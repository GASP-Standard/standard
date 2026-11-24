/**
 * Metric scope (core-spec/spec.md, "Metric Scoping"). Ossie holds a metric in
 * one of two places. A dataset-scoped metric sits in `datasets[].metrics` and
 * names its dataset's fields by single-part name, `SUM(amount)`. A model-scoped
 * metric sits in the model-root `metrics`, names fields as `dataset.field` and
 * is the form for an aggregation that spans datasets.
 *
 * GASP writes a metric that reads one dataset under that dataset and leaves the
 * rest at the root (`placeMetrics`, DECISIONS.md 2026-11-23). Every reader takes
 * the metrics through `modelMetrics`, which gives each one back in the
 * `dataset.field` form whatever its scope, so the code that runs, compares and
 * compiles expressions works on one form. The two are inverses for every metric
 * GASP writes and test/scope.test.ts holds them so.
 */

import type { OssieDataset, OssieExpression, OssieMetric, OssieSemanticModel } from "./types.js";

/** The qualifier a dataset-scoped metric gives a column of its dataset's `source` (rule 2 upstream); matched in any case. */
const SOURCE_QUALIFIER = "source";

/** Replace the contents of single-quoted SQL string literals so they are never scanned. */
export function stripLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

/** Every two-part reference in an expression as its qualifier and name, string literals left out. */
export function refsIn(sql: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const re = /(?<![\w.])([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b/g;
  let m: RegExpExecArray | null;
  const s = stripLiterals(sql);
  while ((m = re.exec(s))) out.push([m[1], m[2]]);
  return out;
}

/** An expression with `f` applied to its `sql` and to each dialect entry. */
function mapExpression(e: OssieExpression, f: (sql: string) => string): OssieExpression {
  return {
    ...e,
    ...(typeof e.sql === "string" ? { sql: f(e.sql) } : {}),
    ...(Array.isArray(e.dialects) ? { dialects: e.dialects.map((d) => (typeof d?.expression === "string" ? { ...d, expression: f(d.expression) } : d)) } : {}),
  };
}

/** Every text an expression carries: `sql` and each dialect entry. */
function texts(e: OssieExpression | string | undefined): string[] {
  if (typeof e === "string") return [e];
  if (typeof e !== "object" || e === null) return [];
  return [...(typeof e.sql === "string" ? [e.sql] : []), ...(Array.isArray(e.dialects) ? e.dialects.map((d) => d?.expression).filter((x): x is string => typeof x === "string") : [])];
}

type Token = { text: string; kind: "string" | "quoted" | "name" | "space" | "other" };

function tokens(sql: string): Token[] {
  const out: Token[] = [];
  for (const m of sql.matchAll(/'(?:[^']|'')*'|"(?:[^"]|"")*"|[A-Za-z_]\w*|\s+|[\s\S]/g)) {
    const text = m[0];
    const kind: Token["kind"] = text[0] === "'" && text.length > 1 ? "string" : text[0] === '"' && text.length > 1 ? "quoted" : /^[A-Za-z_]/.test(text) ? "name" : /^\s/.test(text) ? "space" : "other";
    out.push({ text, kind });
  }
  return out;
}

const is = (t: Token | undefined, word: string): boolean => t?.kind === "name" && t.text.toUpperCase() === word;

/**
 * A dataset-scoped expression with each single-part field name written as
 * `dataset.field`. A name counts as a field when the dataset declares it and it
 * stands where a column can: not already part of a dotted name, not a function
 * name, not a type (after `AS`, or in front of a literal as in `DATE '2026-01-01'`),
 * not an interval unit after a literal and not the field of an `EXTRACT`.
 * `source.column` references are left as written.
 */
export function qualifyExpression(sql: string, dataset: string, fields: ReadonlySet<string>): string {
  const all = tokens(sql);
  const solid = all.map((t, i) => (t.kind === "space" ? -1 : i)).filter((i) => i >= 0);
  const at = new Map(solid.map((i, k) => [i, k]));
  const near = (i: number, d: number): Token | undefined => all[solid[at.get(i)! + d]];
  return all.map((t, i) => {
    if (t.kind !== "name" || !fields.has(t.text)) return t.text;
    const prev = near(i, -1);
    const next = near(i, 1);
    if (prev?.text === "." || next?.text === "." || next?.text === "(") return t.text;
    if (is(prev, "AS") || next?.kind === "string" || prev?.kind === "string") return t.text;
    if (is(next, "FROM") && prev?.text === "(" && is(near(i, -2), "EXTRACT")) return t.text;
    return `${dataset}.${t.text}`;
  }).join("");
}

/** A `dataset.field` expression over one dataset with the qualifier taken off, the form a dataset-scoped metric is written in. */
export function unqualifyExpression(sql: string, dataset: string): string {
  const all = tokens(sql);
  const out: string[] = [];
  for (let i = 0; i < all.length; i++) {
    const t = all[i];
    const dotted = t.kind === "name" && t.text === dataset && all[i + 1]?.text === "." && (all[i + 2]?.kind === "name" || all[i + 2]?.kind === "quoted") && all[i - 1]?.text !== ".";
    if (dotted) i++;
    else out.push(t.text);
  }
  return out.join("");
}

/** The datasets a `dataset.field` expression names, over every text it carries. */
export function datasetsRead(e: OssieExpression | string | undefined): Set<string> {
  return new Set(texts(e).flatMap((t) => refsIn(t).map(([ds]) => ds)));
}

/** True for a two-part reference a dataset-scoped metric may carry: a column of its `source`. */
export const isSourceRef = (qualifier: string): boolean => qualifier.toLowerCase() === SOURCE_QUALIFIER;

/** A dataset with its `metrics` set, placed after its fields as upstream orders the keys; an empty list leaves the key out. */
export function withMetrics(d: OssieDataset, metrics: OssieMetric[]): OssieDataset {
  const { metrics: _was, nonportable_extensions, ...rest } = d;
  return { ...rest, ...(metrics.length ? { metrics } : {}), ...(nonportable_extensions ? { nonportable_extensions } : {}) };
}

/** A dataset without its own metrics, for cutting a model down to the metrics a caller keeps. */
export const withoutMetrics = (d: OssieDataset): OssieDataset => (d.metrics === undefined ? d : withMetrics(d, []));

/**
 * Metrics in the `dataset.field` form placed by scope. One that reads a single
 * dataset of `datasets` goes under it with single-part names; one that reads
 * several datasets, none or one the list lacks stays in the returned root list.
 * So does a metric whose name its dataset already uses for a field or a metric,
 * since the two share a namespace (rule 4 upstream). The datasets given are not
 * changed; those that gain a metric come back as copies.
 */
export function placeMetrics(datasets: OssieDataset[], metrics: OssieMetric[]): { datasets: OssieDataset[]; metrics: OssieMetric[] } {
  const byName = new Map(datasets.map((d) => [d.name, d]));
  const taken = new Map<string, Set<string>>();
  const namesOf = (d: OssieDataset): Set<string> => {
    let s = taken.get(d.name);
    if (!s) taken.set(d.name, (s = new Set([...(d.fields ?? []).map((f) => f.name), ...scopedOf(d).map((m) => m.name)])));
    return s;
  };
  const added = new Map<string, OssieMetric[]>();
  const root: OssieMetric[] = [];
  for (const m of metrics) {
    const read = [...datasetsRead(m.expression)];
    const home = read.length === 1 ? byName.get(read[0]) : undefined;
    if (!home || namesOf(home).has(m.name)) { root.push(m); continue; }
    namesOf(home).add(m.name);
    const list = added.get(home.name) ?? [];
    added.set(home.name, list);
    list.push({ ...m, expression: mapExpression(m.expression, (s) => unqualifyExpression(s, home.name)) });
  }
  return { datasets: datasets.map((d) => (added.has(d.name) ? withMetrics(d, [...scopedOf(d), ...added.get(d.name)!]) : d)), metrics: root };
}

/** A dataset's own metrics as a list, whatever the document holds there. */
function scopedOf(d: OssieDataset | undefined): OssieMetric[] {
  return Array.isArray(d?.metrics) ? d.metrics.filter((m) => typeof m === "object" && m !== null) : [];
}

/** Every metric of a model as written, with the dataset that declares it: the dataset-scoped ones in dataset order, then the model-root ones. */
export function scopedMetrics(model: { datasets?: OssieDataset[]; metrics?: OssieMetric[] }): Array<{ metric: OssieMetric; dataset?: OssieDataset }> {
  const datasets = Array.isArray(model.datasets) ? model.datasets : [];
  return [
    ...datasets.flatMap((d) => scopedOf(d).map((metric) => ({ metric, dataset: d }))),
    ...(Array.isArray(model.metrics) ? model.metrics : []).map((metric) => ({ metric })),
  ];
}

/**
 * A dataset-scoped metric in the `dataset.field` form. The names that count as
 * fields are the ones its dataset declares; `declared` supplies them for a
 * dataset written without fields (a document that holds metrics alone, read
 * against the model that declares the dataset).
 */
export function qualifiedMetric(metric: OssieMetric, dataset: OssieDataset, declared?: (dataset: string) => Iterable<string> | undefined): OssieMetric {
  if (typeof metric.expression !== "object" || metric.expression === null) return metric;
  const own = Array.isArray(dataset.fields) ? dataset.fields.map((f) => f?.name).filter((n): n is string => typeof n === "string") : [];
  const fields = new Set(own.length ? own : declared?.(dataset.name) ?? []);
  return { ...metric, expression: mapExpression(metric.expression, (s) => qualifyExpression(s, dataset.name, fields)) };
}

/**
 * Every metric of a model in the `dataset.field` form, whatever its scope: the
 * list GASP's readers work on. A model-root metric comes back as it is.
 */
export function modelMetrics(model: { datasets?: OssieDataset[]; metrics?: OssieMetric[] } | undefined, declared?: (dataset: string) => Iterable<string> | undefined): OssieMetric[] {
  if (!model) return [];
  return scopedMetrics(model).map(({ metric, dataset }) => (dataset ? qualifiedMetric(metric, dataset, declared) : metric));
}

/** The number of metrics a model declares, in either scope. */
export const metricCount = (model: OssieSemanticModel): number => scopedMetrics(model).length;
