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
import { generateFixture, datasetFields, columnName, TABLES, type Row } from "./fixture/generate.js";

export const fixture = generateFixture();
export const adapter = JSON.parse(readFileSync(join(new URL(".", import.meta.url).pathname, "fixture", "adapter.json"), "utf-8"));

const PG_TYPES: Record<string, string> = { date: "DATE", timestamp: "TIMESTAMP", decimal: "NUMERIC", integer: "INTEGER", boolean: "BOOLEAN" };
const literal = (v: Row[string]) =>
  v === null || v === undefined ? "NULL" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

/** A fresh PGlite holding one table per fixture dataset, under the warehouse names in TABLES and COLUMNS. */
export async function fixtureDb(): Promise<PGlite> {
  const db = new PGlite();
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
