/**
 * Schema drift: what a warehouse schema change did to a mapping. GASP never
 * connects to a warehouse, so a re-check is a job the company schedules: it
 * runs the readiness checks and the schema snapshot query this module writes,
 * then passes both back (to readiness_report, or to the Workspace). Here the
 * snapshot is compared with the mapping, and with the previous snapshot when
 * there is one:
 *
 *   - a mapped table that is gone, or a mapped field whose expression reads a
 *     column that is gone, breaks that pair; the metrics that were fully
 *     covered and no longer are, are named (Core first)
 *   - with the previous snapshot: columns added, dropped and retyped on the
 *     mapped tables, each retyped or dropped column marked with the pairs that
 *     read it
 *
 * The comparison is by name, case-insensitive; a table qualified in one place
 * and bare in the other matches on its bare name when that is unique.
 */
import { parseSchema, type SchemaColumn } from "./ossie/profile.js";
import { checkAdapter, resolveAdapter, columnOf, type Adapter, type Mapping } from "./tools.js";
import type { DialectName } from "./dialect.js";
import type { StandardData } from "./types.js";

export interface BrokenPair {
  dataset: string;
  field: string;
  table: string;
  /** The expression the mapping reads, after any transform */
  expression: string;
  /** "table": the table is gone; otherwise the columns the expression reads that are gone */
  missing: "table" | string[];
}

export interface ColumnChange {
  table: string;
  column: string;
  change: "added" | "dropped" | "retyped";
  from?: string;
  to?: string;
  /** field@dataset pairs whose expression reads the column */
  readBy: string[];
}

export interface SchemaDriftResult {
  /** Every mapped table and whether the snapshot has it */
  tables: Array<{ dataset: string; table: string; found: string | null }>;
  broken: BrokenPair[];
  /** Fully covered before the change and not after, Core first */
  metricsLost: Array<{ metric: string; department: string }>;
  coveredBefore: number;
  coveredAfter: number;
  /** Only with a previous snapshot */
  changes: ColumnChange[];
  hasPrevious: boolean;
  problems: string[];
}

// Words an expression can hold that are not column names. Function names are skipped by the "(" that follows them.
const SQL_WORDS = new Set(("case when then else end and or not null is in as cast true false between like ilike distinct " +
  "interval date time timestamp timestamptz day days week month months quarter year years hour minute second epoch extract from " +
  "numeric decimal double precision float real int integer bigint smallint varchar char text string boolean bool number " +
  "asc desc nulls first last at zone current_date current_timestamp over partition by order rows range unbounded preceding following current row " +
  "escape similar to any all some exists").split(/\s+/));

const lower = (s: string) => s.replace(/["`[\]]/g, "").trim().toLowerCase();
const bare = (t: string) => lower(t).split(".").pop() ?? lower(t);

/** The column names an expression reads: identifiers outside string literals that are not SQL words or function names. */
export function columnsRead(expression: string): string[] {
  const noStrings = expression.replace(/'(?:[^']|'')*'/g, " ");
  const out = new Set<string>();
  const re = /"([^"]+)"|`([^`]+)`|([A-Za-z_][A-Za-z0-9_$]*(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_$]*)*)(\s*\()?/g;
  for (const m of noStrings.matchAll(re)) {
    if (m[1] || m[2]) { out.add((m[1] ?? m[2]).toLowerCase()); continue; }
    if (m[4]) continue; // a function call
    const word = m[3].split(".").pop()!.trim().toLowerCase();
    if (SQL_WORDS.has(word)) continue;
    out.add(word);
  }
  return [...out];
}

/** The expression a mapping reads in the warehouse: the column, or the transform with the column in place of {{value}}. */
export function mappedExpression(m: Mapping): string {
  const column = columnOf(m.warehouseRef);
  return m.transform ? m.transform.replace(/\{\{\s*value\s*\}\}/g, column) : column;
}

interface Snapshot {
  /** lowercased full table name → column → type */
  tables: Map<string, Map<string, string>>;
  /** bare name → full names */
  byBare: Map<string, string[]>;
}

function snapshotOf(columns: SchemaColumn[]): Snapshot {
  const tables = new Map<string, Map<string, string>>();
  for (const c of columns) {
    const t = lower(c.table);
    if (!tables.has(t)) tables.set(t, new Map());
    tables.get(t)!.set(lower(c.column), c.type);
  }
  const byBare = new Map<string, string[]>();
  for (const t of tables.keys()) byBare.set(bare(t), [...(byBare.get(bare(t)) ?? []), t]);
  return { tables, byBare };
}

/** The snapshot's name for a mapped table: the same name, else the same bare name when only one table has it. */
function findTable(s: Snapshot, table: string): string | null {
  const t = lower(table);
  if (s.tables.has(t)) return t;
  const same = s.byBare.get(bare(t)) ?? [];
  return same.length === 1 ? same[0] : null;
}

/** The mapping restated pair by pair, each pair naming its dataset, so pairs can be dropped one at a time. */
function explicitAdapter(adapter: Adapter, data: StandardData, keep: (ds: string, field: string) => boolean = () => true): Adapter {
  const r = resolveAdapter(adapter, data);
  const mappings: Mapping[] = [];
  for (const [ds, fields] of Object.entries(r.columns)) for (const [field, m] of Object.entries(fields)) if (keep(ds, field)) mappings.push({ ...m, gaspField: field, dataset: ds });
  return { ...adapter, datasets: { ...r.tables }, mappings };
}

/** Compare a schema snapshot (and the previous one, when given) with a mapping. */
export function schemaDrift(adapter: Adapter, current: SchemaColumn[], data: StandardData, previous?: SchemaColumn[]): SchemaDriftResult {
  const problems: string[] = [];
  const r = resolveAdapter(adapter, data);
  const now = snapshotOf(current);
  const tables: SchemaDriftResult["tables"] = [];
  const broken: BrokenPair[] = [];
  const reads = new Map<string, string[]>(); // "table.column" (snapshot names) → pairs

  for (const [ds, fields] of Object.entries(r.columns)) {
    for (const [field, m] of Object.entries(fields)) {
      const table = r.tables[ds] ?? m.warehouseRef.split(".").slice(0, -1).join(".");
      if (!table) { problems.push(`\`${field}@${ds}\` names no table, so it was not compared`); continue; }
      if (!tables.some((t) => t.dataset === ds)) tables.push({ dataset: ds, table, found: findTable(now, table) });
      const found = findTable(now, table);
      const expression = mappedExpression(m);
      if (!found) { broken.push({ dataset: ds, field, table, expression, missing: "table" }); continue; }
      const cols = now.tables.get(found)!;
      const read = columnsRead(expression);
      for (const c of read) reads.set(`${found}.${c}`, [...(reads.get(`${found}.${c}`) ?? []), `${field}@${ds}`]);
      const missing = read.filter((c) => !cols.has(c));
      if (missing.length) broken.push({ dataset: ds, field, table, expression, missing });
    }
  }

  const gone = new Set(broken.map((b) => `${b.field}@${b.dataset}`));
  const before = checkAdapter(explicitAdapter(adapter, data), data);
  const after = checkAdapter(explicitAdapter(adapter, data, (ds, field) => !gone.has(`${field}@${ds}`)), data);
  const stillCovered = new Set(after.fully.map((f) => f.metric));
  const dept = new Map(data.dataRequirements.map((d) => [d.metric, d.department]));
  const metricsLost = before.fully.filter((f) => !stillCovered.has(f.metric))
    .map((f) => ({ metric: f.metric, department: dept.get(f.metric) ?? "" }))
    .sort((a, b) => Number(b.department === "Core") - Number(a.department === "Core") || a.metric.localeCompare(b.metric));

  const changes: ColumnChange[] = [];
  if (previous) {
    const then = snapshotOf(previous);
    for (const t of tables) {
      const was = findTable(then, t.table);
      const is = t.found;
      if (!was || !is) continue;
      const a = then.tables.get(was)!;
      const b = now.tables.get(is)!;
      const readBy = (c: string) => reads.get(`${is}.${c}`) ?? [];
      for (const [c, type] of b) {
        if (!a.has(c)) changes.push({ table: t.table, column: c, change: "added", to: type, readBy: [] });
        else if (lower(a.get(c)!) !== lower(type)) changes.push({ table: t.table, column: c, change: "retyped", from: a.get(c), to: type, readBy: readBy(c) });
      }
      for (const [c, type] of a) if (!b.has(c)) changes.push({ table: t.table, column: c, change: "dropped", from: type, readBy: broken.filter((x) => x.table === t.table && Array.isArray(x.missing) && x.missing.includes(c)).map((x) => `${x.field}@${x.dataset}`) });
    }
  }

  return { tables, broken, metricsLost, coveredBefore: before.fully.length, coveredAfter: after.fully.length, changes, hasPrevious: Boolean(previous), problems };
}

/** The schema text parsed into columns, or the reason it could not be. */
export function schemaColumns(text: string): SchemaColumn[] | { error: string } {
  const p = parseSchema(text);
  return "error" in p ? p : p.columns;
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * The query a scheduled job runs to snapshot the mapped tables' columns, one
 * row per column (table_schema, table_name, column_name, data_type,
 * is_nullable), the shape readiness_report and profile_schema read. BigQuery keeps
 * INFORMATION_SCHEMA per dataset, so it reads one view per dataset the tables
 * name; elsewhere the standard view, matched case-insensitively.
 */
export function schemaSnapshotSql(tables: string[], dialect: DialectName): string {
  const parts = [...new Set(tables.map((t) => t.replace(/["`]/g, "").trim()).filter(Boolean))].sort().map((t) => t.split("."));
  const cols = "table_schema, table_name, column_name, data_type, is_nullable";
  if (dialect === "bigquery") {
    const byDataset = new Map<string, string[]>();
    for (const p of parts) {
      const ds = p.length >= 2 ? p.slice(0, -1).join(".") : "<your_dataset>";
      byDataset.set(ds, [...(byDataset.get(ds) ?? []), p[p.length - 1]]);
    }
    return [...byDataset].map(([ds, names]) =>
      `SELECT ${cols} FROM \`${ds}\`.INFORMATION_SCHEMA.COLUMNS WHERE LOWER(table_name) IN (${names.map((n) => quote(n.toLowerCase())).join(", ")})`).join("\nUNION ALL\n") + "\nORDER BY table_schema, table_name, column_name;";
  }
  const match = parts.map((p) => {
    const name = `LOWER(table_name) = ${quote(p[p.length - 1].toLowerCase())}`;
    return p.length >= 2 ? `(LOWER(table_schema) = ${quote(p[p.length - 2].toLowerCase())} AND ${name})` : `(${name})`;
  });
  return `SELECT ${cols}\nFROM information_schema.columns\nWHERE ${match.join("\n   OR ") || "FALSE"}\nORDER BY table_schema, table_name, ordinal_position;`;
}

/** The mapped tables of an adapter, for the snapshot query. */
export function mappedTables(adapter: Adapter, data: StandardData): string[] {
  const r = resolveAdapter(adapter, data);
  const out = new Set<string>(Object.values(r.tables));
  for (const fields of Object.values(r.columns)) for (const m of Object.values(fields)) { const t = m.warehouseRef.split(".").slice(0, -1).join("."); if (t) out.add(t); }
  return [...out];
}

// ── the report ───────────────────────────────────────────────────────────────

export function formatSchemaDrift(d: SchemaDriftResult): string {
  const p: string[] = ["## Schema drift", ""];
  const missingTables = d.tables.filter((t) => !t.found);
  p.push(`${d.tables.length} mapped tables compared, ${missingTables.length} not in the snapshot. ${d.broken.length ? `${d.broken.length} mapped pair${d.broken.length === 1 ? "" : "s"} broken` : "Every mapped pair still reads columns that exist"}; ${d.coveredBefore} metrics fully covered before, ${d.coveredAfter} after.`);
  for (const x of d.problems) p.push(`- Problem: ${x}`);
  if (missingTables.length) p.push("", "Tables gone: " + missingTables.map((t) => `\`${t.table}\` (${t.dataset})`).join(", ") + ".");
  const cols = d.broken.filter((b) => b.missing !== "table");
  if (cols.length) {
    p.push("", "| Pair | Table | Reads | Gone |", "| --- | --- | --- | --- |");
    for (const b of cols) p.push(`| \`${b.field}@${b.dataset}\` | ${b.table} | \`${b.expression}\` | ${(b.missing as string[]).join(", ")} |`);
  }
  if (d.metricsLost.length) p.push("", `Metrics no longer fully covered: ${d.metricsLost.map((m) => m.department === "Core" ? `**${m.metric}** (Core)` : m.metric).join(", ")}. Remap the pairs (propose_mapping over the new schema, then record_decision) and recompile with compile_model.`);
  if (d.hasPrevious) {
    const touched = d.changes.filter((c) => c.change !== "added" && c.readBy.length);
    const other = d.changes.filter((c) => !(c.change !== "added" && c.readBy.length));
    if (!d.changes.length) p.push("", "No column was added, dropped or retyped on the mapped tables since the previous snapshot.");
    if (touched.length) {
      p.push("", "Changes to columns the mapping reads:", "", "| Column | Change | Read by |", "| --- | --- | --- |");
      for (const c of touched) p.push(`| ${c.table}.${c.column} | ${c.change}${c.change === "retyped" ? ` ${c.from} → ${c.to}` : ""} | ${c.readBy.map((x) => `\`${x}\``).join(", ")} |`);
    }
    if (other.length) p.push("", `Other changes on the mapped tables: ${other.map((c) => `${c.table}.${c.column} ${c.change}${c.change === "retyped" ? ` (${c.from} → ${c.to})` : ""}`).join(", ")}. A new column may map a field the mapping lacks: propose_mapping scores it.`);
  } else p.push("", "No previous snapshot given, so added and retyped columns are not listed. Keep each run's snapshot and pass the last one as previous_schema.");
  return p.join("\n");
}
