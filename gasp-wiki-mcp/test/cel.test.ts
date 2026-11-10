import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { loadStandard } from "../src/loader.js";
import { fillTemplate } from "../src/tools.js";
import { DIALECT, DIALECTS } from "../src/dialect.js";
import { CREDIT_DERIVED_FIELDS, DERIVED_FIELDS, creditEventDerivation, creditEventDerivationSql, creditUsageChangesSql, deriveCelFromText, invoiceLedgerSql, referenceCreditEventSql, referenceCreditUsageSql, referenceDerivationSql, referenceInvoiceLedgerSql, referenceUsageSql, revenueEventDerivation, revenueEventDerivationSql, usageChangesSql, type DerivationOptions } from "../src/cel.js";
import { adapterToOssie } from "../src/ossie/adapt.js";
import { ossieYaml } from "../src/ossie/index.js";
import { CREDITS, HISTORY_START, USAGE, addDays, customerStatusOn, mrrOn, type Row } from "../src/synthetic.js";
import { fixture, adapter, fixtureDb, runTemplate } from "./fixture-db.js";
import { acmeAdapterText } from "./ossie-helpers.js";

// The CEL derivation rules (standard/cel.md, "Deriving Revenue Events from a
// Subscription Ledger") run over the synthetic subscription snapshots and must
// give back the synthetic revenue events, which the generator wrote from the same
// stories without going through the rules. The invoice source ("Deriving Revenue
// Events from an Invoice Ledger") runs over the synthetic monthly invoices and
// the usage branch ("Deriving Usage Realisation") over the usage records, each
// checked against what the stories say.

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

/** The fixture adapter with a different table behind a dataset: its dataset entry and its column mappings point at it. */
function adapterOver(table: string, dataset = "subscription") {
  const from = `${adapter.datasets[dataset]}.`;
  return { ...adapter, datasets: { ...adapter.datasets, [dataset]: table }, mappings: adapter.mappings.map((m: { warehouseRef: string }) => (m.warehouseRef.startsWith(from) ? { ...m, warehouseRef: `${table}.${m.warehouseRef.slice(from.length)}` } : m)) };
}

/** The derivation compiled over the fixture adapter and run on the fixture, optionally over another table in place of a dataset's. */
async function derive(table?: string, opts: Partial<DerivationOptions> = {}, dataset = "subscription"): Promise<Derived[]> {
  const a = table ? adapterOver(table, dataset) : adapter;
  const filled = fillTemplate(revenueEventDerivation({ dialect: "postgres", currency: "USD", ...opts }), a, data);
  expect(filled.missingFields).toEqual([]);
  expect(filled.missingTables).toEqual([]);
  return (await db.query<Derived>(filled.sql)).rows;
}

const MONTH_STARTS = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"];
const monthEnd = (start: string) => addDays(MONTH_STARTS[MONTH_STARTS.indexOf(start) + 1] ?? "2026-07-01", -1);
const subOf = (c: string) => `s${c.slice(1)}`;
/** A derived or expected row without the tags, for comparing the invoice ledger's events. */
const ikey = (r: Record<string, unknown>) => [r.customer_id, r.subscription_id, day(r.event_date), r.event_type, Number(r.mrr_change), Number(r.prior_mrr), Number(r.new_mrr)].join("|");
/** The SQL block under a heading of cel.md. */
function celBlock(heading: string): string {
  const cel = readFileSync(join(import.meta.dirname, "..", "..", "standard", "cel.md"), "utf8");
  const section = cel.slice(cel.indexOf(heading));
  const block = /```sql\n([\s\S]*?)\n```/.exec(section);
  expect(block, `cel.md has a SQL block under ${heading}`).toBeTruthy();
  return block![1].trim();
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
    expect(revenueEventDerivationSql({ dialect: "bigquery", currency: "EUR" })).toContain("CAST(NULL AS STRING) ELSE 'usage_realisation' END AS expansion_classification");
    for (const dialect of DIALECTS) {
      for (const opts of [{ source: "invoice" as const }, { usage: true }, { source: "invoice" as const, usage: true }, { usage: true, usageSource: "credit_event" as const }, { source: "invoice" as const, usage: true, usageSource: "credit_event" as const }]) {
        const sql = revenueEventDerivationSql({ dialect, currency: "EUR", ...opts });
        for (const token of DIALECT[dialect].forbidden) expect(sql, `${dialect} ${JSON.stringify(opts)}: ${token}`).not.toContain(token);
      }
      const credit = creditEventDerivationSql({ dialect, currency: "EUR" });
      for (const token of DIALECT[dialect].forbidden) expect(credit, `${dialect} credit events: ${token}`).not.toContain(token);
      expect(credit).toContain("'EUR' AS currency");
    }
    expect(revenueEventDerivationSql({ dialect: "snowflake", currency: "EUR", usage: true, usageSource: "credit_event" })).toContain("LAST_DAY(CAST({{event_date@credit_event}} AS DATE)) AS period_end");
    expect(revenueEventDerivationSql({ dialect: "bigquery", currency: "EUR", usage: true, usageSource: "credit_event" })).toContain("CAST(DATE_ADD(period_end, INTERVAL 1 DAY) AS DATE)");
    expect(creditEventDerivationSql({ dialect: "bigquery", currency: "EUR" })).toContain("CAST(subscription_id AS STRING) || ':overage:' || CAST(period_end AS STRING) AS event_id");
    expect(() => revenueEventDerivationSql({ currency: "EUR", usage: true, usageSource: "ledger" as never })).toThrow(/usageSource must be/);
    expect(() => creditEventDerivationSql({ currency: "euros" })).toThrow(/ISO 4217/);
    expect(revenueEventDerivationSql({ dialect: "bigquery", currency: "EUR", source: "invoice" })).toContain("CAST(DATE_ADD(service_period_end, INTERVAL 1 DAY) AS DATE)");
    expect(revenueEventDerivationSql({ dialect: "snowflake", currency: "EUR", usage: true })).toContain("(DATEDIFF(day, {{period_start@usage_record}}, {{period_end@usage_record}}) + 1) * 12.0 / 365.25");
    // Redshift's CONCAT takes two arguments, so the id is built with ||.
    expect(revenueEventDerivationSql({ dialect: "postgres", currency: "EUR" })).not.toContain("CONCAT(");
  });

  it("is printed in standard/cel.md as the reference SQL", () => {
    expect(celBlock("## Deriving Revenue Events from a Subscription Ledger")).toBe(referenceDerivationSql().trim());
  });
});

describe("invoice ledger derivation", () => {
  /** What the synthetic invoices say: each invoiced customer's MRR on the 1st of each month (0 when not invoiced), its changes typed by the rules. */
  function expectedFromInvoices() {
    const invoiced = [...new Set(fixture.tables.invoice.filter((r) => r.subscription_id !== null).map((r) => String(r.customer_id)))];
    const rows: Array<Record<string, unknown>> = [];
    for (const c of invoiced) {
      const level = (d: string) => (customerStatusOn(c, d) === "active" ? mrrOn(c, d) : 0);
      let mrr = level(MONTH_STARTS[0]);
      for (const d of MONTH_STARTS.slice(1)) {
        const next = level(d);
        if (next === mrr) continue;
        const event_type = next === 0 ? "churn" : mrr === 0 ? "new" : next > mrr ? "expansion" : "contraction";
        rows.push({ customer_id: c, subscription_id: subOf(c), event_date: d, event_type, mrr_change: next - mrr, prior_mrr: mrr, new_mrr: next });
        mrr = next;
      }
    }
    return rows;
  }

  it("reads the invoice dataset alone, one row per service period, and gives the invoiced customers' month-start movements", async () => {
    const t = revenueEventDerivation({ currency: "USD", source: "invoice" });
    expect(t.datasets).toEqual(["invoice"]);
    expect(t.placeholders.every((p) => p.endsWith("@invoice"))).toBe(true);
    expect(() => revenueEventDerivation({ currency: "USD", source: "ledger" as never })).toThrow(/source must be/);
    const got = await derive(undefined, { source: "invoice" });
    const want = expectedFromInvoices();
    expect(want.length).toBe(7);
    expect(got.map(ikey).sort()).toEqual(want.map(ikey).sort());
    for (const r of got) {
      expect(r.segment).toBeNull();
      expect(r.change_nature).toBe("permanent");
      expect(r.expansion_classification).toBeNull();
      expect(r.event_id).toBe(`${r.subscription_id}:${day(r.event_date)}`);
    }
  });

  it("dates a lapsed subscription's churn the day after its last period, within the horizon, and leaves a current one alone", async () => {
    const got = await derive(undefined, { source: "invoice" });
    expect(got.filter((r) => r.event_type === "churn").map((r) => [r.customer_id, day(r.event_date)])).toEqual([["c03", "2026-03-01"], ["c05", "2026-05-01"]]);
    // June's periods end at the horizon (the latest period start, 2026-06-01): no row on 2026-07-01, so nobody churns there.
    expect(got.some((r) => day(r.event_date) > "2026-06-01")).toBe(false);
    // c08 churned on 2026-06-12, after its June invoice: the next billing run shows it.
    expect(got.filter((r) => r.customer_id === "c08")).toEqual([]);
    // A customer invoiced from the first date is an opening balance; with first_snapshot: steps every January invoice is a new event.
    expect(got.some((r) => day(r.event_date) === "2026-01-01")).toBe(false);
    const steps = await derive(undefined, { source: "invoice", firstSnapshot: "steps" });
    expect(steps.filter((r) => day(r.event_date) === "2026-01-01").map((r) => [r.customer_id, r.event_type, Number(r.new_mrr)])).toEqual(
      ["c01", "c02", "c03", "c04", "c05", "c06", "c07", "c08"].map((c) => [c, "new", mrrOn(c, "2026-01-01")]),
    );
  });

  it("states MRR as the amount over the months covered, sums the invoices covering a date, reads a corrected invoice at its latest snapshot and skips a one-off", async () => {
    await db.exec("CREATE TABLE invoice_ledger AS SELECT * FROM gasp_invoices WHERE false");
    const rows: Array<[id: string, customer: string, sub: string | null, snapshot: string, start: string | null, end: string | null, amount: number]> = [
      // k1: quarterly, 3,000 for the first quarter and 3,300 for the second: 1,000 a month, then +100 on 2026-04-01.
      ["iq1", "k1", "q1", "2026-01-01", "2026-01-01", "2026-03-31", 3000], ["iq2", "k1", "q1", "2026-04-01", "2026-04-01", "2026-06-30", 3300],
      // k2: 200 a month, January to June, with an add-on invoice on the same subscription for March, corrected from 80 to 90 on 2026-03-05.
      ...MONTH_STARTS.map((d, i): [string, string, string, string, string, string, number] => [`im${i + 1}`, "k2", "m1", d, d, monthEnd(d), 200]),
      ["io1", "k2", "m1", "2026-03-01", "2026-03-01", "2026-03-31", 80], ["io1", "k2", "m1", "2026-03-05", "2026-03-01", "2026-03-31", 90],
      // k2 also gets a one-off invoice with no service period and one with a subscription but no period: neither is recurring.
      ["ix1", "k2", null, "2026-05-10", null, null, 0], ["ix2", "k2", "m1", "2026-05-10", null, null, 0],
      // k3: annual, 12,000 for the year: 1,000 a month, current until 2027.
      ["ia1", "k3", "a1", "2026-01-01", "2026-01-01", "2026-12-31", 12000],
      // k4: a fortnight for 500: 14 days are 0.46 of a month, so 1,087.05 a month, lapsing on 2026-02-15.
      ["if1", "k4", "f1", "2026-02-01", "2026-02-01", "2026-02-14", 500],
    ];
    const lit = (v: string | number | null) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v}'`);
    for (const [id, c, sub, snap, start, end, amount] of rows) {
      await db.exec(`INSERT INTO invoice_ledger (invoice_id, customer_id, subscription_id, snapshot_date, service_period_start, service_period_end, recurring_amount, invoice_amount, currency)
        VALUES ('${id}', '${c}', ${lit(sub)}, DATE '${snap}', ${start ? `DATE '${start}'` : "NULL"}, ${end ? `DATE '${end}'` : "NULL"}, ${amount}, ${amount}, 'USD')`);
    }
    const got = (await derive("invoice_ledger", { source: "invoice", firstSnapshot: "steps" }, "invoice")).map(ikey);
    expect(got).toEqual([
      "k1|q1|2026-01-01|new|1000|0|1000",
      "k2|m1|2026-01-01|new|200|0|200",
      "k3|a1|2026-01-01|new|1000|0|1000",
      "k4|f1|2026-02-01|new|1087.05|0|1087.05",
      "k4|f1|2026-02-15|churn|-1087.05|1087.05|0",
      "k2|m1|2026-03-01|expansion|90|200|290",
      "k1|q1|2026-04-01|expansion|100|1000|1100",
      "k2|m1|2026-04-01|contraction|-90|290|200",
    ]);
  });

  it("is the subscription derivation from the ledger on, and cel.md prints its ledger", () => {
    const sql = revenueEventDerivationSql({ currency: "USD", source: "invoice" });
    expect(sql.startsWith(`WITH ${invoiceLedgerSql("postgres")},\nsteps AS (`)).toBe(true);
    expect(sql.slice(sql.indexOf("\nsteps AS ("))).toBe(revenueEventDerivationSql({ currency: "USD" }).slice(revenueEventDerivationSql({ currency: "USD" }).indexOf("\nsteps AS (")));
    expect(celBlock("## Deriving Revenue Events from an Invoice Ledger")).toBe(referenceInvoiceLedgerSql().trim());
  });
});

describe("usage realisation", () => {
  /** The pairs the synthetic usage records call for: each month whose usage exceeds the commitment, which is the MRR on the 1st. */
  function expectedPairs() {
    const rows: Array<[string, string, string, string, number, string]> = [];
    for (const [c, byMonth] of Object.entries(USAGE)) {
      for (const [month, used] of Object.entries(byMonth)) {
        const committed = mrrOn(c, `${month}-01`);
        if (committed <= 0 || used <= committed) continue;
        const end = monthEnd(`${month}-01`);
        rows.push([c, subOf(c), end, "expansion", used - committed, "temporary"], [c, subOf(c), addDays(end, 1), "contraction", committed - used, "scheduled_reversal"]);
      }
    }
    return rows.map((r) => r.join("|"));
  }
  const ukey = (r: Derived) => [r.customer_id, r.subscription_id, day(r.event_date), r.event_type, Number(r.mrr_change), r.change_nature].join("|");

  it("adds a pair per period over the commitment, dated its end and the next day, tagged usage_realisation, and nothing within it", async () => {
    const t = revenueEventDerivation({ currency: "USD", usage: true });
    expect(t.datasets).toEqual(["subscription", "usage_record"]);
    const got = await derive(undefined, { usage: true });
    const usage = got.filter((r) => r.expansion_classification === "usage_realisation");
    expect(usage.length).toBe(12);
    expect(usage.map(ukey).sort()).toEqual(expectedPairs().sort());
    for (const r of usage) {
      expect(r.lifecycle_attribution).toBe(r.event_type === "expansion" ? "expansion" : "retention");
      expect(r.event_id).toBe(`${r.subscription_id}:usage:${day(r.event_date)}`);
      expect(r.segment).toBeNull();
    }
    expect(got.filter((r) => r.change_nature !== "permanent").length).toBe(usage.length);
  });

  it("chains the pairs with the ledger's steps and leaves the ledger's own events as they were", async () => {
    const got = await derive(undefined, { usage: true });
    for (const r of got) expect(Number(r.prior_mrr) + Number(r.mrr_change)).toBe(Number(r.new_mrr));
    expect(new Set(got.filter((r) => r.change_nature === "permanent").map(key))).toEqual(new Set((await derive()).map(key)));
    // c07 committed 3,000 on 2026-05-01 and used 3,900; its 2026-05-06 expansion to 4,000 came first, so May's pair chains from 4,000.
    expect(got.filter((r) => r.customer_id === "c07" && day(r.event_date) >= "2026-05-31" && day(r.event_date) <= "2026-06-01").map((r) => [day(r.event_date), Number(r.prior_mrr), Number(r.new_mrr)])).toEqual([["2026-05-31", 4000, 4900], ["2026-06-01", 4900, 4000]]);
    // June's overage reverses on 2026-07-01, after the ledger's last day: the reversal is known on the period's end and is written with it.
    expect(got.filter((r) => day(r.event_date) === "2026-07-01").map(ukey)).toEqual(["c07|s07|2026-07-01|contraction|-500|scheduled_reversal"]);
  });

  it("is an expansion and a contraction whatever the customer's MRR on the day", async () => {
    // The invoice ledger holds no invoice for c10, so its pair chains from 0 and is still typed as the rules say, not as new and churn.
    const got = await derive(undefined, { source: "invoice", usage: true });
    expect(got.filter((r) => r.customer_id === "c10").map((r) => [day(r.event_date), r.event_type, Number(r.prior_mrr), Number(r.new_mrr)])).toEqual([["2026-05-31", "expansion", 0, 200], ["2026-06-01", "contraction", 200, 0]]);
    // The ledger's own events keep their date, type and change; where a pair shares a day with one, the chain runs through the lift
    // (c07's June invoice lands on the day May's overage reverses, so its expansion chains from 3,900, not 3,000).
    const bare = (r: Derived) => ikey(r).split("|").slice(0, 5).join("|");
    expect(got.filter((r) => r.change_nature === "permanent").map(bare).sort()).toEqual((await derive(undefined, { source: "invoice" })).map(bare).sort());
    expect(got.filter((r) => r.customer_id === "c07" && day(r.event_date) === "2026-06-01").map(ikey)).toEqual(["c07|s07|2026-06-01|expansion|1000|3900|4900", "c07|s07|2026-06-01|contraction|-900|4900|4000"]);
  });

  it("states a longer period's overage as MRR and ignores a period with no overage or no bounds", async () => {
    await db.exec("CREATE TABLE usage_ledger AS SELECT * FROM gasp_usage_records WHERE false");
    const rows: Array<[sub: string, customer: string, start: string | null, end: string | null, committed: number, used: number]> = [
      ["s01", "c01", "2026-01-01", "2026-03-31", 3000, 3900], // a quarter: 900 over three months is 300 a month
      ["s01", "c01", "2026-04-01", "2026-06-30", 4500, 4500], // met exactly: nothing
      ["s02", "c02", "2026-02-01", "2026-02-28", 2000, 2000.004], // under a cent over: nothing
      ["s02", "c02", null, "2026-03-31", 2000, 2500], // no start: nothing
    ];
    for (const [sub, c, start, end, committed, used] of rows) {
      await db.exec(`INSERT INTO usage_ledger (subscription_id, customer_id, period_start, period_end, committed_amount, usage_amount, currency)
        VALUES ('${sub}', '${c}', ${start ? `DATE '${start}'` : "NULL"}, ${end ? `DATE '${end}'` : "NULL"}, ${committed}, ${used}, 'USD')`);
    }
    const got = (await derive("usage_ledger", { usage: true }, "usage_record")).filter((r) => r.change_nature !== "permanent").map(ukey);
    expect(got).toEqual(["c01|s01|2026-03-31|expansion|300|temporary", "c01|s01|2026-04-01|contraction|-300|scheduled_reversal"]);
  });

  it("is appended to the subscription derivation's changes, and cel.md prints its CTEs", () => {
    const sql = revenueEventDerivationSql({ currency: "USD", usage: true });
    expect(sql).toContain(`),\n${usageChangesSql("postgres")},\nchanges AS (`);
    expect(sql).toContain("  WHERE mrr <> prior_sub_mrr\n  UNION ALL\n  SELECT subscription_id, customer_id, snapshot_date, segment, opening, mrr_change, kind FROM usage_changes\n)");
    expect(revenueEventDerivationSql({ currency: "USD" })).not.toContain("usage_changes");
    expect(celBlock("## Deriving Usage Realisation")).toBe(referenceUsageSql().trim());
  });
});

describe("usage realisation from the credit ledger", () => {
  const ukey = (r: Derived) => [r.customer_id, r.subscription_id, day(r.event_date), r.event_type, Number(r.mrr_change), Number(r.prior_mrr), Number(r.new_mrr), r.change_nature, r.expansion_classification, r.lifecycle_attribution, r.event_id, r.segment].join("|");
  const realised = (rows: Derived[]) => rows.filter((r) => r.expansion_classification === "usage_realisation");

  it("reads the credit_event dataset in place of usage_record, and gives the usage records' pairs for the same customers, row for row", async () => {
    const t = revenueEventDerivation({ currency: "USD", usage: true, usageSource: "credit_event" });
    expect(t.datasets).toEqual(["subscription", "credit_event"]);
    expect(t.placeholders.filter((p) => !p.endsWith("@subscription")).sort()).toEqual(["consumption_basis@credit_event", "credit_amount@credit_event", "credit_event_type@credit_event", "customer_id@credit_event", "event_date@credit_event", "subscription_id@credit_event"]);
    expect(t.parameterizedQuery).not.toContain("usage_record");
    const fromCredit = realised(await derive(undefined, { usage: true, usageSource: "credit_event" }));
    const fromUsage = realised(await derive(undefined, { usage: true }));
    expect(fromUsage.length).toBe(12);
    const usageCustomers = new Set(Object.keys(USAGE));
    expect(fromCredit.filter((r) => usageCustomers.has(String(r.customer_id))).map(ukey).sort()).toEqual(fromUsage.map(ukey).sort());
  });

  it("realises an exhausted drawdown's overage and nothing from committed drawdowns, expiries or pay-as-you-go", async () => {
    const got = await derive(undefined, { usage: true, usageSource: "credit_event" });
    const others = realised(got).filter((r) => !(String(r.customer_id) in USAGE));
    // The stories' overage outside the usage customers: c11 ran out of its first prepaid balance in March.
    const overage = Object.entries(CREDITS).flatMap(([c, rows]) => rows.filter((r) => r.basis === "overage").map((r) => [c, r.date, -r.amount] as const));
    expect(overage).toEqual([["c11", "2026-03-31", 300]]);
    expect(others.map((r) => [r.customer_id, day(r.event_date), r.event_type, Number(r.mrr_change), r.change_nature])).toEqual([
      ["c11", "2026-03-31", "expansion", 300, "temporary"],
      ["c11", "2026-04-01", "contraction", -300, "scheduled_reversal"],
    ]);
    for (const c of ["c09", "c01", "c06"]) expect(realised(got).filter((r) => r.customer_id === c)).toEqual([]);
    for (const r of got) expect(Number(r.prior_mrr) + Number(r.mrr_change)).toBe(Number(r.new_mrr));
    expect(new Set(got.filter((r) => r.change_nature === "permanent").map(key))).toEqual(new Set((await derive()).map(key)));
  });

  it("sums a month's overage consumption into one pair dated the month's last day and ignores the other rows", async () => {
    await db.exec("CREATE TABLE credit_ledger AS SELECT * FROM gasp_credit_events WHERE false");
    const rows: Array<[id: string, customer: string, sub: string | null, date: string | null, type: string, amount: number, basis: string | null]> = [
      ["k1", "c01", "s01", "2026-02-03", "consumption", -100, "overage"], // two overage rows in February: 150.5
      ["k2", "c01", "s01", "2026-02-20", "consumption", -50.5, "overage"],
      ["k3", "c01", "s01", "2026-02-10", "consumption", -999, "committed"], // drawn from a balance: nothing
      ["k4", "c01", "s01", "2026-02-12", "consumption", -999, "on_demand"], // no commitment: nothing
      ["k5", "c01", "s01", "2026-02-01", "purchase", 5000, null], // a purchase: nothing
      ["k6", "c01", "s01", "2026-02-28", "expiry", -200, null], // an expiry: nothing
      ["k7", "c01", "s01", "2026-04-15", "consumption", -0.004, "overage"], // under a cent: nothing
      ["k8", "c01", null, "2026-05-15", "consumption", -80, "overage"], // no subscription: nothing
      ["k9", "c02", "s02", "2026-12-31", "consumption", -40, "overage"], // the year's last day reverses on the next year's first
    ];
    const lit = (v: string | number | null) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v}'`);
    for (const [id, c, sub, date, type, amount, basis] of rows) {
      await db.exec(`INSERT INTO credit_ledger (event_id, customer_id, sub_ref, event_date, credit_event_type, credit_amount, consumption_basis, currency)
        VALUES ('${id}', '${c}', ${lit(sub)}, ${date ? `DATE '${date}'` : "NULL"}, '${type}', ${amount}, ${lit(basis)}, 'USD')`);
    }
    const got = (await derive("credit_ledger", { usage: true, usageSource: "credit_event" }, "credit_event")).filter((r) => r.change_nature !== "permanent").map((r) => [r.customer_id, r.subscription_id, day(r.event_date), r.event_type, Number(r.mrr_change), r.change_nature, r.event_id]);
    expect(got).toEqual([
      ["c01", "s01", "2026-02-28", "expansion", 150.5, "temporary", "s01:usage:2026-02-28"],
      ["c01", "s01", "2026-03-01", "contraction", -150.5, "scheduled_reversal", "s01:usage:2026-03-01"],
      ["c02", "s02", "2026-12-31", "expansion", 40, "temporary", "s02:usage:2026-12-31"],
      ["c02", "s02", "2027-01-01", "contraction", -40, "scheduled_reversal", "s02:usage:2027-01-01"],
    ]);
  });

  it("is appended to the subscription derivation's changes like the usage records, and cel.md prints its CTEs", () => {
    const sql = revenueEventDerivationSql({ currency: "USD", usage: true, usageSource: "credit_event" });
    expect(sql).toContain(`),\n${creditUsageChangesSql("postgres")},\nchanges AS (`);
    expect(sql).toContain("SELECT subscription_id, customer_id, snapshot_date, segment, opening, mrr_change, kind FROM usage_changes\n)");
    // The two sources end in the same usage_changes CTE.
    const tail = (x: string) => x.slice(x.indexOf("usage_changes AS ("));
    expect(tail(creditUsageChangesSql("postgres"))).toBe(tail(usageChangesSql("postgres")));
    expect(celBlock("### Realisation from the Credit Ledger")).toBe(referenceCreditUsageSql().trim());
  });
});

describe("credit event derivation", () => {
  type CreditRow = Record<(typeof CREDIT_DERIVED_FIELDS)[number], unknown>;
  /** The overage the synthetic usage records call for: each month whose usage exceeds the commitment, for the whole overage. */
  function expectedOverage() {
    const rows: string[] = [];
    for (const [c, byMonth] of Object.entries(USAGE)) {
      for (const [month, used] of Object.entries(byMonth)) {
        const committed = mrrOn(c, `${month}-01`);
        if (committed <= 0 || used <= committed) continue;
        rows.push([c, subOf(c), monthEnd(`${month}-01`), committed - used].join("|"));
      }
    }
    return rows;
  }
  const ckey = (r: CreditRow) => [r.customer_id, r.subscription_id, day(r.event_date), Number(r.credit_amount)].join("|");

  it("writes one overage consumption per usage period over its commitment, with the balances empty", async () => {
    const t = creditEventDerivation({ currency: "USD" });
    expect(t.metric).toBe("cel_credit_events");
    expect(t.datasets).toEqual(["usage_record"]);
    expect(t.placeholders.every((p) => p.endsWith("@usage_record"))).toBe(true);
    const filled = fillTemplate(t, adapter, data);
    expect(filled.missingFields).toEqual([]);
    const got = (await db.query<CreditRow>(filled.sql)).rows;
    expect(Object.keys(got[0])).toEqual([...CREDIT_DERIVED_FIELDS]);
    // One event per pair the usage realisation gives.
    expect(got.length).toBe(6);
    expect(got.map(ckey).sort()).toEqual(expectedOverage().sort());
    for (const r of got) {
      expect(r.credit_event_type).toBe("consumption");
      expect(r.consumption_basis).toBe("overage");
      expect(Number(r.credit_amount)).toBeLessThan(0);
      expect(r.credit_balance_before).toBeNull();
      expect(r.credit_balance_after).toBeNull();
      expect(r.expires_on).toBeNull();
      expect(r.segment).toBeNull();
      expect(r.currency).toBe("USD");
      expect(r.event_id).toBe(`${r.subscription_id}:overage:${day(r.event_date)}`);
    }
    // They are the overage rows the synthetic credit ledger holds for the usage customers.
    const ledger = fixture.tables.credit_event.filter((r) => r.consumption_basis === "overage" && String(r.customer_id) in USAGE);
    expect(ledger.map((r) => ckey(r as CreditRow)).sort()).toEqual(got.map(ckey).sort());
  });

  it("states the whole period's overage, not MRR, and ignores a period within the commitment or with no end", async () => {
    await db.exec("CREATE TABLE usage_for_credits AS SELECT * FROM gasp_usage_records WHERE false");
    const rows: Array<[sub: string, customer: string, start: string, end: string | null, committed: number, used: number]> = [
      ["s01", "c01", "2026-01-01", "2026-03-31", 3000, 3900], // a quarter: 900, as billed
      ["s01", "c01", "2026-04-01", "2026-06-30", 4500, 4500], // met exactly: nothing
      ["s02", "c02", "2026-02-01", "2026-02-28", 2000, 2000.004], // under a cent over: nothing
      ["s02", "c02", "2026-03-01", null, 2000, 2500], // no end: nothing
    ];
    for (const [sub, c, start, end, committed, used] of rows) {
      await db.exec(`INSERT INTO usage_for_credits (subscription_id, customer_id, period_start, period_end, committed_amount, usage_amount, currency)
        VALUES ('${sub}', '${c}', DATE '${start}', ${end ? `DATE '${end}'` : "NULL"}, ${committed}, ${used}, 'USD')`);
    }
    const sql = fillTemplate(creditEventDerivation({ currency: "USD" }), adapterOver("usage_for_credits", "usage_record"), data).sql;
    expect((await db.query<CreditRow>(sql)).rows.map(ckey)).toEqual(["c01|s01|2026-03-31|-900"]);
  });

  it("is printed in standard/cel.md as the reference SQL", () => {
    expect(celBlock("### Consumption Events from Usage Records")).toBe(referenceCreditEventSql().trim());
  });
});

describe("derive_cel tool", () => {
  const acme = acmeAdapterText;
  const fixtureAdapter = JSON.stringify(adapter);

  it("asks for the mapping and the currency, and refuses a code that is not ISO 4217", () => {
    expect(deriveCelFromText(undefined, undefined, data, { currency: "USD" })).toContain("Pass adapter");
    expect(deriveCelFromText(fixtureAdapter, undefined, data, {})).toContain("Pass currency");
    expect(deriveCelFromText(fixtureAdapter, undefined, data, { currency: "dollars" })).toContain("ISO 4217");
    expect(deriveCelFromText(fixtureAdapter, undefined, data, { currency: "USD", dialect: "oracle" })).toContain("Unknown SQL dialect");
  });

  it("compiles over the fixture adapter, reads its usage records unasked, and the SQL alone runs and yields every movement", async () => {
    const sql = deriveCelFromText(fixtureAdapter, undefined, data, { currency: "usd", output: "sql" });
    expect(sql).not.toContain("{{");
    expect(sql).toContain("'USD' AS currency");
    const rows = (await db.query<Derived>(sql)).rows;
    expect(rows.length).toBe(expected().length + 12);
    expect((await db.query<Derived>(deriveCelFromText(fixtureAdapter, undefined, data, { currency: "usd", usage: false, output: "sql" }))).rows.length).toBe(expected().length);
    const report = deriveCelFromText(fixtureAdapter, undefined, data, { currency: "USD" });
    expect(report).toContain("# CEL Revenue_Events derived from your subscription ledger and usage records");
    expect(report).toContain("the `subscription` dataset, 6 / 6 fields mapped; the `usage_record` dataset, 6 / 6 fields mapped (read because the mapping covers it");
    expect(report).toContain("postgres (from the adapter's warehouse");
    expect(report).toContain("deriving-revenue-events-from-a-subscription-ledger");
    expect(report).toContain("deriving-usage-realisation");
    expect(report).toContain("**Usage realisation.**");
    expect(report).toContain("`snapshot_date` (subscription) → `gasp_subscriptions.snapshot_day`");
    expect(report).toContain("`usage_amount` (usage_record) → `gasp_usage_records.usage_amount`");
  });

  it("reads the invoice dataset with source: invoice", async () => {
    const sql = deriveCelFromText(fixtureAdapter, undefined, data, { currency: "USD", source: "invoice", usage: false, output: "sql" });
    expect(sql).toContain("FROM gasp_invoices");
    expect(sql).not.toContain("gasp_subscriptions");
    expect((await db.query<Derived>(sql)).rows.length).toBe(7);
    const report = deriveCelFromText(fixtureAdapter, undefined, data, { currency: "USD", source: "invoice" });
    expect(report).toContain("# CEL Revenue_Events derived from your invoice ledger and usage records");
    expect(report).toContain("deriving-revenue-events-from-an-invoice-ledger");
    expect(report).toContain("the `invoice` dataset, 7 / 7 fields mapped");
    expect(report).toContain("**What the invoices can and cannot say.**");
    expect(deriveCelFromText(fixtureAdapter, undefined, data, { currency: "USD", source: "ledger" })).toContain("source must be one of subscription, invoice");
  });

  it("takes the dialect from the warehouse and names the fields a mapping lacks", () => {
    const report = deriveCelFromText(acme, undefined, data, { currency: "EUR" });
    expect(report).toContain("snowflake (from the adapter's warehouse");
    expect(report).toContain("CAST(snapshot_date AS VARCHAR)");
    expect(report).toMatch(/Unmapped fields \(left as placeholders\):.*`segment@subscription`/);
    expect(report).toContain("(transform: {{value}} / 100)");
    expect(report).toContain("no usage records (map the `usage_record` dataset");
    expect(report).not.toContain("usage_changes");
    const invoices = deriveCelFromText(acme, undefined, data, { currency: "EUR", source: "invoice" });
    expect(invoices).toMatch(/Unmapped fields \(left as placeholders\):.*`service_period_start@invoice`.*`recurring_amount@invoice`/);
  });

  it("reads the usage records when both they and a credit ledger are mapped, so the overage is derived once", async () => {
    expect(adapter.datasets.credit_event).toBe("gasp_credit_events");
    const sql = deriveCelFromText(fixtureAdapter, undefined, data, { currency: "USD", output: "sql" });
    expect(sql).toContain("FROM gasp_usage_records");
    expect(sql).not.toContain("gasp_credit_events");
    const rows = (await db.query<Derived>(sql)).rows;
    expect(rows.filter((r) => r.expansion_classification === "usage_realisation").length).toBe(12);
    expect(new Set(rows.map((r) => r.event_id)).size).toBe(rows.length);
    const report = deriveCelFromText(fixtureAdapter, undefined, data, { currency: "USD" });
    expect(report).toContain("the `credit_event` dataset is mapped too and not read, so the overage is not derived twice");
    // Asked for, the credit ledger is read instead of the usage records, never beside them.
    const credit = deriveCelFromText(fixtureAdapter, undefined, data, { currency: "USD", usageSource: "credit_event", output: "sql" });
    expect(credit).toContain("FROM gasp_credit_events");
    expect(credit).not.toContain("gasp_usage_records");
    expect(deriveCelFromText(fixtureAdapter, undefined, data, { currency: "USD", usageSource: "ledger" })).toContain("usage_source must be one of usage_record, credit_event");
  });

  it("reads the credit ledger unasked when the mapping covers it and no usage records", async () => {
    const { usage_record: _, ...datasets } = adapter.datasets;
    const noUsage = { ...adapter, datasets, mappings: adapter.mappings.filter((m: { warehouseRef: string }) => !m.warehouseRef.startsWith("gasp_usage_records.")) };
    const sql = deriveCelFromText(JSON.stringify(noUsage), undefined, data, { currency: "USD", output: "sql" });
    expect(sql).not.toContain("{{");
    expect(sql).toContain("FROM gasp_credit_events");
    const rows = (await db.query<Derived>(sql)).rows;
    // The usage records' six pairs and c11's exhausted drawdown.
    expect(rows.length).toBe(expected().length + 14);
    const report = deriveCelFromText(JSON.stringify(noUsage), undefined, data, { currency: "USD" });
    expect(report).toContain("# CEL Revenue_Events derived from your subscription ledger and credit ledger");
    expect(report).toContain("the `credit_event` dataset (its overage consumption), 6 / 6 fields mapped (read because the mapping covers it");
    expect(report).toContain("realisation-from-the-credit-ledger");
    expect(report).toContain("**Usage realisation from the credit ledger.**");
    expect(report).toContain("`credit_amount` (credit_event) → `gasp_credit_events.credit_amount`");
  });

  it("writes credit events from the usage records with target: credit_event", async () => {
    const sql = deriveCelFromText(fixtureAdapter, undefined, data, { currency: "usd", target: "credit_event", output: "sql" });
    expect(sql).not.toContain("{{");
    expect(sql).toContain("FROM gasp_usage_records");
    expect((await db.query(sql)).rows.length).toBe(6);
    const report = deriveCelFromText(fixtureAdapter, undefined, data, { currency: "USD", target: "credit_event" });
    expect(report).toContain("# CEL Credit_Events derived from your usage records");
    expect(report).toContain("consumption-events-from-usage-records");
    expect(report).toContain("the `usage_record` dataset, 5 / 5 fields mapped");
    expect(report).toContain("**What the usage records can and cannot say for the credit ledger.**");
    expect(report).toContain("Your mapping covers the `credit_event` dataset already.");
    expect(deriveCelFromText(fixtureAdapter, undefined, data, { currency: "USD", target: "ledger" })).toContain("target must be one of revenue_event, credit_event");
    const acmeReport = deriveCelFromText(acme, undefined, data, { currency: "EUR", target: "credit_event" });
    expect(acmeReport).toMatch(/Unmapped fields \(left as placeholders\):.*`usage_amount@usage_record`/);
  });

  it("takes an Ossie mapping with its model as generate_query does", () => {
    const form = adapterToOssie(adapter, data);
    const sql = deriveCelFromText(ossieYaml(form.mapping), ossieYaml(form.model), data, { currency: "USD", output: "sql" });
    expect(sql).not.toContain("{{");
    expect(sql).toContain("FROM gasp_subscriptions");
  });
});
