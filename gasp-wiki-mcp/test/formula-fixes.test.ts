import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { loadStandard } from "../src/loader.js";
import { compileMetric } from "../src/compile.js";
import { fillTemplate } from "../src/tools.js";
import { TABLES, columnName } from "../src/synthetic.js";
import type { QueryTemplate } from "../src/types.js";
import { ACCOUNT_COHORTS } from "../src/ossie/cohorts.js";
import { adapter, fixtureDb, bind, scalar, runTemplate, moveSegment, plantMovement } from "./fixture-db.js";

// Regression tests for the formula corrections of 2026-11-10 (four),
// 2026-11-19 (90-Day Turnover again and Commit Accuracy) and 2026-11-21 (NRR
// and GRR by segment, a change to how a breakdown reads a cohort, and Logo
// Churn Rate, Revenue Churn Rate and Expansion Rate, which became cohort
// formulas) and 2026-11-24 (five rates that divided the period's events by an
// opening count, now cohort formulas too) and 2026-11-27 (NRR-M, which dropped
// an expansion or reactivation that carried no tag). Each metric's
// compiled template is checked against a value computed in plain SQL over the
// fixture, and the formula it replaced is compiled and run on the same rows to
// show it gives a different answer. Rows the synthetic data lacks are planted in
// this file's own database.

const data = loadStandard();
let db: PGlite;

const t = (ds: string) => TABLES[ds];
const c = (ds: string, field: string) => columnName(ds, field);

/** Copy one row of a dataset, change some of its columns and insert the copy. */
async function plant(ds: string, where: string, set: string) {
  await db.exec(`CREATE TEMP TABLE planted AS SELECT * FROM ${t(ds)} WHERE ${where};
    UPDATE planted SET ${set};
    INSERT INTO ${t(ds)} SELECT * FROM planted;
    DROP TABLE planted;`);
}

const run = (id: string, start: string, end: string) => runTemplate(db, data, id, start, end);

/** A formula compiled in place of the canonical one and run over the fixture. */
async function runFormula(id: string, formula: string, start: string, end: string, on: PGlite = db): Promise<number | null> {
  const ctx = {
    fields: Object.fromEntries(data.ontology!.fields!.map((f) => [f.id, f])),
    datasets: data.ontology!.datasets!,
    formulas: { ...data.formulas!, [id]: { ...data.formulas![id], formula } },
  };
  const compiled = compileMetric(id, ctx);
  const template = { ...data.queryTemplates[id], parameterizedQuery: compiled.sql, placeholders: compiled.placeholders } as QueryTemplate;
  return scalar(on, bind(fillTemplate(template, adapter, data).sql, start, end));
}

const value = (sql: string) => scalar(db, sql);

beforeAll(async () => {
  db = await fixtureDb();
  // e99 is hired on 20 March and leaves 30 days later, on 19 April: still employed in the
  // March month-end snapshot, terminated in June's. Their 90th day is 18 June.
  const e21 = (day: string) => `employee_id = 'e21' AND ${c("employee", "snapshot_date")} = '${day}'`;
  await plant("employee", e21("2026-03-31"), `employee_id = 'e99', ${c("employee", "hire_date")} = '2026-03-20'`);
  await plant("employee", e21("2026-06-30"),
    `employee_id = 'e99', ${c("employee", "hire_date")} = '2026-03-20', termination_date = '2026-04-19', ${c("employee", "employee_status")} = 'terminated'`);
}, 120_000);

afterAll(async () => { await db?.close(); });

describe("formula corrections", () => {
  it("90-Day Turnover counts each hire in the period their 90th day falls in", async () => {
    const E = t("employee"), snap = c("employee", "snapshot_date"), hire = c("employee", "hire_date");
    // June's cohort: hired from 3 March to 1 April, so day 90 falls in June. e21 stayed, e99 left on day 30.
    const cohort = `FROM ${E} WHERE ${snap} = '2026-06-30' AND ${hire} + 90 BETWEEN DATE '2026-06-01' AND DATE '2026-06-30'`;
    const ids = await db.query<{ employee_id: string }>(`SELECT DISTINCT employee_id ${cohort} ORDER BY 1`);
    expect(ids.rows.map((r) => r.employee_id)).toEqual(["e21", "e99"]);
    const early = await value(`SELECT COUNT(DISTINCT employee_id) ${cohort} AND termination_date - ${hire} <= 90`);
    expect(early).toBe(1);
    expect(await run("day_90_turnover", "2026-06-01", "2026-06-30")).toBeCloseTo(0.5, 10);
    // March, the month e99 was hired in, holds the hires of December: none, so no rate.
    expect(await run("day_90_turnover", "2026-03-01", "2026-03-31")).toBeNull();
    // The formula of 2026-11-10 counted a hire in the month they were hired. In March e99 had not
    // left yet, and no later month's cohort holds them, so the departure was never reported.
    const hireMonth = "count_distinct(field.employee_id where in_period(field.hire_date) and field.termination_date is not null and field.termination_date - field.hire_date <= 90) / count_distinct(field.employee_id where in_period(field.hire_date))";
    expect(await runFormula("day_90_turnover", hireMonth, "2026-03-01", "2026-03-31")).toBe(0); // e21 and e99 hired, neither gone yet
    expect(await runFormula("day_90_turnover", hireMonth, "2026-04-01", "2026-04-30")).toBe(0); // April's hire, e22, stayed
    expect(await runFormula("day_90_turnover", hireMonth, "2026-06-01", "2026-06-30")).toBe(0);
    // The formula before that counted every early leaver in the company's history (e19 and e99)
    // over the month's one hire.
    const allTime = "count_distinct(field.employee_id where field.termination_date is not null and field.termination_date - field.hire_date <= 90) / count_distinct(field.employee_id where field.hire_date >= period_start and field.hire_date <= period_end)";
    expect(await runFormula("day_90_turnover", allTime, "2026-06-01", "2026-06-30")).toBeCloseTo(2, 10);
  });

  it("90-Day Turnover counts every hire in exactly one month", async () => {
    const E = t("employee"), snap = c("employee", "snapshot_date"), hire = c("employee", "hire_date");
    const months = [["2026-01-01", "2026-01-31"], ["2026-02-01", "2026-02-28"], ["2026-03-01", "2026-03-31"], ["2026-04-01", "2026-04-30"], ["2026-05-01", "2026-05-31"], ["2026-06-01", "2026-06-30"]];
    const denominator = "count_distinct(field.employee_id where period_start - field.hire_date <= 90 and period_end - field.hire_date >= 90)";
    let counted = 0;
    for (const [start, end] of months) counted += (await runFormula("day_90_turnover", denominator, start, end)) ?? 0;
    // Everyone whose 90th day falls in the half year, read once from the last snapshot.
    const expected = await value(`SELECT COUNT(DISTINCT employee_id) FROM ${E} WHERE ${snap} = '2026-06-30' AND ${hire} + 90 BETWEEN DATE '2026-01-01' AND DATE '2026-06-30'`);
    expect(expected).toBe(5); // e18, e19, e20, e21, e99
    expect(counted).toBe(expected);
  });

  it("Commit Accuracy follows the deals in commit when the period opened", async () => {
    const O = t("opportunity"), snap = c("opportunity", "snapshot_date"), close = c("opportunity", "close_date");
    const ids = async (sql: string) => (await db.query<{ opportunity_id: string }>(`SELECT DISTINCT opportunity_id FROM ${O} WHERE ${sql} ORDER BY 1`)).rows.map((r) => r.opportunity_id);
    // On 1 April o05 and o12 are in commit. o05 is won on the 21st and o12 lost on the 14th.
    // o19 enters commit on the 4th and is won on the 28th: a win, and outside the opening commit.
    const opening = await ids(`${snap} = '2026-04-01' AND forecast_category = 'commit'`);
    const won = await ids(`${snap} = '2026-04-30' AND opportunity_stage = 'closed_won' AND ${close} BETWEEN '2026-04-01' AND '2026-04-30'`);
    expect(opening).toEqual(["o05", "o12"]);
    expect(won).toEqual(["o05", "o19"]);
    expect(await ids(`opportunity_id = 'o19' AND ${snap} = '2026-04-04' AND forecast_category = 'commit'`)).toEqual(["o19"]);
    expect(await run("commit_accuracy", "2026-04-01", "2026-04-30")).toBeCloseTo(0.5, 10);
    // The old formula read one month-end snapshot. A won deal's category is 'closed' there, so the
    // numerator was empty, and the denominator was the deals in commit at month end (o06 and o13),
    // the commit for the month after.
    const old = "count_distinct(field.opportunity_id where field.forecast_category = 'commit' and field.opportunity_stage = 'closed_won' and in_period(field.close_date)) / count_distinct(field.opportunity_id where field.forecast_category = 'commit')";
    expect(await ids(`${snap} = '2026-04-30' AND forecast_category = 'commit'`)).toEqual(["o06", "o13"]);
    expect(await runFormula("commit_accuracy", old, "2026-04-01", "2026-04-30")).toBe(0);
    // The quarter opens with the same two deals in commit and o05 is still the one win among them.
    expect(await run("commit_accuracy", "2026-04-01", "2026-06-30")).toBeCloseTo(0.5, 10);

    // o98 is in commit on 1 April and slips: still open at month end with a close date in May.
    const o12 = (day: string) => `opportunity_id = 'o12' AND ${snap} = '${day}'`;
    await plant("opportunity", o12("2026-04-01"), `opportunity_id = 'o98'`);
    await plant("opportunity", o12("2026-04-01"), `opportunity_id = 'o98', ${snap} = '2026-04-30', ${close} = '2026-05-20'`);
    expect(await run("commit_accuracy", "2026-04-01", "2026-04-30")).toBeCloseTo(1 / 3, 10);
  });

  it("Average Services Deal Size reads services deals won in the period", async () => {
    const O = t("opportunity"), snap = c("opportunity", "snapshot_date"), close = c("opportunity", "close_date");
    const won = `FROM ${O} WHERE ${snap} = '2026-04-30' AND revenue_type = 'services' AND opportunity_stage = 'closed_won' AND ${close} BETWEEN '2026-04-01' AND '2026-04-30'`;
    const expected = await value(`SELECT SUM(opportunity_amount) / COUNT(DISTINCT opportunity_id) ${won}`);
    expect(expected).toBe(36000); // o19
    expect(await run("average_services_deal_size", "2026-04-01", "2026-04-30")).toBe(expected);
    // The old formula averaged in o21, lost in March.
    const old = "sum(field.opportunity_amount where field.revenue_type = 'services') / count_distinct(field.opportunity_id where field.revenue_type = 'services')";
    expect(await runFormula("average_services_deal_size", old, "2026-04-01", "2026-04-30")).toBe(29000);
  });

  it("Days to Renewal averages active subscriptions with a term end still to come", async () => {
    const S = t("subscription"), snap = c("subscription", "snapshot_date"), status = c("subscription", "subscription_status");
    const expected = await value(`SELECT AVG(contract_end - ${snap}) FROM ${S} WHERE ${snap} = '2026-06-30' AND ${status} = 'active' AND contract_end >= ${snap}`);
    const past = await value(`SELECT COUNT(*) FROM ${S} WHERE ${snap} = '2026-06-30' AND (${status} <> 'active' OR contract_end < ${snap})`);
    expect(past).toBeGreaterThan(0);
    expect(expected).toBeGreaterThan(0);
    expect(await run("days_to_renewal", "2026-06-01", "2026-06-30")).toBeCloseTo(expected!, 10);
    const old = await runFormula("days_to_renewal", "avg(field.contract_end - field.snapshot_date)", "2026-06-01", "2026-06-30");
    // 16 active subscriptions with a term end to come average 174.19 days; the old formula
    // averaged in five more with past term ends or a cancelled status, giving 129.38.
    expect(expected).toBeCloseTo(174.1875, 4);
    expect(old).toBeCloseTo(129.381, 3);
  });

  it("Auto-Renewal Rate divides by the contracts that renewed", async () => {
    const S = t("subscription"), snap = c("subscription", "snapshot_date");
    const ending = `FROM ${S} WHERE ${snap} = '2026-06-30' AND contract_end BETWEEN '2026-06-01' AND '2026-06-30' AND renewed`;
    const expected = (await value(`SELECT COUNT(DISTINCT subscription_id) ${ending} AND auto_renewed`))! / (await value(`SELECT COUNT(DISTINCT subscription_id) ${ending}`))!;
    expect(expected).toBe(0.5); // c12 auto-renewed, c11 renewed by hand; c08 lapsed
    expect(await run("auto_renewal_rate", "2026-06-01", "2026-06-30")).toBeCloseTo(expected, 10);
    const old = "count_distinct(field.subscription_id where in_period(field.contract_end) and field.auto_renewed = true) / count_distinct(field.subscription_id where in_period(field.contract_end))";
    expect(await runFormula("auto_renewal_rate", old, "2026-06-01", "2026-06-30")).toBeCloseTo(1 / 3, 10);
  });
});

describe("NRR and GRR by segment group the cohort by the segment held at period start (2026-11-21)", () => {
  // c07, smb, becomes enterprise on 1 May, five days before its 1,000 expansion.
  // c14, mid_market, becomes enterprise on 1 June, a week before its 300 contraction.
  // Both were in the cohort of 1 April under their first segment.
  const Q2 = ["2026-04-01", "2026-06-30"] as const;
  const SEGMENTS = ["enterprise", "mid_market", "smb"];
  const NRR = ["expansion", "contraction", "churn"], GRR = ["contraction", "churn"];
  let moved: PGlite;

  beforeAll(async () => {
    moved = await fixtureDb();
    await moveSegment(moved, "c07", "2026-05-01", "enterprise");
    await moveSegment(moved, "c14", "2026-06-01", "enterprise");
  }, 120_000);
  afterAll(async () => { await moved?.close(); });

  /** The compiled by_segment breakdown of a metric over Q2, a value per segment. */
  async function compiled(on: PGlite, id: string): Promise<Record<string, number | null>> {
    const ctx = { fields: Object.fromEntries(data.ontology!.fields!.map((f) => [f.id, f])), datasets: data.ontology!.datasets!, formulas: data.formulas! };
    const k = compileMetric(id, ctx, "by_segment");
    expect(k.placeholders.filter((p) => p.startsWith("segment@"))).toEqual(["segment@customer"]);
    const template = { ...data.queryTemplates[id], fields: k.fields, datasets: k.datasets, parameterizedQuery: k.sql, placeholders: k.placeholders, breakdown: k.breakdown } as QueryTemplate;
    const res = await on.query<Record<string, unknown>>(bind(fillTemplate(template, adapter, data).sql, ...Q2));
    return Object.fromEntries(res.rows.map((r) => [String(r.segment), r[id] === null || r[id] === undefined ? null : Number(r[id])]));
  }

  // Plain SQL over the fixture's own names. `who` picks the customers and `rows` narrows the rows read.
  const active = (segment?: string) => `SELECT ${c("customer", "customer_id")} FROM ${t("customer")} WHERE ${c("customer", "snapshot_date")} = DATE '${Q2[0]}' AND ${c("customer", "customer_status")} = 'active'`
    + (segment ? ` AND ${c("customer", "segment")} = '${segment}'` : "");
  const opening = (who: string, rows: string) => `(SELECT COALESCE(SUM(${c("subscription", "mrr")}), 0) FROM ${t("subscription")} WHERE ${c("subscription", "snapshot_date")} = DATE '${Q2[0]}'`
    + ` AND ${c("subscription", "subscription_status")} = 'active' AND ${c("subscription", "customer_id")} IN (${who})${rows && ` AND ${c("subscription", "segment")} = '${rows}'`})`;
  const movement = (types: string[], who: string, rows: string) => `(SELECT COALESCE(SUM(${c("revenue_event", "mrr_change")}), 0) FROM ${t("revenue_event")}`
    + ` WHERE ${c("revenue_event", "event_date")} BETWEEN DATE '${Q2[0]}' AND DATE '${Q2[1]}' AND ${c("revenue_event", "event_type")} IN (${types.map((x) => `'${x}'`).join(", ")})`
    + ` AND ${c("revenue_event", "customer_id")} IN (${who})${rows && ` AND ${c("revenue_event", "segment")} = '${rows}'`})`;
  const retained = (on: PGlite, types: string[], who: string, rows = "") =>
    scalar(on, `SELECT CAST(${opening(who, rows)} + ${movement(types, who, rows)} AS DOUBLE PRECISION) / NULLIF(${opening(who, rows)}, 0)`);
  /** The rule since 2026-11-21: the customers who held the segment on the first day, with every row of theirs. */
  const atStart = (on: PGlite, types: string[], segment: string) => retained(on, types, active(segment));
  /** The rule it replaced: the whole cohort, with each snapshot and event counted in the segment the row carries. */
  const byRow = (on: PGlite, types: string[], segment: string) => retained(on, types, active(), segment);

  for (const [id, types] of [["nrr", NRR], ["grr", GRR]] as const) {
    it(`${id}: each customer counts in the segment held on the first day of the period`, async () => {
      const rows = await compiled(moved, id);
      expect(Object.keys(rows).sort()).toEqual(SEGMENTS);
      for (const g of SEGMENTS) expect(rows[g], g).toBeCloseTo((await atStart(moved, types, g))!, 12);
    });

    it(`${id}: with no customer changing segment the two readings agree`, async () => {
      const rows = await compiled(db, id);
      for (const g of SEGMENTS) {
        expect(rows[g], g).toBeCloseTo((await atStart(db, types, g))!, 12);
        expect(rows[g], g).toBeCloseTo((await byRow(db, types, g))!, 12);
      }
    });
  }

  it("the reading by row moved a customer's expansion and contraction into a segment that held none of their opening MRR", async () => {
    const [nrr, grr] = [await compiled(moved, "nrr"), await compiled(moved, "grr")];
    const opened = async (g: string) => (await scalar(moved, `SELECT ${opening(active(g), "")}`))!;
    const [ent, mid, smb] = [await opened("enterprise"), await opened("mid_market"), await opened("smb")];
    // c07's 1,000 expansion: by row, enterprise gained it over an opening that never held c07 and smb lost it.
    // c14's 300 contraction: by row, enterprise lost it and mid_market kept revenue it had lost.
    expect((await byRow(moved, NRR, "enterprise"))! - nrr.enterprise!).toBeCloseTo((1000 - 300) / ent, 10);
    expect((await byRow(moved, NRR, "smb"))! - nrr.smb!).toBeCloseTo(-1000 / smb, 10);
    expect((await byRow(moved, NRR, "mid_market"))! - nrr.mid_market!).toBeCloseTo(300 / mid, 10);
    expect((await byRow(moved, GRR, "enterprise"))! - grr.enterprise!).toBeCloseTo(-300 / ent, 10);
    expect((await byRow(moved, GRR, "mid_market"))! - grr.mid_market!).toBeCloseTo(300 / mid, 10);
    // GRR reads no expansion, so smb is the same either way.
    expect(await byRow(moved, GRR, "smb")).toBeCloseTo(grr.smb!, 12);
    // The segments' values moved and the company's did not: the breakdown regroups the same customers.
    expect(await runTemplate(moved, data, "nrr", ...Q2)).toBeCloseTo((await runTemplate(db, data, "nrr", ...Q2))!, 12);
    expect(await runTemplate(moved, data, "grr", ...Q2)).toBeCloseTo((await runTemplate(db, data, "grr", ...Q2))!, 12);
  });
});

describe("Logo Churn Rate follows the customers of the first day of the period (2026-11-21)", () => {
  // c18, enterprise, starts on 13 May and is planted to churn on 20 June: a customer of Q2 who was not one on 1 April.
  // c08, mid_market on 1 April, becomes enterprise on 1 May, six weeks before it churns.
  // Only the rows these formulas read are planted: the churn event and the customer snapshots.
  const Q2 = ["2026-04-01", "2026-06-30"] as const;
  const SEGMENTS = ["enterprise", "mid_market", "smb"];
  const REPLACED = "metric.churned_customers / metric.total_customers at period_start";
  let planted: PGlite;

  const re = (f: string) => c("revenue_event", f);
  const cu = (f: string) => c("customer", f);

  beforeAll(async () => {
    planted = await fixtureDb();
    await planted.exec(`CREATE TEMP TABLE planted AS SELECT * FROM ${t("revenue_event")} WHERE ${re("customer_id")} = 'c05' AND ${re("event_type")} = 'churn';
      UPDATE planted SET ${re("customer_id")} = 'c18', ${re("event_id")} = 'planted_churn_c18', ${re("event_date")} = DATE '2026-06-20', ${re("segment")} = 'enterprise';
      INSERT INTO ${t("revenue_event")} SELECT * FROM planted;
      DROP TABLE planted;
      UPDATE ${t("customer")} SET ${cu("customer_status")} = 'churned' WHERE ${cu("customer_id")} = 'c18' AND ${cu("snapshot_date")} >= DATE '2026-06-20';`);
    await moveSegment(planted, "c08", "2026-05-01", "enterprise");
  }, 120_000);
  afterAll(async () => { await planted?.close(); });

  /** Logo Churn Rate compiled from the canonical formula, or from the one it replaced, over Q2: the company's value or a value per segment. */
  function template(variant?: string, formula?: string): QueryTemplate {
    const ctx = {
      fields: Object.fromEntries(data.ontology!.fields!.map((f) => [f.id, f])),
      datasets: data.ontology!.datasets!,
      formulas: formula ? { ...data.formulas!, logo_churn_rate: { ...data.formulas!.logo_churn_rate, formula } } : data.formulas!,
    };
    const k = compileMetric("logo_churn_rate", ctx, variant);
    if (variant && !formula) expect(k.placeholders.filter((p) => p.startsWith("segment@"))).toEqual(["segment@customer"]);
    return { ...data.queryTemplates.logo_churn_rate, fields: k.fields, datasets: k.datasets, parameterizedQuery: k.sql, placeholders: k.placeholders, breakdown: k.breakdown } as QueryTemplate;
  }
  const company = (on: PGlite, formula?: string) => scalar(on, bind(fillTemplate(template(undefined, formula), adapter, data).sql, ...Q2));
  async function bySegment(on: PGlite, formula?: string): Promise<Record<string, number | null>> {
    const res = await on.query<Record<string, unknown>>(bind(fillTemplate(template("by_segment", formula), adapter, data).sql, ...Q2));
    return Object.fromEntries(res.rows.map((r) => [String(r.segment), r.logo_churn_rate === null || r.logo_churn_rate === undefined ? null : Number(r.logo_churn_rate)]));
  }

  // Plain SQL over the fixture's own names.
  const opening = (segment?: string) => `SELECT ${cu("customer_id")} FROM ${t("customer")} WHERE ${cu("snapshot_date")} = DATE '${Q2[0]}' AND ${cu("customer_status")} = 'active'`
    + (segment ? ` AND ${cu("segment")} = '${segment}'` : "");
  const churned = (rows = "") => `SELECT DISTINCT ${re("customer_id")} FROM ${t("revenue_event")} WHERE ${re("event_date")} BETWEEN DATE '${Q2[0]}' AND DATE '${Q2[1]}' AND ${re("event_type")} = 'churn'${rows}`;
  const count = async (on: PGlite, sql: string) => (await scalar(on, `SELECT COUNT(*) FROM (${sql}) AS x`))!;
  /** The rule since 2026-11-21: the churned customers among those of the first day, over those of the first day. */
  const ofFirstDay = async (on: PGlite, segment?: string) => (await count(on, churned(` AND ${re("customer_id")} IN (${opening(segment)})`))) / (await count(on, opening(segment)));
  /** The rule it replaced: every customer with a churn event in the period, by the segment the event carries. */
  const everyChurn = async (on: PGlite, segment?: string) => (await count(on, churned(segment ? ` AND ${re("segment")} = '${segment}'` : ""))) / (await count(on, opening(segment)));

  it("counts a churned customer only when they were a customer on the first day", async () => {
    const customers = await count(planted, opening());
    expect(await company(planted)).toBeCloseTo(await ofFirstDay(planted), 12);
    // c05 and c08 opened the quarter as customers; c18 did not.
    expect(await company(planted)).toBeCloseTo(2 / customers, 12);
    expect(await company(planted, REPLACED)).toBeCloseTo(await everyChurn(planted), 12);
    expect(await company(planted, REPLACED)).toBeCloseTo(3 / customers, 12);
  });

  it("by segment: each customer counts in the segment held on the first day", async () => {
    const rows = await bySegment(planted);
    expect(Object.keys(rows).sort()).toEqual(SEGMENTS);
    for (const g of SEGMENTS) expect(rows[g], g).toBeCloseTo(await ofFirstDay(planted, g), 12);
    const replaced = await bySegment(planted, REPLACED);
    for (const g of SEGMENTS) expect(replaced[g], g).toBeCloseTo(await everyChurn(planted, g), 12);
    const [ent, mid] = [await count(planted, opening("enterprise")), await count(planted, opening("mid_market"))];
    // c08 churns in mid_market, where it opened the quarter. By row it churned in enterprise, beside c18, who was never in the opening count.
    expect(rows.mid_market).toBeCloseTo(2 / mid, 12);
    expect(rows.enterprise).toBe(0);
    expect(replaced.mid_market).toBeCloseTo(1 / mid, 12);
    expect(replaced.enterprise).toBeCloseTo(2 / ent, 12);
  });

  it("with nobody joining and churning in the period and nobody changing segment the two readings agree", async () => {
    expect(await company(db)).toBeCloseTo((await company(db, REPLACED))!, 12);
    const [rows, replaced] = [await bySegment(db), await bySegment(db, REPLACED)];
    for (const g of SEGMENTS) expect(rows[g], g).toBeCloseTo(replaced[g]!, 12);
  });

  it("Logo Retention Rate is one less the rate, for the company and per segment", async () => {
    expect(await runTemplate(planted, data, "logo_retention_rate", ...Q2)).toBeCloseTo(1 - (await company(planted))!, 12);
    const k = compileMetric("logo_retention_rate", { fields: Object.fromEntries(data.ontology!.fields!.map((f) => [f.id, f])), datasets: data.ontology!.datasets!, formulas: data.formulas! }, "by_segment");
    const tpl = { ...data.queryTemplates.logo_retention_rate, fields: k.fields, datasets: k.datasets, parameterizedQuery: k.sql, placeholders: k.placeholders, breakdown: k.breakdown } as QueryTemplate;
    const res = await planted.query<Record<string, unknown>>(bind(fillTemplate(tpl, adapter, data).sql, ...Q2));
    const churn = await bySegment(planted);
    expect(res.rows).toHaveLength(SEGMENTS.length);
    for (const r of res.rows) expect(Number(r.logo_retention_rate), String(r.segment)).toBeCloseTo(1 - churn[String(r.segment)]!, 12);
  });
});

describe("Revenue Churn Rate and Expansion Rate follow the customers of the first day of the period (2026-11-21)", () => {
  // Three customers who joined inside Q2 are planted to move MRR before it ends:
  // c18, enterprise, starts on 13 May and contracts by 500 on 20 June.
  // c19, smb, starts on 3 June and churns its 700 on 25 June.
  // c17, mid_market, starts on 21 April and expands by 300 on 18 June.
  // Two customers of 1 April change segment on 1 May: c06, enterprise, becomes mid_market before its 200
  // contraction of 18 May and c07, smb, becomes enterprise before its 1,000 expansion of 6 May.
  const Q2 = ["2026-04-01", "2026-06-30"] as const;
  const SEGMENTS = ["enterprise", "mid_market", "smb"];
  const RATES = {
    revenue_churn_rate: { replaced: "(metric.churned_mrr + metric.contraction_mrr) / metric.mrr at period_start", types: ["churn", "contraction"], sign: -1 },
    expansion_rate: { replaced: "metric.expansion_mrr / metric.mrr at period_start", types: ["expansion"], sign: 1 },
  } as const;
  type Rate = keyof typeof RATES;
  let planted: PGlite;

  const re = (f: string) => c("revenue_event", f);
  const cu = (f: string) => c("customer", f);
  const su = (f: string) => c("subscription", f);

  /** Copy the customer's first event as a later movement of another type. */
  const movement = (customer: string, type: string, date: string, change: number) =>
    `CREATE TEMP TABLE planted AS SELECT * FROM ${t("revenue_event")} WHERE ${re("customer_id")} = '${customer}' AND ${re("event_type")} = 'new';
      UPDATE planted SET ${re("event_id")} = 'planted_${type}_${customer}', ${re("event_type")} = '${type}', ${re("event_date")} = DATE '${date}', ${re("mrr_change")} = ${change};
      INSERT INTO ${t("revenue_event")} SELECT * FROM planted;
      DROP TABLE planted;`;

  beforeAll(async () => {
    planted = await fixtureDb();
    await planted.exec(movement("c18", "contraction", "2026-06-20", -500) + movement("c19", "churn", "2026-06-25", -700) + movement("c17", "expansion", "2026-06-18", 300));
    await moveSegment(planted, "c06", "2026-05-01", "mid_market");
    await moveSegment(planted, "c07", "2026-05-01", "enterprise");
  }, 120_000);
  afterAll(async () => { await planted?.close(); });

  /** A metric compiled from the canonical formula, or from the one given in its place: the company's value or a value per segment. */
  function template(id: string, variant?: string, formula?: string): QueryTemplate {
    const ctx = {
      fields: Object.fromEntries(data.ontology!.fields!.map((f) => [f.id, f])),
      datasets: data.ontology!.datasets!,
      formulas: formula ? { ...data.formulas!, [id]: { ...data.formulas![id], formula } } : data.formulas!,
    };
    const k = compileMetric(id, ctx, variant);
    if (variant && !formula) expect(k.placeholders.filter((p) => p.startsWith("segment@"))).toEqual(["segment@customer"]);
    return { ...data.queryTemplates[id], fields: k.fields, datasets: k.datasets, parameterizedQuery: k.sql, placeholders: k.placeholders, breakdown: k.breakdown } as QueryTemplate;
  }
  const company = (on: PGlite, id: string, formula?: string) => scalar(on, bind(fillTemplate(template(id, undefined, formula), adapter, data).sql, ...Q2));
  async function bySegment(on: PGlite, id: string, formula?: string): Promise<Record<string, number | null>> {
    const res = await on.query<Record<string, unknown>>(bind(fillTemplate(template(id, "by_segment", formula), adapter, data).sql, ...Q2));
    return Object.fromEntries(res.rows.map((r) => [String(r.segment), r[id] === null || r[id] === undefined ? null : Number(r[id])]));
  }

  // Plain SQL over the fixture's own names. `who` picks the customers and `rows` narrows the rows read to one segment.
  const active = (segment?: string) => `SELECT ${cu("customer_id")} FROM ${t("customer")} WHERE ${cu("snapshot_date")} = DATE '${Q2[0]}' AND ${cu("customer_status")} = 'active'`
    + (segment ? ` AND ${cu("segment")} = '${segment}'` : "");
  const opening = (who = "", rows = "") => `(SELECT COALESCE(SUM(${su("mrr")}), 0) FROM ${t("subscription")} WHERE ${su("snapshot_date")} = DATE '${Q2[0]}' AND ${su("subscription_status")} = 'active'`
    + `${who && ` AND ${su("customer_id")} IN (${who})`}${rows && ` AND ${su("segment")} = '${rows}'`})`;
  const moved = (types: readonly string[], who = "", rows = "") => `(SELECT COALESCE(SUM(${re("mrr_change")}), 0) FROM ${t("revenue_event")}`
    + ` WHERE ${re("event_date")} BETWEEN DATE '${Q2[0]}' AND DATE '${Q2[1]}' AND ${re("event_type")} IN (${types.map((x) => `'${x}'`).join(", ")})`
    + `${who && ` AND ${re("customer_id")} IN (${who})`}${rows && ` AND ${re("segment")} = '${rows}'`})`;
  const rate = (on: PGlite, id: Rate, who: string, rows: string) =>
    scalar(on, `SELECT CAST(${RATES[id].sign} * ${moved(RATES[id].types, who, rows)} AS DOUBLE PRECISION) / NULLIF(${opening(who, rows)}, 0)`);
  /** The rule since 2026-11-21: the movements of the customers of the first day over their MRR on that day. */
  const ofFirstDay = (on: PGlite, id: Rate, segment?: string) => rate(on, id, active(segment), "");
  /** The rule it replaced: every customer's movements in the period, each row in the segment it carries. */
  const everyRow = (on: PGlite, id: Rate, segment = "") => rate(on, id, "", segment);
  const opened = async (segment?: string) => (await scalar(planted, `SELECT ${opening(active(segment))}`))!;

  for (const id of Object.keys(RATES) as Rate[]) {
    it(`${id}: reads the customers of the first day, for the company and per segment`, async () => {
      expect(await company(planted, id)).toBeCloseTo((await ofFirstDay(planted, id))!, 12);
      expect(await company(planted, id, RATES[id].replaced)).toBeCloseTo((await everyRow(planted, id))!, 12);
      const [rows, replaced] = [await bySegment(planted, id), await bySegment(planted, id, RATES[id].replaced)];
      expect(Object.keys(rows).sort()).toEqual(SEGMENTS);
      for (const g of SEGMENTS) {
        expect(rows[g], g).toBeCloseTo((await ofFirstDay(planted, id, g))!, 12);
        expect(replaced[g], g).toBeCloseTo((await everyRow(planted, id, g))!, 12);
      }
    });

    it(`${id}: with nobody joining and moving MRR in the period and nobody changing segment the two readings agree`, async () => {
      expect(await company(db, id)).toBeCloseTo((await company(db, id, RATES[id].replaced))!, 12);
      const [rows, replaced] = [await bySegment(db, id), await bySegment(db, id, RATES[id].replaced)];
      for (const g of SEGMENTS) expect(rows[g], g).toBeCloseTo(replaced[g]!, 12);
    });
  }

  it("the formulas they replace counted MRR that was never in the opening figure", async () => {
    const all = await opened();
    const [ent, mid, smb] = [await opened("enterprise"), await opened("mid_market"), await opened("smb")];
    // Company: c18's 500 and c19's 700 were lost by customers with no MRR on 1 April, as c17's 300 was gained by one.
    expect((await company(planted, "revenue_churn_rate", RATES.revenue_churn_rate.replaced))! - (await company(planted, "revenue_churn_rate"))!).toBeCloseTo(1200 / all, 12);
    expect((await company(planted, "expansion_rate", RATES.expansion_rate.replaced))! - (await company(planted, "expansion_rate"))!).toBeCloseTo(300 / all, 12);
    // Per segment: c06's 200 stays in enterprise, where it opened, and c18's 500 leaves it; mid_market loses c06's 200; smb has no churn without c19.
    const [churn, churnWas] = [await bySegment(planted, "revenue_churn_rate"), await bySegment(planted, "revenue_churn_rate", RATES.revenue_churn_rate.replaced)];
    expect(churnWas.enterprise! - churn.enterprise!).toBeCloseTo((500 - 200) / ent, 12);
    expect(churnWas.mid_market! - churn.mid_market!).toBeCloseTo(200 / mid, 12);
    expect(churnWas.smb!).toBeCloseTo(700 / smb, 12);
    expect(churn.smb).toBe(0);
    // c07's 1,000 expansion stays in smb and c17's 300 leaves mid_market.
    const [exp, expWas] = [await bySegment(planted, "expansion_rate"), await bySegment(planted, "expansion_rate", RATES.expansion_rate.replaced)];
    expect(expWas.smb! - exp.smb!).toBeCloseTo(-1000 / smb, 12);
    expect(expWas.enterprise! - exp.enterprise!).toBeCloseTo(1000 / ent, 12);
    expect(expWas.mid_market! - exp.mid_market!).toBeCloseTo(300 / mid, 12);
  });

  it("Revenue Churn Rate is one less GRR over the same period, for the company and per segment, and stays within 0 and 1", async () => {
    const [churn, grr] = [await company(planted, "revenue_churn_rate"), await company(planted, "grr")];
    expect(churn).toBeCloseTo(1 - grr!, 12);
    const [rows, kept] = [await bySegment(planted, "revenue_churn_rate"), await bySegment(planted, "grr")];
    for (const g of SEGMENTS) {
      expect(rows[g], g).toBeCloseTo(1 - kept[g]!, 12);
      expect(rows[g], g).toBeGreaterThanOrEqual(0);
      expect(rows[g], g).toBeLessThanOrEqual(1);
    }
  });
});

describe("Five rates follow the population of the first day of the period (2026-11-24)", () => {
  // Partner Churn Rate, Cross-sell Rate, Upsell Rate, the entered_at_risk variant of At-Risk Rate and
  // Resurrection Rate each divided every event of the period by a count taken on its first day. Planted over Q2:
  // p08, platinum, recruited on 4 June, becomes active on 10 June and leaves on 25 June.
  // p09, registered and active on 1 April, becomes gold on 1 May, six weeks before it leaves.
  // c18, a customer from 13 May, buys a second product and upgrades on 24 June and turns at risk on 20 June.
  // c09, a customer on 1 April, turns at risk on 5 May.
  // u01, active on 1 April, is dormant from 1 May and returns on 10 June.
  const Q2 = ["2026-04-01", "2026-06-30"] as const;
  const REPLACED = {
    partner_churn_rate: "count_distinct(field.partner_id where in_period(field.partner_churn_date)) / count_distinct(field.partner_id where field.partner_status = 'active') at period_start",
    cross_sell_rate: "count_distinct(field.customer_id where field.amendment_type = 'cross_sell') / count_distinct(field.customer_id where field.customer_status = 'active') at period_start",
    upsell_rate: "count_distinct(field.customer_id where field.amendment_type = 'upgrade') / count_distinct(field.customer_id where field.upgrade_eligible = true) at period_start",
    at_risk_rate: "count_distinct(field.customer_id where field.state_category = 'at_risk') / count_distinct(field.customer_id where field.customer_status = 'active') at period_start",
    resurrection_rate: "count_distinct(field.user_id where field.product_event_type = 'reactivation') / count_distinct(field.user_id where field.user_status = 'dormant') at period_start",
  } as const;
  type Rate = keyof typeof REPLACED;
  /** The entry the rate lives in: the main formula, or the variant for At-Risk Rate. */
  const VARIANT: Partial<Record<Rate, string>> = { at_risk_rate: "entered_at_risk" };
  let planted: PGlite;

  const pa = (f: string) => c("partner", f);
  const cu = (f: string) => c("customer", f);
  const am = (f: string) => c("amendment_event", f);
  const lc = (f: string) => c("lifecycle_event", f);
  const us = (f: string) => c("user", f);
  const pe = (f: string) => c("product_event", f);

  /** Copy one row of a dataset onto the planted database with some columns changed. */
  const copy = (ds: string, where: string, set: string) => planted.exec(`CREATE TEMP TABLE planted AS SELECT * FROM ${t(ds)} WHERE ${where};
    UPDATE planted SET ${set};
    INSERT INTO ${t(ds)} SELECT * FROM planted;
    DROP TABLE planted;`);

  beforeAll(async () => {
    planted = await fixtureDb();
    await planted.exec(`UPDATE ${t("partner")} SET ${pa("partner_status")} = 'active' WHERE ${pa("partner_id")} = 'p08' AND ${pa("snapshot_date")} >= DATE '2026-06-10';
      UPDATE ${t("partner")} SET ${pa("partner_status")} = 'churned', ${pa("partner_churn_date")} = DATE '2026-06-25' WHERE ${pa("partner_id")} = 'p08' AND ${pa("snapshot_date")} >= DATE '2026-06-25';
      UPDATE ${t("partner")} SET ${pa("partner_tier")} = 'gold' WHERE ${pa("partner_id")} = 'p09' AND ${pa("snapshot_date")} >= DATE '2026-05-01';
      UPDATE ${t("user")} SET ${us("user_status")} = 'dormant' WHERE ${us("user_id")} = 'u01' AND ${us("snapshot_date")} BETWEEN DATE '2026-05-01' AND DATE '2026-06-09';`);
    const amendment = (type: string) => `${am("customer_id")} = 'c18', ${am("event_id")} = 'planted_${type}_c18', ${am("event_date")} = DATE '2026-06-24', ${am("amendment_type")} = '${type}'`;
    await copy("amendment_event", `${am("customer_id")} = 'c10' AND ${am("amendment_type")} = 'cross_sell'`, amendment("cross_sell"));
    await copy("amendment_event", `${am("customer_id")} = 'c13' AND ${am("amendment_type")} = 'upgrade'`, amendment("upgrade"));
    const atRisk = (customer: string, day: string) => `${lc("customer_id")} = '${customer}', ${lc("event_id")} = 'planted_risk_${customer}', ${lc("event_date")} = DATE '${day}', ${lc("prior_state")} = 'active', ${lc("new_state")} = 'at_risk', ${lc("state_category")} = 'at_risk'`;
    const churnOfC05 = `${lc("customer_id")} = 'c05' AND ${lc("state_category")} = 'churned'`;
    await copy("lifecycle_event", churnOfC05, atRisk("c09", "2026-05-05"));
    await copy("lifecycle_event", churnOfC05, atRisk("c18", "2026-06-20"));
    await copy("product_event", `${pe("event_id")} = 'pe_u29_back'`, `${pe("user_id")} = 'u01', ${pe("event_id")} = 'planted_back_u01', ${pe("event_date")} = DATE '2026-06-10'`);
  }, 120_000);
  afterAll(async () => { await planted?.close(); });

  /** A rate compiled from the canonical entry, or with the formula it replaced in its place, optionally by a breakdown. */
  function template(id: Rate, replaced: boolean, breakdown?: string): QueryTemplate {
    const entry = data.formulas![id];
    const old = VARIANT[id] ? { ...entry, variants: { ...entry.variants, [VARIANT[id]!]: REPLACED[id] } } : { ...entry, formula: REPLACED[id] };
    const ctx = {
      fields: Object.fromEntries(data.ontology!.fields!.map((f) => [f.id, f])),
      datasets: data.ontology!.datasets!,
      formulas: replaced ? { ...data.formulas!, [id]: old } : data.formulas!,
    };
    const k = compileMetric(id, ctx, breakdown ?? VARIANT[id]);
    expect(k.staged, id).toBe(!replaced);
    return { ...data.queryTemplates[id], fields: k.fields, datasets: k.datasets, parameterizedQuery: k.sql, placeholders: k.placeholders, breakdown: k.breakdown } as QueryTemplate;
  }
  const rate = (on: PGlite, id: Rate, replaced = false) => scalar(on, bind(fillTemplate(template(id, replaced), adapter, data).sql, ...Q2));
  const count = async (sql: string) => (await scalar(planted, `SELECT COUNT(*) FROM (${sql}) AS x`))!;

  // Plain SQL over the fixture's own names.
  const inQ2 = (col: string) => `${col} BETWEEN DATE '${Q2[0]}' AND DATE '${Q2[1]}'`;
  const openingCustomers = (and = "") => `SELECT ${cu("customer_id")} FROM ${t("customer")} WHERE ${cu("snapshot_date")} = DATE '${Q2[0]}' AND ${cu("customer_status")} = 'active'${and}`;
  const amended = (type: string) => `SELECT DISTINCT ${am("customer_id")} FROM ${t("amendment_event")} WHERE ${inQ2(am("event_date"))} AND ${am("amendment_type")} = '${type}'`;
  const of = (events: string, key: string, members: string) => `${events} AND ${key} IN (${members})`;

  it("Partner Churn Rate counts a partner who left only when they were active on the first day", async () => {
    const opening = (tier?: string) => `SELECT ${pa("partner_id")} FROM ${t("partner")} WHERE ${pa("snapshot_date")} = DATE '${Q2[0]}' AND ${pa("partner_status")} = 'active'` + (tier ? ` AND ${pa("partner_tier")} = '${tier}'` : "");
    const left = (tier?: string) => `SELECT ${pa("partner_id")} FROM ${t("partner")} WHERE ${pa("snapshot_date")} = DATE '${Q2[1]}' AND ${inQ2(pa("partner_churn_date"))}` + (tier ? ` AND ${pa("partner_tier")} = '${tier}'` : "");
    const partners = await count(opening());
    expect(partners).toBe(8);
    // p09 was active on 1 April; p08 was not a partner yet.
    expect(await count(of(left(), pa("partner_id"), opening()))).toBe(1);
    expect(await rate(planted, "partner_churn_rate")).toBeCloseTo(1 / partners, 12);
    expect(await count(left())).toBe(2);
    expect(await rate(planted, "partner_churn_rate", true)).toBeCloseTo(2 / partners, 12);

    // By tier each partner counts in the tier held on the first day: p09 left from registered, where it opened the quarter.
    const TIERS = ["gold", "platinum", "registered", "silver"];
    const byTier = async (replaced: boolean) => {
      const res = await planted.query<Record<string, unknown>>(bind(fillTemplate(template("partner_churn_rate", replaced, "by_partner_tier"), adapter, data).sql, ...Q2));
      return Object.fromEntries(res.rows.map((r) => [String(r.partner_tier), r.partner_churn_rate === null || r.partner_churn_rate === undefined ? null : Number(r.partner_churn_rate)]));
    };
    const [rows, replaced] = [await byTier(false), await byTier(true)];
    expect(Object.keys(rows).sort()).toEqual(TIERS);
    for (const g of TIERS) {
      expect(rows[g], g).toBeCloseTo((await count(of(left(), pa("partner_id"), opening(g)))) / (await count(opening(g))), 12);
      expect(replaced[g], g).toBeCloseTo((await count(left(g))) / (await count(opening(g))), 12);
    }
    expect(rows.registered).toBeCloseTo(1 / (await count(opening("registered"))), 12);
    expect([rows.gold, rows.platinum, rows.silver]).toEqual([0, 0, 0]);
    // By the tier of the last day p09 left from gold and p08, never in the opening count, made platinum 100%.
    expect([replaced.registered, replaced.platinum]).toEqual([0, 1]);
    expect(replaced.gold).toBeCloseTo(1 / (await count(opening("gold"))), 12);
  });

  it("Cross-sell Rate counts a second product only from a customer of the first day", async () => {
    const customers = await count(openingCustomers());
    // c10 was a customer on 1 April; c18 joined on 13 May.
    expect(await count(of(amended("cross_sell"), am("customer_id"), openingCustomers()))).toBe(1);
    expect(await rate(planted, "cross_sell_rate")).toBeCloseTo(1 / customers, 12);
    expect(await count(amended("cross_sell"))).toBe(2);
    expect(await rate(planted, "cross_sell_rate", true)).toBeCloseTo(2 / customers, 12);
  });

  it("Upsell Rate counts an upgrade only from a customer active and eligible on the first day", async () => {
    const eligible = openingCustomers(` AND ${cu("upgrade_eligible")} = TRUE`);
    const customers = await count(eligible);
    // c13 was eligible on 1 April. c04 upgrades without the flag and c18 joined on 13 May.
    expect(await count(of(amended("upgrade"), am("customer_id"), eligible))).toBe(1);
    expect(await rate(planted, "upsell_rate")).toBeCloseTo(1 / customers, 12);
    expect(await count(amended("upgrade"))).toBe(3);
    const flagged = await count(`SELECT ${cu("customer_id")} FROM ${t("customer")} WHERE ${cu("snapshot_date")} = DATE '${Q2[0]}' AND ${cu("upgrade_eligible")} = TRUE`);
    expect(await rate(planted, "upsell_rate", true)).toBeCloseTo(3 / flagged, 12);
  });

  it("At-Risk Rate, entered_at_risk, counts a customer of the first day who turned at risk", async () => {
    const customers = await count(openingCustomers());
    const turned = `SELECT DISTINCT ${lc("customer_id")} FROM ${t("lifecycle_event")} WHERE ${inQ2(lc("event_date"))} AND ${lc("state_category")} = 'at_risk'`;
    // c09 was a customer on 1 April; c18 joined on 13 May.
    expect(await count(of(turned, lc("customer_id"), openingCustomers()))).toBe(1);
    expect(await rate(planted, "at_risk_rate")).toBeCloseTo(1 / customers, 12);
    expect(await count(turned)).toBe(2);
    expect(await rate(planted, "at_risk_rate", true)).toBeCloseTo(2 / customers, 12);
  });

  it("Resurrection Rate follows the users dormant on the first day and stays within 0 and 1", async () => {
    const dormant = `SELECT ${us("user_id")} FROM ${t("user")} WHERE ${us("snapshot_date")} = DATE '${Q2[0]}' AND ${us("user_status")} = 'dormant'`;
    const back = `SELECT DISTINCT ${pe("user_id")} FROM ${t("product_event")} WHERE ${inQ2(pe("event_date"))} AND ${pe("product_event_type")} = 'reactivation'`;
    // u29 was dormant on 1 April and returns on 17 June. u01 went dormant and returned inside the quarter.
    expect(await count(dormant)).toBe(1);
    expect(await count(of(back, pe("user_id"), dormant))).toBe(1);
    expect(await rate(planted, "resurrection_rate")).toBe(1);
    expect(await count(back)).toBe(2);
    // The formula it replaces returned two users for one dormant user: 200%.
    expect(await rate(planted, "resurrection_rate", true)).toBe(2);
  });

  it("with nobody joining and acting inside the period the two readings agree", async () => {
    // Upsell Rate is left out: the fixture's c04 upgrades without the eligible flag, so the two differ on any rows.
    for (const id of ["partner_churn_rate", "cross_sell_rate", "at_risk_rate", "resurrection_rate"] as const) {
      expect(await rate(db, id), id).toBeCloseTo((await rate(db, id, true))!, 12);
    }
  });
});

describe("NRR-M counts every expansion and reactivation, with a tag or without (2026-11-27)", () => {
  // The Market form filtered expansion_classification on every value the field takes. On tagged rows
  // that leaves out nothing; a row with no tag fails it, and the ledger derive_cel writes carries
  // none (cel.md, step 6). c07 and c14 are in the cohort of 1 April; each gets one untagged event.
  const Q2 = ["2026-04-01", "2026-06-30"] as const;
  const M = data.formulas!.nrr.forms!.M!, O = data.formulas!.nrr.forms!.O!;
  const EVERY = "sum(field.mrr_change where field.event_type in ('expansion', 'reactivation'))";
  const FILTERED = EVERY.replace(/\)\)$/, ") and field.expansion_classification in ('same_product', 'new_module', 'new_buying_centre', 'pricing_adjustment', 'recontracting'))");
  const WAS = M.replace(EVERY, FILTERED);
  let untagged: PGlite;

  beforeAll(async () => {
    untagged = await fixtureDb();
    await plantMovement(untagged, "c07", { id: "ev_untagged_expansion", date: "2026-05-20", type: "expansion", change: 700, nature: "permanent" });
    await plantMovement(untagged, "c14", { id: "ev_untagged_reactivation", date: "2026-06-15", type: "reactivation", change: 400, nature: "permanent" });
  }, 120_000);
  afterAll(async () => { await untagged?.close(); });

  const opening = (on: PGlite) => scalar(on, `SELECT SUM(${c("subscription", "mrr")}) FROM ${t("subscription")} WHERE ${c("subscription", "snapshot_date")} = DATE '${Q2[0]}'
    AND ${c("subscription", "subscription_status")} = 'active' AND ${c("subscription", "customer_id")} IN (SELECT ${c("customer", "customer_id")} FROM ${t("customer")}
      WHERE ${c("customer", "snapshot_date")} = DATE '${Q2[0]}' AND ${c("customer", "customer_status")} = 'active')`);

  it("the form reads event_type alone, in the formula, its data requirement and the cohort table's column", () => {
    expect(M).toContain(EVERY);
    expect(WAS).not.toBe(M);
    const forms = data.dataRequirements.find((d) => d.formulaId === "nrr")!.forms!;
    expect(forms.M!.fields).not.toContain("expansion_classification");
    expect(forms.O!.fields).toContain("expansion_classification");
    expect(ACCOUNT_COHORTS.columns.find((col) => col.name === "expansion_mrr_m")!.formula).toBe(EVERY);
  });

  it("gives the number the filter gave where every event carries a tag", async () => {
    expect(await scalar(db, `SELECT COUNT(*) FROM ${t("revenue_event")} WHERE ${c("revenue_event", "event_type")} IN ('expansion', 'reactivation') AND ${c("revenue_event", "expansion_classification")} IS NULL`)).toBe(0);
    expect(await runFormula("nrr", M, ...Q2)).toBeCloseTo((await runFormula("nrr", WAS, ...Q2))!, 12);
  });

  it("counts an expansion and a reactivation that carry no tag, which the filter dropped and the Operating form still leaves out", async () => {
    const open = (await opening(untagged))!;
    expect(open).toBeGreaterThan(0);
    expect(open).toBe(await opening(db));
    expect((await runFormula("nrr", M, ...Q2, untagged))! - (await runFormula("nrr", M, ...Q2))!).toBeCloseTo((700 + 400) / open, 10);
    expect(await runFormula("nrr", WAS, ...Q2, untagged)).toBeCloseTo((await runFormula("nrr", WAS, ...Q2))!, 12);
    expect(await runFormula("nrr", O, ...Q2, untagged)).toBeCloseTo((await runFormula("nrr", O, ...Q2))!, 12);
  });
});
