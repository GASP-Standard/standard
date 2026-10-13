/**
 * Shared logic behind the MCP tools: exact-first metric resolution, canonical
 * formula formatting, adapter validation against the formula field sets, and
 * filling compiled query templates from an adapter.
 */
import { findDefinition, metricFormulaId, isMetricStub } from "./loader.js";
import { metricUrl } from "./urls.js";
import type { StandardData, Metric, Definition, QueryTemplate } from "./types.js";

// ── resolution ───────────────────────────────────────────────────────────────

export type Resolved =
  | { kind: "metric"; metric: Metric }
  | { kind: "definition"; definition: Definition }
  | { kind: "none" };

/**
 * Exact matches only: name, name without its abbreviation, abbreviation, alias,
 * slug, formula id, or a glossary term. Never a substring guess.
 */
export function resolveMetric(data: StandardData, name: string): Resolved {
  const q = name.toLowerCase().trim();
  if (!q) return { kind: "none" };
  const idq = q.replace(/[\s-]+/g, "_");
  const metric =
    data.metrics.find((m) => m.name.toLowerCase() === q) ||
    data.metrics.find((m) => baseName(m.name) === q) ||
    data.metrics.find((m) => m.aliases.some((a) => a.toLowerCase() === q)) ||
    data.metrics.find((m) => m.slug === q) ||
    data.metrics.find((m) => abbreviation(m.name) === q) ||
    data.metrics.find((m) => !isMetricStub(m) && metricFormulaId(data, m) === idq) ||
    viaNodeLabel(data, q);
  if (metric) return { kind: "metric", metric };
  const def = data.definitions.find((d) => d.term.toLowerCase() === q || d.slug === q || termParts(d.term).includes(q));
  if (def) return { kind: "definition", definition: def };
  return { kind: "none" };
}

/** A graph node label ("Employee NPS") or id, followed back to its metric through metricNodeIds. */
function viaNodeLabel(data: StandardData, q: string): Metric | undefined {
  const node = data.nodes.find((n) => (!n.nodeType || n.nodeType === "metric") && (n.id === q || n.label.toLowerCase() === q || baseName(n.label) === q));
  if (!node) return undefined;
  const slugs = Object.entries(data.metricNodeIds ?? {}).filter(([, id]) => id === node.id).map(([slug]) => slug);
  return data.metrics.find((m) => slugs.includes(m.slug) && !isMetricStub(m)) ?? data.metrics.find((m) => slugs.includes(m.slug));
}

/** "Net Revenue Retention (NRR)" → "nrr" */
export function abbreviation(name: string): string | undefined {
  return name.match(/\(([^)]+)\)\s*$/)?.[1].toLowerCase();
}
/** "Net Revenue Retention (NRR)" → "net revenue retention" */
export function baseName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase().trim();
}
function termParts(term: string): string[] {
  const m = term.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  return m ? [m[1].toLowerCase().trim(), m[2].toLowerCase().trim()] : [];
}

/** Nearest names, offered as suggestions rather than returned as the answer. */
export function suggestMatches(data: StandardData, name: string, limit = 6): string {
  const q = name.toLowerCase().trim();
  if (!q) return "";
  const hits: string[] = [];
  for (const m of data.metrics) {
    if (m.name.toLowerCase().includes(q) || m.aliases.some((a) => a.toLowerCase().includes(q))) hits.push(`${m.name} (${m.department})`);
  }
  for (const d of data.definitions) if (d.term.toLowerCase().includes(q)) hits.push(`${d.term} (glossary)`);
  const unique = [...new Set(hits)].slice(0, limit);
  if (unique.length === 0) return " Try the 'search' tool.";
  return ` Did you mean: ${unique.join("; ")}? Pass the exact name.`;
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
  if (f.forms) for (const [k, v] of Object.entries(f.forms)) parts.push(`**${k === "O" ? "Operating form (O)" : "Market form (M)"}:**`, "```\n" + v + "\n```");
  if (f.variants) for (const [k, v] of Object.entries(f.variants)) parts.push(`**Variant \`${k}\`:**`, "```\n" + v + "\n```");
  if (f.notes) parts.push(`**Notes:** ${f.notes}`);
  const dr = data.dataRequirements.find((d) => d.formulaId === id);
  const sf = data.ontology?.structuredFormulas?.[id];
  if (sf?.inputs?.length) parts.push(`**Reads metrics:** ${sf.inputs.map((i) => `${labelOf(data, i.ref)} (${i.role}${i.polarity && i.polarity !== "positive" ? `, ${i.polarity}` : ""})`).join(", ")}`);
  if (dr) parts.push(`**Reads fields:** ${dr.fields.map((x) => `\`${x}\``).join(", ")}`, `**Datasets:** ${dr.datasets.join(", ")}${dr.staged ? " (cohort or prior-period comparison; a staged dataset helps)" : ""}`);
  return parts;
}

function labelOf(data: StandardData, id: string): string {
  return data.nodes.find((n) => n.id === id)?.label ?? data.metrics.find((m) => metricFormulaId(data, m) === id)?.name ?? id;
}

// ── adapter handling ─────────────────────────────────────────────────────────

interface Mapping { gaspField: string; dataset?: string; warehouseRef: string; transform?: string }
interface Adapter { version?: string; organization?: string; warehouse?: string; metricOwners?: Array<{ metric: string; team: string; contact?: string }>; datasets?: Record<string, string>; mappings: Mapping[] }

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

export function validateAdapter(adapter: Adapter, data: StandardData): string {
  const problems: string[] = [];
  if (!Array.isArray(adapter?.mappings)) return 'Adapter must have a "mappings" array. Template: https://gaspwiki.com/downloads/gasp-adapter-template.json';
  if (adapter.version && !["1.0", "1.1"].includes(String(adapter.version))) problems.push(`Unknown adapter version "${adapter.version}" (expected 1.0 or 1.1).`);
  const fields = new Map((data.ontology?.fields ?? []).map((f) => [f.id, f]));
  const r = resolveAdapter(adapter, data);
  for (const m of adapter.mappings) if (!m?.gaspField) problems.push("A mapping has no gaspField.");
  for (const f of r.unknownFields) problems.push(`Unknown GASP field \`${f}\`; it is not in the ontology and no metric reads it.`);
  for (const d of r.unknownDatasets) problems.push(`Unknown GASP dataset \`${d}\`.`);
  for (const m of adapter.mappings) {
    if (!m?.gaspField || !fields.has(m.gaspField) || typeof m.warehouseRef !== "string" || !m.warehouseRef.trim()) continue;
    const f = fields.get(m.gaspField)!;
    if (!m.dataset && (f.datasets ?? []).length > 1 && !tableOf(m.warehouseRef)) problems.push(`\`${m.gaspField}\` lives on ${f.datasets!.length} datasets; a bare column name applies to all of them. Add "dataset" or a schema.table prefix if the column differs per table.`);
  }
  const { tables, conflicts } = r;
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
  const unmapped = [...needed].filter((p) => !mappedPairs.has(p)).sort();
  const enumNoTransform = [...new Set(Object.values(r.columns).flatMap((c) => Object.values(c)).filter((m) => fields.get(m.gaspField)?.values && !m.transform).map((m) => m.gaspField))].sort();
  const owners = adapter.metricOwners ?? [];
  const ownerNames = new Set(owners.flatMap((o) => [o.metric?.toLowerCase().trim(), o.metric?.toLowerCase().trim().replace(/[\s-]+/g, "_")]));
  const allCore = [...ownerNames].some((n) => n === "all core metrics");
  const ownedBy = (dr: (typeof requirements)[number]) => allCore && dr.department === "Core" || ownerNames.has(dr.metric.toLowerCase()) || ownerNames.has(dr.formulaId);
  const unowned = fully.filter((dr) => !ownedBy(dr));
  const badOwners = owners.filter((o) => o.metric && !allCore && !requirements.some((dr) => dr.metric.toLowerCase() === o.metric.toLowerCase().trim() || dr.formulaId === o.metric.toLowerCase().trim().replace(/[\s-]+/g, "_")) && !data.metrics.some((m) => m.name.toLowerCase() === o.metric.toLowerCase().trim()));

  const p: string[] = [`# GASP Adapter Validation: ${adapter.organization || "unnamed"}`, `**Warehouse:** ${adapter.warehouse || "not specified"}`,
    `**Mapped fields:** ${[...mappedPairs].filter((p) => needed.has(p)).length} / ${needed.size} field and dataset pairs that canonical formulas read (written field@dataset: the logical table the column comes from)`,
    `**Datasets with a table:** ${Object.keys(tables).length} / ${Object.keys(data.ontology?.datasets ?? {}).length}`,
    `**Metrics:** ${fully.length} fully covered, ${partial.length} partially covered, ${none.length} not covered (of ${requirements.length} with a formula)`, ""];
  if (problems.length) p.push(`## Problems (${problems.length})`, ...problems.map((x) => `- ${x}`), "");
  if (conflicts.length) p.push(`## Dataset conflicts (${conflicts.length})`, ...conflicts.map((x) => `- ${x}`), "");
  if (fully.length) {
    p.push(`## Fully covered (${fully.length})`, "Every field the canonical formula reads is mapped:", "");
    for (const dr of fully) p.push(`- ${dr.metric}${ownedBy(dr) ? "" : " (no owner declared)"}`);
    p.push("");
  }
  if (partial.length) {
    p.push(`## Partially covered (${partial.length})`, "");
    for (const { dr, missing } of partial.sort((a, b) => a.missing.length - b.missing.length)) p.push(`- **${dr.metric}**: missing \`${missing.join("`, `")}\``);
    p.push("");
  }
  if (none.length) p.push(`## Not covered (${none.length})`, none.map((d) => d.metric).join(", "), "");
  if (enumNoTransform.length) p.push(`## Enum fields mapped without a transform (${enumNoTransform.length})`, "The column must already produce GASP's declared values; otherwise add a CASE transform:", ...enumNoTransform.map((f) => `- \`${f}\`: ${fields.get(f)!.values!.join(", ")}`), "");
  if (unowned.length) p.push(`## Covered metrics without an owner (${unowned.length})`, "Add metricOwners entries so someone resolves definition disputes:", unowned.map((d) => d.metric).join(", "), "");
  if (badOwners.length) p.push(`## Owners naming unknown metrics (${badOwners.length})`, ...badOwners.map((o) => `- "${o.metric}" (${o.team})`), "");
  if (unmapped.length) {
    const unlock = new Map<string, number>();
    for (const { missing } of partial) for (const f of missing) unlock.set(f, (unlock.get(f) ?? 0) + 1);
    const ranked = [...unlock.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    if (ranked.length) p.push("## Highest-value fields to map next", "Each field@dataset pair unlocks this many partially covered metrics:", ...ranked.map(([f, n]) => `- \`${f}\` (${n})`), "");
  }
  return p.join("\n");
}

export { metricUrl };
