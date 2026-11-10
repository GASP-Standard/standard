import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { loadStandard } from "../src/loader.js";
import { compileMetric } from "../src/compile.js";
import { fillTemplate } from "../src/tools.js";
import { TABLES, columnName } from "../src/synthetic.js";
import type { QueryTemplate } from "../src/types.js";
import { adapter, fixtureDb, bind, scalar, runTemplate } from "./fixture-db.js";

// Regression tests for four formula corrections (2026-11-10). Each metric's
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
  // A June hire who leaves 18 days later: the one early leaver of the June cohort.
  await plant("employee", `employee_id = 'e24' AND ${c("employee", "snapshot_date")} = '2026-06-30'`,
    `employee_id = 'e99', ${c("employee", "hire_date")} = '2026-06-02', termination_date = '2026-06-20', ${c("employee", "employee_status")} = 'terminated'`);
}, 120_000);

afterAll(async () => { await db?.close(); });

describe("formula corrections", () => {
  it("90-Day Turnover counts early leavers among the period's hires only", async () => {
    const E = t("employee"), snap = c("employee", "snapshot_date"), hire = c("employee", "hire_date");
    const cohort = `FROM ${E} WHERE ${snap} = '2026-06-30' AND ${hire} BETWEEN '2026-06-01' AND '2026-06-30'`;
    const hires = await value(`SELECT COUNT(DISTINCT employee_id) ${cohort}`);
    const early = await value(`SELECT COUNT(DISTINCT employee_id) ${cohort} AND termination_date - ${hire} <= 90`);
    expect([hires, early]).toEqual([2, 1]);
    expect(await run("day_90_turnover", "2026-06-01", "2026-06-30")).toBeCloseTo(early! / hires!, 10);
    // The old numerator also counted e19 (hired in January, left in April).
    const old = "count_distinct(field.employee_id where field.termination_date is not null and field.termination_date - field.hire_date <= 90) / count_distinct(field.employee_id where field.hire_date >= period_start and field.hire_date <= period_end)";
    expect(await runFormula("day_90_turnover", old, "2026-06-01", "2026-06-30")).toBeCloseTo(1, 10);
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
