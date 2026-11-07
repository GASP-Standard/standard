/**
 * The metric compiler into a company's Apache Ossie model (docs/ossie-interop-spec.md,
 * "Metric compiler"): every GASP metric whose fields the company's mapping
 * covers, written into their semantic model as a `gasp_` metric. A metric the
 * expression language can state is a direct expression over their datasets
 * and fields; the rest are staged through a per-period dataset whose source is
 * the compiled SQL over their tables, in their warehouse dialect.
 *
 * The mapping comes in either format (adapt.ts): a v1 adapter compiles into
 * the model synthesised from its tables and columns, an Ossie mapping into the
 * model it names. The output is their model with the GASP metrics and staged
 * datasets added (any from an earlier compile replaced, so a recompile is
 * idempotent), plus a coverage record saying what was left out and why.
 */
import { metricFormulaId, isMetricStub } from "../loader.js";
import { chooseDialect, resolveMetric } from "../tools.js";
import { OSSIE_DIALECT_OF, type DialectName } from "../dialect.js";
import type { Metric, StandardData } from "../types.js";
import { expressionText, ossieSchemaErrors, resolveCompany, type Company, type ModelRefs } from "./adapt.js";
import { checkCompiledMetrics } from "./check.js";
import { buildMetrics, PERIOD_SPINE, type ModelTarget } from "./model.js";
import { ossieYaml } from "./index.js";
import { GASP_VENDOR, OSSIE_DIALECT, portable, type MetricCoverage, type OssieDataset, type OssieExtension, type OssieField, type OssieMetric, type OssieSemanticModel, readGaspExtension } from "./types.js";

/** The dataset that declares the period spine the staged sources read. */
export const SPINE_DATASET = "gasp_period_spine";

export interface CompileOptions {
  /** SQL dialect of the staged sources; the adapter's warehouse, else postgres, when omitted */
  dialect?: string;
  /** Formula ids to compile; every formula when omitted */
  only?: Set<string>;
  /** FROM text of the period spine table; gasp.period_spine when omitted */
  spine?: string;
}

export interface CompiledModel {
  company: Company;
  /** The company's model with the GASP metrics and staged datasets added */
  model: OssieSemanticModel;
  /** Formula id (plus `:O`, `:M` or `:variant`) → how it compiled */
  coverage: Record<string, MetricCoverage>;
  dialect: DialectName;
  dialectNote: string;
  spine: string;
  counts: { direct: number; staged: number; unmapped: number; notComputable: number };
  /** The compiled metrics checked in place: the bundled Ossie model schema and GASP's reference checks */
  problems: string[];
}

const IDENTIFIER = /^[A-Za-z_][\w$]*(\.[A-Za-z_][\w$]*)*$/;
const ext = (x: { custom_extensions?: OssieExtension[] }): Record<string, unknown> => readGaspExtension(x.custom_extensions) ?? {};
/** A metric an earlier compile wrote: it carries the GASP extension or the gasp_ prefix. */
export const isGaspMetric = (m: OssieMetric): boolean => ext(m).gasp_id !== undefined || m.name.startsWith("gasp_");
const isGaspDataset = (d: OssieDataset): boolean => ext(d).staged === true || d.name.startsWith("gasp_staged_") || d.name === SPINE_DATASET;

/** A model field's SQL in the compile dialect: its entry for that dialect, else the portable one, else the first. */
export function fieldSql(f: OssieField, dialect: DialectName): string {
  const vendor = f.expression?.dialects?.find((d) => d.dialect === OSSIE_DIALECT_OF[dialect]);
  return vendor?.expression ?? expressionText(f) ?? f.name;
}

/** The target a company's model is for buildMetrics: its datasets, sources and field expressions behind the GASP names. */
export function companyTarget(company: Company, dialect: DialectName, spine: string, data: StandardData): ModelTarget {
  const refs: ModelRefs = company.refs;
  const byName = new Map(company.model.datasets.map((d) => [d.name, d]));
  const gaspDatasets = data.ontology?.datasets ?? {};
  const modelDataset = (ds: string): OssieDataset | undefined => {
    const name = refs[ds]?.[gaspDatasets[ds]?.key]?.dataset ?? Object.values(refs[ds] ?? {})[0]?.dataset;
    return name ? byName.get(name) ?? { name, source: name } : undefined;
  };
  return {
    ref: (ds, f) => { const r = refs[ds]?.[f]; return r ? `${r.dataset}.${r.field}` : `${ds}.${f}`; },
    table: (ds) => {
      const d = modelDataset(ds);
      if (!d) return ds;
      const source = d.source.trim();
      return IDENTIFIER.test(source) ? source : `(${source}) AS _${d.name}`;
    },
    column: (ds, f) => {
      const r = refs[ds]?.[f];
      if (!r) return f;
      const field = byName.get(r.dataset)?.fields?.find((x) => x.name === r.field);
      const sql = field ? fieldSql(field, dialect).trim() : r.field;
      return IDENTIFIER.test(sql) ? sql : `(${sql})`;
    },
    spine,
    dialects: { primary: dialect, others: [] },
    missing: (placeholders) => placeholders.filter((p) => { const i = p.indexOf("@"); return !refs[p.slice(i + 1)]?.[p.slice(0, i)]; }),
  };
}

const spineDataset = (spine: string): OssieDataset => ({
  name: SPINE_DATASET,
  source: spine,
  description: "Reporting periods for the staged GASP metrics: one row per period, provided by the adopter. Every staged dataset reads it.",
  primary_key: ["period_start"],
  fields: [
    { name: "period_start", expression: portable("period_start"), dimension: { is_time: true }, datatype: "Date", description: "First day of the reporting period" },
    { name: "period_end", expression: portable("period_end"), datatype: "Date", description: "Last day of the reporting period" },
  ],
  custom_extensions: [{ vendor_name: GASP_VENDOR, data: JSON.stringify({ period_spine: true }) }],
});

/** Compile the GASP metrics the company's mapping covers into its model. */
export function compileModel(company: Company, data: StandardData, opts: CompileOptions = {}): CompiledModel | { error: string } {
  const chosen = chooseDialect(opts.dialect, company.adapter.warehouse);
  if ("error" in chosen) return { error: chosen.error };
  const spine = opts.spine?.trim() || PERIOD_SPINE;
  const target = companyTarget(company, chosen.dialect, spine, data);
  const { metrics, staged, coverage } = buildMetrics(data, target, opts.only ? (id) => opts.only!.has(id) : undefined);
  const counts = { direct: 0, staged: 0, unmapped: 0, notComputable: 0 };
  for (const c of Object.values(coverage)) counts[c.kind]++;

  const base = company.model;
  const datasets = [...base.datasets.filter((d) => !isGaspDataset(d)), ...(staged.length ? [spineDataset(spine)] : []), ...staged];
  const kept = (base.metrics ?? []).filter((m) => !isGaspMetric(m));
  const compiled: OssieExtension = {
    vendor_name: GASP_VENDOR,
    data: JSON.stringify({ compiled: { gasp_version: "1", dialect: OSSIE_DIALECT_OF[chosen.dialect], period_spine: spine, metrics: metrics.length, staged: staged.length } }),
  };
  const model: OssieSemanticModel = {
    ...base,
    datasets,
    ...(base.relationships ? { relationships: base.relationships } : {}),
    metrics: [...kept, ...metrics],
    custom_extensions: [...(base.custom_extensions ?? []).filter((e) => e.vendor_name !== GASP_VENDOR), compiled],
  };
  const names = new Set([...metrics.map((m) => m.name)]);
  const problems = [...(ossieSchemaErrors(model, "model", data) ?? []).map((e) => `Ossie schema: ${e}`), ...checkCompiledMetrics(model, names, { extensionSchema: data.extensionSchema })];
  return { company, model, coverage, dialect: chosen.dialect, dialectNote: chosen.note, spine, counts, problems };
}

/** Formula id → the metric record that owns it, for labels. */
function owners(data: StandardData): Map<string, Metric> {
  const out = new Map<string, Metric>();
  for (const m of data.metrics) {
    if (isMetricStub(m)) continue;
    const id = metricFormulaId(data, m);
    if (!out.has(id)) out.set(id, m);
  }
  return out;
}

/** The formula ids behind a metric list (names resolved as in lookup_metric) or a department, or an error naming what did not resolve. */
export function selectFormulas(data: StandardData, metrics: string | undefined, department: string | undefined): { only?: Set<string>; error?: string } {
  const only = new Set<string>();
  if (department?.trim()) {
    const want = department.trim().toLowerCase().replace(/-/g, " ");
    const hit = data.metrics.filter((m) => !isMetricStub(m) && m.department.toLowerCase() === want);
    if (!hit.length) return { error: `Unknown department \`${department}\`. Departments: ${[...new Set(data.metrics.map((m) => m.department))].join(", ")}.` };
    for (const m of hit) only.add(metricFormulaId(data, m));
  }
  if (metrics?.trim()) {
    for (const name of metrics.split(",").map((s) => s.trim()).filter(Boolean)) {
      const r = resolveMetric(data, name);
      if (r.kind === "metric") only.add(metricFormulaId(data, r.metric));
      else if (r.kind === "ambiguous") return { error: `\`${name}\` names ${r.candidates.length} metrics (${r.candidates.map((c) => `${c.department} ${c.name}`).join("; ")}); prefix the department or pass the formula id.` };
      else return { error: `\`${name}\` is not a metric name, abbreviation, alias or formula id.` };
    }
  }
  return only.size ? { only } : {};
}

export function formatCompileReport(r: CompiledModel, data: StandardData, opts: { document?: boolean } = {}): string {
  const c = r.company;
  const org = c.adapter.organization || "unnamed";
  const label = owners(data);
  const nameOf = (key: string): string => {
    const [id, v] = key.split(":");
    const m = label.get(id);
    return `${m?.name ?? id}${v ? ` (${v})` : ""}`;
  };
  const p: string[] = [`# Compiled GASP metrics: ${org}`, ""];
  p.push(`**Mapping:** ${c.format === "v1"
    ? `GASP adapter${c.adapter.version ? ` v${c.adapter.version}` : ""}, converted on load; the metrics compile into the model synthesised from its tables and columns (\`${c.model.name}\`).`
    : c.modelProvided
      ? `Ossie mapping with its semantic model \`${c.model.name}\`.`
      : `Ossie mapping without a semantic model: dataset and field names were taken from its expressions, so sources are the dataset names and every field is its bare column. Pass the model to compile against its sources and expressions.`}`);
  p.push(`**Dialect:** ${r.dialectNote}. Direct metrics are ${OSSIE_DIALECT}; staged sources are written in it.`);
  p.push(`**Period spine:** \`${r.spine}\`, a table of (period_start, period_end) rows you provide, one per reporting period; the staged sources read it and the model declares it as \`${SPINE_DATASET}\`.`);
  const { direct, staged, unmapped, notComputable } = r.counts;
  const n = direct + staged;
  p.push(`**Compiled:** ${n} metric${n === 1 ? "" : "s"} (${direct} direct, ${staged} staged through ${staged} per-period dataset${staged === 1 ? "" : "s"}). Left out: ${unmapped} unmapped, ${notComputable} not computable.`);
  p.push(r.problems.length ? `**Checks:** ${r.problems.length} problem${r.problems.length === 1 ? "" : "s"}:` : "**Checks:** the compiled metrics pass the bundled Ossie model schema and GASP's reference checks.");
  for (const x of r.problems) p.push(`- ${x}`);
  for (const x of c.problems) p.push(`- Mapping: ${x}`);
  p.push("");

  const by = (kind: MetricCoverage["kind"]) => Object.entries(r.coverage).filter(([, v]) => v.kind === kind);
  if (staged) {
    const reasons: Record<string, number> = {};
    for (const [, v] of by("staged")) if (v.kind === "staged") reasons[v.reason] = (reasons[v.reason] ?? 0) + 1;
    p.push("## Staged", "Each needs a construct the expression language cannot state; its dataset's `source` is the compiled query over your tables.", ...Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`), "");
  }
  const left = by("unmapped");
  if (left.length) {
    p.push(`## Left out: unmapped (${left.length})`, "Each reads a field and dataset pair the mapping lacks. validate_mapping ranks the pairs by how many metrics they unlock.");
    const shown = left.slice(0, 40);
    for (const [key, v] of shown) if (v.kind === "unmapped") p.push(`- ${nameOf(key)}: needs \`${v.missing.join("`, `")}\``);
    if (left.length > shown.length) p.push(`- and ${left.length - shown.length} more`);
    p.push("");
  }
  if (opts.document !== false) {
    const base = c.format === "v1" ? (c.adapter.organization || "company").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") : undefined;
    p.push("## Model", `Your semantic model with the GASP metrics added${c.format === "v1" ? ` (save it as \`${base}.semantic_model.yaml\` beside the mapping validate_mapping shows)` : " (it replaces the one you passed; the mapping is unchanged)"}. Recompiling replaces every \`gasp_\` metric and staged dataset and leaves the rest as it was.`, "", "```yaml", ossieYaml(r.model).trimEnd(), "```");
  }
  return p.join("\n");
}

/** The compile_model tool: the report (and the model document) for a mapping given as text. */
export function compileModelFromText(documentText: string, modelText: string | undefined, data: StandardData, opts: CompileOptions & { metrics?: string; department?: string; document?: boolean } = {}): string {
  const company = resolveCompany(documentText, modelText, data);
  if ("error" in company) return company.error;
  const sel = selectFormulas(data, opts.metrics, opts.department);
  if (sel.error) return sel.error;
  const r = compileModel(company, data, { dialect: opts.dialect, only: sel.only, spine: opts.spine });
  if ("error" in r) return r.error;
  return formatCompileReport(r, data, { document: opts.document });
}

