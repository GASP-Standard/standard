/**
 * Shared logic behind the MCP tools: exact-first metric resolution, canonical
 * formula formatting, adapter validation against the formula field sets, and
 * filling compiled query templates from an adapter.
 */
import { metricFormulaId, closestNames } from "./loader.js";
import { metricUrl } from "./urls.js";
import { enumFilters, formatFilters } from "./filters.js";
import { compileMetric, exampleSql, type CompileContext } from "./compile.js";
import type { StandardData, Metric, Definition, QueryTemplate, DataRequirement, BreakdownSpec } from "./types.js";
import Ajv2020Module from "ajv/dist/2020.js";
import type { ValidateFunction, ErrorObject } from "ajv";

// ajv is CommonJS; under Node16 resolution the default import is the module object
const Ajv2020: typeof Ajv2020Module.default = (Ajv2020Module as any).default ?? Ajv2020Module;

// ── resolution ───────────────────────────────────────────────────────────────

// Exact resolution lives in the loader beside resolveNode, which shares it.
export { resolveMetric, abbreviation, baseName, type Resolved } from "./loader.js";

/** Nearest names by word similarity (the matcher search falls back to), offered as suggestions rather than returned as the answer. */
export function suggestMatches(data: StandardData, name: string, limit = 6): string {
  if (!name.trim()) return "";
  const hits = closestNames(data, name, limit).map(({ metric, definition }) => (metric ? `${metric.name} (${metric.department})` : `${definition!.term} (glossary)`));
  if (hits.length === 0) return " Try the 'search' tool.";
  return ` Did you mean: ${hits.join("; ")}? Pass the exact name.`;
}

/**
 * The reply when a name matches several metrics: each candidate with its
 * department, formula id and URL, and how to pick one.
 */
export function formatAmbiguous(data: StandardData, name: string, candidates: Metric[]): string {
  const lines = candidates.map((m) => `- **${m.name}** (${m.department}): formula id \`${metricFormulaId(data, m)}\`, ${metricUrl(m)}`);
  return [`"${name}" names ${candidates.length} different metrics:`, ...lines, "", `Qualify it by department ("${candidates[0].department} ${candidates[0].name}" or "${candidates[0].name} (${candidates[0].department})") or pass the formula id.`].join("\n");
}

// ── canonical formula ────────────────────────────────────────────────────────

export function formatCanonicalFormula(data: StandardData, metric: Metric): string[] {
  const id = metricFormulaId(data, metric);
  const f = data.formulas?.[id];
  if (!f) return [];
  const parts: string[] = ["\n## Canonical formula (GASP grammar)"];
  if (f.notComputable) {
    parts.push(`Not computable as a single formula: ${f.notComputable}`);
    return parts;
  }
  parts.push("```\n" + f.formula + "\n```", `**Unit:** ${f.unit}${f.unit === "percent" ? " (the formula yields an unscaled ratio)" : ""}`);
  const totalMode = " (total mode: other aggregates stay whole)";
  const bucketText = (b: Record<string, [number, number | null]>) =>
    Object.entries(b).map(([label, [lo, hi]]) => `\`${label}\` ${hi === null ? `${lo} and over` : `${lo} to ${hi}`}`).join(", ");
  /** Field and description of a breakdown spec; `column` names a bucketed breakdown's output column. */
  const spec = (b: BreakdownSpec, column: string) => {
    if (typeof b === "string") return { field: b.replace(/^field\./, ""), total: false, text: `\`${b.replace(/^field\./, "")}\`` };
    if ("expression" in b) return { field: column, total: b.total === true, text: `buckets of \`${b.expression}\` (column \`${column}\`, inclusive bounds): ${bucketText(b.buckets)}` };
    return { field: b.field.replace(/^field\./, ""), total: b.total === true, text: `\`${b.field.replace(/^field\./, "")}\`` };
  };
  if (f.breakdown) {
    const { field, total, text } = spec(f.breakdown, "bucket");
    parts.push(`**Breakdown by:** ${text}${total ? totalMode : ""}. The formula is computed once per ${field} value, one row per value; aggregates under total() read the whole population.`);
  }
  if (f.forms) for (const [k, v] of Object.entries(f.forms)) parts.push(`**${k === "O" ? "Operating form (O)" : "Market form (M)"}:**`, "```\n" + v + "\n```");
  if (f.variants) for (const [k, v] of Object.entries(f.variants)) parts.push(`**Variant \`${k}\`:**`, "```\n" + v + "\n```");
  if (f.breakdowns && Object.keys(f.breakdowns).length) {
    const list = Object.entries(f.breakdowns).map(([k, v]) => { const s = spec(v, k); return `\`${k}\` by ${s.text}${s.total ? totalMode : ""}`; }).join(", ");
    parts.push(`**Breakdowns:** ${list}. Each computes the main formula once per value of its field, one row per value.`);
  }
  if (f.notes) parts.push(`**Notes:** ${f.notes}`);
  const dr = data.dataRequirements.find((d) => d.formulaId === id);
  const sf = data.ontology?.structuredFormulas?.[id];
  if (sf?.inputs?.length) parts.push(`**Reads metrics:** ${sf.inputs.map((i) => `${labelOf(data, i.ref)} (${i.role}${i.polarity && i.polarity !== "positive" ? `, ${i.polarity}` : ""})`).join(", ")}`);
  const staged = " (cohort or prior-period comparison; a staged dataset helps)";
  const fieldList = (xs: string[]) => xs.map((x) => `\`${x}\``).join(", ");
  if (dr) parts.push(`**Reads fields:** ${fieldList(dr.fields)}`, `**Datasets:** ${dr.datasets.join(", ")}${dr.staged ? staged : ""}`);
  // Enum filters per form, so forms that read the same fields show where they differ.
  const filterCtx = { fields: Object.fromEntries((data.ontology?.fields ?? []).map((x) => [x.id, x])), formulas: data.formulas ?? {} };
  const formFilters = Object.fromEntries(Object.entries(f.forms ?? {}).map(([k, v]) => [k, formatFilters(enumFilters(v, filterCtx))]));
  for (const [k, r] of Object.entries(dr?.forms ?? {})) {
    if (!r) continue;
    parts.push(`**${k === "O" ? "Operating form (O)" : "Market form (M)"} reads fields:** ${fieldList(r.fields)}`, `**${k} form datasets:** ${r.datasets.join(", ")}${r.staged ? staged : ""}`);
    if (formFilters[k]) parts.push(`**${k} form filters:** ${formFilters[k]}`);
  }
  if (f.forms && Object.keys(f.forms).length) {
    const main = formatFilters(enumFilters(f.formula!, filterCtx));
    if (main && Object.values(formFilters).every((x) => x !== main)) parts.push(`**Main formula filters:** ${main}`);
  }
  return parts;
}

function labelOf(data: StandardData, id: string): string {
  return data.nodes.find((n) => n.id === id)?.label ?? data.metrics.find((m) => metricFormulaId(data, m) === id)?.name ?? id;
}

// ── adapter handling ─────────────────────────────────────────────────────────

export interface Mapping { gaspField: string; dataset?: string; warehouseRef: string; transform?: string }
export interface Adapter { version?: string; organization?: string; warehouse?: string; metricOwners?: Array<{ metric: string; team: string; contact?: string }>; datasets?: Record<string, string>; mappings: Mapping[] }

const tableOf = (ref: string) => ref.split(".").slice(0, -1).join(".");
const columnOf = (ref: string) => ref.split(".").pop() ?? ref;

/**
 * Resolved adapter: the table behind each dataset and the column for each
 * (dataset, field) pair. A mapping that names a dataset applies to it alone;
 * one without applies to every dataset of the field whose table it matches,
 * or to all of them when it carries no table prefix.
 */
interface ResolvedAdapter {
  tables: Record<string, string>;
  /** dataset -> field -> mapping */
  columns: Record<string, Record<string, Mapping>>;
  conflicts: string[];
  unknownFields: string[];
  unknownDatasets: string[];
}

function resolveAdapter(adapter: Adapter, data: StandardData): ResolvedAdapter {
  const fields = new Map((data.ontology?.fields ?? []).map((f) => [f.id, f]));
  const datasets = data.ontology?.datasets ?? {};
  const live = (adapter.mappings ?? []).filter((m) => m?.gaspField && typeof m.warehouseRef === "string" && m.warehouseRef.trim());
  const unknownFields = [...new Set(live.filter((m) => !fields.has(m.gaspField)).map((m) => m.gaspField))];
  const unknownDatasets = [...new Set([...live.map((m) => m.dataset), ...Object.keys(adapter.datasets ?? {})].filter((d): d is string => !!d && !datasets[d]))];
  const tables: Record<string, string> = {};
  for (const [ds, t] of Object.entries(adapter.datasets ?? {})) if (datasets[ds] && t?.trim()) tables[ds] = t.trim();
  const conflicts: string[] = [];
  // Infer tables for datasets with no declared table from dataset-specific mappings.
  for (const ds of Object.keys(datasets)) {
    if (tables[ds]) continue;
    const seen = new Map<string, string[]>();
    for (const m of live) {
      if (!fields.has(m.gaspField)) continue;
      const t = tableOf(m.warehouseRef);
      if (!t) continue;
      const applies = m.dataset ? m.dataset === ds : (fields.get(m.gaspField)!.datasets ?? []).length === 1 && fields.get(m.gaspField)!.datasets![0] === ds;
      if (applies) seen.set(t, [...(seen.get(t) ?? []), m.gaspField]);
    }
    if (seen.size === 1) tables[ds] = [...seen.keys()][0];
    else if (seen.size > 1) conflicts.push(`dataset \`${ds}\`: its fields point at ${seen.size} tables (${[...seen.entries()].map(([t, fs]) => `${t}: ${fs.join(", ")}`).join("; ")}). Name one table under "datasets".`);
  }
  const columns: Record<string, Record<string, Mapping>> = {};
  for (const m of live) {
    const f = fields.get(m.gaspField);
    if (!f) continue;
    const t = tableOf(m.warehouseRef);
    const targets = m.dataset
      ? [m.dataset]
      : (f.datasets ?? []).filter((ds) => !t || !tables[ds] || tables[ds] === t);
    for (const ds of targets) {
      if (!datasets[ds]) continue;
      if (columns[ds]?.[m.gaspField] && columns[ds][m.gaspField].warehouseRef !== m.warehouseRef) conflicts.push(`\`${m.gaspField}\` on dataset \`${ds}\` is mapped twice (${columns[ds][m.gaspField].warehouseRef} and ${m.warehouseRef}).`);
      (columns[ds] ??= {})[m.gaspField] = m;
    }
  }
  return { tables, columns, conflicts, unknownFields, unknownDatasets };
}

/** Split a "field@dataset" placeholder name. */
const pair = (p: string): [string, string] => { const i = p.indexOf("@"); return [p.slice(0, i), p.slice(i + 1)]; };

/** The column mapped for an exact (field, dataset) pair, or undefined. */
function mappedFor(r: ResolvedAdapter, placeholder: string): Mapping | undefined {
  const [field, ds] = pair(placeholder);
  return r.columns[ds]?.[field];
}

/**
 * Fills a compiled template from an adapter. Every field placeholder carries
 * the dataset it is read from ({{customer_status@customer}}), so each one is
 * resolved by its own tag, including fields inside a cohort subquery that sits
 * in another dataset's WHERE clause. Unmapped pairs stay as placeholders and
 * are reported as "field@dataset".
 */
export function fillTemplate(template: QueryTemplate, adapter: Adapter, data: StandardData) {
  const r = resolveAdapter(adapter, data);
  const used: Array<{ field: string; dataset: string; ref: string; transform?: string }> = [];
  const missingFields: string[] = [];
  for (const p of template.placeholders) {
    const m = mappedFor(r, p);
    const [field, dataset] = pair(p);
    if (m) used.push({ field, dataset, ref: m.warehouseRef, transform: m.transform });
    else missingFields.push(p);
  }
  let sql = template.parameterizedQuery.replace(/\{\{(\w+)@(\w+)\}\}/g, (ph, field: string, ds: string) => {
    const m = r.columns[ds]?.[field];
    if (!m) return ph;
    return m.transform ? `(${m.transform.replace(/\{\{value\}\}/g, columnOf(m.warehouseRef))})` : columnOf(m.warehouseRef);
  });
  const missingTables: string[] = [];
  for (const ds of template.datasets) {
    if (r.tables[ds]) sql = sql.split(`{{_table:${ds}}}`).join(r.tables[ds]);
    else missingTables.push(ds);
  }
  sql = sql.split("{{_period_start}}").join(":period_start").split("{{_period_end}}").join(":period_end");
  return { sql, mapped: used, missingFields, missingTables, conflicts: r.conflicts.filter((c) => template.datasets.some((d) => c.includes(`\`${d}\``))) };
}

/**
 * The query template of a named breakdown (`breakdowns` on the formula entry,
 * for example MRR `by_plan`), compiled on demand from the loaded data: the
 * main formula grouped by the breakdown's field, one row per value. Grain,
 * frequency and source come from the metric's own template. Returns an error
 * message for an unknown name, listing the declared breakdowns.
 */
/**
 * The data requirement of a named breakdown: the metric's own requirement with
 * the fields, datasets, placeholders and example SQL of the breakdown's compiled
 * query (the dimension included; one row per value). Rejects an unknown name
 * with the declared list, as breakdownTemplate does.
 */
export function breakdownRequirement(data: StandardData, id: string, name: string): { requirement: DataRequirement } | { error: string } {
  const base = data.dataRequirements.find((d) => d.formulaId === id);
  const b = breakdownTemplate(data, id, name);
  if ("error" in b) return b;
  if (!base) return { error: `${id} has no data requirements.` };
  const t = b.template;
  const types = new Map((data.ontology?.fields ?? []).map((x) => [x.id, x.type === "enum" ? "string" : x.type]));
  const { forms: _forms, ...rest } = base;
  return {
    requirement: {
      ...rest, metric: `${base.metric}, breakdown ${name}`, fields: t.fields, datasets: t.datasets, placeholders: t.placeholders, staged: t.staged,
      fieldTypes: Object.fromEntries(t.fields.map((f) => [f, types.get(f) ?? "string"])),
      exampleQuery: exampleSql(t.parameterizedQuery), ...(t.breakdown ? { breakdown: t.breakdown } : {}),
    },
  };
}

export function breakdownTemplate(data: StandardData, id: string, name: string): { template: QueryTemplate } | { error: string } {
  const f = data.formulas?.[id];
  const base = data.queryTemplates?.[id];
  const declared = Object.keys(f?.breakdowns ?? {});
  if (!f || !base || !f.breakdowns?.[name]) {
    const list = declared.length ? `Declared breakdowns: ${declared.map((d) => `\`${d}\``).join(", ")}.` : "It declares no named breakdowns.";
    return { error: `${base?.metric ?? id} has no breakdown named \`${name}\`. ${list}` };
  }
  const ctx: CompileContext = {
    fields: Object.fromEntries((data.ontology?.fields ?? []).map((x) => [x.id, x])),
    datasets: data.ontology?.datasets ?? {},
    formulas: data.formulas!,
  };
  const c = compileMetric(id, ctx, name);
  return {
    template: {
      ...base, fields: c.fields, datasets: c.datasets, sourceTable: c.datasets.length === 1 ? c.datasets[0] : null,
      parameterizedQuery: c.sql, staged: c.staged, placeholders: c.placeholders, ...(c.breakdown ? { breakdown: c.breakdown } : {}),
    },
  };
}

const schemaValidators = new WeakMap<object, ValidateFunction>();

/** One line per error: instance path, message, and the offending key or allowed values. */
function formatSchemaError(e: ErrorObject): string {
  const path = e.instancePath || "/";
  const extra =
    e.keyword === "additionalProperties" ? `: \`${(e.params as any).additionalProperty}\`` :
    e.keyword === "enum" ? `: ${(e.params as any).allowedValues.map((v: unknown) => JSON.stringify(v)).join(", ")}` : "";
  return `\`${path}\` ${e.message}${extra}`;
}

/**
 * Applies the adapter JSON Schema (standard/gasp-adapter-schema.json, draft 2020-12)
 * and returns one line per error. Null when the loaded data carries no schema.
 */
export function adapterSchemaErrors(adapter: unknown, data: StandardData): string[] | null {
  const schema = data.adapterSchema;
  if (!schema) return null;
  let validate = schemaValidators.get(schema);
  if (!validate) {
    validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema) as ValidateFunction;
    schemaValidators.set(schema, validate);
  }
  return validate(adapter) ? [] : (validate.errors ?? []).map(formatSchemaError);
}

/** Everything validate_adapter found, before formatting. */
export interface AdapterValidation {
  /** One line per schema error; null when the loaded data carries no schema */
  schemaErrors: string[] | null;
  /** False when the adapter has no mappings array: only schemaErrors is meaningful */
  hasMappings: boolean;
  problems: string[];
  conflicts: string[];
  /** field@dataset pairs that canonical formulas read and the adapter maps */
  mappedNeededCount: number;
  /** field@dataset pairs that canonical formulas read */
  neededCount: number;
  tableCount: number;
  datasetCount: number;
  requirementCount: number;
  fully: Array<{ metric: string; owned: boolean }>;
  /** Sorted by fewest missing pairs first */
  partial: Array<{ metric: string; missing: string[] }>;
  none: string[];
  enumNoTransform: Array<{ field: string; values: string[] }>;
  unowned: string[];
  badOwners: Array<{ metric: string; team: string }>;
  /** Up to 15 unmapped pairs ranked by how many partially covered metrics each unlocks */
  nextToMap: Array<{ pair: string; unlocks: number }>;
}

const NO_MAPPINGS = 'Adapter must have a "mappings" array, so coverage cannot be scored. Template: https://gaspwiki.com/downloads/gasp-adapter-template.json';

/** Runs every validate_adapter check: the schema first, then fields, datasets, owners and coverage. */
export function checkAdapter(adapter: Adapter, data: StandardData): AdapterValidation {
  const schemaErrors = adapterSchemaErrors(adapter, data);
  const result: AdapterValidation = {
    schemaErrors, hasMappings: Array.isArray(adapter?.mappings), problems: [], conflicts: [], mappedNeededCount: 0, neededCount: 0,
    tableCount: 0, datasetCount: Object.keys(data.ontology?.datasets ?? {}).length, requirementCount: data.dataRequirements.length,
    fully: [], partial: [], none: [], enumNoTransform: [], unowned: [], badOwners: [], nextToMap: [],
  };
  if (!result.hasMappings) return result;
  const problems = result.problems;
  // The schema checks version; this covers data loaded without a schema
  if (schemaErrors === null && adapter.version && !["1.0", "1.1"].includes(String(adapter.version))) problems.push(`Unknown adapter version "${adapter.version}" (expected 1.0 or 1.1).`);
  const fields = new Map((data.ontology?.fields ?? []).map((f) => [f.id, f]));
  const r = resolveAdapter(adapter, data);
  for (const m of adapter.mappings) if (!m?.gaspField) problems.push("A mapping has no gaspField.");
  for (const f of r.unknownFields) problems.push(`Unknown GASP field \`${f}\`; it is not in the ontology and no metric reads it.`);
  for (const d of r.unknownDatasets) problems.push(`Unknown GASP dataset \`${d}\`.`);
  const knownDatasets = data.ontology?.datasets ?? {};
  for (const m of adapter.mappings) {
    if (!m?.gaspField || !m.dataset || !fields.has(m.gaspField) || !knownDatasets[m.dataset]) continue;
    const homes = fields.get(m.gaspField)!.datasets ?? [];
    if (!homes.includes(m.dataset)) problems.push(`\`${m.gaspField}\` is mapped to dataset \`${m.dataset}\`, which does not carry it (it lives on ${homes.map((d) => `\`${d}\``).join(", ") || "no dataset"}). No formula reads \`${m.gaspField}@${m.dataset}\`, so this mapping is never used.`);
  }
  for (const m of adapter.mappings) {
    if (!m?.gaspField || !fields.has(m.gaspField) || typeof m.warehouseRef !== "string" || !m.warehouseRef.trim()) continue;
    const f = fields.get(m.gaspField)!;
    if (!m.dataset && (f.datasets ?? []).length > 1 && !tableOf(m.warehouseRef)) problems.push(`\`${m.gaspField}\` lives on ${f.datasets!.length} datasets; a bare column name applies to all of them. Add "dataset" or a schema.table prefix if the column differs per table.`);
  }
  result.conflicts = r.conflicts;
  result.tableCount = Object.keys(r.tables).length;
  const mappedPairs = new Set(Object.entries(r.columns).flatMap(([ds, c]) => Object.keys(c).map((f) => `${f}@${ds}`)));
  const requirements = data.dataRequirements;
  const fully: typeof requirements = [], partial: Array<{ dr: (typeof requirements)[number]; missing: string[] }> = [], none: typeof requirements = [];
  for (const dr of requirements) {
    const missing = dr.placeholders.filter((p) => !mappedFor(r, p));
    if (missing.length === 0) fully.push(dr);
    else if (missing.length < dr.placeholders.length) partial.push({ dr, missing });
    else none.push(dr);
  }
  const needed = new Set(requirements.flatMap((d) => d.placeholders));
  result.neededCount = needed.size;
  result.mappedNeededCount = [...mappedPairs].filter((p) => needed.has(p)).length;
  const unmapped = [...needed].filter((p) => !mappedPairs.has(p)).sort();
  result.enumNoTransform = [...new Set(Object.values(r.columns).flatMap((c) => Object.values(c)).filter((m) => fields.get(m.gaspField)?.values && !m.transform).map((m) => m.gaspField))].sort()
    .map((f) => ({ field: f, values: fields.get(f)!.values! }));
  const owners = adapter.metricOwners ?? [];
  const ownerNames = new Set(owners.flatMap((o) => [o.metric?.toLowerCase().trim(), o.metric?.toLowerCase().trim().replace(/[\s-]+/g, "_")]));
  const allCore = [...ownerNames].some((n) => n === "all core metrics");
  const ownedBy = (dr: (typeof requirements)[number]) => allCore && dr.department === "Core" || ownerNames.has(dr.metric.toLowerCase()) || ownerNames.has(dr.formulaId);
  result.fully = fully.map((dr) => ({ metric: dr.metric, owned: ownedBy(dr) }));
  result.partial = partial.sort((a, b) => a.missing.length - b.missing.length).map(({ dr, missing }) => ({ metric: dr.metric, missing }));
  result.none = none.map((d) => d.metric);
  result.unowned = fully.filter((dr) => !ownedBy(dr)).map((d) => d.metric);
  result.badOwners = owners.filter((o) => o.metric && !allCore && !requirements.some((dr) => dr.metric.toLowerCase() === o.metric.toLowerCase().trim() || dr.formulaId === o.metric.toLowerCase().trim().replace(/[\s-]+/g, "_")) && !data.metrics.some((m) => m.name.toLowerCase() === o.metric.toLowerCase().trim()))
    .map((o) => ({ metric: o.metric, team: o.team }));
  if (unmapped.length) {
    const unlock = new Map<string, number>();
    for (const { missing } of result.partial) for (const f of missing) unlock.set(f, (unlock.get(f) ?? 0) + 1);
    result.nextToMap = [...unlock.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([pair, unlocks]) => ({ pair, unlocks }));
  }
  return result;
}

/**
 * The validate_adapter report as markdown. Pure: the MCP handler and the
 * website's adapter page both render it from checkAdapter's result.
 */
export function formatValidationReport(result: AdapterValidation, adapter: Adapter, data: StandardData): string {
  const { schemaErrors } = result;
  const schemaSection = schemaErrors === null
    ? ["## Schema", "The loaded standard data carries no adapter schema, so the schema was not applied.", ""]
    : schemaErrors.length
      ? [`## Schema (${schemaErrors.length} ${schemaErrors.length === 1 ? "error" : "errors"})`, "Against https://gaspwiki.com/schemas/gasp-adapter-v1.json:", ...schemaErrors.map((x) => `- ${x}`), ""]
      : ["## Schema", "Valid against https://gaspwiki.com/schemas/gasp-adapter-v1.json.", ""];
  if (!result.hasMappings) return [...schemaSection, NO_MAPPINGS].join("\n");
  const { problems, conflicts, fully, partial, none, enumNoTransform, unowned, badOwners, nextToMap } = result;
  const p: string[] = [`# GASP Adapter Validation: ${adapter.organization || "unnamed"}`, "", ...schemaSection, `**Warehouse:** ${adapter.warehouse || "not specified"}`,
    `**Mapped fields:** ${result.mappedNeededCount} / ${result.neededCount} field and dataset pairs that canonical formulas read (written field@dataset: the logical table the column comes from)`,
    `**Datasets with a table:** ${result.tableCount} / ${result.datasetCount}`,
    `**Metrics:** ${fully.length} fully covered, ${partial.length} partially covered, ${none.length} not covered (of ${result.requirementCount} with a formula)`, ""];
  if (problems.length) p.push(`## Problems (${problems.length})`, ...problems.map((x) => `- ${x}`), "");
  if (conflicts.length) p.push(`## Dataset conflicts (${conflicts.length})`, ...conflicts.map((x) => `- ${x}`), "");
  if (fully.length) {
    p.push(`## Fully covered (${fully.length})`, "Every field the canonical formula reads is mapped:", "");
    for (const f of fully) p.push(`- ${f.metric}${f.owned ? "" : " (no owner declared)"}`);
    p.push("");
  }
  if (partial.length) {
    p.push(`## Partially covered (${partial.length})`, "");
    for (const { metric, missing } of partial) p.push(`- **${metric}**: missing \`${missing.join("`, `")}\``);
    p.push("");
  }
  if (none.length) p.push(`## Not covered (${none.length})`, none.join(", "), "");
  if (enumNoTransform.length) p.push(`## Enum fields mapped without a transform (${enumNoTransform.length})`, "The column must already produce GASP's declared values; otherwise add a CASE transform:", ...enumNoTransform.map((e) => `- \`${e.field}\`: ${e.values.join(", ")}`), "");
  if (unowned.length) p.push(`## Covered metrics without an owner (${unowned.length})`, "Add metricOwners entries so someone resolves definition disputes:", unowned.join(", "), "");
  if (badOwners.length) p.push(`## Owners naming unknown metrics (${badOwners.length})`, ...badOwners.map((o) => `- "${o.metric}" (${o.team})`), "");
  if (nextToMap.length) p.push("## Highest-value fields to map next", "Each field@dataset pair unlocks this many partially covered metrics:", ...nextToMap.map((n) => `- \`${n.pair}\` (${n.unlocks})`), "");
  return p.join("\n");
}

/** The validate_adapter report: checkAdapter then formatValidationReport. */
export function validateAdapter(adapter: Adapter, data: StandardData): string {
  return formatValidationReport(checkAdapter(adapter, data), adapter, data);
}

/**
 * One get_data_requirements entry as markdown: source, grain, frequency,
 * description, the field table and the example SQL. Pure, so the site can
 * render the same block.
 */
export function formatDataRequirement(req: DataRequirement, url?: string): string {
  const parts: string[] = [
    `### ${req.metric}`,
    `- **Source:** ${req.source}`,
    `- **Grain:** ${req.grain}`,
    `- **Frequency:** ${req.frequency}`,
    `- **Description:** ${req.description}`,
    `- **Staged:** ${req.staged ? "yes: a cohort or prior-period comparison; a staged dataset makes it cheaper" : "no"}`,
    ...(url ? [`- **URL:** ${url}`] : []),
    "",
    "| Field | Dataset | Type |",
    "|-------|---------|------|",
  ];
  // One row per field@dataset pair the compiled SQL reads; a field on two datasets gets two rows
  const datasetsOf = new Map<string, string[]>();
  for (const p of req.placeholders ?? []) {
    const [field, ds] = pair(p);
    datasetsOf.set(field, [...(datasetsOf.get(field) ?? []), ds]);
  }
  for (const field of req.fields) {
    for (const ds of datasetsOf.get(field) ?? ["unknown"]) parts.push(`| \`${field}\` | ${ds} | ${req.fieldTypes?.[field] || "unknown"} |`);
  }
  if (req.breakdown) parts.push("", `The query returns one row per \`${req.breakdown.field}\` value.`);
  parts.push("", "**Example SQL:**", "```sql\n" + req.exampleQuery + "\n```\n");
  return parts.join("\n");
}

export { metricUrl };
