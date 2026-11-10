/**
 * The dbt compile target: a dbt project directory for the MetricFlow semantic
 * layer (docs/compile-targets-spike.md).
 *
 * MetricFlow needs a single-column key per entity. Every GASP snapshot dataset
 * is keyed by entity and snapshot date, which the upstream dbt converter
 * refuses ("composite primary key ... cannot represent composite keys
 * losslessly"). Decided 2026-11-10: each table with a composite key gets a
 * surrogate key, the key columns cast to text in the dialect and joined with
 * '_' (`customer_id || '_' || snapshot_date`), computed in the table's dbt
 * model. A foreign entity onto such a table builds the same key from its own
 * join columns, so the joins GASP declares survive as entities.
 *
 * Files, all under models/gasp/:
 *
 *   <model>.sql                  one model per table: the company's fields
 *                                projected under the compiled model's names
 *                                (a computed field as its expression), plus
 *                                gasp_surrogate_key where the key is composite;
 *                                a staged dataset's model is its compiled source
 *                                in the dialect; the period spine's selects the
 *                                spine table
 *   _gasp__sources.yml           the company's tables as dbt sources
 *   _gasp__semantic_models.yml   one semantic model per dbt model: entities,
 *                                dimensions, the time dimension as default and
 *                                the measures the metrics read
 *   _gasp__metrics.yml           the GASP metrics: simple where the expression
 *                                is one aggregate, ratio where it is one over
 *                                another, derived otherwise, over a simple
 *                                metric per aggregate
 *
 * Each aggregate in a direct metric's expression (in the target dialect)
 * becomes a measure on the semantic model of the table it reads: SUM to sum,
 * COUNT to count, COUNT(DISTINCT) to count_distinct, AVG to average, MIN and
 * MAX, the dialect's percentile to percentile, and a COALESCE(..., 0) around
 * it to fill_nulls_with: 0 on its metric. A measure on a snapshot table carries
 * a non_additive_dimension on the snapshot date (window_choice: max), so it is
 * read as of the period end as GASP reads snapshots. A staged metric is a sum
 * over its staged model's value.
 */
import { stringify } from "yaml";
import type { DialectName } from "../dialect.js";
import { DIALECT } from "../dialect.js";
import { slugName, tablesIn, type TargetField, type TargetMetric, type TargetModel, type TargetTable } from "./common.js";

export const SURROGATE_KEY = "gasp_surrogate_key";
export const DBT_DIR = "models/gasp";

export type DbtAgg = "sum" | "count" | "count_distinct" | "average" | "min" | "max" | "median" | "percentile";

export interface Aggregate {
  /** Offsets of the whole call in the expression, COALESCE wrapper included */
  start: number;
  end: number;
  agg: DbtAgg;
  /** The aggregated expression as written, table-qualified */
  expr: string;
  fill?: number;
  percentile?: { p: number; approximate?: boolean };
}

const AGG_START = /(?:COALESCE\(\s*)?(SUM|COUNT|AVG|MIN|MAX|MEDIAN|PERCENTILE_CONT|PERCENTILE|APPROX_QUANTILES)\(/y;

/** The index of the parenthesis closing the one at `open`, skipping string literals; -1 when unbalanced. */
function closing(sql: string, open: number): number {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") { i++; while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1; continue; }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Split on commas at depth zero. */
function topLevelArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") { i++; while (i < s.length && !(s[i] === "'" && s[i + 1] !== "'")) i += s[i] === "'" ? 2 : 1; continue; }
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) { out.push(s.slice(from, i).trim()); from = i + 1; }
  }
  out.push(s.slice(from).trim());
  return out;
}

/** One aggregate call starting at `at` (no COALESCE), or undefined. */
function aggregateAt(sql: string, at: number): Omit<Aggregate, "start" | "fill"> | undefined {
  const m = /^(SUM|COUNT|AVG|MIN|MAX|MEDIAN|PERCENTILE_CONT|PERCENTILE|APPROX_QUANTILES)\(/.exec(sql.slice(at));
  if (!m) return undefined;
  const open = at + m[1].length;
  const close = closing(sql, open);
  if (close < 0) return undefined;
  const inner = sql.slice(open + 1, close).trim();
  switch (m[1]) {
    case "SUM": return { end: close + 1, agg: "sum", expr: inner };
    case "AVG": return { end: close + 1, agg: "average", expr: inner };
    case "MIN": return { end: close + 1, agg: "min", expr: inner };
    case "MAX": return { end: close + 1, agg: "max", expr: inner };
    case "MEDIAN": return { end: close + 1, agg: "median", expr: inner };
    case "COUNT": {
      const d = /^DISTINCT\s+([\s\S]+)$/i.exec(inner);
      if (d) return topLevelArgs(d[1]).length === 1 ? { end: close + 1, agg: "count_distinct", expr: d[1].trim() } : undefined;
      return { end: close + 1, agg: "count", expr: inner === "*" ? "1" : inner };
    }
    case "PERCENTILE_CONT": {
      // PERCENTILE_CONT(p) WITHIN GROUP (ORDER BY x)
      const w = /^\s*WITHIN GROUP \(ORDER BY /.exec(sql.slice(close + 1));
      if (!w) return undefined;
      const open2 = sql.indexOf("(", close + 1);
      const close2 = closing(sql, open2);
      if (close2 < 0) return undefined;
      const x = sql.slice(open2 + 1, close2).replace(/^ORDER BY\s+/, "").trim();
      return { end: close2 + 1, agg: "percentile", expr: x, percentile: { p: Number(inner) } };
    }
    case "PERCENTILE": {
      // Databricks: PERCENTILE(x, p)
      const args = topLevelArgs(inner);
      if (args.length !== 2) return undefined;
      return { end: close + 1, agg: "percentile", expr: args[0], percentile: { p: Number(args[1]) } };
    }
    case "APPROX_QUANTILES": {
      // BigQuery: APPROX_QUANTILES(x, 1000)[OFFSET(n)]
      const args = topLevelArgs(inner);
      const o = /^\[OFFSET\((\d+)\)\]/.exec(sql.slice(close + 1));
      if (args.length !== 2 || !o) return undefined;
      return { end: close + 1 + o[0].length, agg: "percentile", expr: args[0], percentile: { p: Number(o[1]) / Number(args[1]), approximate: true } };
    }
  }
  return undefined;
}

/** Every aggregate call in an expression, outermost first, with any COALESCE(..., 0) around it. */
export function aggregatesIn(sql: string): Aggregate[] {
  const out: Aggregate[] = [];
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") { i++; while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1; continue; }
    if (i > 0 && /[\w$.]/.test(sql[i - 1])) continue;
    AGG_START.lastIndex = i;
    if (!AGG_START.test(sql)) continue;
    const wrapped = /^COALESCE\(\s*/.exec(sql.slice(i));
    if (wrapped) {
      const a = aggregateAt(sql, i + wrapped[0].length);
      const tail = a ? /^\s*,\s*0\s*\)/.exec(sql.slice(a.end)) : null;
      if (a && tail) { out.push({ start: i, ...a, end: a.end + tail[0].length, fill: 0 }); i = a.end + tail[0].length - 1; continue; }
      continue; // a COALESCE of something else: scan inside it
    }
    const a = aggregateAt(sql, i);
    if (a) { out.push({ start: i, ...a }); i = a.end - 1; }
  }
  return out;
}

/** Replace `<table>.<field>` outside string literals. */
function rewriteRefs(sql: string, replace: (table: string, field: string) => string | undefined): string {
  return sql.split(/('(?:[^']|'')*')/).map((part, i) => (i % 2 === 1 ? part : part.replace(/\b([A-Za-z_][\w$]*)\.([A-Za-z_][\w$]*)\b/g, (m, t: string, f: string) => replace(t, f) ?? m))).join("");
}

/** The expression with each known table's qualifier removed. */
export const unqualify = (sql: string, tables: Set<string>): string => rewriteRefs(sql, (t, f) => (tables.has(t) ? f : undefined));

/** The dbt model a table becomes: its name, gasp_-prefixed so no model is a reserved word. */
export const modelName = (t: TargetTable): string => (t.name.startsWith("gasp_") ? t.name : `gasp_${t.name}`);

/** A composite key needs the surrogate: two or more distinct key columns. */
export const needsSurrogate = (t: TargetTable): boolean => t.primaryKey.length > 1;

/** The surrogate key over the given column expressions, in the dialect. */
export function surrogateSql(columns: string[], dialect: DialectName): string {
  const d = DIALECT[dialect];
  return columns.map((c) => d.toText(c)).join(" || '_' || ");
}

const quoteId = (s: string): string => (/^[a-z_][a-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`);

interface MetricOut {
  name: string;
  label: string;
  description: string;
  type: "simple" | "ratio" | "derived";
  type_params: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export function writeDbt(tm: TargetModel): { files: Record<string, string>; notes: string[] } {
  const notes: string[] = [];
  const dialect = tm.dialect;
  const byName = new Map(tm.tables.map((t) => [t.name, t]));
  const tableNames = new Set(byName.keys());
  const files: Record<string, string> = {};

  // Sources: the company's tables, grouped by database and schema.
  const sources = new Map<string, { database?: string; schema: string; tables: Set<string> }>();
  const fromOf = (t: TargetTable): string => {
    if (t.source.kind === "query") return `(\n${t.source.sqlByDialect?.[dialect] ?? t.source.sql}\n) AS src`;
    const parts = t.source.parts;
    if (parts.length < 2) return parts.join(".");
    const [database, schema, table] = parts.length >= 3 ? parts.slice(-3) : [undefined, parts[0], parts[1]];
    const name = slugName(database ? `${database}_${schema}` : schema);
    const s = sources.get(name) ?? { ...(database ? { database } : {}), schema, tables: new Set<string>() };
    s.tables.add(table);
    sources.set(name, s);
    return `{{ source('${name}', '${table}') }}`;
  };

  // Models.
  for (const t of tm.tables) {
    const file = `${DBT_DIR}/${modelName(t)}.sql`;
    if (t.staged) {
      const source = (t.source.kind === "query" ? t.source.sqlByDialect?.[dialect] ?? t.source.sql : "").trim();
      const head = `-- Staged dataset for ${t.staged.for} (${t.staged.reason}): one row per reporting period${needsSurrogate(t) ? " and group" : ""}, compiled by GASP over your tables and the period spine.`;
      // A breakdown keys its rows by period and group: the surrogate goes around the compiled source.
      files[file] = needsSurrogate(t)
        ? `${head}\nSELECT\n  staged.*,\n  ${surrogateSql(t.primaryKey.map((k) => `staged.${k}`), dialect)} AS ${SURROGATE_KEY}\nFROM (\n${source}\n) AS staged\n`
        : `${head}\n${source}\n`;
      continue;
    }
    const cols = t.fields.map((f) => (f.sql === f.name ? `  ${quoteId(f.name)}` : `  ${f.sql} AS ${quoteId(f.name)}`));
    if (needsSurrogate(t)) {
      const keySql = surrogateSql(t.primaryKey.map((k) => t.fields.find((f) => f.name === k)?.sql ?? k), dialect);
      cols.push(`  ${keySql} AS ${SURROGATE_KEY}`);
    }
    const head = t.spine
      ? "-- The period spine: one row per reporting period, from the table you fill. The staged models read that table."
      : `-- ${t.name}: your fields under the GASP model's names${needsSurrogate(t) ? `, with ${SURROGATE_KEY} for the composite key (${t.primaryKey.join(", ")})` : ""}.`;
    files[file] = `${head}\nSELECT\n${cols.join(",\n")}\nFROM ${fromOf(t)}\n`;
  }
  if (sources.size) {
    files[`${DBT_DIR}/_gasp__sources.yml`] = yaml({
      version: 2,
      sources: [...sources.entries()].map(([name, s]) => ({ name, ...(s.database ? { database: s.database } : {}), schema: s.schema, tables: [...s.tables].sort().map((x) => ({ name: x })) })),
    });
  }

  // Measures and metrics from each GASP metric.
  const measuresOf = new Map<string, Array<Record<string, unknown>>>();
  const measureBySig = new Map<string, string>();
  const simple = new Map<string, MetricOut>();
  const metrics: MetricOut[] = [];
  const skipped: string[] = [];
  const crossTable: string[] = [];
  const doubles = [...new Set(Object.values(DIALECT).map((d) => d.toDouble("X").replace(/^CAST\(X AS (.+)\)$/, "$1")))].map((x) => x.replace(/ /g, "\\s+")).join("|");
  const RATIO = new RegExp(`^CAST\\(\\(?(__m\\d+__)\\)? AS (?:${doubles})\\) \\/ NULLIF\\(\\(?(__m\\d+__)\\)?, 0\\)$`);
  const strip = (s: string): string => { let x = s.trim(); while (x.startsWith("(") && closing(x, 0) === x.length - 1) x = x.slice(1, -1).trim(); return x; };

  const measureFor = (m: TargetMetric, a: Aggregate, k: number): string | undefined => {
    const reads = tablesIn(a.expr, tableNames);
    if (reads.length !== 1) return undefined;
    const t = byName.get(reads[0])!;
    if (t.staged || t.spine) return undefined;
    const expr = unqualify(a.expr, tableNames);
    const sig = JSON.stringify([t.name, a.agg, expr, a.percentile ?? null]);
    let name = measureBySig.get(sig);
    if (!name) {
      name = `${m.name}__${k}`;
      measureBySig.set(sig, name);
      const list = measuresOf.get(t.name) ?? [];
      list.push({
        name,
        agg: a.agg,
        expr,
        ...(a.percentile ? { agg_params: { percentile: a.percentile.p, use_discrete_percentile: false, ...(a.percentile.approximate ? { use_approximate_percentile: true } : {}) } } : {}),
        ...(t.kind === "snapshot" && t.timeField ? { non_additive_dimension: { name: t.timeField, window_choice: "max" } } : {}),
      });
      measuresOf.set(t.name, list);
    }
    return name;
  };
  const describe = (m: TargetMetric): string => `${m.description ?? m.label} Canonical definition: ${m.url}`.trim();
  const config = (m: TargetMetric) => ({ meta: { gasp_id: m.gaspId, gasp_url: m.url } });

  for (const m of tm.metrics) {
    if (m.staged) {
      const t = byName.get(m.staged);
      if (!t) { skipped.push(m.name); continue; }
      const name = `${m.name}__value`;
      measuresOf.set(t.name, [{ name, agg: "sum", expr: "value" }]);
      metrics.push({ name: m.name, label: m.label, description: describe(m), type: "simple", type_params: { measure: { name } }, config: config(m) });
      continue;
    }
    const aggs = aggregatesIn(m.sql);
    const names: string[] = [];
    let ok = aggs.length > 0;
    for (const [k, a] of aggs.entries()) {
      const n = ok ? measureFor(m, a, k + 1) : undefined;
      if (!n) { ok = false; break; }
      names.push(n);
    }
    let residue = m.sql;
    for (let k = aggs.length - 1; k >= 0 && ok; k--) residue = residue.slice(0, aggs[k].start) + `__m${k}__` + residue.slice(aggs[k].end);
    if (!ok || tablesIn(residue, tableNames).length || /\{\{/.test(residue)) { skipped.push(m.name); continue; }
    if (m.datasets.length > 1) crossTable.push(m.name);
    const base = { name: m.name, label: m.label, description: describe(m), config: config(m) };
    const body = strip(residue);
    const single = /^__m(\d+)__$/.exec(body);
    if (single) {
      const a = aggs[Number(single[1])];
      metrics.push({ ...base, type: "simple", type_params: { measure: { name: names[Number(single[1])], ...(a.fill !== undefined ? { fill_nulls_with: a.fill } : {}) } } });
      continue;
    }
    // An input metric per aggregate: simple, named as its measure, filling nulls as the expression does.
    const input = (k: number): string => {
      const a = aggs[k];
      const name = `${names[k]}${a.fill !== undefined ? "_filled" : ""}`;
      if (!simple.has(name)) simple.set(name, { name, label: name, description: `An input to GASP metrics: ${a.agg} of ${unqualify(a.expr, tableNames)}.`, type: "simple", type_params: { measure: { name: names[k], ...(a.fill !== undefined ? { fill_nulls_with: a.fill } : {}) } } });
      return name;
    };
    const ratio = RATIO.exec(body);
    if (ratio) {
      const [num, den] = [Number(ratio[1].slice(3, -2)), Number(ratio[2].slice(3, -2))];
      metrics.push({ ...base, type: "ratio", type_params: { numerator: input(num), denominator: input(den) } });
      continue;
    }
    const inputs = aggs.map((_, k) => input(k));
    const expr = residue.replace(/__m(\d+)__/g, (_, k: string) => inputs[Number(k)]);
    metrics.push({ ...base, type: "derived", type_params: { expr, metrics: [...new Set(inputs)].map((name) => ({ name })) } });
  }

  // Semantic models.
  const entityOf = (t: TargetTable): { name: string; expr: string } | undefined => {
    if (!t.primaryKey.length) return undefined;
    return { name: t.name, expr: needsSurrogate(t) ? SURROGATE_KEY : t.primaryKey[0] };
  };
  const semanticModels = tm.tables.filter((t) => !t.spine).map((t) => {
    const entities: Array<Record<string, unknown>> = [];
    const primary = entityOf(t);
    if (primary) entities.push({ name: primary.name, type: "primary", expr: primary.expr });
    const seen = new Set(entities.map((e) => e.name));
    for (const r of tm.relationships) {
      if (r.from !== t.name) continue;
      const to = byName.get(r.to);
      if (!to || !entityOf(to)) continue;
      // The join columns in the order of the other table's key, so a surrogate builds the same value.
      const order = to.primaryKey.map((k) => r.to_columns.indexOf(k));
      if (order.some((i) => i < 0) || order.length !== r.to_columns.length) continue;
      const cols = order.map((i) => r.from_columns[i]);
      const name = seen.has(r.to) ? r.name : r.to;
      seen.add(name);
      // The models project every field under its own name, so a column reference is the field name.
      entities.push({ name, type: "foreign", expr: needsSurrogate(to) ? surrogateSql(cols, dialect) : cols[0] });
    }
    // Time fields, and every other non-fact field the entities do not already carry.
    const dimensions = t.fields.filter((f) => f.role === "time" || (f.role !== "fact" && !t.primaryKey.includes(f.name))).map((f: TargetField) => (
      f.role === "time"
        ? { name: f.name, type: "time", type_params: { time_granularity: "day" }, ...(f.description ? { description: f.description } : {}) }
        : { name: f.name, type: "categorical", ...(f.description ? { description: f.description } : {}) }
    ));
    const measures = measuresOf.get(t.name) ?? [];
    return {
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      model: `ref('${modelName(t)}')`,
      ...(t.timeField ? { defaults: { agg_time_dimension: t.timeField } } : {}),
      ...(entities.length ? { entities } : {}),
      ...(dimensions.length ? { dimensions } : {}),
      ...(measures.length ? { measures } : {}),
    };
  });
  files[`${DBT_DIR}/_gasp__semantic_models.yml`] = yaml({ semantic_models: semanticModels });
  // Name, label and description first, then the type, then the GASP references.
  const ordered = [...metrics, ...simple.values()].map(({ config: c, ...rest }) => ({ ...rest, ...(c ? { config: c } : {}) }));
  files[`${DBT_DIR}/_gasp__metrics.yml`] = yaml({ metrics: ordered });

  const surrogates = tm.tables.filter((t) => needsSurrogate(t) && !t.staged).length;
  notes.push(`A dbt project fragment for the MetricFlow semantic layer: copy models/gasp/ into your project. ${tm.tables.length} models, ${semanticModels.length} semantic models and ${metrics.length} GASP metrics (${simple.size} input metrics beside them).`);
  if (surrogates) notes.push(`${surrogates} table${surrogates === 1 ? " has" : "s have"} a composite key (entity and snapshot date), which MetricFlow cannot key on; each model adds ${SURROGATE_KEY}, the key columns as text joined with '_'. A foreign entity onto it builds the same value from its own join columns.`);
  notes.push("Snapshot measures carry a non_additive_dimension on the snapshot date (window_choice: max), so they read the last snapshot of the period as GASP does. MetricFlow also needs a time spine model in your project (metricflow_time_spine); GASP's period spine is a separate table the staged models read.");
  if (sources.size) notes.push(`_gasp__sources.yml declares ${sources.size} source${sources.size === 1 ? "" : "s"} from your table names; merge it with your own sources if they already declare these tables.`);
  if (crossTable.length) notes.push(`${crossTable.length} metric${crossTable.length === 1 ? " combines" : "s combine"} measures from more than one semantic model; MetricFlow joins them through the entities, so check each against GASP's value before relying on it: ${crossTable.slice(0, 12).join(", ")}${crossTable.length > 12 ? ", ..." : ""}.`);
  if (skipped.length) notes.push(`Left out, as their expressions do not split into MetricFlow measures: ${skipped.join(", ")}.`);
  return { files, notes };
}

const yaml = (doc: unknown): string => stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false });
