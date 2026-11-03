/**
 * Drift scoring (docs/ossie-interop-spec.md, "Drift scoring"): a company's own
 * metrics compared with GASP's canonical definitions by result, on the GASP
 * synthetic SaaS dataset (src/synthetic.ts), behind the `score_drift` tool.
 *
 * The company's metrics are matched to GASP metrics by name, by the synonyms
 * in their `ai_context` or by explicit pairs; nothing is scored on a fuzzy
 * guess, those go to a review list. For each match the canonical metric is
 * compiled into the company's own dataset and field names (company.ts) and
 * both expressions run on views of the synthetic rows named as the company's
 * datasets, filled through their mapping, for six monthly periods. Where the
 * numbers differ, the likely cause is read from the canonical formula: a
 * construct the expression language cannot state (a cohort, an opening value,
 * a period bound to a business date), a filter one side applies and the other
 * does not, a dataset read on one side only or an aggregate whose value has no
 * equal on the other side.
 *
 * The engine is PGlite, an in-process Postgres, loaded as an optional
 * dependency; without it the tool says so and returns nothing it cannot run.
 */
import { closestNames, isMetricStub, metricFormulaId, resolveMetric } from "../loader.js";
import { enumFilters, type EnumFilter } from "../filters.js";
import { columnName, generateFixture, loadSynthetic, TABLES, type Fixture } from "../synthetic.js";
import type { Metric, OntologyDataset, OntologyField, StandardData } from "../types.js";
import { expressionText, parseDocument, resolveCompany, type Company } from "./adapt.js";
import { compileModel, isGaspMetric, type CompiledModel } from "./company.js";
import { directQuery, stagedQuery, type Period } from "./demo.js";
import { formulaSource } from "./metrics.js";
import { aggregateSpans } from "./portability.js";
import { OSSIE_DIALECT, type MetricCoverage, type OssieMetric, type OssieSemanticModel } from "./types.js";

/** The six monthly periods of the synthetic dataset's window. */
export const DRIFT_PERIODS: Period[] = [31, 28, 31, 30, 31, 30].map((days, i) => {
  const m = String(i + 1).padStart(2, "0");
  return { start: `2026-${m}-01`, end: `2026-${m}-${days}` };
});
const SPINE = "gasp.period_spine";
const TOLERANCE = 1e-9;

/** Anything that runs SQL: PGlite, or a test double. */
export interface Engine {
  exec(sql: string): Promise<unknown>;
  query<T>(sql: string): Promise<{ rows: T[] }>;
}

export interface DriftMatch {
  metric: OssieMetric;
  /** Formula id, plus `:O`, `:M` or `:variant` */
  key: string;
  gasp: Metric;
  variant?: string;
  how: "name" | "synonym" | "matches";
}

export interface DriftReview {
  name: string;
  /** Near names, best first; none is scored */
  suggestions: Array<{ name: string; score: number }>;
}

export interface PeriodValue { period: Period; yours: number | null; canonical: number | null }

export interface DriftScore {
  /** The company's metric name */
  name: string;
  /** The GASP metric's label */
  gasp: string;
  key: string;
  how: DriftMatch["how"];
  status: "agrees" | "differs" | "not runnable" | "not compiled";
  /** The company's expression */
  yours: string;
  /** The canonical expression in the company's names, or the staged source */
  canonical?: string;
  canonicalKind?: "direct" | "staged";
  stagedReason?: string;
  periods: PeriodValue[];
  /** The period with the largest relative difference */
  worst?: PeriodValue & { relative: number };
  differing: number;
  causes: string[];
  /** Why it could not run or compile */
  error?: string;
}

export interface DriftResult {
  company: Company;
  engine: "pglite" | "none";
  periods: Period[];
  matched: DriftMatch[];
  scores: DriftScore[];
  review: DriftReview[];
  counts: { metrics: number; matched: number; agrees: number; differs: number; notRunnable: number; notCompiled: number; review: number };
  /** The mapping's own problems, as compile_model reports them */
  problems: string[];
}

// ── the engine ───────────────────────────────────────────────────────────────

let shared: Promise<Engine | null> | undefined;
let queue: Promise<unknown> = Promise.resolve();

/** One call at a time on the shared engine: each call sets its own search path. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

/** Load the synthetic dataset into a fresh engine: the fixture tables and the period spine. */
async function loadDriftData(db: Engine, data: StandardData, fixture?: Fixture): Promise<void> {
  await loadSynthetic(db, fixture ?? generateFixture(data.ontology!));
  await db.exec(`CREATE SCHEMA IF NOT EXISTS gasp; CREATE TABLE ${SPINE} (period_start DATE, period_end DATE)`);
  await db.exec(`INSERT INTO ${SPINE} VALUES ${DRIFT_PERIODS.map((p) => `('${p.start}', '${p.end}')`).join(", ")}`);
}

/** Close the shared engine (a script that scored once should release it before exiting); the next call loads it again. */
export async function closeSyntheticEngine(): Promise<void> {
  const db = await shared?.catch(() => null);
  shared = undefined;
  await (db as (Engine & { close?: () => Promise<void> }) | null)?.close?.();
}

/** The process-wide engine over the synthetic dataset, or null when PGlite is not installed. */
export function syntheticEngine(data: StandardData): Promise<Engine | null> {
  shared ??= (async () => {
    let mod: { PGlite: new () => Engine };
    try {
      mod = (await import("@electric-sql/pglite")) as unknown as { PGlite: new () => Engine };
    } catch (e) {
      if (/Cannot find|ERR_MODULE_NOT_FOUND|not found/i.test(String(e))) return null;
      throw e;
    }
    const db = new mod.PGlite();
    await loadDriftData(db, data);
    return db;
  })();
  return shared;
}

// ── matching ─────────────────────────────────────────────────────────────────

const synonymsOf = (m: OssieMetric): string[] => {
  const ctx = m.ai_context;
  return ctx && typeof ctx === "object" && Array.isArray(ctx.synonyms) ? ctx.synonyms.map(String) : [];
};

const exactMetric = (data: StandardData, name: string): Metric | undefined => {
  for (const candidate of [name, name.replace(/_/g, " ")]) {
    const r = resolveMetric(data, candidate);
    if (r.kind === "metric" && !isMetricStub(r.metric)) return r.metric;
  }
  return undefined;
};

/** Explicit pairs: "company_metric=GASP name" (comma separated), with an optional ":O", ":M" or ":variant" on the GASP side. */
export function parseMatches(text: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (text ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const i = pair.indexOf("=");
    if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
}

/** The company's metrics matched to GASP's: exact name, then synonyms, then the explicit pairs; the rest reviewed with near names. */
export function matchMetrics(metrics: OssieMetric[], data: StandardData, matches: Record<string, string> = {}): { matched: DriftMatch[]; review: DriftReview[]; errors: string[] } {
  const matched: DriftMatch[] = [];
  const review: DriftReview[] = [];
  const errors: string[] = [];
  for (const m of metrics) {
    const explicit = matches[m.name];
    if (explicit !== undefined) {
      const whole = resolveMetric(data, explicit);
      const cut = explicit.lastIndexOf(":");
      const [gaspName, variant] = whole.kind === "metric" || cut < 0 ? [explicit.trim(), undefined] : [explicit.slice(0, cut).trim(), explicit.slice(cut + 1).trim()];
      const r = whole.kind === "metric" ? whole : resolveMetric(data, gaspName);
      if (r.kind !== "metric") { errors.push(`matches: \`${m.name}=${explicit}\`: \`${gaspName}\` is ${r.kind === "ambiguous" ? "ambiguous; prefix the department" : "not a metric name, abbreviation, alias or formula id"}.`); continue; }
      const id = metricFormulaId(data, r.metric);
      const f = data.formulas?.[id];
      if (variant && !formulaSource(f ?? {}, variant)) { errors.push(`matches: \`${m.name}=${explicit}\`: ${r.metric.name} has no form or variant \`${variant}\`.`); continue; }
      matched.push({ metric: m, key: variant ? `${id}:${variant}` : id, gasp: r.metric, variant, how: "matches" });
      continue;
    }
    const byName = exactMetric(data, m.name);
    if (byName) { matched.push({ metric: m, key: metricFormulaId(data, byName), gasp: byName, how: "name" }); continue; }
    const bySynonym = synonymsOf(m).map((s) => exactMetric(data, s)).find(Boolean);
    if (bySynonym) { matched.push({ metric: m, key: metricFormulaId(data, bySynonym), gasp: bySynonym, how: "synonym" }); continue; }
    const near = [m.name.replace(/_/g, " "), ...synonymsOf(m)]
      .flatMap((q) => closestNames(data, q, 3).filter((c) => c.metric).map((c) => ({ name: c.metric!.name, score: c.score })))
      .sort((a, b) => b.score - a.score)
      .filter((c, i, all) => all.findIndex((x) => x.name === c.name) === i)
      .slice(0, 3);
    review.push({ name: m.name, suggestions: near });
  }
  return { matched, review, errors };
}

// ── running both sides ───────────────────────────────────────────────────────

const exprOf = (m: Pick<OssieMetric, "expression">): string => expressionText(m) ?? "";
/** The company's physical names as the compiler wants them: the view is named as the dataset and dated by its date column. */
const physicalOf = (ns: { date: Record<string, string> }) => ({ table: (n: string) => n, date: (n: string) => ns.date[n] });

/** OSSIE_SQL_2026 to Postgres: the date functions and the median PGlite lacks. */
export function toPostgres(sql: string): string {
  return sql
    .replace(/DATEDIFF\(second, ([\w.]+), ([\w.]+)\)/g, "EXTRACT(EPOCH FROM ($2 - $1))")
    .replace(/DATEDIFF\(day, ([\w.]+), ([\w.]+)\)/g, "($2 - $1)")
    .replace(/\bMEDIAN\(/g, "PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ");
}

const DATASET_REF = /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi;

async function value(db: Engine, sql: string): Promise<number | null> {
  const res = await db.query<Record<string, unknown>>(sql);
  const v = res.rows[0] ? Object.values(res.rows[0])[0] : null;
  return v === null || v === undefined ? null : Number(v);
}

const same = (a: number | null, b: number | null): boolean =>
  a === null || b === null ? a === b : Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));

/** The difference relative to the canonical value; relative to yours when canonical is 0 (so a value against 0 is 100%), infinite when a side is null. */
const relative = (yours: number | null, canonical: number | null): number =>
  yours === null || canonical === null ? Infinity : Math.abs(yours - canonical) / (Math.abs(canonical) || Math.abs(yours) || 1);

/** Aggregate spans with the COALESCE(..., 0) the compiler wraps a sum in, so the call runs alone as the expression reads it. */
function guardedSpans(expr: string): Array<{ start: number; end: number }> {
  return aggregateSpans(expr).map((s) => {
    const before = /COALESCE\s*\(\s*$/i.exec(expr.slice(0, s.start));
    const after = /^\s*,\s*0\s*\)/.exec(expr.slice(s.end));
    return before && after ? { start: s.start - before[0].length, end: s.end + after[0].length } : s;
  });
}

/** The company's namespace on the synthetic dataset: a view per mapped dataset, named and columned as the company's model. */
interface Namespace {
  /** Company dataset name → the GASP dataset it stands for */
  datasets: Record<string, string>;
  /** Company dataset name → its GASP metadata, for the period filter */
  meta: Record<string, OntologyDataset>;
  /** Company dataset name → the column carrying its date field, if mapped */
  date: Record<string, string>;
  /** Company `dataset.field` → the GASP field it maps */
  fields: Record<string, { dataset: string; field: string }>;
  /** The canonical metrics compiled into these names */
  compiled: CompiledModel;
  views: string[];
  notes: string[];
}

function namespace(company: Company, data: StandardData, only: Set<string>): Namespace | { error: string } {
  const gaspDatasets = data.ontology!.datasets!;
  const ns: Omit<Namespace, "compiled"> = { datasets: {}, meta: {}, date: {}, fields: {}, views: [], notes: [] };
  for (const [ds, refs] of Object.entries(company.refs)) {
    const meta = gaspDatasets[ds];
    if (!meta) continue;
    const name = refs[meta.key]?.dataset ?? Object.values(refs)[0]?.dataset;
    if (!name) continue;
    if (ns.datasets[name] && ns.datasets[name] !== ds) { ns.notes.push(`\`${name}\` maps both \`${ns.datasets[name]}\` and \`${ds}\`; it stands for \`${ns.datasets[name]}\` here.`); continue; }
    ns.datasets[name] = ds;
    ns.meta[name] = meta;
    for (const [gaspField, r] of Object.entries(refs)) {
      if (r.dataset !== name) continue;
      ns.fields[`${name}.${r.field}`] = { dataset: ds, field: gaspField };
      if (gaspField === meta.date) ns.date[name] = r.field;
    }
  }
  // The canonical metrics compiled into the company's names: a model whose datasets are the views and whose fields are bare columns.
  const model: OssieSemanticModel = {
    version: company.model.version,
    name: company.model.name,
    datasets: Object.entries(ns.datasets).map(([name, ds]) => ({
      name,
      source: name,
      fields: Object.entries(company.refs[ds]).filter(([, r]) => r.dataset === name).map(([, r]) => ({ name: r.field, expression: { dialects: [{ dialect: OSSIE_DIALECT, expression: r.field }] } })),
    })),
    metrics: [],
  };
  const compiled = compileModel({ ...company, model, modelProvided: true }, data, { dialect: "postgres", only, spine: SPINE });
  if ("error" in compiled) return compiled;
  return { ...ns, compiled };
}

async function createViews(db: Engine, schema: string, ns: Namespace, company: Company): Promise<void> {
  await db.exec(`CREATE SCHEMA ${schema}`);
  for (const [name, ds] of Object.entries(ns.datasets)) {
    const table = TABLES[ds];
    if (!table) { ns.notes.push(`\`${name}\` stands for \`${ds}\`, which the synthetic dataset lacks.`); continue; }
    const cols = Object.entries(company.refs[ds]).filter(([, r]) => r.dataset === name).map(([gaspField, r]) => `${columnName(ds, gaspField)} AS "${r.field}"`);
    await db.exec(`CREATE VIEW ${schema}."${name}" AS SELECT ${cols.join(", ")} FROM public.${table}`);
    ns.views.push(name);
  }
  await db.exec(`SET search_path TO ${schema}, public`);
}

/** The datasets an expression's aggregates read, by company name. */
function datasetsRead(expr: string, ns: Namespace): string[] {
  const out = new Set<string>();
  for (const m of expr.matchAll(DATASET_REF)) if (ns.meta[m[1]]) out.add(m[1]);
  return [...out];
}

/** Why an expression cannot run on the namespace, before trying. */
function unrunnable(expr: string, ns: Namespace): string | undefined {
  for (const m of expr.matchAll(DATASET_REF)) {
    const [ref, ds] = m;
    if (!ns.meta[ds]) return `it reads \`${ref}\` and \`${ds}\` is not a dataset your mapping covers`;
    if (!ns.fields[ref]) return `it reads \`${ref}\`, which your mapping does not tie to a GASP field, so the synthetic dataset has no column for it`;
    if (!ns.date[ds]) return `it reads \`${ds}\`, whose time field \`${ns.meta[ds].date}\` is not mapped, so its rows cannot be placed in a period`;
  }
  return undefined;
}

// ── explaining a difference ──────────────────────────────────────────────────

const STAGED_WHY: Record<string, string> = {
  cohort: "canonical is a cohort metric: it fixes the population at period start (the customers active then) and reads their opening values from the snapshot, which one expression over the period's rows cannot state",
  lag: "canonical reads the previous period's value (lag), so it needs two periods of rows",
  "at period_start": "canonical reads an opening value at period start beside the period's rows",
  window: "canonical reads a trailing window of rows ending at period end, not the period's rows",
  all_time: "canonical reads rows outside the period, bounded by another field on the row",
  to_date: "canonical is cumulative to period end",
  "period bound in filter": "canonical binds the period to a business date on the row inside a filter, not to the dataset's time field",
  "period bound": "canonical binds the period to a business date on the row, not to the dataset's time field",
  period_days: "canonical uses the period's length in days",
  "distinct pair": "canonical counts distinct pairs of fields",
  bucket: "canonical is a bucketed breakdown",
  total: "canonical is a share of a total across the breakdown",
};

/** The enum literals an expression compares a field with, by company `dataset.field`. */
function literalFilters(expr: string): Record<string, { include: Set<string>; exclude: Set<string> }> {
  const out: Record<string, { include: Set<string>; exclude: Set<string> }> = {};
  const at = (ref: string) => (out[ref] ??= { include: new Set(), exclude: new Set() });
  for (const m of expr.matchAll(/\b([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*(=|!=|<>)\s*'([^']*)'/gi)) (m[2] === "=" ? at(m[1]).include : at(m[1]).exclude).add(m[3]);
  for (const m of expr.matchAll(/\b([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s+(NOT\s+)?IN\s*\(([^)]*)\)/gi)) {
    const values = [...m[3].matchAll(/'([^']*)'/g)].map((v) => v[1]);
    for (const v of values) (m[2] ? at(m[1]).exclude : at(m[1]).include).add(v);
  }
  return out;
}

const list = (xs: Iterable<string>): string => [...xs].map((x) => `'${x}'`).join(", ");

/** Filters one side applies and the other does not, in GASP field terms. */
function filterCauses(yours: string, canonical: EnumFilter[], ns: Namespace, fields: Record<string, OntologyField>): string[] {
  const mine = literalFilters(yours);
  const mineByField: Record<string, { ref: string; include: Set<string>; exclude: Set<string> }> = {};
  for (const [ref, f] of Object.entries(mine)) {
    const g = ns.fields[ref];
    if (g) mineByField[g.field] = { ref, ...f };
  }
  const causes: string[] = [];
  for (const c of canonical) {
    const m = mineByField[c.field];
    const canon = `${c.include.length ? `keeps ${c.field} in (${list(c.include)})` : ""}${c.include.length && c.exclude.length ? " and " : ""}${c.exclude.length ? `leaves out ${c.field} in (${list(c.exclude)})` : ""}`;
    if (!m) { causes.push(`canonical ${canon}; yours applies no filter on it`); continue; }
    const sameSet = (a: string[], b: Set<string>) => a.length === b.size && a.every((x) => b.has(x));
    if (!sameSet(c.include, m.include) || !sameSet(c.exclude, m.exclude)) {
      const yoursText = `${m.include.size ? `keeps ${m.ref} in (${list(m.include)})` : ""}${m.include.size && m.exclude.size ? " and " : ""}${m.exclude.size ? `leaves out ${m.ref} in (${list(m.exclude)})` : ""}`;
      causes.push(`canonical ${canon}; yours ${yoursText}`);
    }
  }
  const canonicalFields = new Set(canonical.map((c) => c.field));
  for (const [field, m] of Object.entries(mineByField)) {
    if (canonicalFields.has(field)) continue;
    if (fields[field]?.type !== "enum") continue;
    causes.push(`yours ${m.include.size ? `keeps ${m.ref} in (${list(m.include)})` : `leaves out ${m.ref} in (${list(m.exclude)})`}; canonical applies no filter on ${field}`);
  }
  return causes;
}

/** Each aggregate call of an expression run alone for the period, as (call, value). */
async function aggregateValues(db: Engine, expr: string, ns: Namespace, period: Period, fields: Record<string, OntologyField>): Promise<Array<{ call: string; value: number | null }>> {
  const out: Array<{ call: string; value: number | null }> = [];
  for (const span of guardedSpans(expr)) {
    const call = expr.slice(span.start, span.end);
    try {
      out.push({ call, value: await value(db, `SELECT ${toPostgres(directQuery(call, ns.meta, fields, period, physicalOf(ns)))}`) });
    } catch { /* an aggregate that cannot run alone adds nothing */ }
  }
  return out;
}

const fmt = (v: number | null): string => (v === null ? "null" : Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 10 ? 4 : 2));

// ── scoring ──────────────────────────────────────────────────────────────────

export interface DriftOptions {
  /** Explicit company → GASP pairs */
  matches?: Record<string, string>;
  /** Company metric names to score; every metric when omitted */
  only?: Set<string>;
  periods?: Period[];
  /** An engine holding the synthetic dataset (loadDriftData); the shared PGlite when omitted */
  engine?: Engine;
}

let calls = 0;

/** Score a company's metrics against GASP's on the synthetic dataset. */
export async function scoreDrift(company: Company, metrics: OssieMetric[], data: StandardData, opts: DriftOptions = {}): Promise<DriftResult | { error: string }> {
  const periods = opts.periods ?? DRIFT_PERIODS;
  const own = metrics.filter((m) => !isGaspMetric(m) && (!opts.only || opts.only.has(m.name)));
  if (!own.length) return { error: opts.only ? `None of the named metrics is in the document${metrics.length ? ` (it has: ${metrics.map((m) => m.name).join(", ")})` : ""}.` : "The document has no metrics of your own to score (gasp_ metrics an earlier compile wrote are skipped)." };
  const { matched, review, errors } = matchMetrics(own, data, opts.matches);
  if (errors.length) return { error: errors.join("\n") };
  const only = new Set(matched.map((m) => m.key.split(":")[0]));
  const ns = namespace(company, data, only);
  if ("error" in ns) return ns;
  const fields = Object.fromEntries(data.ontology!.fields!.map((f) => [f.id, f]));
  const engine = opts.engine ?? (await syntheticEngine(data));
  const base = { company, periods, matched, review, problems: [...company.problems, ...ns.notes] };
  if (!engine) {
    return { ...base, engine: "none", scores: [], counts: { metrics: own.length, matched: matched.length, agrees: 0, differs: 0, notRunnable: 0, notCompiled: 0, review: review.length } };
  }

  const filterCtx = { fields, formulas: data.formulas ?? {} };
  const run = async (): Promise<DriftScore[]> => {
    const schema = `drift_${++calls}`;
    await createViews(engine, schema, ns, company);
    try {
      const scores: DriftScore[] = [];
      for (const m of matched) {
        const yours = exprOf(m.metric);
        const label = `${m.gasp.name}${m.variant ? ` (${m.variant})` : ""}`;
        const score: DriftScore = { name: m.metric.name, gasp: label, key: m.key, how: m.how, status: "agrees", yours, periods: [], differing: 0, causes: [] };
        scores.push(score);
        const cov: MetricCoverage | undefined = ns.compiled.coverage[m.key];
        if (!cov || cov.kind === "unmapped" || cov.kind === "notComputable") {
          score.status = "not compiled";
          score.error = !cov ? `GASP has no entry \`${m.key}\`` : cov.kind === "unmapped" ? `the canonical metric reads pairs your mapping lacks: \`${cov.missing.join("`, `")}\`` : `the canonical metric is not computable: ${cov.reason}`;
          continue;
        }
        score.canonicalKind = cov.kind;
        const canonical = cov.kind === "direct"
          ? exprOf(ns.compiled.model.metrics!.find((x) => x.name === cov.ossieName)!)
          : ns.compiled.model.datasets.find((d) => d.name === cov.stagedDataset)!.source;
        score.canonical = canonical;
        if (cov.kind === "staged") score.stagedReason = cov.reason;
        const why = unrunnable(yours, ns);
        if (why) { score.status = "not runnable"; score.error = `yours cannot run on the synthetic dataset: ${why}`; continue; }
        const physical = physicalOf(ns);
        try {
          for (const period of periods) {
            const mine = await value(engine, `SELECT ${toPostgres(directQuery(yours, ns.meta, fields, period, physical))}`);
            const theirs = await value(engine, `SELECT ${toPostgres(cov.kind === "direct" ? directQuery(canonical, ns.meta, fields, period, physical) : stagedQuery(canonical, period))}`);
            score.periods.push({ period, yours: mine, canonical: theirs });
          }
        } catch (e) {
          score.status = "not runnable";
          score.error = `yours cannot run on the synthetic dataset: ${(e as Error).message.split("\n")[0]}`;
          score.periods = [];
          continue;
        }
        const differing = score.periods.filter((p) => !same(p.yours, p.canonical));
        score.differing = differing.length;
        if (!differing.length) continue;
        score.status = "differs";
        // The period with the largest relative difference; one where both sides have a value comes before one where a side is null.
        const worst = differing.map((p) => ({ ...p, relative: relative(p.yours, p.canonical) })).sort((a, b) => (Number.isFinite(b.relative) ? b.relative : -1) - (Number.isFinite(a.relative) ? a.relative : -1))[0];
        score.worst = worst;
        // Causes, most specific first. A null on one side only is a semantics difference, not a formula one; say so before reading anything into it.
        const both = score.periods.filter((p) => p.yours !== null && p.canonical !== null);
        const whenBoth = both.length ? `; in the ${both.length} period${both.length === 1 ? "" : "s"} where both sides have a value they ${both.every((p) => same(p.yours, p.canonical)) ? "agree" : "differ"}` : "";
        const mineNull = differing.filter((p) => p.yours === null && p.canonical !== null).length;
        if (mineNull) score.causes.push(`yours is null in ${mineNull} of ${score.periods.length} periods where canonical has a value: a sum over no matching rows is NULL in SQL, and GASP compiles sum() as COALESCE(SUM(...), 0), so a period with no event of a type the formula sums gives 0${whenBoth}`);
        const theirNull = differing.filter((p) => p.canonical === null && p.yours !== null).length;
        if (theirNull) score.causes.push(`canonical is null in ${theirNull} of ${score.periods.length} periods where yours has a value: an average, extreme or percentile over no matching rows, or a ratio over a zero denominator, is NULL in the compiled SQL${whenBoth}`);
        if (cov.kind === "staged") score.causes.push(STAGED_WHY[cov.reason] ?? `canonical needs a construct the expression language cannot state (${cov.reason})`);
        const f = data.formulas?.[m.key.split(":")[0]];
        const src = f ? formulaSource(f, m.variant) : undefined;
        if (src) score.causes.push(...filterCauses(yours, enumFilters(src, filterCtx), ns, fields));
        if (cov.kind === "direct") {
          const mineDs = datasetsRead(yours, ns);
          const theirDs = datasetsRead(canonical, ns);
          const onlyMine = mineDs.filter((d) => !theirDs.includes(d));
          const onlyTheirs = theirDs.filter((d) => !mineDs.includes(d));
          if (onlyMine.length || onlyTheirs.length) score.causes.push(`${onlyTheirs.length ? `canonical reads ${onlyTheirs.map((d) => `\`${d}\``).join(", ")}` : "canonical reads no dataset"} that yours does not${onlyMine.length ? `; yours reads ${onlyMine.map((d) => `\`${d}\``).join(", ")} that canonical does not` : ""}`);
          const mineAgg = await aggregateValues(engine, yours, ns, worst.period, fields);
          const theirAgg = await aggregateValues(engine, canonical, ns, worst.period, fields);
          const unpaired = theirAgg.filter((t) => !mineAgg.some((x) => same(x.value, t.value)));
          const spare = mineAgg.filter((x) => !theirAgg.some((t) => same(x.value, t.value)));
          for (const u of unpaired) score.causes.push(`canonical aggregate \`${u.call}\` = ${fmt(u.value)} in ${periodLabel(worst.period)} has no equal among yours${spare.length ? ` (yours: ${spare.map((s) => `\`${s.call}\` = ${fmt(s.value)}`).join(", ")})` : ""}`);
        }
        if (!score.causes.length) score.causes.push("the values differ and no single cause stands out; compare the two expressions");
      }
      return scores;
    } finally {
      await engine.exec(`SET search_path TO public; DROP SCHEMA ${schema} CASCADE`);
    }
  };
  const scores = await serial(run);
  const counts = {
    metrics: own.length,
    matched: matched.length,
    agrees: scores.filter((s) => s.status === "agrees").length,
    differs: scores.filter((s) => s.status === "differs").length,
    notRunnable: scores.filter((s) => s.status === "not runnable").length,
    notCompiled: scores.filter((s) => s.status === "not compiled").length,
    review: review.length,
  };
  return { ...base, engine: "pglite", scores, counts };
}

// ── the report ───────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const periodLabel = (p: Period): string => `${MONTHS[Number(p.start.slice(5, 7)) - 1]} ${p.start.slice(0, 4)}`;

const pct = (r: number): string => (!Number.isFinite(r) ? "one side is null" : `${(r * 100).toFixed(r < 0.1 ? 2 : 1)}%`);

export function formatDriftReport(r: DriftResult): string {
  const org = r.company.adapter.organization || "unnamed";
  const p: string[] = [`# GASP drift: ${org}`, ""];
  p.push(`**Mapping:** ${r.company.format === "v1" ? "GASP adapter, converted on load; your metrics are read over the model synthesised from its tables and columns." : r.company.modelProvided ? `Ossie mapping with your semantic model \`${r.company.model.name}\`.` : "Ossie mapping without a semantic model; dataset and field names were taken from its expressions."}`);
  p.push(`**Dataset:** the GASP synthetic SaaS dataset (about twenty customers, ${r.periods[0].start} to ${r.periods[r.periods.length - 1].end}), ${r.periods.length} monthly periods${r.engine === "pglite" ? ", run on PGlite in process" : ""}. Each of your metrics runs over views named as your datasets and fields, filled through your mapping; the canonical metric is compiled into the same names (as compile_model does) and runs beside it.`);
  const how = (k: DriftMatch["how"]) => r.matched.filter((m) => m.how === k).length;
  const c = r.counts;
  p.push(`**Matched:** ${c.matched} of ${c.metrics} metrics (${[how("name") ? `${how("name")} by name` : "", how("synonym") ? `${how("synonym")} by synonym` : "", how("matches") ? `${how("matches")} by your matches` : ""].filter(Boolean).join(", ") || "none"}); ${c.review} to review.`);
  if (r.engine === "none") {
    p.push("**Engine:** PGlite is not installed beside the server, so nothing was run. Install `@electric-sql/pglite` next to `gasp-standard-mcp` and call again.");
    for (const x of r.problems) p.push(`- Mapping: ${x}`);
    return p.join("\n");
  }
  p.push(`**Drift:** ${c.differs} differ${c.differs === 1 ? "s" : ""}, ${c.agrees} agree${c.agrees === 1 ? "s" : ""}${c.notRunnable ? `, ${c.notRunnable} could not run` : ""}${c.notCompiled ? `, ${c.notCompiled} not compiled` : ""}.`);
  for (const x of r.problems) p.push(`- Mapping: ${x}`);
  p.push("");

  const by = (s: DriftScore["status"]) => r.scores.filter((x) => x.status === s);
  const differs = by("differs");
  if (differs.length) {
    p.push(`## Differs (${differs.length})`, "");
    for (const s of differs) {
      const w = s.worst!;
      p.push(`### ${s.name} → ${s.gasp}`);
      p.push(`Largest difference in ${periodLabel(w.period)}: yours ${fmt(w.yours)}, canonical ${fmt(w.canonical)} (${pct(w.relative)}). Differs in ${s.differing} of ${s.periods.length} periods.`);
      p.push(`Likely cause${s.causes.length === 1 ? "" : "s"}:`);
      for (const cause of s.causes) p.push(`- ${cause}`);
      p.push(`Yours: \`${s.yours}\``);
      p.push(s.canonicalKind === "direct" ? `Canonical: \`${s.canonical}\`` : `Canonical: staged (${s.stagedReason}); its source is the compiled query over your tables, as compile_model writes it.`);
      p.push("", "| Period | Yours | Canonical |", "|---|---|---|");
      for (const pv of s.periods) p.push(`| ${periodLabel(pv.period)} | ${fmt(pv.yours)} | ${fmt(pv.canonical)}${same(pv.yours, pv.canonical) ? "" : " ≠"} |`);
      p.push("");
    }
  }
  const agrees = by("agrees");
  if (agrees.length) {
    p.push(`## Agrees (${agrees.length})`);
    for (const s of agrees) p.push(`- ${s.name} → ${s.gasp}: equal in all ${s.periods.length} periods`);
    p.push("");
  }
  const notRun = [...by("not runnable"), ...by("not compiled")];
  if (notRun.length) {
    p.push(`## Not scored (${notRun.length})`);
    for (const s of notRun) p.push(`- ${s.name} → ${s.gasp}: ${s.error}`);
    p.push("");
  }
  if (r.review.length) {
    p.push(`## Review (${r.review.length})`, "No GASP metric by that name or synonym; nothing is scored on a guess. Pass `matches` (\"your_metric=GASP name\") to score one.");
    for (const v of r.review) p.push(`- ${v.name}: ${v.suggestions.length ? `closest ${v.suggestions.map((s) => `${s.name} (${s.score.toFixed(2)})`).join(", ")}` : "no close names"}`);
    p.push("");
  }
  return p.join("\n").trimEnd();
}

// ── the tool ─────────────────────────────────────────────────────────────────

/** The company's own metrics from a semantic model document, or any document carrying a `metrics` list. */
export function companyMetrics(text: string | undefined): { metrics?: OssieMetric[]; error?: string } {
  if (!text?.trim()) return { error: "Pass semantic_model: your Ossie semantic model (YAML or JSON) holding the metrics to score; with a GASP adapter as the mapping, any document with a metrics list will do." };
  const doc = parseDocument(text);
  if (!doc.doc) return { error: `Invalid semantic model. ${doc.error}` };
  const metrics = doc.doc.metrics;
  if (!Array.isArray(metrics)) return { error: "The semantic model has no metrics list." };
  const bad = metrics.findIndex((m) => !m || typeof m !== "object" || typeof (m as OssieMetric).name !== "string" || !(m as OssieMetric).expression?.dialects?.length);
  if (bad >= 0) return { error: `metrics[${bad}] needs a name and an expression with at least one dialect.` };
  return { metrics: metrics as OssieMetric[] };
}

/** The score_drift tool: the report (or the result as JSON) for a mapping and metrics given as text. */
export async function scoreDriftFromText(documentText: string, modelText: string | undefined, data: StandardData, opts: { matches?: string; metrics?: string; output?: "report" | "json"; engine?: Engine } = {}): Promise<string> {
  const company = resolveCompany(documentText, modelText, data);
  if ("error" in company) return company.error;
  const own = companyMetrics(modelText);
  if (!own.metrics) return own.error!;
  const only = opts.metrics?.trim() ? new Set(opts.metrics.split(",").map((s) => s.trim()).filter(Boolean)) : undefined;
  const r = await scoreDrift(company, own.metrics, data, { matches: parseMatches(opts.matches), only, engine: opts.engine });
  if ("error" in r) return r.error;
  if (opts.output === "json") {
    const { company: _c, ...rest } = r;
    return JSON.stringify({ organization: company.adapter.organization, format: company.format, ...rest, matched: rest.matched.map((m) => ({ metric: m.metric.name, key: m.key, gasp: m.gasp.name, how: m.how })) }, null, 2);
  }
  return formatDriftReport(r);
}
