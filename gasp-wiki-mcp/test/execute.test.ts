import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { loadStandard } from "../src/loader.js";
import { fillTemplate } from "../src/tools.js";
import {
  generateFixture, buildAdapter, datasetFields, columnName, addDays, TABLES, START, END, type Row,
} from "./fixture/generate.js";

// Runs the compiled SQL. The fixture (test/fixture) is loaded into an in-process
// Postgres, every template is filled from the fixture's per-dataset adapter, and
// ten metrics are checked against values computed in plain TypeScript over the
// same rows. The expected values never go through the compiler or the filler.

const data = loadStandard();
const fixture = generateFixture();
const adapter = JSON.parse(readFileSync(join(new URL(".", import.meta.url).pathname, "fixture", "adapter.json"), "utf-8"));
let db: PGlite;

const PG_TYPES: Record<string, string> = { date: "DATE", timestamp: "TIMESTAMP", decimal: "NUMERIC", integer: "INTEGER", boolean: "BOOLEAN" };
const literal = (v: Row[string]) =>
  v === null || v === undefined ? "NULL" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

beforeAll(async () => {
  db = new PGlite();
  for (const [ds, table] of Object.entries(TABLES)) {
    const fields = datasetFields(ds);
    const cols = fields.map((f) => columnName(ds, f.id));
    await db.exec(`CREATE TABLE ${table} (${fields.map((f, i) => `${cols[i]} ${PG_TYPES[f.type] ?? "TEXT"}`).join(", ")})`);
    const rows = fixture.tables[ds];
    for (let i = 0; i < rows.length; i += 1000) {
      const values = rows.slice(i, i + 1000).map((r) => `(${fields.map((f) => literal(r[f.id])).join(", ")})`);
      await db.exec(`INSERT INTO ${table} (${cols.join(", ")}) VALUES ${values.join(", ")}`);
    }
  }
}, 120_000);

afterAll(async () => { await db?.close(); });

function fill(id: string) {
  const template = data.queryTemplates[id];
  if (!template) throw new Error(`no template for ${id}`);
  return fillTemplate(template, adapter, data);
}

function bind(sql: string, start: string, end: string): string {
  return sql.replace(/:period_start\b/g, `DATE '${start}'`).replace(/:period_end\b/g, `DATE '${end}'`);
}

async function run(id: string, start: string, end: string): Promise<number | null> {
  const res = await db.query<Record<string, unknown>>(bind(fill(id).sql, start, end));
  const v = Object.values(res.rows[0])[0];
  return v === null || v === undefined ? null : Number(v);
}

// ── independent expected values over the generated rows ──────────────────────

const T = fixture.tables;
const between = (d: unknown, start: string, end: string) => typeof d === "string" && d.slice(0, 10) >= start && d.slice(0, 10) <= end;
const sum = (rows: Row[], f: string) => rows.reduce((s, r) => s + Number(r[f]), 0);
const distinct = (rows: Row[], f: string) => new Set(rows.map((r) => r[f])).size;
const snapshot = (ds: string, day: string) => T[ds].filter((r) => r.snapshot_date === day);
const activeCustomersOn = (day: string) => snapshot("customer", day).filter((r) => r.customer_status === "active");
const mrrOn = (day: string, customers?: Set<unknown>) =>
  sum(snapshot("subscription", day).filter((r) => r.subscription_status === "active" && (!customers || customers.has(r.customer_id))), "mrr");
const revenueEvents = (start: string, end: string, type: string, customers?: Set<unknown>) =>
  T.revenue_event.filter((r) => between(r.event_date, start, end) && r.event_type === type && (!customers || customers.has(r.customer_id)));
const gtmCost = (start: string, end: string) => sum(T.cost_event.filter((r) => between(r.event_date, start, end) && r.cost_function === "gtm"), "cost");
const qualifyingUsers = (start: string, end: string) =>
  distinct(T.product_event.filter((r) => between(r.event_date, start, end) && r.product_event_type === "qualifying"), "user_id");

function expectedNrr(start: string, end: string, gross = false) {
  const cohort = new Set(activeCustomersOn(start).map((r) => r.customer_id));
  const opening = mrrOn(start, cohort);
  const expansion = gross ? 0 : sum(revenueEvents(start, end, "expansion", cohort), "mrr_change");
  const contraction = -sum(revenueEvents(start, end, "contraction", cohort), "mrr_change");
  const churn = -sum(revenueEvents(start, end, "churn", cohort), "mrr_change");
  return (opening + expansion - contraction - churn) / opening;
}
const expectedCac = (start: string, end: string) => gtmCost(start, end) / distinct(revenueEvents(start, end, "new"), "customer_id");
function expectedCacPayback(start: string, end: string) {
  const arpa = mrrOn(end) / activeCustomersOn(end).length;
  const revenue = sum(T.financials.filter((r) => between(r.period_start, start, end)), "revenue");
  const infra = sum(T.cost_event.filter((r) => between(r.event_date, start, end) && r.cost_function === "infrastructure"), "cost");
  return expectedCac(start, end) / (arpa * ((revenue - infra) / revenue));
}
function expectedWinRate(start: string, end: string) {
  const closedInPeriod = snapshot("opportunity", end).filter((r) => between(r.close_date, start, end));
  return closedInPeriod.filter((r) => r.opportunity_stage === "closed_won").length
    / closedInPeriod.filter((r) => r.opportunity_stage === "closed_won" || r.opportunity_stage === "closed_lost").length;
}
/** Users who signed up in the period and had a qualifying event `from` to `to` days after signup (any date). */
function expectedRetention(start: string, end: string, from: number, to: number) {
  const cohort = snapshot("user", end).filter((r) => between(r.signup_date, start, end)).map((r) => r.user_id);
  const retained = cohort.filter((u) => T.product_event.some((e) => {
    if (e.user_id !== u || e.product_event_type !== "qualifying") return false;
    const d = Math.round((Date.parse(String(e.event_date)) - Date.parse(String(e.signup_date))) / 86400000);
    return d >= from && d <= to;
  }));
  return retained.length / cohort.length;
}

const H1 = [START, END] as const;              // 2026-01-01 to 2026-06-30
const JUNE = ["2026-06-01", END] as const;
const Q2 = ["2026-04-01", END] as const;
const JANUARY = [START, "2026-01-31"] as const;

// ── tests ────────────────────────────────────────────────────────────────────

describe("fixture", () => {
  it("adapter.json is current (npx tsx test/fixture/generate.ts --adapter)", () => {
    expect(adapter).toEqual(buildAdapter());
  });

  it("subscription MRR is the running sum of revenue event mrr_change", () => {
    for (const day of ["2026-01-01", "2026-03-31", END]) {
      for (const s of snapshot("subscription", day)) {
        const running = sum(T.revenue_event.filter((r) => r.customer_id === s.customer_id && String(r.event_date) <= day), "mrr_change");
        expect(s.mrr, `${s.customer_id} on ${day}`).toBe(running);
      }
    }
  });

  it("locks the fixture's shape", () => {
    expect(mrrOn(START)).toBe(15100);
    expect(mrrOn(END)).toBe(24200);
    expect(activeCustomersOn(END).length).toBe(18);
    expect(expectedNrr(...H1)).toBeCloseTo(14900 / 15100, 10);
    expect(expectedNrr(...H1, true)).toBeCloseTo(12100 / 15100, 10);
    expect(expectedWinRate(...JUNE)).toBeCloseTo(2 / 5, 10);
    expect(qualifyingUsers(END, END)).toBe(5);
    expect(qualifyingUsers(addDays(END, -6), END)).toBe(12);
    expect(qualifyingUsers(addDays(END, -29), END)).toBe(21);
  });
});

describe("compiled SQL runs on Postgres", () => {
  const ids = Object.keys(data.queryTemplates).sort();
  const filled = ids.map((id) => ({ id, ...fill(id) }));
  const runnable = filled.filter((f) => f.missingFields.length === 0 && f.missingTables.length === 0);
  const skipped = filled.filter((f) => !runnable.includes(f));
  console.info(`execute.test: ${runnable.length} of ${ids.length} templates fully mapped; skipped (missing mappings): ${skipped.map((f) => f.id).join(", ")}`);

  it("maps enough templates that a regression which maps nothing is caught", () => {
    expect(runnable.length).toBeGreaterThanOrEqual(130);
  });

  it("fully mapped templates leave no placeholder unfilled", () => {
    const left = runnable
      .map((f) => ({ id: f.id, placeholders: [...new Set(f.sql.match(/\{\{[^}]+\}\}/g) ?? [])] }))
      .filter((x) => x.placeholders.length > 0);
    expect(left, JSON.stringify(left, null, 1)).toEqual([]);
  });

  it(`every fully mapped template executes (${runnable.length} templates)`, async () => {
    const failures: Array<{ id: string; error: string }> = [];
    for (const f of runnable) {
      try {
        await db.query(bind(f.sql, ...JUNE));
      } catch (e) {
        failures.push({ id: f.id, error: (e as Error).message });
      }
    }
    expect(failures, failures.map((x) => `${x.id}: ${x.error}`).join("\n")).toEqual([]);
  });
});

describe("hand-computed metric values", () => {
  it("MRR at 2026-06-30", async () => {
    expect(await run("mrr", ...JUNE)).toBe(24200);
    expect(await run("mrr", ...JUNE)).toBe(mrrOn(END));
  });

  it("ARR at 2026-06-30", async () => {
    expect(await run("arr", ...JUNE)).toBe(290400);
    expect(await run("arr", ...JUNE)).toBe(mrrOn(END) * 12);
  });

  it("Logo Churn Rate, Q2", async () => {
    const churned = distinct(revenueEvents(...Q2, "churn"), "customer_id");
    const expected = churned / activeCustomersOn(Q2[0]).length;
    expect(churned).toBe(2);
    expect(await run("logo_churn_rate", ...Q2)).toBeCloseTo(expected, 10);
  });

  it("CAC, June", async () => {
    expect(expectedCac(...JUNE)).toBe((3800 + 2600) / 2);
    expect(await run("cac", ...JUNE)).toBeCloseTo(expectedCac(...JUNE), 6);
  });

  it("CAC Payback, June", async () => {
    expect(await run("cac_payback", ...JUNE)).toBeCloseTo(expectedCacPayback(...JUNE), 6);
  });

  it("Win Rate, June (open deals with a June close date are excluded)", async () => {
    expect(await run("win_rate", ...JUNE)).toBeCloseTo(expectedWinRate(...JUNE), 10);
  });

  it("NRR, 2026-01-01 to 2026-06-30", async () => {
    expect(await run("nrr", ...H1)).toBeCloseTo(expectedNrr(...H1), 10);
  });

  it("GRR, 2026-01-01 to 2026-06-30", async () => {
    expect(await run("grr", ...H1)).toBeCloseTo(expectedNrr(...H1, true), 10);
  });

  // Item 3: DAU is the day ending at period_end, MAU the 30 days ending there.
  it("DAU/MAU Ratio, June (DAU on 2026-06-30 over MAU for the 30 days to 2026-06-30)", async () => {
    const expected = qualifyingUsers(END, END) / qualifyingUsers(addDays(END, -29), END);
    expect(expected).toBeCloseTo(5 / 21, 10);
    expect(await run("dau_mau", ...JUNE)).toBeCloseTo(expected, 10);
  });

  // Item 3: quarter-over-quarter ARR change over one quarter of GTM spend in the prior quarter.
  it("Magic Number, June (ARR change since 2026-03-30 over GTM spend January to March)", async () => {
    const priorEnd = "2026-03-30"; // 2026-06-30 minus 3 months in Postgres
    const arrChange = (mrrOn(END) - mrrOn(priorEnd)) * 12;
    const spend = gtmCost(addDays(priorEnd, -89), priorEnd);
    expect(spend).toBe(3000 + 2000 + 3100 + 2100 + 3600 + 2400);
    expect(await run("magic_number", ...JUNE)).toBeCloseTo(arrChange / spend, 6);
  });
});

// Item 2: per-dataset mappings. snapshot_date is as_of_date on the customer
// table and snapshot_day on the subscription table; customer_id is account_ref
// on revenue events. The cohort subquery inside NRR and GRR must read the
// customer table's own columns.
describe("per-dataset mappings (item 2)", () => {
  it.each(["nrr", "grr"])("%s fills every placeholder from its own dataset and matches the expected value", async (id) => {
    const f = fill(id);
    expect(f.missingFields).toEqual([]);
    expect(f.missingTables).toEqual([]);
    expect(f.sql).not.toMatch(/\{\{/);
    expect(f.sql).not.toMatch(/FROM gasp_customers WHERE snapshot_day/);
    expect(await run(id, ...H1)).toBeCloseTo(expectedNrr(...H1, id === "grr"), 10);
  });
});

// Item 3: windows. DAU, WAU and MAU are the 1, 7 and 30 days ending at period_end;
// retention numerators look past the period for users who signed up in it.
describe("windows (item 3)", () => {
  it("DAU, WAU and MAU differ", async () => {
    expect(await run("daily_active_users_dau", ...JUNE)).toBe(5);
    expect(await run("weekly_active_users_wau", ...JUNE)).toBe(12);
    expect(await run("monthly_active_users_mau", ...JUNE)).toBe(21);
  });

  it("week 8 retention for the January signup cohort", async () => {
    const expected = expectedRetention(...JANUARY, 49, 55);
    expect(expected).toBeCloseTo(2 / 5, 10);
    expect(await run("cohort_retention", ...JANUARY)).toBeCloseTo(expected, 10);
  });

  it("day 30 retention for the January signup cohort", async () => {
    const expected = expectedRetention(...JANUARY, 30, 30);
    expect(expected).toBeCloseTo(3 / 5, 10);
    expect(await run("user_retention_day_n", ...JANUARY)).toBeCloseTo(expected, 10);
  });
});
