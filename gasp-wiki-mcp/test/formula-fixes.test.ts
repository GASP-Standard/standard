import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { loadStandard } from "../src/loader.js";
import { compileMetric } from "../src/compile.js";
import { fillTemplate } from "../src/tools.js";
import { TABLES, columnName } from "../src/synthetic.js";
import type { QueryTemplate } from "../src/types.js";
import { adapter, fixtureDb, bind, scalar, runTemplate } from "./fixture-db.js";

// Regression tests for the formula corrections of 2026-11-10 (four) and
// 2026-11-19 (90-Day Turnover again and Commit Accuracy). Each metric's
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
async function runFormula(id: string, formula: string, start: string, end: string): Promise<number | null> {
  const ctx = {
    fields: Object.fromEntries(data.ontology!.fields!.map((f) => [f.id, f])),
    datasets: data.ontology!.datasets!,
    formulas: { ...data.formulas!, [id]: { ...data.formulas![id], formula } },
  };
  const compiled = compileMetric(id, ctx);
  const template = { ...data.queryTemplates[id], parameterizedQuery: compiled.sql, placeholders: compiled.placeholders } as QueryTemplate;
  return scalar(db, bind(fillTemplate(template, adapter, data).sql, start, end));
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
