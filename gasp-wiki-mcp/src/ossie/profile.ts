/**
 * Schema profiler behind `profile_schema`: a company's warehouse schema as a
 * minimal Apache Ossie semantic model, level 1 of the readiness pipeline
 * (docs/ossie-interop-spec.md).
 *
 * The server has no warehouse credentials, so the agent calling the tool reads
 * the schema through the company's own warehouse MCP and pastes it. Accepted:
 *
 *   - the rows of information_schema.columns as JSON or CSV (table, column,
 *     type and, when present, schema and nullability), or an object of the
 *     shape { tables: [{ name, columns: [{ name, type }] }] }
 *   - DDL: CREATE TABLE statements, whose PRIMARY KEY and REFERENCES clauses
 *     are the strongest evidence there is
 *
 * and, optionally, statistics per column (rows, nulls, distinct, min, max,
 * values), which `statisticsSql` writes the query for. Without them the
 * profile rests on names and types and says what the statistics would settle.
 *
 * For every table the profiler infers the key, the time field and the kind
 * (snapshot, event or fact, the GASP dataset kinds, or reference for a table
 * with no date), each with its evidence and a confidence, and the relationships
 * the columns imply. Nothing is guessed
 * silently: a low-confidence inference is left out of the model and listed as
 * a question for the Decide step. The model passes the bundled Ossie schema;
 * the profile (kind, confidence, evidence) travels in the GASP extension of
 * each dataset (with the listed enum values) so nothing is lost when the
 * mapping proposer (propose.ts) reads it next.
 */
import { type DialectName } from "../dialect.js";
import type { StandardData } from "../types.js";
import { ossieSchemaErrors } from "./adapt.js";
import { ossieYaml } from "./index.js";
import { bareName } from "./names.js";
import { OSSIE_VERSION, portable, writeGaspExtension, type OssieDataset, type OssieDataType, type OssieField, type OssieRelationship, type OssieSemanticModel } from "./types.js";

// ── input ────────────────────────────────────────────────────────────────────

export interface SchemaColumn {
  /** The table as given, schema-qualified when the input says so */
  table: string;
  column: string;
  /** The warehouse type as given */
  type: string;
  nullable?: boolean;
  /** Declared in DDL */
  primaryKey?: boolean;
  references?: { table: string; column?: string };
}

export interface DeclaredKey { table: string; columns: string[] }

export interface ParsedSchema {
  format: "columns-json" | "tables-json" | "columns-csv" | "ddl";
  columns: SchemaColumn[];
  /** PRIMARY KEY constraints declared in DDL */
  keys: DeclaredKey[];
  problems: string[];
}

export interface ColumnStats {
  table: string;
  column: string;
  rows?: number;
  nulls?: number;
  distinct?: number;
  min?: string | number;
  max?: string | number;
  values?: Array<string | number>;
}

/** A table qualified by its schema, unless the schema is the warehouse's default one. */
const inSchema = (schema: unknown, table: string): string => (typeof schema === "string" && schema && !["public", "main", "dbo"].includes(schema.toLowerCase()) ? `${schema}.${table}` : table);
/** A nullable flag as information_schema or a tables list states it (YES, true, 1, or the opposite); nothing when it is not stated. */
const nullableOf = (v: unknown): { nullable?: boolean } => (v === undefined ? {} : { nullable: !(v === false || /^(no|false|n|0)$/i.test(String(v))) });

const pick = (row: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) {
    const hit = Object.keys(row).find((x) => x.toLowerCase() === k);
    if (hit !== undefined && row[hit] !== undefined && row[hit] !== null && row[hit] !== "") return row[hit];
  }
  return undefined;
};

const asNumber = (v: unknown): number | undefined => (v === undefined || v === null || v === "" ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined);

/** A CSV with a header row; quoted fields may hold commas and doubled quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().replace(/^"|"$/g, ""));
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const TABLE_KEYS = ["table_name", "table", "tablename"];
const SCHEMA_KEYS = ["table_schema", "schema", "schema_name"];
const COLUMN_KEYS = ["column_name", "column", "name", "field"];
const TYPE_KEYS = ["data_type", "type", "datatype", "column_type"];

function columnsFromRows(rows: Record<string, unknown>[], problems: string[]): SchemaColumn[] {
  const out: SchemaColumn[] = [];
  rows.forEach((r, i) => {
    const table = pick(r, ...TABLE_KEYS);
    const column = pick(r, ...COLUMN_KEYS);
    if (typeof table !== "string" || typeof column !== "string") { problems.push(`row ${i + 1} has no table and column`); return; }
    out.push({
      table: inSchema(pick(r, ...SCHEMA_KEYS), table),
      column,
      type: String(pick(r, ...TYPE_KEYS) ?? "unknown"),
      ...nullableOf(pick(r, "is_nullable", "nullable")),
    });
  });
  return out;
}

/** Split a parenthesised body on top-level commas. */
function splitTop(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of body) {
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === "," && depth === 0) { parts.push(cur); cur = ""; }
    else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const unquote = (s: string): string => s.trim().replace(/^[`"\[]|[`"\]]$/g, "").replace(/^[`"\[]|[`"\]]$/g, "");
const qualified = (name: string): string => name.split(".").map(unquote).join(".");
const COLUMN_LIST = (s: string): string[] => splitTop(s).map(unquote);

function columnsFromDdl(text: string, problems: string[]): { columns: SchemaColumn[]; keys: DeclaredKey[] } {
  const columns: SchemaColumn[] = [];
  const keys: DeclaredKey[] = [];
  const re = /create\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+|transient\s+|external\s+)?table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const table = qualified(m[1]);
    let depth = 1;
    let i = re.lastIndex;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
    }
    if (depth !== 0) { problems.push(`CREATE TABLE ${table}: unbalanced parentheses`); break; }
    const body = text.slice(re.lastIndex, i - 1);
    re.lastIndex = i;
    for (const part of splitTop(body)) {
      const pk = /^(?:constraint\s+\S+\s+)?primary\s+key\s*\(([^)]*)\)/i.exec(part);
      if (pk) { keys.push({ table, columns: COLUMN_LIST(pk[1]) }); continue; }
      const fk = /^(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]*)\)\s*references\s+([^\s(]+)\s*(?:\(([^)]*)\))?/i.exec(part);
      if (fk) {
        const cols = COLUMN_LIST(fk[1]);
        const refCols = fk[3] ? COLUMN_LIST(fk[3]) : [];
        const col = columns.find((c) => c.table === table && cols.length === 1 && c.column === cols[0]);
        if (col) col.references = { table: qualified(fk[2]), ...(refCols[0] ? { column: refCols[0] } : {}) };
        continue;
      }
      if (/^(constraint|unique|key|index|check|exclude|period|like|partition)\b/i.test(part)) continue;
      const col = /^("[^"]+"|`[^`]+`|\[[^\]]+\]|[^\s]+)\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*\([^)]*\))?(?:\s+(?:with|without)\s+time\s+zone)?(?:\s+unsigned)?(?:\[\])?)(.*)$/is.exec(part);
      if (!col) { problems.push(`CREATE TABLE ${table}: cannot read column definition "${part.slice(0, 40)}"`); continue; }
      const rest = col[3];
      const ref = /references\s+([^\s(]+)\s*(?:\(([^)]*)\))?/i.exec(rest);
      const c: SchemaColumn = {
        table,
        column: unquote(col[1]),
        type: col[2].replace(/\s+/g, " ").trim(),
        nullable: !/\bnot\s+null\b/i.test(rest) && !/\bprimary\s+key\b/i.test(rest),
        ...(/\bprimary\s+key\b/i.test(rest) ? { primaryKey: true } : {}),
        ...(ref ? { references: { table: qualified(ref[1]), ...(ref[2] ? { column: unquote(ref[2]) } : {}) } } : {}),
      };
      columns.push(c);
      if (c.primaryKey) keys.push({ table, columns: [c.column] });
    }
  }
  return { columns, keys };
}

/** The schema text as columns, in whichever of the accepted shapes it is written. */
export function parseSchema(text: string | undefined): ParsedSchema | { error: string } {
  if (!text?.trim()) return { error: "Pass schema: the rows of information_schema.columns (JSON or CSV with table, column and type), an object { tables: [{ name, columns: [{ name, type }] }] }, or CREATE TABLE statements." };
  const problems: string[] = [];
  const t = text.trim();
  if (/create\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+|transient\s+|external\s+)?table\b/i.test(t) && !t.startsWith("{") && !t.startsWith("[")) {
    const { columns, keys } = columnsFromDdl(t, problems);
    if (!columns.length) return { error: `No columns could be read from the CREATE TABLE statements${problems.length ? `: ${problems[0]}` : ""}.` };
    return { format: "ddl", columns, keys, problems };
  }
  if (t.startsWith("{") || t.startsWith("[")) {
    let doc: unknown;
    try { doc = JSON.parse(t); } catch (e) { return { error: `schema is not valid JSON: ${(e as Error).message}` }; }
    if (Array.isArray(doc)) {
      const columns = columnsFromRows(doc.filter((r) => r && typeof r === "object") as Record<string, unknown>[], problems);
      if (!columns.length) return { error: "The JSON array holds no rows with a table and a column (information_schema.columns rows have table_name, column_name and data_type)." };
      return { format: "columns-json", columns, keys: [], problems };
    }
    const tables = (doc as { tables?: unknown }).tables;
    if (Array.isArray(tables)) {
      const columns: SchemaColumn[] = [];
      for (const tbl of tables as Array<Record<string, unknown>>) {
        const name = pick(tbl, "name", "table", "table_name");
        const schema = pick(tbl, "schema", "table_schema");
        if (typeof name !== "string") { problems.push("a table entry has no name"); continue; }
        const table = inSchema(schema, name);
        const cols = tbl.columns;
        if (!Array.isArray(cols)) { problems.push(`table ${table} has no columns list`); continue; }
        for (const c of cols as Array<Record<string, unknown> | string>) {
          if (typeof c === "string") { columns.push({ table, column: c, type: "unknown" }); continue; }
          const column = pick(c, ...COLUMN_KEYS);
          if (typeof column !== "string") { problems.push(`table ${table} has a column without a name`); continue; }
          columns.push({ table, column, type: String(pick(c, ...TYPE_KEYS) ?? "unknown"), ...nullableOf(pick(c, "nullable", "is_nullable")) });
        }
      }
      if (!columns.length) return { error: "The tables list holds no columns." };
      return { format: "tables-json", columns, keys: [], problems };
    }
    return { error: "The JSON is neither an array of information_schema.columns rows nor an object with a tables list." };
  }
  const rows = parseCsv(t);
  if (rows.length) {
    const columns = columnsFromRows(rows, problems);
    if (columns.length) return { format: "columns-csv", columns, keys: [], problems };
  }
  return { error: "schema is not in a shape the profiler reads: information_schema.columns rows as JSON or CSV (table, column, type), an object with a tables list, or CREATE TABLE statements." };
}

/** Statistics per column, as JSON rows or CSV (table, column, rows, nulls, distinct, min, max, values). */
export function parseStatistics(text: string | undefined): { stats: ColumnStats[]; problems: string[] } | { error: string } {
  if (!text?.trim()) return { stats: [], problems: [] };
  const t = text.trim();
  let rows: Record<string, unknown>[];
  if (t.startsWith("[") || t.startsWith("{")) {
    let doc: unknown;
    try { doc = JSON.parse(t); } catch (e) { return { error: `statistics is not valid JSON: ${(e as Error).message}` }; }
    const arr = Array.isArray(doc) ? doc : (doc as { statistics?: unknown; columns?: unknown }).statistics ?? (doc as { columns?: unknown }).columns;
    if (!Array.isArray(arr)) return { error: "statistics must be a JSON array of rows (table, column, rows, nulls, distinct, min, max, values) or CSV with those headers." };
    rows = arr.filter((r) => r && typeof r === "object") as Record<string, unknown>[];
  } else rows = parseCsv(t);
  const problems: string[] = [];
  const stats: ColumnStats[] = [];
  rows.forEach((r, i) => {
    const table = pick(r, ...TABLE_KEYS);
    const column = pick(r, ...COLUMN_KEYS);
    if (typeof table !== "string" || typeof column !== "string") { problems.push(`statistics row ${i + 1} has no table and column`); return; }
    const schema = pick(r, ...SCHEMA_KEYS);
    let values = pick(r, "values", "distinct_values", "top_values");
    if (typeof values === "string") {
      const raw = values;
      try { values = JSON.parse(raw); } catch { values = raw.split(/[|;]/).map((v) => v.trim()).filter(Boolean); }
    }
    const nulls = asNumber(pick(r, "nulls", "null_count"));
    const rowsN = asNumber(pick(r, "rows", "row_count", "count"));
    const nullRate = asNumber(pick(r, "null_rate", "null_fraction"));
    const distinct = asNumber(pick(r, "distinct", "distinct_count", "n_distinct", "cardinality"));
    stats.push({
      table: inSchema(schema, table),
      column,
      ...(rowsN !== undefined ? { rows: rowsN } : {}),
      ...(nulls !== undefined ? { nulls } : nullRate !== undefined && rowsN !== undefined ? { nulls: Math.round(nullRate * rowsN) } : {}),
      ...(distinct !== undefined ? { distinct } : {}),
      ...(pick(r, "min", "min_value") !== undefined ? { min: pick(r, "min", "min_value") as string | number } : {}),
      ...(pick(r, "max", "max_value") !== undefined ? { max: pick(r, "max", "max_value") as string | number } : {}),
      ...(Array.isArray(values) ? { values: values as Array<string | number> } : {}),
    });
  });
  return { stats, problems };
}

/**
 * The query that gathers the statistics the profiler reads, one row per
 * column. Identifiers are written unquoted, as the schema named them, so a
 * name that needs quoting in the warehouse must be quoted by hand; the string
 * type of the min and max columns follows the dialect (STRING on BigQuery and
 * Databricks, VARCHAR elsewhere).
 */
export function statisticsSql(columns: SchemaColumn[], dialect?: DialectName): string {
  const text = dialect === "bigquery" || dialect === "databricks" ? "STRING" : "VARCHAR";
  const byTable = new Map<string, SchemaColumn[]>();
  for (const c of columns) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c]);
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const selects: string[] = [];
  for (const [table, cols] of byTable) {
    for (const c of cols) {
      const col = c.column;
      // MIN and MAX are not defined on booleans in every warehouse, and mean nothing on opaque types.
      const ordered = !["Boolean", "Opaque"].includes(ossieTypeOf(c.type));
      const bound = (fn: string) => (ordered ? `CAST(${fn}(${col}) AS ${text})` : `CAST(NULL AS ${text})`);
      selects.push(`SELECT ${q(table)} AS table_name, ${q(c.column)} AS column_name, COUNT(*) AS row_count, COUNT(*) - COUNT(${col}) AS null_count, COUNT(DISTINCT ${col}) AS distinct_count, ${bound("MIN")} AS min_value, ${bound("MAX")} AS max_value FROM ${table}`);
    }
  }
  return selects.join("\nUNION ALL\n") + ";";
}

/** The query that lists a low-cardinality column's values, for the `values` statistic. */
export const valuesSql = (table: string, column: string): string => `SELECT ${column} AS value, COUNT(*) AS row_count FROM ${table} GROUP BY ${column} ORDER BY row_count DESC;`;

// ── inference ────────────────────────────────────────────────────────────────

export type Confidence = "declared" | "high" | "medium" | "low";
export type DatasetKind = "snapshot" | "event" | "fact" | "reference";

export interface Inference<T> { value: T; confidence: Confidence; evidence: string }

export interface Question {
  dataset: string;
  about: "key" | "time" | "type";
  question: string;
  options?: string[];
  why: string;
}

export interface DatasetProfile {
  name: string;
  source: string;
  columns: number;
  kind: Inference<DatasetKind>;
  key?: Inference<string[]>;
  time?: Inference<string>;
  enums: Array<{ column: string; values: Array<string | number> }>;
  /** Text columns the statistics show with a short repeated list of values, whose values were not listed */
  enumCandidates: string[];
  questions: Question[];
  /** Columns with statistics */
  profiled: number;
}

export interface ProfileResult {
  organization: string;
  format: ParsedSchema["format"];
  model: OssieSemanticModel;
  datasets: DatasetProfile[];
  relationships: Array<{ name: string; from: string; to: string; column: string; confidence: Confidence; evidence: string }>;
  questions: Question[];
  statistics: { given: number; columns: number };
  problems: string[];
}

export function ossieTypeOf(type: string): OssieDataType {
  const raw = type.toLowerCase().trim();
  if (/^(number|numeric|decimal)\s*\(\s*\d+\s*(,\s*0\s*)?\)$/.test(raw)) return "Integer"; // a scale of 0 (Snowflake NUMBER(38,0), the default) is an integer
  const t = raw.replace(/\(.*\)/, "").trim();
  if (/^(timestamptz|timestamp_tz|timestamp_ltz|timestamp with time zone|datetimeoffset)$/.test(t) || /with time zone/.test(t)) return "DateTimeTz";
  if (/^(timestamp|timestamp_ntz|datetime|datetime2|timestamp without time zone|smalldatetime)$/.test(t)) return "DateTime";
  if (/^date$/.test(t)) return "Date";
  if (/^time$/.test(t) || /^time without time zone$/.test(t)) return "Time";
  if (/^(bool|boolean|bit)$/.test(t)) return "Boolean";
  if (/^(int|integer|int2|int4|int8|bigint|smallint|tinyint|int64|serial|bigserial)$/.test(t) || /^(unsigned )?(big|small|tiny)?int/.test(t)) return "Integer";
  if (/^(numeric|decimal|number|money|bignumeric)$/.test(t) || /^(numeric|decimal|number)\b/.test(t)) return "Decimal";
  if (/^(float|float4|float8|double|double precision|real|float64|binary_float|binary_double)$/.test(t)) return "Float";
  if (/^(varchar|char|character|character varying|text|string|nvarchar|nchar|clob|uuid|enum|citext|bpchar|varchar2)$/.test(t) || /^(var)?char/.test(t) || /text$/.test(t)) return "String";
  return "Opaque";
}

const isDateType = (t: OssieDataType): boolean => t === "Date" || t === "DateTime" || t === "DateTimeTz";
const isDateName = (c: string): boolean => /(_date|_at|_on|_ts|_time|_day|^date$|^as_of|^as_at|^snapshot|^period_start$|^period_end$)$/i.test(c) || /^(as_of|as_at|asof|asat|snap)/i.test(c);

/** Whether two words are the same up to an English plural (customer/customers, entry/entries, status/statuses). */
export const sameWord = (a: string, b: string): boolean => {
  if (a === b) return true;
  const [x, y] = a.length <= b.length ? [a, b] : [b, a];
  return y === `${x}s` || y === `${x}es` || (x.endsWith("y") && y === `${x.slice(0, -1)}ies`);
};
/** The table's words without a schema-like prefix (gasp_, raw_, stg_, dim_, fct_). */
export function tableWords(table: string): string[] {
  const words = bareName(table).split(/[^a-z0-9]+/).filter(Boolean);
  return words.length > 1 && /^(gasp|raw|stg|src|dim|fct|fact|tbl|tb|t|v|vw)$/.test(words[0]) ? words.slice(1) : words;
}
/** Whether a column stem names the table: its whole name or its last word, singular or plural. */
const namesTable = (stem: string, words: string[]): boolean => words.some((w) => sameWord(stem, w)) || sameWord(stem, words.join("_")) || (words.length > 1 && sameWord(stem.split("_").pop()!, words[words.length - 1]) && words.join("_").startsWith(stem.split("_").slice(0, -1).join("_")));
const SNAPSHOT_NAME = /^(snapshot|snap|as_of|as_at|asof|asat|valid_from|effective)/i;
const EVENT_STEM_RANK = ["occurred", "event", "happened", "booked", "incurred", "started", "opened", "created", "logged", "recorded", "submitted", "received", "sent", "detected", "acknowledged", "resolved", "closed", "completed", "ended", "updated", "modified", "deleted"];

interface TableInfo { table: string; columns: SchemaColumn[]; stats: Map<string, ColumnStats>; rows?: number }

function statFor(t: TableInfo, column: string): ColumnStats | undefined { return t.stats.get(column); }
const uniqueIn = (s: ColumnStats | undefined, rows: number | undefined): boolean | undefined =>
  s?.distinct === undefined || rows === undefined ? undefined : s.distinct === rows && (s.nulls ?? 0) === 0;

function inferTime(t: TableInfo): Inference<string> | { question: Question } | undefined {
  const words = tableWords(t.table);
  const cands = t.columns.filter((c) => isDateType(ossieTypeOf(c.type)) || ((ossieTypeOf(c.type) === "Opaque" || ossieTypeOf(c.type) === "String") && isDateName(c.column)));
  if (!cands.length) return undefined;
  const name = (c: SchemaColumn) => c.column.toLowerCase();
  const score = (c: SchemaColumn): [number, string] => {
    const n = name(c);
    if (SNAPSHOT_NAME.test(n)) return [100, "named as a snapshot date"];
    if (n === "period_start") return [90, "the period start of a per-period row"];
    if (n === "event_date" || n === "event_at" || n === "event_time" || n === "event_ts") return [80, "named as the event date"];
    const stem = n.replace(/_(date|at|on|ts|time|day)$/, "");
    const rank = EVENT_STEM_RANK.indexOf(stem);
    if (rank >= 0) return [70 - rank, `${stem} comes before the other lifecycle dates`];
    if (/^(updated|modified|deleted|last_)/.test(n)) return [5, "a maintenance timestamp"];
    if (/_(end|until|through|to|due|deadline|expiry|expires|expiration)$/.test(stem) || /^(end|until|due)(_|$)/.test(stem)) return [20, "an end or due date"];
    if (words.some((w) => sameWord(stem, w) || w.startsWith(stem) || stem.startsWith(`${w}_`) || stem.endsWith(`_${w}`))) return [60, "carries the table's own name"];
    return [40, "a date column"];
  };
  const scored = cands.map((c) => ({ c, s: score(c) }));
  // Statistics: the time field is never null; a null rate breaks a tie downward.
  for (const x of scored) {
    const s = statFor(t, x.c.column);
    if (s?.nulls !== undefined && s.rows) {
      if (s.nulls === 0) x.s = [x.s[0] + 3, `${x.s[1]}, never null`];
      else x.s = [x.s[0] - 10, `${x.s[1]}, null in ${s.nulls} of ${s.rows} rows`];
    }
  }
  scored.sort((a, b) => b.s[0] - a.s[0] || a.c.column.localeCompare(b.c.column));
  const top = scored[0];
  if (cands.length === 1) return { value: top.c.column, confidence: "high", evidence: "the only date column" };
  const runnersUp = scored.slice(1).filter((x) => x.s[0] >= top.s[0] - 5);
  // A start date beside its end date is a span: which end places the row is the business's call (a trial counts when it ends).
  // period_start beside period_end is not: the pair bounds the period the row describes, and the row is dated its start.
  const topStem = name(top.c).replace(/_(date|at|on|ts|time|day)$/, "");
  const periodPair = name(top.c) === "period_start" && cands.some((c) => name(c) === "period_end");
  const endOf = !periodPair && (/_(start|begin|from|open|opened)$/.test(topStem) || /^(start|begin)(_|$)/.test(topStem))
    ? cands.find((c) => c !== top.c && name(c).replace(/_(date|at|on|ts|time|day)$/, "") === topStem.replace(/_(start|begin|from|open|opened)$/, "_end").replace(/^(start|begin)(_|$)/, "end$2"))
    : undefined;
  if (endOf && !runnersUp.some((x) => x.c === endOf)) runnersUp.unshift(scored.find((x) => x.c === endOf)!);
  if (periodPair) return { value: top.c.column, confidence: "high", evidence: `${top.s[1]}; period_end is the end of the same period${scored.length > 2 ? `, ${scored.slice(1).filter((x) => name(x.c) !== "period_end").map((x) => x.c.column).join(", ")} ${scored.length === 3 ? "is a secondary date" : "are secondary dates"}` : ""}` };
  if (!runnersUp.length) return { value: top.c.column, confidence: top.s[0] >= 60 ? "high" : "medium", evidence: `${top.s[1]}; ${scored.slice(1).map((x) => x.c.column).join(", ")} ${scored.length === 2 ? "is a later or secondary date" : "are later or secondary dates"}` };
  return {
    question: {
      dataset: bareName(t.table),
      about: "time",
      question: `Which column places a row of ${t.table} in time?`,
      options: [top.c.column, ...runnersUp.map((x) => x.c.column)],
      why: `${[top, ...runnersUp].map((x) => `${x.c.column} (${x.s[1]})`).join(", ")} rank alike by name; the column with no nulls and the widest range is usually it`,
    },
  };
}

function inferKind(t: TableInfo, time: string | undefined, key: string[] | undefined): Inference<DatasetKind> {
  const names = t.columns.map((c) => c.column.toLowerCase());
  const b = bareName(t.table);
  const dated = t.columns.some((c) => isDateType(ossieTypeOf(c.type)));
  if (!time && dated) {
    if (names.some((n) => SNAPSHOT_NAME.test(n))) return { value: "snapshot", confidence: "medium", evidence: "has a snapshot-named date column; which column is the time field is a question" };
    return { value: "event", confidence: "low", evidence: "has date columns but which one places a row in time is a question; a snapshot would name its date as one" };
  }
  if (names.includes("period_start") && (time === "period_start" || names.includes("period_end"))) return { value: "fact", confidence: "high", evidence: "has period_start: one row per entity per period" };
  if (time && SNAPSHOT_NAME.test(time)) return { value: "snapshot", confidence: "high", evidence: `${time} is a snapshot date: one row per entity per day it was observed` };
  if (time && key?.length === 1) {
    const ks = statFor(t, key[0]);
    const ts = statFor(t, time);
    if (ks?.distinct !== undefined && t.rows !== undefined && ks.distinct < t.rows && ts?.distinct !== undefined && ts.distinct > 1) {
      return { value: "snapshot", confidence: "medium", evidence: `${key[0]} repeats (${ks.distinct} distinct in ${t.rows} rows) across ${ts.distinct} values of ${time}: a snapshot of each entity per ${time}` };
    }
  }
  if (/(event|log|history|activity|activities|transaction|entries|entry|_fact)s?$/.test(b) && time) return { value: "event", confidence: "high", evidence: `named ${b} with a time column ${time}: one row per occurrence` };
  if (time) {
    const ks = key?.length === 1 ? statFor(t, key[0]) : undefined;
    const unique = uniqueIn(ks, t.rows);
    if (unique === true) return { value: "event", confidence: "high", evidence: `${key![0]} is unique and ${time} places each row in time: one row per occurrence` };
    return { value: "event", confidence: "medium", evidence: `${time} places each row in time and nothing says rows repeat per entity; a snapshot would name its date as one` };
  }
  return { value: "reference", confidence: "medium", evidence: "no date or timestamp column: a reference table, read as of now" };
}

function inferKey(t: TableInfo, declared: DeclaredKey | undefined, time: string | undefined, tables: Map<string, TableInfo>): Inference<string[]> | { question: Question } | undefined {
  if (declared) return { value: declared.columns, confidence: "declared", evidence: "declared PRIMARY KEY" };
  const words = tableWords(t.table);
  const lower = (c: SchemaColumn) => c.column.toLowerCase();
  const idLike = t.columns.filter((c) => /(_id|_key|_pk|_ref|_uid|_uuid|_no|_number|_code)$|^id$/i.test(c.column));
  const otherTables = [...tables.keys()].filter((x) => x !== t.table).map((x) => tableWords(x));
  const stemOf = (c: SchemaColumn) => lower(c).replace(/(_id|_key|_pk|_ref|_uid|_uuid|_no|_number|_code)$/, "");
  const looksForeign = (c: SchemaColumn): string | undefined => {
    const stem = stemOf(c);
    if (namesTable(stem, words)) return undefined;
    const hit = otherTables.find((w) => namesTable(stem, w));
    return hit ? hit.join("_") : undefined;
  };
  const named = idLike.find((c) => lower(c) === "id")
    ?? idLike.find((c) => /_id$/.test(lower(c)) && sameWord(stemOf(c), words.join("_")))
    ?? idLike.find((c) => /_id$/.test(lower(c)) && namesTable(stemOf(c), words))
    ?? idLike.find((c) => namesTable(stemOf(c), words));
  const own = idLike.filter((c) => !looksForeign(c));
  const withTime = (cols: string[]): string[] => (time && !cols.includes(time) ? [...cols, time] : cols);
  const check = (cols: string[], base: string, conf: Confidence): Inference<string[]> => {
    // Statistics decide between the column alone and the column with the time field.
    const s = statFor(t, cols[0]);
    if (s?.distinct !== undefined && t.rows !== undefined) {
      if (uniqueIn(s, t.rows)) return { value: cols, confidence: "high", evidence: `${base}; unique: ${s.distinct} distinct in ${t.rows} rows, no nulls` };
      const ts = time ? statFor(t, time) : undefined;
      if (time && ts?.distinct !== undefined && s.distinct * ts.distinct >= t.rows && (s.nulls ?? 0) === 0) {
        return { value: withTime(cols), confidence: "high", evidence: `${base}; ${s.distinct} distinct in ${t.rows} rows across ${ts.distinct} values of ${time}, so the key is the pair` };
      }
      return { value: cols, confidence: "low", evidence: `${base}, but ${s.distinct} distinct in ${t.rows} rows${(s.nulls ?? 0) ? ` and ${s.nulls} nulls` : ""}${time ? `, more than ${time} explains` : ""}` };
    }
    return { value: cols, confidence: conf, evidence: `${base}${perPeriod(time) ? `; with ${time}, since a ${time === "period_start" ? "per-period row repeats each entity per period" : "snapshot repeats each entity per date"}` : ""}` };
  };
  const perPeriod = (t: string | undefined): boolean => !!t && (SNAPSHOT_NAME.test(t) || t === "period_start");
  const snapshotPair = (cols: string[]): string[] => (perPeriod(time) ? withTime(cols) : cols);
  if (named) {
    const r = check([named.column], `named ${named.column === "id" ? "id" : `after the table (${named.column})`}`, "medium");
    return r.confidence === "medium" && !statFor(t, named.column) ? { ...r, value: snapshotPair(r.value) } : r;
  }
  if (own.length === 1) {
    const r = check([own[0].column], `the one id column that is not a reference to another table (${own[0].column})`, "medium");
    return r.confidence === "medium" && !statFor(t, own[0].column) ? { ...r, value: snapshotPair(r.value) } : r;
  }
  // Statistics can still find a unique column among the candidates, or a pair with the time field.
  const cands = own.length ? own : idLike;
  if (t.rows !== undefined) {
    const covering = cands.map((c) => check([c.column], `${c.column} is the one candidate the statistics make unique`, "low")).filter((r) => r.confidence === "high");
    const alone = covering.filter((r) => r.value.length === 1);
    if (alone.length === 1) return alone[0];
    if (covering.length === 1) return covering[0];
    if (covering.length > 1) {
      return { question: { dataset: bareName(t.table), about: "key", question: `Which identifies a row of ${t.table}: ${covering.map((r) => r.value.join(", ")).join(" or ")}?`, options: covering.map((r) => r.value.join(", ")), why: `each covers the ${t.rows} rows alike (${covering.map((r) => `${r.value[0]}: ${statFor(t, r.value[0])!.distinct} distinct`).join(", ")}), so the statistics cannot tell them apart` } };
    }
    const ts = time ? statFor(t, time) : undefined;
    if (time && ts?.distinct !== undefined && ts.distinct === t.rows) return { value: [time], confidence: "high", evidence: `${time} is unique: one row per period` };
    if (time && ts?.distinct !== undefined && !cands.length) {
      for (const d of t.columns.filter((c) => ossieTypeOf(c.type) === "String" && !isDateName(c.column))) {
        const ds = statFor(t, d.column);
        if (ds?.distinct !== undefined && (ds.nulls ?? 0) === 0 && ds.distinct * ts.distinct >= t.rows && ds.distinct < t.rows) {
          return { value: [d.column, time], confidence: "high", evidence: `${d.column} with ${time}: ${ds.distinct} values across ${ts.distinct} periods cover the ${t.rows} rows` };
        }
      }
    }
  }
  const period = time && (time === "period_start" || SNAPSHOT_NAME.test(time));
  if (!cands.length && period && t.rows === undefined) {
    const dims = t.columns.filter((c) => ossieTypeOf(c.type) === "String" && !isDateName(c.column));
    if (!dims.length) return { value: [time!], confidence: "medium", evidence: `no id column and one row per ${time} as far as the names say` };
    return { question: { dataset: bareName(t.table), about: "key", question: `What identifies a row of ${t.table} within one ${time}: ${time} alone, or ${time} with one of ${dims.map((d) => d.column).join(", ")}?`, options: [time!, ...dims.map((d) => `${time}, ${d.column}`)], why: "no id column; the statistics (distinct counts) would settle it" } };
  }
  if (!cands.length) return { question: { dataset: bareName(t.table), about: "key", question: `What identifies a row of ${t.table}?`, options: t.columns.map((c) => c.column), why: "no column is named like a key and no PRIMARY KEY is declared" } };
  return {
    question: {
      dataset: bareName(t.table),
      about: "key",
      question: `Which column identifies a row of ${t.table}?`,
      options: cands.map((c) => c.column),
      why: `${cands.map((c) => `${c.column}${looksForeign(c) ? ` (looks like a reference to ${looksForeign(c)})` : ""}`).join(", ")} are all key-like and none is named after the table; distinct counts would settle it`,
    },
  };
}

/** Profile parsed columns and statistics into a model and its evidence. */
export function profileSchema(schema: ParsedSchema, stats: ColumnStats[], data: StandardData, opts: { organization?: string } = {}): ProfileResult {
  const organization = opts.organization?.trim() || "Company";
  const problems = [...schema.problems];
  const tables = new Map<string, TableInfo>();
  for (const c of schema.columns) {
    if (!tables.has(c.table)) tables.set(c.table, { table: c.table, columns: [], stats: new Map() });
    const t = tables.get(c.table)!;
    if (t.columns.some((x) => x.column === c.column)) continue;
    t.columns.push(c);
  }
  const unknownStats: string[] = [];
  for (const s of stats) {
    const t = tables.get(s.table) ?? [...tables.values()].find((x) => bareName(x.table) === bareName(s.table));
    if (!t) { unknownStats.push(`${s.table}.${s.column}`); continue; }
    if (!t.columns.some((c) => c.column === s.column)) { unknownStats.push(`${s.table}.${s.column}`); continue; }
    t.stats.set(s.column, s);
    if (s.rows !== undefined) t.rows = Math.max(t.rows ?? 0, s.rows);
  }
  if (unknownStats.length) problems.push(`statistics name columns the schema lacks: ${unknownStats.slice(0, 5).join(", ")}${unknownStats.length > 5 ? ` and ${unknownStats.length - 5} more` : ""}`);

  // Dataset names: the bare table name, qualified by its schema only when two tables share one.
  const nameCount = new Map<string, number>();
  for (const t of tables.keys()) nameCount.set(bareName(t), (nameCount.get(bareName(t)) ?? 0) + 1);
  const dsName = (table: string) => ((nameCount.get(bareName(table)) ?? 0) > 1 ? table.toLowerCase().replace(/[^a-z0-9]+/g, "_") : bareName(table).replace(/[^a-z0-9]+/g, "_"));

  const datasets: DatasetProfile[] = [];
  const modelDatasets: OssieDataset[] = [];
  const keyOf = new Map<string, string[]>();
  for (const t of tables.values()) {
    const questions: Question[] = [];
    const declared = schema.keys.find((k) => k.table === t.table);
    const timeR = inferTime(t);
    const time = timeR && "question" in timeR ? undefined : timeR;
    if (timeR && "question" in timeR) questions.push(timeR.question);
    const keyR = inferKey(t, declared, time?.value, tables);
    let key = keyR && "question" in keyR ? undefined : keyR;
    if (keyR && "question" in keyR) questions.push(keyR.question);
    if (key?.confidence === "low") {
      questions.push({ dataset: dsName(t.table), about: "key", question: `Is ${key.value.join(", ")} the key of ${t.table}, or is there a composite key?`, options: [key.value.join(", "), ...(time && !key.value.includes(time.value) ? [`${key.value.join(", ")}, ${time.value}`] : [])], why: key.evidence });
      key = undefined;
    }
    for (const q of questions) q.dataset = dsName(t.table);
    const kind = inferKind(t, time?.value, key?.value);
    const enums: DatasetProfile["enums"] = [];
    const enumCandidates: string[] = [];
    const idLikeName = (c: string) => /(_id|_key|_pk|_ref|_uid|_uuid|_no|_number|_code|_name|_email|_url)$|^id$/i.test(c);
    const fields: OssieField[] = t.columns.map((c) => {
      const s = statFor(t, c.column);
      const datatype = ossieTypeOf(c.type);
      // An enum is a short list of values that repeat: not a key, not an identifier, at most 20 distinct and well under one per row.
      const enumLike = datatype === "String" && !idLikeName(c.column) && !key?.value.includes(c.column) && s?.distinct !== undefined && t.rows !== undefined
        && s.distinct <= 20 && s.distinct <= Math.max(2, t.rows / 2);
      const values = enumLike && s!.values?.length && s!.values.length <= 20 ? s!.values : undefined;
      if (values) enums.push({ column: c.column, values });
      else if (enumLike) enumCandidates.push(c.column);
      return {
        name: c.column,
        expression: portable(c.column),
        ...(time?.value === c.column ? { dimension: { is_time: true } } : {}),
        datatype,
        ...(values ? { ai_context: { instructions: `One of ${values.join(", ")}` } } : {}),
      };
    });
    const opaque = t.columns.filter((c) => ossieTypeOf(c.type) === "Opaque");
    if (opaque.length) questions.push({ dataset: dsName(t.table), about: "type", question: `What do the columns ${opaque.map((c) => `${c.column} (${c.type})`).join(", ")} of ${t.table} hold?`, why: "their warehouse types map to no Ossie datatype; they are declared Opaque" });
    const profile: DatasetProfile = { name: dsName(t.table), source: t.table, columns: t.columns.length, kind, ...(key ? { key } : {}), ...(time ? { time } : {}), enums, enumCandidates, questions, profiled: t.stats.size };
    datasets.push(profile);
    if (key) keyOf.set(t.table, key.value);
    modelDatasets.push({
      name: profile.name,
      source: t.table,
      ...(key ? { primary_key: key.value } : {}),
      description: `${t.table}: ${kind.value === "reference" ? "a reference table" : `a ${kind.value} table`}${time ? ` placed in time by ${time.value}` : ""}; profiled from the schema${t.stats.size ? " and statistics" : ""}.`,
      fields,
      nonportable_extensions: writeGaspExtension(undefined, { profile: { kind: kind.value, confidence: { kind: kind.confidence, ...(key ? { key: key.confidence } : {}), ...(time ? { time: time.confidence } : {}) }, evidence: { kind: kind.evidence, ...(key ? { key: key.evidence } : {}), ...(time ? { time: time.evidence } : {}) }, questions, ...(enums.length ? { values: Object.fromEntries(enums.map((e) => [e.column, e.values])) } : {}) } }),
    });
  }

  // Relationships: declared REFERENCES, else a column named <other table>_id where that table's key is one column.
  const relationships: ProfileResult["relationships"] = [];
  const modelRelationships: OssieRelationship[] = [];
  const targetFor = (stem: string, self: TableInfo): TableInfo | undefined =>
    [...tables.values()].find((x) => x !== self && sameWord(stem, tableWords(x.table).join("_")))
    ?? [...tables.values()].find((x) => x !== self && namesTable(stem, tableWords(x.table)));
  for (const t of tables.values()) {
    for (const c of t.columns) {
      let target: TableInfo | undefined;
      let toColumn: string | undefined;
      let confidence: Confidence = "medium";
      let evidence = "";
      if (c.references) {
        target = tables.get(c.references.table) ?? [...tables.values()].find((x) => bareName(x.table) === bareName(c.references!.table));
        if (!target) { problems.push(`${t.table}.${c.column} references ${c.references.table}, which the schema does not hold`); continue; }
        toColumn = c.references.column ?? keyOf.get(target.table)?.[0];
        confidence = "declared";
        evidence = "declared REFERENCES";
      } else if (/_(id|key|ref)$/i.test(c.column)) {
        const stem = c.column.toLowerCase().replace(/_(id|key|ref)$/, "");
        if (namesTable(stem, tableWords(t.table))) continue;
        target = targetFor(stem, t);
        if (!target) continue;
        const k = keyOf.get(target.table);
        const targetTime = datasets.find((d) => d.source === target!.table)?.time?.value;
        const tk = k?.filter((x) => x !== targetTime);
        if (!tk || tk.length !== 1) continue;
        toColumn = tk[0];
        evidence = `${c.column} names ${target.table}, whose key is ${toColumn}`;
      }
      if (!target || !toColumn) continue;
      const name = `${dsName(t.table)}_${c.column.toLowerCase().replace(/_(id|key|ref)$/, "")}_${dsName(target.table)}`.replace(/[^a-z0-9_]/g, "_");
      if (modelRelationships.some((r) => r.name === name)) continue;
      relationships.push({ name, from: dsName(t.table), to: dsName(target.table), column: c.column, confidence, evidence });
      modelRelationships.push({ name, from: dsName(t.table), to: dsName(target.table), from_columns: [c.column], to_columns: [toColumn], ai_context: { instructions: `${confidence === "declared" ? "Declared" : "Inferred"}: ${evidence}` } });
    }
  }

  const questions = datasets.flatMap((d) => d.questions);
  const model: OssieSemanticModel = {
    version: OSSIE_VERSION,
    name: `${organization} semantic model`,
    description: `${organization}'s warehouse profiled from its schema${stats.length ? " and column statistics" : ""} by the GASP profiler: ${datasets.length} datasets, ${modelRelationships.length} relationships, ${questions.length} open questions.`,
    datasets: modelDatasets,
    ...(modelRelationships.length ? { relationships: modelRelationships } : {}),
    nonportable_extensions: writeGaspExtension(undefined, { profiled: { input: schema.format, statistics: stats.length > 0, questions: questions.length } }),
  };
  const errors = ossieSchemaErrors(model, "model", data);
  if (errors?.length) problems.push(...errors.map((e) => `model: ${e}`));
  return { organization, format: schema.format, model, datasets, relationships, questions, statistics: { given: stats.length, columns: schema.columns.length }, problems };
}

// ── report ───────────────────────────────────────────────────────────────────

const conf = (c: Confidence): string => (c === "declared" ? "declared" : `${c} confidence`);

export function formatProfileReport(r: ProfileResult): string {
  const lines: string[] = [`# Schema profile: ${r.organization}`, ""];
  const fmt = { "columns-json": "information_schema rows (JSON)", "tables-json": "a tables list (JSON)", "columns-csv": "information_schema rows (CSV)", ddl: "CREATE TABLE statements" }[r.format];
  lines.push(`**Input:** ${r.datasets.length} tables, ${r.statistics.columns} columns from ${fmt}; statistics for ${r.statistics.given ? `${r.statistics.given} columns` : "no columns"}.`);
  const kinds = ["snapshot", "event", "fact", "reference"].map((k) => [k, r.datasets.filter((d) => d.kind.value === k).length] as const).filter(([, n]) => n);
  const keyed = r.datasets.filter((d) => d.key);
  const timed = r.datasets.filter((d) => d.time);
  lines.push(`**Model:** ${r.datasets.length} datasets (${kinds.map(([k, n]) => `${n} ${k}`).join(", ")}), ${keyed.length} with a key, ${timed.length} with a time field, ${r.relationships.length} relationships; ${r.questions.length} question${r.questions.length === 1 ? "" : "s"} to answer.`);
  if (r.problems.length) lines.push("", "**Problems:**", ...r.problems.map((p) => `- ${p}`));
  lines.push("", "## Datasets");
  for (const d of r.datasets) {
    lines.push("", `### ${d.name}${d.name !== d.source ? ` (${d.source})` : ""}: ${d.kind.value}, ${d.columns} columns`);
    lines.push(`- kind: ${d.kind.value} (${conf(d.kind.confidence)}: ${d.kind.evidence})`);
    lines.push(d.key ? `- key: ${d.key.value.join(", ")} (${conf(d.key.confidence)}: ${d.key.evidence})` : "- key: not set (see the questions)");
    lines.push(d.time ? `- time: ${d.time.value} (${conf(d.time.confidence)}: ${d.time.evidence})` : d.kind.value === "reference" ? "- time: none" : "- time: not set (see the questions)");
    for (const e of d.enums) lines.push(`- ${e.column}: one of ${e.values.join(", ")}`);
    if (d.enumCandidates.length) lines.push(`- values to list (a short repeated list each; add their values to the statistics): ${d.enumCandidates.join(", ")}`);
  }
  if (r.relationships.length) {
    lines.push("", `## Relationships (${r.relationships.length})`, "");
    for (const rel of r.relationships) lines.push(`- ${rel.from}.${rel.column} → ${rel.to} (${conf(rel.confidence)}: ${rel.evidence})`);
  }
  if (r.questions.length) {
    lines.push("", `## Questions (${r.questions.length})`, "", "For the Decide step; each answer goes into the model as a key, a time field or a type.", "");
    r.questions.forEach((q, i) => lines.push(`${i + 1}. **${q.dataset}** (${q.about}): ${q.question}${q.options?.length ? ` Options: ${q.options.join("; ")}.` : ""} ${q.why}.`));
  }
  if (!r.statistics.given) {
    lines.push("", "## Statistics", "", "No statistics were given, so the keys and kinds rest on names. Run `statisticsSql` (the tool returns it with `output: statistics`) on your warehouse and pass the rows as `statistics` to confirm which columns are unique, which are never null and which hold a short list of values.");
  }
  return lines.join("\n");
}

export interface ProfileOptions {
  organization?: string;
  output?: "report" | "model" | "json" | "statistics";
  /** The warehouse dialect the statistics query is written for */
  dialect?: DialectName;
}

/** The tool: the schema text and optional statistics text to the report, the model, both as JSON or the statistics query. */
export function profileSchemaFromText(schemaText: string | undefined, statisticsText: string | undefined, data: StandardData, opts: ProfileOptions = {}): string {
  const schema = parseSchema(schemaText);
  if ("error" in schema) return schema.error;
  if (opts.output === "statistics") return `-- Run on your warehouse and pass the result rows as \`statistics\` (JSON or CSV). Then, for each text column the result shows with up to 20 distinct values, list its values:\n-- ${valuesSql("<table>", "<column>")}\n${statisticsSql(schema.columns, opts.dialect)}`;
  const stats = parseStatistics(statisticsText);
  if ("error" in stats) return stats.error;
  const r = profileSchema(schema, stats.stats, data, { organization: opts.organization });
  r.problems.push(...stats.problems);
  if (opts.output === "json") return JSON.stringify({ organization: r.organization, format: r.format, statistics: r.statistics, datasets: r.datasets, relationships: r.relationships, questions: r.questions, problems: r.problems, model: r.model }, null, 2);
  if (opts.output === "model") return ossieYaml(r.model);
  return `${formatProfileReport(r)}\n\n## Semantic model\n\nPass this as \`semantic_model\` to the next step; edit the keys and time fields the questions settle.\n\n\`\`\`yaml\n${ossieYaml(r.model)}\`\`\`\n`;
}
