/**
 * Shared pieces of the Ossie pipeline tests: the Acme fixtures, the schema
 * parser that throws, the fixture's information_schema and the pair set an
 * adapter resolves to.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { parseSchema, type ParsedSchema } from "../src/ossie/profile.js";
import type { StandardData } from "../src/types.js";
import { resolveAdapter, type Adapter } from "../src/tools.js";

const fixtureDir = join(process.cwd(), "test", "fixture");

/** Acme SaaS's billing schema as a Snowflake DDL dump (see fixture/README.md). */
export const acmeDdl = readFileSync(join(fixtureDir, "acme-schema.sql"), "utf-8");
/** The Acme example adapter as text, the one copy both packages read. */
export const acmeAdapterText = readFileSync(join(fixtureDir, "acme-adapter.json"), "utf-8");
export const acmeAdapter = (): Adapter => JSON.parse(acmeAdapterText) as Adapter;

export const parsedSchema = (text: string): ParsedSchema => {
  const s = parseSchema(text);
  if ("error" in s) throw new Error(s.error);
  return s;
};

/** The fixture's own schema as the rows of information_schema.columns, the shape an agent pastes. */
export async function informationSchema(db: PGlite): Promise<string> {
  const cols = await db.query<Record<string, unknown>>("SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position");
  return JSON.stringify(cols.rows);
}

/** `dataset.field=column[|transform]` for every pair an adapter resolves to, the transform with the column in place of {{value}} so both forms compare alike. */
export const pairs = (adapter: Adapter, data: StandardData): Set<string> => {
  const r = resolveAdapter(adapter, data);
  const out = new Set<string>();
  for (const [ds, cols] of Object.entries(r.columns)) {
    for (const [f, m] of Object.entries(cols)) {
      const column = m.warehouseRef.split(".").pop()!;
      out.add(`${ds}.${f}${m.transform ? `|${m.transform.replace(/\{\{value\}\}/g, column)}` : `=${column}`}`);
    }
  }
  return out;
};
export const missing = (want: Set<string>, got: Set<string>): string[] => [...want].filter((x) => !got.has(x)).sort();
