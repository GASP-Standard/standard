import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { loadStandard } from "../src/loader.js";
import { fillTemplate } from "../src/tools.js";
import { DIALECT, DIALECTS } from "../src/dialect.js";
import { DERIVED_FIELDS, deriveCelFromText, referenceDerivationSql, revenueEventDerivation, revenueEventDerivationSql } from "../src/cel.js";
import { adapterToOssie } from "../src/ossie/adapt.js";
import { ossieYaml } from "../src/ossie/index.js";
import { HISTORY_START, type Row } from "../src/synthetic.js";
import { fixture, adapter, fixtureDb, runTemplate } from "./fixture-db.js";

// The CEL derivation rules (standard/cel.md, "Deriving Revenue Events from a
// Subscription Ledger") run over the synthetic subscription snapshots and must
// give back the synthetic revenue events, which the generator wrote from the same
// stories without going through the rules.

const data = loadStandard();
let db: PGlite;
beforeAll(async () => { db = await fixtureDb(); }, 120_000);
afterAll(async () => { await db?.close(); });

const MONTHS: Array<[string, string]> = [["2026-01-01", "2026-01-31"], ["2026-02-01", "2026-02-28"], ["2026-03-01", "2026-03-31"], ["2026-04-01", "2026-04-30"], ["2026-05-01", "2026-05-31"], ["2026-06-01", "2026-06-30"]];
const MOVEMENTS = ["new", "expansion", "contraction", "churn", "reactivation"] as const;

type Derived = Record<(typeof DERIVED_FIELDS)[number], unknown>;
/** A date value as YYYY-MM-DD, whether PGlite returned a Date or the generator a string. */
const day = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
const key = (r: Record<string, unknown>) => [r.customer_id, r.subscription_id, day(r.event_date), r.event_type, Number(r.mrr_change), Number(r.prior_mrr), Number(r.new_mrr), r.segment, r.lifecycle_attribution].join("|");

/** The derivation compiled over the fixture adapter and run on the fixture, optionally over a view in place of the subscription table. */
/** The fixture adapter with a different table behind the subscription dataset: its dataset entry and its column mappings point at it. */
function adapterOver(table: string) {
  const from = `${adapter.datasets.subscription}.`;
  return { ...adapter, datasets: { ...adapter.datasets, subscription: table }, mappings: adapter.mappings.map((m: { warehouseRef: string }) => (m.warehouseRef.startsWith(from) ? { ...m, warehouseRef: `${table}.${m.warehouseRef.slice(from.length)}` } : m)) };
}

async function derive(table?: string): Promise<Derived[]> {
  const a = table ? adapterOver(table) : adapter;
  const filled = fillTemplate(revenueEventDerivation({ dialect: "postgres", currency: "USD" }), a, data);
  expect(filled.missingFields).toEqual([]);
  expect(filled.missingTables).toEqual([]);
  return (await db.query<Derived>(filled.sql)).rows;
}

/** The generator's revenue events the ledger can show: movements (not renewals) from the first snapshot date on. */
const expected = (): Row[] => fixture.tables.revenue_event.filter((r) => r.event_type !== "renewal" && String(r.event_date) > HISTORY_START);

describe("revenue event derivation", () => {
  it("fills over the fixture adapter and reads the subscription dataset alone", () => {
    const t = revenueEventDerivation({ currency: "USD" });
    expect(t.datasets).toEqual(["subscription"]);
    expect(t.placeholders.every((p) => p.endsWith("@subscription"))).toBe(true);
    expect(() => revenueEventDerivation({ currency: "dollars" })).toThrow(/ISO 4217/);
  });

  it("reproduces every synthetic movement from the daily snapshots, row for row", async () => {
    const got = await derive();
    const want = expected();
    expect(want.length).toBeGreaterThan(30);
    expect(got.length).toBe(want.length);
    expect(new Set(got.map(key))).toEqual(new Set(want.map(key)));
  });

  it("keeps the CEL row identity and writes the defaults the ledger allows", async () => {
    for (const r of await derive()) {
      expect(Number(r.prior_mrr) + Number(r.mrr_change)).toBe(Number(r.new_mrr));
      expect(r.currency).toBe("USD");
      expect(r.change_nature).toBe("permanent");
      expect(r.expansion_classification).toBeNull();
      expect(r.event_id).toBe(`${r.subscription_id}:${day(r.event_date)}`);
      expect(MOVEMENTS).toContain(r.event_type);
    }
  });

  it("treats the ledger's first snapshot as the opening balance, so a customer active before it is not new", async () => {
    const got = await derive();
    const c21 = got.filter((r) => r.customer_id === "c21");
    expect(c21.map((r) => [r.event_type, Number(r.prior_mrr), Number(r.new_mrr)])).toEqual([["churn", 900, 0]]);
    expect(got.some((r) => day(r.event_date) === HISTORY_START)).toBe(false);
  });

  it("agrees with the compiled movement metrics in every month", async () => {
    const got = await derive();
    for (const [start, end] of MONTHS) {
      const inMonth = got.filter((r) => day(r.event_date) >= start && day(r.event_date) <= end);
      const sum = (type: string) => inMonth.filter((r) => r.event_type === type).reduce((s, r) => s + Number(r.mrr_change), 0);
      // A negated zero: -0 is not Object.is-equal to 0.
      const neg = (x: number) => (x === 0 ? 0 : -x);
      expect(sum("new"), `new ${start}`).toBe(await runTemplate(db, data, "new_mrr", start, end));
      expect(sum("expansion"), `expansion ${start}`).toBe(await runTemplate(db, data, "expansion_mrr", start, end));
      expect(neg(sum("contraction")), `contraction ${start}`).toBe(await runTemplate(db, data, "contraction_mrr", start, end));
      expect(neg(sum("churn")), `churn ${start}`).toBe(await runTemplate(db, data, "churned_mrr", start, end));
      expect(sum("reactivation"), `reactivation ${start}`).toBe(await runTemplate(db, data, "reactivation_mrr", start, end));
    }
  });

  it("nets the movements inside a snapshot interval: month-end snapshots give the same net change per month, dated the month end", async () => {
    // A month-end ledger: the last snapshot of each month. Its first date is the opening balance.
    await db.exec(`CREATE OR REPLACE VIEW month_end_subscriptions AS SELECT * FROM gasp_subscriptions
      WHERE snapshot_day = CAST(DATE_TRUNC('month', snapshot_day) + INTERVAL '1 month' - INTERVAL '1 day' AS DATE)`);
    const monthly = await derive("month_end_subscriptions");
    const daily = await derive();
    for (const [start, end] of MONTHS) {
      const within = (rows: Derived[]) => rows.filter((r) => day(r.event_date) >= start && day(r.event_date) <= end);
      const byType = (rows: Derived[]) => Object.fromEntries(MOVEMENTS.map((t) => [t, within(rows).filter((r) => r.event_type === t).reduce((s, r) => s + Number(r.mrr_change), 0)]));
      const net = (rows: Derived[]) => within(rows).reduce((s, r) => s + Number(r.mrr_change), 0);
      expect(net(monthly), start).toBe(net(daily));
      // The split by type also holds here only because no synthetic customer has two movements in one month; netting would move it otherwise.
      expect(byType(monthly), start).toEqual(byType(daily));
      for (const r of within(monthly)) expect(day(r.event_date)).toBe(end);
    }
  }, 30_000);

  it("types several steps of one customer on one date from the day's start and end MRR", async () => {
    // Two subscriptions per customer, hand-built under the fixture's column names. 2026-01-01 is the opening balance.
    await db.exec(`CREATE TABLE two_sub_ledger AS SELECT * FROM gasp_subscriptions WHERE false`);
    const rows: Array<[string, string, string, number, string]> = [
      // k1: plan swap on 2026-03-01, s1 (100) cancelled and s2 (120) started: an expansion and a contraction, 100 to 120.
      ["s1", "k1", "2026-01-01", 100, "active"], ["s1", "k1", "2026-02-01", 100, "active"], ["s1", "k1", "2026-03-01", 0, "cancelled"],
      ["s2", "k1", "2026-03-01", 120, "active"],
      // k2: both subscriptions cancelled on 2026-02-01: two churns, 150 to 0; then one comes back on 2026-04-01: reactivation.
      ["s3", "k2", "2026-01-01", 100, "active"], ["s3", "k2", "2026-02-01", 0, "cancelled"], ["s3", "k2", "2026-04-01", 80, "active"],
      ["s4", "k2", "2026-01-01", 50, "active"], ["s4", "k2", "2026-02-01", 0, "cancelled"],
      // k3: a new customer with two subscriptions on one date: two new events; a second-subscription add later is an expansion.
      ["s5", "k3", "2026-02-01", 30, "active"], ["s6", "k3", "2026-02-01", 70, "active"],
      ["s7", "k3", "2026-05-01", 20, "active"],
    ];
    for (const [sub, cust, d, mrr, status] of rows) {
      await db.exec(`INSERT INTO two_sub_ledger (subscription_id, customer_id, snapshot_day, mrr, status, segment) VALUES ('${sub}', '${cust}', DATE '${d}', ${mrr}, '${status}', 'smb')`);
    }
    const got = (await derive("two_sub_ledger")).map((r) => [r.customer_id, r.subscription_id, day(r.event_date), r.event_type, Number(r.mrr_change), Number(r.prior_mrr), Number(r.new_mrr)]);
    expect(got).toEqual([
      ["k2", "s3", "2026-02-01", "churn", -100, 150, 50],
      ["k2", "s4", "2026-02-01", "churn", -50, 50, 0],
      ["k3", "s5", "2026-02-01", "new", 30, 0, 30],
      ["k3", "s6", "2026-02-01", "new", 70, 30, 100],
      ["k1", "s2", "2026-03-01", "expansion", 120, 100, 220],
      ["k1", "s1", "2026-03-01", "contraction", -100, 220, 120],
      ["k2", "s3", "2026-04-01", "reactivation", 80, 0, 80],
      ["k3", "s7", "2026-05-01", "expansion", 20, 100, 120],
    ]);
    // first_snapshot: steps makes the opening rows steps from 0, so k1 and k2 are new on 2026-01-01.
    const steps = fillTemplate(revenueEventDerivation({ dialect: "postgres", currency: "USD", firstSnapshot: "steps" }), adapterOver("two_sub_ledger"), data).sql;
    const first = (await db.query<Derived>(steps)).rows.filter((r) => day(r.event_date) === "2026-01-01").map((r) => [r.customer_id, r.subscription_id, r.event_type, Number(r.new_mrr)]);
    expect(first).toEqual([["k1", "s1", "new", 100], ["k2", "s3", "new", 100], ["k2", "s4", "new", 150]]);
  });

  it("compiles in every dialect without that dialect's forbidden tokens", () => {
    for (const dialect of DIALECTS) {
      const sql = revenueEventDerivationSql({ dialect, currency: "EUR" });
      for (const token of DIALECT[dialect].forbidden) expect(sql, `${dialect}: ${token}`).not.toContain(token);
      expect(sql).toContain("'EUR' AS currency");
    }
    expect(revenueEventDerivationSql({ dialect: "bigquery", currency: "EUR" })).toContain("CAST(snapshot_date AS STRING)");
    expect(revenueEventDerivationSql({ dialect: "bigquery", currency: "EUR" })).toContain("CAST(NULL AS STRING) AS expansion_classification");
    // Redshift's CONCAT takes two arguments, so the id is built with ||.
    expect(revenueEventDerivationSql({ dialect: "postgres", currency: "EUR" })).not.toContain("CONCAT(");
  });

  it("is printed in standard/cel.md as the reference SQL", () => {
    const cel = readFileSync(join(import.meta.dirname, "..", "..", "standard", "cel.md"), "utf8");
    const section = cel.slice(cel.indexOf("## Deriving Revenue Events from a Subscription Ledger"));
    const block = /```sql\n([\s\S]*?)\n```/.exec(section);
    expect(block, "cel.md has a SQL block in the derivation section").toBeTruthy();
    expect(block![1].trim()).toBe(referenceDerivationSql().trim());
  });
});

describe("derive_cel tool", () => {
  const acme = readFileSync(join(import.meta.dirname, "fixture", "acme-adapter.json"), "utf8");
  const fixtureAdapter = JSON.stringify(adapter);

  it("asks for the mapping and the currency, and refuses a code that is not ISO 4217", () => {
    expect(deriveCelFromText(undefined, undefined, data, { currency: "USD" })).toContain("Pass adapter");
    expect(deriveCelFromText(fixtureAdapter, undefined, data, {})).toContain("Pass currency");
    expect(deriveCelFromText(fixtureAdapter, undefined, data, { currency: "dollars" })).toContain("ISO 4217");
    expect(deriveCelFromText(fixtureAdapter, undefined, data, { currency: "USD", dialect: "oracle" })).toContain("Unknown SQL dialect");
  });

  it("compiles over the fixture adapter and the SQL alone runs and yields every movement", async () => {
    const sql = deriveCelFromText(fixtureAdapter, undefined, data, { currency: "usd", output: "sql" });
    expect(sql).not.toContain("{{");
    expect(sql).toContain("'USD' AS currency");
    const rows = (await db.query<Derived>(sql)).rows;
    expect(rows.length).toBe(expected().length);
    const report = deriveCelFromText(fixtureAdapter, undefined, data, { currency: "USD" });
    expect(report).toContain("6 / 6 fields mapped");
    expect(report).toContain("postgres (from the adapter's warehouse");
    expect(report).toContain("deriving-revenue-events-from-a-subscription-ledger");
    expect(report).toContain("`snapshot_date` (subscription) → `gasp_subscriptions.snapshot_day`");
  });

  it("takes the dialect from the warehouse and names the fields a mapping lacks", () => {
    const report = deriveCelFromText(acme, undefined, data, { currency: "EUR" });
    expect(report).toContain("snowflake (from the adapter's warehouse");
    expect(report).toContain("CAST(snapshot_date AS VARCHAR)");
    expect(report).toMatch(/Unmapped fields \(left as placeholders\):.*`segment@subscription`/);
    expect(report).toContain("(transform: {{value}} / 100)");
  });

  it("takes an Ossie mapping with its model as generate_query does", () => {
    const form = adapterToOssie(adapter, data);
    const sql = deriveCelFromText(ossieYaml(form.mapping), ossieYaml(form.model), data, { currency: "USD", output: "sql" });
    expect(sql).not.toContain("{{");
    expect(sql).toContain("FROM gasp_subscriptions");
  });
});
