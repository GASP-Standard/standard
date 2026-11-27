/**
 * The fixture (test/fixture) loaded into an in-process Postgres, shared by the
 * tests that run SQL against it: execute.test.ts runs the compiled templates
 * filled from the fixture adapter, ossie-model.test.ts runs the Ossie
 * expressions and staged sources over `gasp.<dataset>` views of the same rows.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { fillTemplate } from "../src/tools.js";
import type { StandardData } from "../src/types.js";
import { generateFixture, datasetFields, columnName, loadSynthetic, addDays, segmentOf, TABLES } from "../src/synthetic.js";

export const fixture = generateFixture();
export const adapter = JSON.parse(readFileSync(join(new URL(".", import.meta.url).pathname, "fixture", "adapter.json"), "utf-8"));

/** A fresh PGlite holding one table per fixture dataset, under the warehouse names in TABLES and COLUMNS. */
export async function fixtureDb(): Promise<PGlite> {
  const db = new PGlite();
  await loadSynthetic(db, fixture);
  return db;
}

/**
 * The physical tables the Ossie model names: a `gasp.<dataset>` view per fixture
 * dataset with every column under its GASP field id.
 */
export async function addOssieViews(db: PGlite): Promise<void> {
  await db.exec("CREATE SCHEMA IF NOT EXISTS gasp");
  for (const [ds, table] of Object.entries(TABLES)) {
    const cols = datasetFields(ds).map((f) => `${columnName(ds, f.id)} AS "${f.id}"`);
    await db.exec(`CREATE VIEW gasp."${ds}" AS SELECT ${cols.join(", ")} FROM ${table}`);
  }
}

/**
 * Move a customer to another segment from a day on: their customer and
 * subscription snapshots and their revenue events from that day carry it. The
 * synthetic data keeps every customer in one segment, so a test of what a
 * breakdown by segment does with a mover plants one.
 */
export async function moveSegment(db: PGlite, customer: string, from: string, segment: string): Promise<void> {
  for (const [ds, date] of [["customer", "snapshot_date"], ["subscription", "snapshot_date"], ["revenue_event", "event_date"]] as const)
    await db.exec(`UPDATE ${TABLES[ds]} SET ${columnName(ds, "segment")} = '${segment}' WHERE ${columnName(ds, "customer_id")} = '${customer}' AND ${columnName(ds, date)} >= DATE '${from}'`);
}

type Planted = string | number | boolean | null | undefined;
const literal = (v: Planted) => (v === null || v === undefined ? "NULL" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : typeof v === "number" ? String(v) : `'${v}'`);

/** Add a row to a dataset's table: a copy of one of its rows with the given fields set and the customer's segment. */
async function plant(db: PGlite, ds: string, customer: string, values: Record<string, Planted>): Promise<void> {
  // A planted account (any id outside the synthetic c01 to c20 form) has no subscription unless the values name one.
  const subscription = /^c\d+$/.test(customer) ? `s${customer.slice(1)}` : null;
  const set = Object.entries({ subscription_id: subscription, ...values, customer_id: customer, segment: segmentOf(customer) })
    .map(([f, v]) => `${columnName(ds, f)} = ${literal(v)}`);
  await db.exec(`CREATE TEMP TABLE planted AS SELECT * FROM ${TABLES[ds]} LIMIT 1;
    UPDATE planted SET ${set.join(", ")};
    INSERT INTO ${TABLES[ds]} SELECT * FROM planted;
    DROP TABLE planted;`);
}

/**
 * Add a pay-as-you-go account: a customer snapshot row for every day the
 * template customer has one, with the status `pay_as_you_go` and no
 * subscription or revenue event. No synthetic customer is one.
 */
export async function plantPayAsYouGoCustomer(db: PGlite, customer: string, template = "c01"): Promise<void> {
  const cu = (f: string) => columnName("customer", f);
  await db.exec(`CREATE TEMP TABLE planted AS SELECT * FROM ${TABLES.customer} WHERE ${cu("customer_id")} = '${template}';
    UPDATE planted SET ${cu("customer_id")} = '${customer}', ${cu("customer_status")} = 'pay_as_you_go';
    INSERT INTO ${TABLES.customer} SELECT * FROM planted;
    DROP TABLE planted;`);
}

/** Rows for a planted customer on every day from one date: copies of a template customer's row with the day set, ready for an UPDATE. */
async function plantDaily(db: PGlite, ds: string, template: string, from: string, set: string): Promise<void> {
  const col = (f: string) => columnName(ds, f);
  await db.exec(`CREATE TEMP TABLE planted AS
      SELECT t.*, d::date AS planted_day
      FROM (SELECT * FROM ${TABLES[ds]} WHERE ${col("customer_id")} = '${template}' LIMIT 1) t
      CROSS JOIN generate_series(DATE '${from}', DATE '${FIXTURE_END}', INTERVAL '1 day') d;
    UPDATE planted SET ${col("snapshot_date")} = planted_day, ${set};
    ALTER TABLE planted DROP COLUMN planted_day;
    INSERT INTO ${TABLES[ds]} SELECT * FROM planted;
    DROP TABLE planted;`);
}

const FIXTURE_END = "2026-06-30";

/** A contract a planted customer holds, with the day its access stops (the first day with no MRR). */
export interface PlantedContract { start: string; end: string; mrr: number; renewable: boolean }

/**
 * Add a customer on one contract that counts in MRR: customer and subscription
 * snapshot rows for every day from its start, the `new` event on its first day
 * and the `churn` event on the day it ends, when that falls inside the fixture.
 * A contract with no renewal (12 months or more, since it counts) carries
 * `renewable` false and its events the `temporary` and `scheduled_reversal`
 * tags of cel.md; a renewing one is `permanent` at both ends. The subscription
 * id is `s_<customer>`.
 */
export async function plantContractCustomer(db: PGlite, customer: string, c: PlantedContract, template = "c01"): Promise<void> {
  const cu = (f: string) => columnName("customer", f);
  const su = (f: string) => columnName("subscription", f);
  const subscription = `s_${customer}`;
  const mrr = (day: string) => `CASE WHEN ${day} < DATE '${c.end}' THEN ${c.mrr} ELSE 0 END`;
  await plantDaily(db, "customer", template, c.start,
    `${cu("customer_id")} = '${customer}', ${cu("acquisition_date")} = '${c.start}', ${cu("customer_status")} = CASE WHEN planted_day < DATE '${c.end}' THEN 'active' ELSE 'churned' END`);
  await plantDaily(db, "subscription", template, c.start,
    `${su("customer_id")} = '${customer}', ${su("subscription_id")} = '${subscription}', ${su("contract_start")} = '${c.start}', ${su("contract_end")} = '${c.end}', ${su("renewable")} = ${literal(c.renewable)},
      ${su("mrr")} = ${mrr("planted_day")}, ${su("mrr_end")} = ${mrr("planted_day")}, ${su("mrr_start")} = CASE WHEN planted_day = DATE '${c.start}' THEN 0 ELSE ${mrr("planted_day - 1")} END,
      ${su("subscription_status")} = CASE WHEN planted_day < DATE '${c.end}' THEN 'active' ELSE 'cancelled' END`);
  const event = { subscription_id: subscription, expansion_classification: null };
  await plant(db, "revenue_event", customer, { ...event, event_id: `${customer}:new`, event_date: c.start, event_type: "new", mrr_change: c.mrr, prior_mrr: 0, new_mrr: c.mrr,
    change_nature: c.renewable ? "permanent" : "temporary", lifecycle_attribution: "acquisition" });
  if (c.end <= FIXTURE_END) await plant(db, "revenue_event", customer, { ...event, event_id: `${customer}:churn`, event_date: c.end, event_type: "churn", mrr_change: -c.mrr, prior_mrr: c.mrr, new_mrr: 0,
    change_nature: c.renewable ? "permanent" : "scheduled_reversal", lifecycle_attribution: "retention" });
  await plant(db, "contract_event", customer, { subscription_id: subscription, event_id: `${customer}:contract:${c.start}`, event_date: c.start, contract_event_type: "new_contract",
    contract_start: c.start, contract_end: c.end, renewable: c.renewable, acv: c.mrr * 12, tcv: c.mrr * 12 });
}

/** Add a revenue event to a planted customer's subscription, with its tags, and the amount to the subscription's MRR from that day up to another. */
export async function plantMovement(db: PGlite, customer: string, e: { id: string; date: string; type: string; change: number; nature: string; classification?: string }, mrrUntil?: string): Promise<void> {
  const su = (f: string) => columnName("subscription", f);
  await plant(db, "revenue_event", customer, { subscription_id: `s_${customer}`, event_id: e.id, event_date: e.date, event_type: e.type, mrr_change: e.change,
    change_nature: e.nature, expansion_classification: e.classification ?? null, lifecycle_attribution: e.type === "expansion" ? "expansion" : "retention" });
  if (mrrUntil) await db.exec(`UPDATE ${TABLES.subscription} SET ${su("mrr")} = ${su("mrr")} + ${e.change}, ${su("mrr_end")} = ${su("mrr_end")} + ${e.change}
    WHERE ${su("customer_id")} = '${customer}' AND ${su("snapshot_date")} >= DATE '${e.date}' AND ${su("snapshot_date")} < DATE '${mrrUntil}'`);
}

/**
 * Add a customer whose only contract is fixed-term revenue, one under 12
 * months with no renewal (core.md, the year-or-renewal test): customer
 * snapshot rows with the status `fixed_term` from the day it is signed and a
 * new_contract event with the contract's total value and no ACV. It has no
 * subscription row and no revenue event. No synthetic customer is one.
 */
export async function plantFixedTermCustomer(db: PGlite, customer: string, c: { signed: string; start: string; end: string; tcv: number }, template = "c01"): Promise<void> {
  const cu = (f: string) => columnName("customer", f);
  await plantDaily(db, "customer", template, c.signed, `${cu("customer_id")} = '${customer}', ${cu("acquisition_date")} = '${c.start}', ${cu("customer_status")} = 'fixed_term'`);
  await plant(db, "contract_event", customer, { event_id: `${customer}:contract:${c.start}`, event_date: c.signed, contract_event_type: "new_contract",
    contract_start: c.start, contract_end: c.end, renewable: false, acv: null, tcv: c.tcv });
}

/** Add an income statement line for a month: revenue of one type recognised in it, beside the lines the synthetic set holds. */
export async function plantRecognisedRevenue(db: PGlite, month: string, revenueType: string, amount: number): Promise<void> {
  const col = (f: string) => columnName("financials", f);
  const set = Object.entries({ period_start: `${month}-01`, revenue: amount, revenue_type: revenueType, ebitda: null, net_income: null, operating_cash_flow: null, capital_expenditures: null, bad_debt_expense: null })
    .map(([f, v]) => `${col(f)} = ${literal(v)}`);
  await db.exec(`CREATE TEMP TABLE planted AS SELECT * FROM ${TABLES.financials} LIMIT 1;
    UPDATE planted SET ${set.join(", ")};
    INSERT INTO ${TABLES.financials} SELECT * FROM planted;
    DROP TABLE planted;`);
}

/** Add a credit ledger row for a customer: a purchase, or a consumption on a basis, with the balance either side of it. */
export async function plantCreditEvent(db: PGlite, customer: string, e: { id: string; date: string; type: string; amount: number; basis?: string; before: number; after: number; expires?: string }): Promise<void> {
  await plant(db, "credit_event", customer, {
    event_id: e.id, event_date: e.date, credit_event_type: e.type, credit_amount: e.amount, consumption_basis: e.basis ?? null,
    credit_balance_before: e.before, credit_balance_after: e.after, expires_on: e.expires ?? null,
  });
}

/** A metric's compiled template filled from the fixture adapter. */
export function fill(data: StandardData, id: string) {
  const template = data.queryTemplates?.[id];
  if (!template) throw new Error(`no template for ${id}`);
  return fillTemplate(template, adapter, data);
}

/** Replace :period_start and :period_end with date literals. */
export function bind(sql: string, start: string, end: string): string {
  return sql.replace(/:period_start\b/g, `DATE '${start}'`).replace(/:period_end\b/g, `DATE '${end}'`);
}

/** The first column of the first row as a number, or null. */
export async function scalar(db: PGlite, sql: string): Promise<number | null> {
  const res = await db.query<Record<string, unknown>>(sql);
  const v = res.rows[0] ? Object.values(res.rows[0])[0] : null;
  return v === null || v === undefined ? null : Number(v);
}

/** A compiled template's value for one period. */
export async function runTemplate(db: PGlite, data: StandardData, id: string, start: string, end: string): Promise<number | null> {
  return scalar(db, bind(fill(data, id).sql, start, end));
}
