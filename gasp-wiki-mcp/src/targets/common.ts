/**
 * The neutral target model the compile targets write from (docs/compile-targets-spike.md).
 *
 * A company's compiled model (ossie/company.ts) holds every dataset with its
 * source, every field with its column expression, every staged dataset with its
 * source in the warehouse dialect and every GASP metric in OSSIE_SQL_2026. A
 * semantic-layer engine wants the same things in its own shape and its
 * warehouse's SQL, so this module restates the compiled model once:
 *
 *   tables         every dataset of the compiled model (the company's, the period
 *                  spine and the staged ones), each field with a role (time, key,
 *                  dimension or fact) the writers sort into their own sections
 *   metrics        every direct or staged GASP metric: a direct one re-emitted in
 *                  the target dialect (metrics.ts with `dialect` set, so a filter
 *                  is a CASE inside the aggregate), a staged one as SUM(<staged>.value)
 *   relationships  the model's own, plus the joins GASP declares between the
 *                  datasets the mapping covers (model.ts relationshipsOf), in the
 *                  company's dataset and field names
 *
 * The writers (snowflake.ts, cube.ts) are shape transforms over this model.
 */
import type { DialectName } from "../dialect.js";
import { OSSIE_DIALECT_OF } from "../dialect.js";
import { isMetricStub, metricFormulaId } from "../loader.js";
import { metricUrl, SITE } from "../urls.js";
import type { Metric, StandardData } from "../types.js";
import { companyTarget, fieldSql, isGaspMetric, type CompiledModel } from "../ossie/company.js";
import { directExpressionFor, type EmitContext } from "../ossie/metrics.js";
import { relationshipsOf } from "../ossie/model.js";
import { readGaspExtension, type OssieAIContext, type OssieDataType, type OssieDataset, type OssieExtension, type OssieRelationship } from "../ossie/types.js";

export type FieldRole = "time" | "key" | "dimension" | "fact";

export interface TargetField {
  name: string;
  /** The company's column expression in the target dialect */
  sql: string;
  role: FieldRole;
  datatype: OssieDataType;
  description?: string;
  /** The GASP field's declared values, for an enum field */
  enumValues?: string[];
}

export type TargetSource =
  | { kind: "table"; parts: string[] }
  | { kind: "query"; sql: string; sqlByDialect?: Partial<Record<DialectName, string>> };

export interface TargetTable {
  /** The compiled model's dataset name: the GASP dataset id for a v1 adapter, a gasp_staged_ name for a staged dataset */
  name: string;
  source: TargetSource;
  primaryKey: string[];
  description?: string;
  fields: TargetField[];
  /** Set on a staged dataset: the metric it holds and why it is staged */
  staged?: { for: string; reason: string };
  /** Set on the period spine dataset */
  spine?: boolean;
}

export interface TargetMetric {
  /** The compiled model's metric name (gasp_mrr, gasp_nrr_o) */
  name: string;
  gaspId: string;
  label: string;
  url: string;
  /** The expression in the target dialect over `<table>.<field>` references */
  sql: string;
  /** The tables the expression reads, in order of first appearance */
  datasets: string[];
  /** The staged table a staged metric reads */
  staged?: string;
  description?: string;
  synonyms?: string[];
  /** The compiled model's coverage key: formula id plus `:O`, `:M` or `:variant` */
  coverageKey: string;
}

export interface TargetRelationship {
  name: string;
  from: string;
  to: string;
  from_columns: string[];
  to_columns: string[];
}

export interface TargetModel {
  name: string;
  description: string;
  dialect: DialectName;
  tables: TargetTable[];
  metrics: TargetMetric[];
  relationships: TargetRelationship[];
}

const IDENTIFIER = /^[A-Za-z_][\w$]*(\.[A-Za-z_][\w$]*)*$/;
const TIME_TYPES = new Set<OssieDataType>(["Date", "DateTime", "DateTimeTz"]);
const NUMERIC_TYPES = new Set<OssieDataType>(["Integer", "Decimal", "Float"]);
const ext = (x: { custom_extensions?: OssieExtension[] }): Record<string, unknown> => readGaspExtension(x.custom_extensions) ?? {};
const FORM_LABEL: Record<string, string> = { O: "Operating form", M: "Market form" };

/** True when a column expression is a bare (optionally dotted) identifier, so a writer can qualify it. */
export const isIdentifier = (sql: string): boolean => IDENTIFIER.test(sql.trim());

/** A field's role: the time dimension and any date first, then keys, then numbers as facts, the rest as dimensions. */
export function fieldRole(name: string, datatype: OssieDataType, isTime: boolean, primaryKey: string[]): FieldRole {
  if (isTime || TIME_TYPES.has(datatype)) return "time";
  if (primaryKey.includes(name) || name.endsWith("_id")) return "key";
  if (NUMERIC_TYPES.has(datatype)) return "fact";
  return "dimension";
}

/** A dataset source as table parts, or a query. */
export function sourceOf(source: string): TargetSource {
  const s = source.trim();
  return IDENTIFIER.test(s) ? { kind: "table", parts: s.split(".") } : { kind: "query", sql: s };
}

/** Formula id → the metric record that owns it. */
function owners(data: StandardData): Map<string, Metric> {
  const out = new Map<string, Metric>();
  for (const m of data.metrics) {
    if (isMetricStub(m)) continue;
    const id = metricFormulaId(data, m);
    if (!out.has(id)) out.set(id, m);
  }
  return out;
}

/** The tables an expression reads, in order of first appearance. */
export function tablesIn(sql: string, tables: Set<string>): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(/\b([A-Za-z_][\w$]*)\.[A-Za-z_]/g)) if (tables.has(m[1]) && !out.includes(m[1])) out.push(m[1]);
  return out;
}

/**
 * The joins GASP declares between the datasets the mapping covers, in the
 * company's names; a join whose columns are not all mapped on one dataset each
 * is left out.
 */
function derivedRelationships(r: CompiledModel, data: StandardData): TargetRelationship[] {
  const refs = r.company.refs;
  const gaspDatasets = data.ontology?.datasets ?? {};
  const mapped = Object.fromEntries(Object.entries(gaspDatasets).filter(([id]) => refs[id] && Object.keys(refs[id]).length));
  const out: TargetRelationship[] = [];
  for (const rel of relationshipsOf(mapped, data.ontology?.fields ?? [])) {
    const from = rel.from_columns.map((c) => refs[rel.from]?.[c]);
    const to = rel.to_columns.map((c) => refs[rel.to]?.[c]);
    if (from.some((x) => !x) || to.some((x) => !x)) continue;
    const fromDs = new Set(from.map((x) => x!.dataset));
    const toDs = new Set(to.map((x) => x!.dataset));
    if (fromDs.size !== 1 || toDs.size !== 1) continue;
    out.push({ name: rel.name, from: from[0]!.dataset, to: to[0]!.dataset, from_columns: from.map((x) => x!.field), to_columns: to.map((x) => x!.field) });
  }
  return out;
}

function tableOf(d: OssieDataset, r: CompiledModel, enumOf: Map<string, string[]>): TargetTable {
  const e = ext(d);
  const primaryKey = d.primary_key ?? [];
  const fields: TargetField[] = (d.fields ?? []).map((f) => {
    const datatype = f.datatype ?? "String";
    const values = enumOf.get(`${d.name}.${f.name}`);
    return {
      name: f.name,
      sql: fieldSql(f, r.dialect).trim(),
      role: fieldRole(f.name, datatype, f.dimension?.is_time === true, primaryKey),
      datatype,
      ...(f.description ? { description: f.description } : {}),
      ...(values?.length ? { enumValues: values } : {}),
    };
  });
  let source = sourceOf(d.source);
  if (e.staged === true) {
    // The staged source is written in the compile dialect; any others ride in the extension.
    const byDialect: Partial<Record<DialectName, string>> = { [r.dialect]: d.source };
    const others = (e.sources ?? {}) as Record<string, string>;
    for (const [name, ossie] of Object.entries(OSSIE_DIALECT_OF)) if (others[ossie]) byDialect[name as DialectName] = others[ossie];
    source = { kind: "query", sql: d.source, sqlByDialect: byDialect };
  }
  return {
    name: d.name,
    source,
    primaryKey,
    ...(d.description ? { description: d.description } : {}),
    fields,
    ...(e.staged === true ? { staged: { for: String(e.for ?? ""), reason: String(e.reason ?? "") } } : {}),
    ...(e.period_spine === true ? { spine: true } : {}),
  };
}

/** The compiled model as the neutral target model, every direct metric re-emitted in the compile dialect. */
export function targetModel(r: CompiledModel, data: StandardData): TargetModel {
  const ont = data.ontology;
  if (!ont?.fields || !ont.datasets || !data.formulas) throw new Error("Standard data has no fields, datasets or formulas");
  const fieldById = new Map(ont.fields.map((f) => [f.id, f]));
  // Model field → the GASP field's declared values, through the mapping's references.
  const enumOf = new Map<string, string[]>();
  for (const [, byField] of Object.entries(r.company.refs)) {
    for (const [gf, ref] of Object.entries(byField)) {
      const f = fieldById.get(gf);
      if (f?.type === "enum" && f.values?.length) enumOf.set(`${ref.dataset}.${ref.field}`, f.values);
    }
  }
  const tables = r.model.datasets.map((d) => tableOf(d, r, enumOf));
  const tableNames = new Set(tables.map((t) => t.name));

  const ctx: EmitContext = {
    fields: Object.fromEntries(ont.fields.map((f) => [f.id, f])),
    datasets: ont.datasets,
    formulas: data.formulas,
    ref: companyTarget(r.company, r.dialect, r.spine, data).ref,
  };
  const keyOf = new Map<string, string>();
  for (const [key, c] of Object.entries(r.coverage)) if (c.kind === "direct" || c.kind === "staged") keyOf.set(c.ossieName, key);
  const label = owners(data);

  const metrics: TargetMetric[] = [];
  for (const m of r.model.metrics ?? []) {
    if (!isGaspMetric(m)) continue;
    const key = keyOf.get(m.name);
    const cov = key ? r.coverage[key] : undefined;
    if (!key || !cov) continue;
    const [id, variant] = key.split(":");
    let sql: string;
    let staged: string | undefined;
    if (cov.kind === "direct") {
      const x = directExpressionFor(id, ctx, r.dialect, variant);
      if (!x) throw new Error(`${key} compiled direct but does not emit directly in ${r.dialect}`);
      sql = x;
    } else if (cov.kind === "staged") {
      staged = cov.stagedDataset;
      sql = `SUM(${staged}.value)`;
    } else continue;
    const owner = label.get(id);
    const qualifier = variant ? ` (${FORM_LABEL[variant] ?? variant})` : "";
    const ai = (typeof m.ai_context === "object" ? m.ai_context : undefined) as OssieAIContext | undefined;
    metrics.push({
      name: m.name,
      gaspId: id,
      label: `${owner?.name ?? id}${qualifier}`,
      url: owner ? metricUrl(owner) : `${SITE}/v1/metrics`,
      sql,
      datasets: tablesIn(sql, tableNames),
      ...(staged ? { staged } : {}),
      ...(m.description ? { description: m.description } : {}),
      ...(ai?.synonyms?.length ? { synonyms: ai.synonyms } : {}),
      coverageKey: key,
    });
  }

  // The model's own relationships first; GASP's fill in the dataset pairs the model leaves unjoined.
  const own: TargetRelationship[] = (r.model.relationships ?? []).map((x: OssieRelationship) => ({ name: x.name, from: x.from, to: x.to, from_columns: x.from_columns, to_columns: x.to_columns }));
  const pairs = new Set(own.map((x) => `${x.from}>${x.to}`));
  const relationships = [...own, ...derivedRelationships(r, data).filter((x) => tableNames.has(x.from) && tableNames.has(x.to) && !pairs.has(`${x.from}>${x.to}`))];

  return { name: r.model.name, description: r.model.description ?? "", dialect: r.dialect, tables, metrics, relationships };
}

/** A name safe as a file or object name: lower case, underscores. */
export const slugName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "model";
