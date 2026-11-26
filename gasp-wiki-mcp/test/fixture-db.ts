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

const literal = (v: string | number | null | undefined) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${v}'`);

/** Add a row to a dataset's table: a copy of one of its rows with the given fields set and the customer's segment. */
async function plant(db: PGlite, ds: string, customer: string, values: Record<string, string | number | null | undefined>): Promise<void> {
  // A planted pay-as-you-go account (any id outside the synthetic c01 to c20 form) has no subscription.
  const subscription = /^c\d+$/.test(customer) ? `s${customer.slice(1)}` : null;
  const set = Object.entries({ ...values, customer_id: customer, subscription_id: subscription, segment: segmentOf(customer) })
    .map(([f, v]) => `${columnName(ds, f)} = ${literal(v)}`);
  await db.exec(`CREATE TEMP TABLE planted AS SELECT * FROM ${TABLES[ds]} LIMIT 1;
    UPDATE planted SET ${set.join(", ")};
    INSERT INTO ${TABLES[ds]} SELECT * FROM planted;
    DROP TABLE planted;`);
}

/**
 * The pair the usage realisation rule of cel.md writes for a period above its
 * commitment: an expansion on the period's last day and its reversal on the
 * next. The synthetic revenue events hold no realised usage, so a test of what
 * a metric does with it plants the pairs.
 */
export async function plantUsageRealisation(db: PGlite, customer: string, periodEnd: string, amount: number): Promise<void> {
  const tags = { expansion_classification: "usage_realisation" };
  await plant(db, "revenue_event", customer, { ...tags, event_id: `usage:${customer}:${periodEnd}`, event_date: periodEnd, event_type: "expansion", mrr_change: amount, change_nature: "temporary" });
  await plant(db, "revenue_event", customer, { ...tags, event_id: `usage:${customer}:${periodEnd}:reversal`, event_date: addDays(periodEnd, 1), event_type: "contraction", mrr_change: -amount, change_nature: "scheduled_reversal" });
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
