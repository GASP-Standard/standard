import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import {
  Metric,
  Definition,
  RelationshipNode,
  RelationshipEdge,
  DataRequirement,
  QueryTemplate,
  StandardData,
  SignalType,
} from "./types.js";
import { parseMetricsFile, parseDefinitions } from "./parser.js";
import { metricUrl, definitionUrl } from "./urls.js";
import { compileMetric, exampleSql } from "./compile.js";
import { words, phraseMatcher, closest } from "./fuzzy.js";

/** Resolve the repo root (two levels up from build/index.js) */
function repoRoot(): string {
  // gasp-wiki-mcp/build/index.js -> gasp-wiki-mcp -> repo root
  const thisDir = new URL(".", import.meta.url).pathname;
  return join(thisDir, "..", "..");
}

const DATA_URL = "https://gaspwiki.com/api/standard.json";

/** Load pre-parsed data bundled with the npm package (offline fallback) */
export function loadBundled(): StandardData {
  const bundledPath = join(
    new URL(".", import.meta.url).pathname,
    "standard-data.json"
  );
  const raw = readFileSync(bundledPath, "utf-8");
  return JSON.parse(raw) as StandardData;
}

/** Fetch pre-parsed standard data from gaspwiki.com (for global/npx installs) */
export async function loadRemote(): Promise<StandardData> {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Failed to fetch ${DATA_URL}: ${res.status}`);
  return validateRemote(await res.json());
}

/** Check a fetched payload has the shape the tools rely on; throws a clear message otherwise. */
export function validateRemote(payload: unknown): StandardData {
  const bad = (what: string): never => {
    throw new Error(`Remote data from ${DATA_URL} is malformed: ${what}`);
  };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return bad("expected a JSON object");
  const p = payload as Record<string, any>;
  for (const key of ["metrics", "definitions", "nodes", "edges"]) {
    if (!Array.isArray(p[key]) || p[key].length === 0) bad(`"${key}" must be a non-empty array`);
  }
  const o = p.ontology;
  if (!o || typeof o !== "object") bad(`"ontology" must be an object`);
  if (!Array.isArray(o.fields)) bad(`"ontology.fields" must be an array`);
  if (!o.datasets || typeof o.datasets !== "object" || Array.isArray(o.datasets)) bad(`"ontology.datasets" must be an object`);
  if (!p.formulas || typeof p.formulas !== "object" || Array.isArray(p.formulas)) bad(`"formulas" must be an object`);
  return p as StandardData;
}

/** Load all standard data from local files at startup */
export function loadStandard(): StandardData {
  const root = repoRoot();
  const standardDir = join(root, "standard");
  const metricsDir = join(standardDir, "metrics");

  // Load all metric files
  const metricFiles = readdirSync(metricsDir).filter((f) =>
    f.endsWith(".md")
  );
  const metrics: Metric[] = [];
  for (const file of metricFiles) {
    const content = readFileSync(join(metricsDir, file), "utf-8");
    const parsed = parseMetricsFile(content, file);
    metrics.push(...parsed);
  }

  // Load definitions
  const defsContent = readFileSync(
    join(standardDir, "definitions.md"),
    "utf-8"
  );
  const definitions = parseDefinitions(defsContent);

  // Load relationships
  const relPath = join(standardDir, "relationships.json");
  const relData = JSON.parse(readFileSync(relPath, "utf-8"));
  const nodes: RelationshipNode[] = relData.nodes;
  const edges: RelationshipEdge[] = relData.edges;

  // Metric slug → graph node id, from the slug each metric node carries.
  // Stubs that share the canonical slug resolve directly.
  const metricNodeIds: Record<string, string> = {};
  for (const n of nodes) {
    if ((!n.nodeType || n.nodeType === "metric") && n.slug) metricNodeIds[n.slug] = n.id;
  }
  // Node id → canonical slug, taken before stubs are added
  const slugByNodeId = new Map(Object.entries(metricNodeIds).map(([slug, id]) => [id, slug]));
  // Stubs with their own slug ("See [Core](core.md#cac-customer-acquisition-cost)")
  // inherit the node of the metric they point to.
  for (const m of metrics) {
    const anchor = m.rawMarkdown.match(/See \[[^\]]+\]\([^)#]*#([^)]+)\)/)?.[1];
    if (anchor && metricNodeIds[anchor] && !metricNodeIds[m.slug]) {
      metricNodeIds[m.slug] = metricNodeIds[anchor];
    }
  }

  // Load taxonomy classifications
  const taxonomyPath = join(standardDir, "taxonomy.json");
  let taxonomy: {
    classifications: Record<string, { primary: SignalType; secondary?: SignalType }>;
  } = { classifications: {} };
  try {
    taxonomy = JSON.parse(readFileSync(taxonomyPath, "utf-8"));
  } catch {
    // taxonomy.json not yet created: default to operational
  }

  // Merge signal types into metrics
  for (const m of metrics) {
    const deptSlug = m.department.toLowerCase().replace(/\s+/g, "-");
    const key = `${deptSlug}::${m.slug}`;
    const entry = taxonomy.classifications[key];
    if (entry) {
      m.signalType = entry.primary;
      m.signalTypeSecondary = entry.secondary || null;
    } else {
      // Cross-reference stubs: look up canonical metric's classification
      const seeMatch = m.rawMarkdown.match(/See \[([^\]]+)\]\(([^)]+)\)/);
      if (seeMatch) {
        const link = seeMatch[2];
        const anchor = link.includes("#") ? link.split("#")[1] : null;
        if (anchor) {
          // Find canonical metric's key
          for (const [canonKey, canonEntry] of Object.entries(taxonomy.classifications)) {
            if (canonKey.endsWith(`::${anchor}`)) {
              m.signalType = canonEntry.primary;
              m.signalTypeSecondary = canonEntry.secondary || null;
              break;
            }
          }
        }
      }
      // Fallback if still unset
      if (!m.signalType) {
        m.signalType = "operational";
        m.signalTypeSecondary = null;
      }
    }
  }

  // Enrich cross-reference stubs with canonical content fields.
  //
  // Some metrics intentionally appear in multiple department files, e.g. NRR
  // is defined canonically in core.md and listed as a "See [Core](core.md#...)"
  // stub in customer-success.md. Per-department records are needed to drive
  // department-scoped routes (e.g. /v1/metrics/customer-success/...), but
  // consumers of standard.json that look up by slug expect every record to
  // carry full content. Without this pass, Map-based lookups silently get the
  // empty stub instead of the canonical record.
  //
  // Strategy: keep stub identity (department, category, name, slug, rawMarkdown)
  // but copy any content field that's empty on the stub from the canonical.
  const canonicalBySlug = new Map<string, Metric>();
  for (const m of metrics) {
    if (m.slug && m.definition && !canonicalBySlug.has(m.slug)) {
      canonicalBySlug.set(m.slug, m);
    }
  }
  for (const m of metrics) {
    if (m.definition) continue; // already canonical or non-stub
    const seeMatch = m.rawMarkdown.match(/See \[([^\]]+)\]\(([^)]+)\)/);
    if (!seeMatch) continue;
    const link = seeMatch[2];
    const anchor = link.includes("#") ? link.split("#")[1] : null;
    if (!anchor) continue;
    const canon =
      canonicalBySlug.get(anchor) ||
      canonicalBySlug.get(m.slug) ||
      [...canonicalBySlug.values()].find((c) => c.slug.includes(anchor));
    if (!canon || canon === m) continue;
    if (!m.definition) m.definition = canon.definition;
    if (!m.formulas?.length) m.formulas = [...canon.formulas];
    if (!m.benchmarks) m.benchmarks = canon.benchmarks;
    if (!m.insight) m.insight = canon.insight;
    if (!m.commonMistakes?.length && canon.commonMistakes) m.commonMistakes = [...canon.commonMistakes];
    if (!m.sources?.length) m.sources = [...canon.sources];
    if (!m.aliases?.length) m.aliases = [...canon.aliases];
    // dualLens and dualLensNote are intentionally NOT enriched: they are a
    // Core-only construct (asserted by data-integrity tests). Consumers that
    // need dual-lens content should resolve via slug to the Core record.
  }

  // Load ontology
  const ontologyPath = join(standardDir, "ontology.json");
  let ontology: StandardData["ontology"];
  let ontRawTemporal: { temporalMapping?: Record<string, string>; temporalSemantics?: Record<string, { grain: string; frequency: string }> } = {};
  try {
    const ontRaw = JSON.parse(readFileSync(ontologyPath, "utf-8"));
    ontRawTemporal = { temporalMapping: ontRaw.temporalMapping, temporalSemantics: ontRaw.temporalSemantics };
    ontology = {
      entities: ontRaw.entities || [],
      fields: ontRaw.fields || [],
      datasets: ontRaw.datasets || undefined,
      sourceCategories: ontRaw.sourceCategories || undefined,
      entityMappings: ontRaw.entityMappings || {},
      concepts: ontRaw.concepts || [],
      entityRelationships: ontRaw.entityRelationships || undefined,
      structuredFormulas: ontRaw.structuredFormulas || undefined,
      accessControl: ontRaw.accessControl || undefined,
      validationRules: ontRaw.validationRules || undefined,
    };
  } catch {
    // ontology.json not yet created
  }

  // Enrich relationship nodes with descriptions
  const defBySlug = new Map<string, string>();
  for (const m of metrics) {
    if (m.slug && m.definition) defBySlug.set(m.slug, m.definition);
  }
  for (const d of definitions) {
    if (d.slug && d.definition && !defBySlug.has(d.slug)) defBySlug.set(d.slug, d.definition);
  }

  for (const node of nodes) {
    if ((node as any).nodeType === 'entity' && ontology) {
      const entityId = node.id.replace('entity_', '');
      const entity = ontology.entities.find(e => e.id === entityId);
      node.nodeType = 'entity';
      node.description = entity?.definition || '';
      node.category = 'entity';
    } else if ((node as any).nodeType === 'concept' && ontology?.concepts) {
      const conceptId = node.id.replace('concept_', '');
      const concept = ontology.concepts.find(c => c.id === conceptId);
      node.nodeType = 'concept';
      node.description = concept?.definition || '';
      node.category = 'concept';
    } else {
      // Try to find metric description by slug
      node.department = (node as any).department || '';
      node.signalType = (node as any).signalType || '';
      node.category = node.category || (node as any).department || '';
      if (!node.description) {
        const slug = slugByNodeId.get(node.id);
        node.description = (slug && defBySlug.get(slug)) || '';
      }
    }
  }

  // Load canonical formulas
  let formulas: StandardData["formulas"];
  try {
    formulas = JSON.parse(readFileSync(join(standardDir, "formulas.json"), "utf-8")).formulas || {};
  } catch {
    // formulas.json not yet created
  }

  const { dataRequirements, queryTemplates } = deriveRequirements(metrics, nodes, metricNodeIds, ontology, ontRawTemporal, formulas);

  // The adapter schema travels with the data so validate_adapter can apply it offline
  const adapterSchema = JSON.parse(readFileSync(join(standardDir, "gasp-adapter-schema.json"), "utf-8")) as Record<string, unknown>;

  return { metrics, definitions, nodes, edges, dataRequirements, ontology, queryTemplates, metricNodeIds, formulas, adapterSchema };
}

/**
 * Data requirements and query templates are compiled from formulas.json, so a
 * company validating an adapter is checked against the fields the canonical
 * formula really reads. Grain and frequency come from the ontology's temporal
 * mapping for graph metrics and from the datasets' kinds otherwise.
 */
function deriveRequirements(
  metrics: Metric[],
  nodes: RelationshipNode[],
  metricNodeIds: Record<string, string>,
  ontology: StandardData["ontology"],
  temporal: { temporalMapping?: Record<string, string>; temporalSemantics?: Record<string, { grain: string; frequency: string }> },
  formulas: StandardData["formulas"],
): { dataRequirements: DataRequirement[]; queryTemplates: Record<string, QueryTemplate> } {
  const dataRequirements: DataRequirement[] = [];
  const queryTemplates: Record<string, QueryTemplate> = {};
  if (!ontology?.fields || !ontology.datasets || !formulas) return { dataRequirements, queryTemplates };
  const data = { metrics, nodes, metricNodeIds } as StandardData;
  const fields = Object.fromEntries(ontology.fields.map((f) => [f.id, f]));
  const ctx = { fields, datasets: ontology.datasets, formulas };
  const sourceLabel = new Map<string, string>();
  for (const sc of (ontology as any).sourceCategories ?? []) sourceLabel.set(sc.id, sc.label ?? sc.id);

  for (const m of metrics) {
    if (isMetricStub(m)) continue;
    const id = metricFormulaId(data, m);
    const f = formulas[id];
    if (!f?.formula) continue;
    let compiled;
    try {
      compiled = compileMetric(id, ctx);
    } catch (e) {
      throw new Error(`Cannot compile formula '${id}': ${(e as Error).message}`);
    }
    const kinds = new Set(compiled.datasets.map((d) => ontology.datasets![d].kind));
    const semantic = temporal.temporalMapping?.[id] ? temporal.temporalSemantics?.[temporal.temporalMapping[id]] : undefined;
    const grain = semantic?.grain ?? (kinds.size === 1 && kinds.has("snapshot") ? "Snapshot at period end" : kinds.has("snapshot") ? "Events in period plus period-end snapshot" : "Per event, aggregate per period");
    const frequency = semantic?.frequency ?? "Monthly";
    const sources = new Map<string, number>();
    for (const fid of compiled.fields) for (const sc of fields[fid]?.sources ?? []) sources.set(sc, (sources.get(sc) ?? 0) + 1);
    const top = [...sources.entries()].filter(([k]) => k !== "derived").sort((a, b) => b[1] - a[1])[0]?.[0];
    const source = top ? sourceLabel.get(top) ?? top : "Derived";
    const forms: DataRequirement["forms"] = {};
    for (const form of Object.keys(f.forms ?? {}) as Array<"O" | "M">) {
      try {
        const c = compileMetric(id, ctx, form);
        forms[form] = { fields: c.fields, datasets: c.datasets, staged: c.staged };
      } catch (e) {
        throw new Error(`Cannot compile formula '${id}' form ${form}: ${(e as Error).message}`);
      }
    }
    const fieldTypes = Object.fromEntries(compiled.fields.map((fid) => [fid, fields[fid]?.type === "enum" ? "string" : fields[fid]?.type ?? "string"]));
    dataRequirements.push({
      metric: m.name, formulaId: id, fields: compiled.fields, fieldTypes, datasets: compiled.datasets, source, frequency, grain,
      exampleQuery: exampleSql(compiled.sql), description: m.definition, department: m.department, staged: compiled.staged,
      placeholders: compiled.placeholders, ...(Object.keys(forms).length ? { forms } : {}),
      ...(compiled.breakdown ? { breakdown: compiled.breakdown } : {}),
    });
    queryTemplates[id] = {
      metric: m.name, fields: compiled.fields, datasets: compiled.datasets,
      sourceTable: compiled.datasets.length === 1 ? compiled.datasets[0] : null,
      grain, frequency, source, parameterizedQuery: compiled.sql, staged: compiled.staged, placeholders: compiled.placeholders,
      ...(compiled.breakdown ? { breakdown: compiled.breakdown } : {}),
    };
  }
  return { dataRequirements, queryTemplates };
}

/**
 * True for cross-reference stubs that defer to another metric: an anchored link
 * anywhere ("See [Core](core.md#...)"), or a body that opens with a See link to a
 * metrics file with or without an anchor ("See [Core Metrics](core.md) for full definitions.").
 */
export function isMetricStub(metric: Pick<Metric, "rawMarkdown">): boolean {
  if (/See \[[^\]]+\]\([^)#]*#[^)]+\)/.test(metric.rawMarkdown)) return true;
  const body = metric.rawMarkdown.split("\n").filter((l) => l.trim() && !l.startsWith("#")).join("\n").trim();
  return /^See \[[^\]]+\]\([^)]+\.md\)/.test(body);
}

/**
 * Id that keys a metric in standard/formulas.json and in `metric.<id>` formula
 * references: the graph node id when the metric has one, else its slug with
 * underscores.
 */
export function metricFormulaId(data: StandardData, metric: Pick<Metric, "slug" | "department" | "rawMarkdown">): string {
  // Only the tested slug → node map counts here; the slug-prefix fallback in
  // metricNodeId would hand Product's "Activation Rate" the Onboarding node.
  const node = data.metricNodeIds ? data.metricNodeIds[metric.slug] : metricNodeId(data, metric);
  if (node) return node;
  // Identifiers never start with a digit: "30-day-retention" becomes day_30_retention.
  let bare = metric.slug.replace(/-/g, "_").replace(/^(\d+)_day_/, "day_$1_");
  if (/^\d/.test(bare)) bare = `n_${bare}`;
  // Two departments can define different metrics under one heading (Activation
  // Rate, Escalation Rate). The metric that owns a graph node keeps the bare id;
  // the others are qualified by department so each formula has one meaning.
  const rivals = data.metrics.filter((m) => m !== metric && !isMetricStub(m) && m.slug === metric.slug);
  const nodeOwner = data.nodes.some((n) => n.id === bare) || rivals.some((m) => metricNodeId(data, m) === bare);
  if (rivals.length === 0 && !nodeOwner) return bare;
  return `${metric.department.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${bare}`;
}

/**
 * Graph node id for a metric record, used to key ontology lookups.
 * Data bundled before metricNodeIds existed falls back to an exact slug match.
 */
export function metricNodeId(data: StandardData, metric: Pick<Metric, "slug">): string | undefined {
  const mapped = data.metricNodeIds?.[metric.slug];
  if (mapped) return mapped;
  const id = metric.slug.replace(/-/g, "_");
  return data.nodes.some((n) => n.id === id) ? id : undefined;
}

/**
 * Formula id and stub flag for every metric record, computed once per loaded
 * data set. metricFormulaId scans every metric for rivals, so lookups that
 * test each record would otherwise be quadratic.
 */
const metricKeys = new WeakMap<StandardData, Map<Metric, { id: string; stub: boolean }>>();
function keysOf(data: StandardData): Map<Metric, { id: string; stub: boolean }> {
  let keys = metricKeys.get(data);
  if (!keys || keys.size !== data.metrics.length) {
    keys = new Map(data.metrics.map((m) => [m, { id: metricFormulaId(data, m), stub: isMetricStub(m) }]));
    metricKeys.set(data, keys);
  }
  return keys;
}
const formulaIdOf = (data: StandardData, m: Metric) => keysOf(data).get(m)?.id ?? metricFormulaId(data, m);
const stubOf = (data: StandardData, m: Metric) => keysOf(data).get(m)?.stub ?? isMetricStub(m);

/** The graph node a metric record owns, from metricNodeIds only (no slug-prefix guess). */
function ownNodeId(data: StandardData, metric: Pick<Metric, "slug">): string | undefined {
  return data.metricNodeIds ? data.metricNodeIds[metric.slug] : metricNodeId(data, metric);
}

// ── search ───────────────────────────────────────────────────────────────────

/**
 * Search metrics + definitions for a query string.
 * Whole-word matching, one result per metric or definition, ranked by where
 * the query matched: name or alias, then definition, then formula or field.
 * When nothing matches, the closest names come back flagged `didYouMean`.
 */
export interface SearchResult {
  type: "metric" | "definition";
  name: string;
  snippet: string;
  department?: string;
  /** gaspwiki.com page for this result */
  url?: string;
  /** Where the query matched: name, alias, term, definition, formula, field, category or department */
  matched: string;
  /** True for a fuzzy fallback suggestion; exact matching found nothing */
  didYouMean?: boolean;
}

/** Match strength by where the query matched. Names beat definitions beat formulas and fields. */
const RANK = { name: 100, alias: 95, term: 95, nameWord: 80, aliasWord: 75, termWord: 75, definition: 50, formula: 30, field: 30, category: 20, department: 20, section: 15 } as const;
const REASON: Record<keyof typeof RANK, string> = {
  name: "name", alias: "alias", term: "term", nameWord: "name", aliasWord: "alias", termWord: "term",
  definition: "definition", formula: "formula", field: "field", category: "category", department: "department", section: "section",
};

export function search(
  data: StandardData,
  query: string,
  limit: number = 10
): SearchResult[] {
  const q = query.toLowerCase().trim();
  if (!words(q).length) return [];
  const hit = phraseMatcher(q);
  const normalised = words(q).join(" ");
  const same = (s: string) => words(s).join(" ") === normalised;
  const best = (pairs: Array<[keyof typeof RANK, boolean]>) => {
    const found = pairs.filter(([, ok]) => ok).map(([k]) => k);
    if (!found.length) return null;
    return found.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
  };

  // One entry per metric: stubs and data requirements fold into the canonical record by formula id
  const groups = new Map<string, Metric[]>();
  for (const m of data.metrics) {
    const id = formulaIdOf(data, m);
    groups.set(id, [...(groups.get(id) ?? []), m]);
  }
  const requirementByFormula = new Map((data.dataRequirements ?? []).map((dr) => [dr.formulaId, dr]));

  const results: Array<SearchResult & { score: number }> = [];
  for (const [id, records] of groups) {
    const canonical = records.find((m) => !stubOf(data, m)) ?? records[0];
    let top: keyof typeof RANK | null = null;
    for (const m of records) {
      const dr = requirementByFormula.get(id);
      const k = best([
        ["name", same(m.name) || same(baseName(m.name)) || abbreviation(m.name) === normalised],
        ["alias", m.aliases.some(same)],
        ["nameWord", hit(m.name)],
        ["aliasWord", m.aliases.some(hit)],
        ["definition", hit(m.definition) || hit(m.insight)],
        ["formula", m.formulas.some(hit) || hit(data.formulas?.[id]?.formula)],
        ["field", !!dr && dr.fields.some(hit)],
        ["category", hit(m.category)],
        ["department", hit(m.department)],
      ]);
      if (k && (!top || RANK[k] > RANK[top])) top = k;
    }
    if (!top) continue;
    results.push({ ...metricResult(canonical), matched: REASON[top], score: RANK[top] });
  }

  for (const d of data.definitions) {
    const k = best([
      ["term", same(d.term) || d.slug === q || termParts(d.term).some(same)],
      ["termWord", hit(d.term)],
      ["definition", hit(d.definition)],
      ["section", hit(d.section)],
    ]);
    if (k) results.push({ ...definitionResult(d), matched: REASON[k], score: RANK[k] });
  }

  if (results.length === 0) return suggestions(data, q, limit);
  // Ties: metrics before glossary terms, then shorter names (closer to the query)
  results.sort((a, b) => b.score - a.score || (a.type === b.type ? 0 : a.type === "metric" ? -1 : 1) || a.name.length - b.name.length);
  return results.slice(0, limit).map(({ score: _, ...rest }) => rest);
}

function metricResult(m: Metric): Omit<SearchResult, "matched"> {
  const signalLabel = m.signalType.charAt(0).toUpperCase() + m.signalType.slice(1);
  return { type: "metric", name: m.name, snippet: `[${signalLabel}] ${m.definition || m.insight || ""}`, department: m.department, url: metricUrl(m) };
}

function definitionResult(d: Definition): Omit<SearchResult, "matched"> {
  return { type: "definition", name: d.term, snippet: d.definition, url: definitionUrl(d) };
}

/**
 * Metrics and glossary terms whose names are closest to the query, for "Did
 * you mean" offers. Shared by search's fallback and the not-found messages.
 * One entry per metric: the canonical record, never its stubs.
 */
export function closestNames(data: StandardData, query: string, limit = 6): Array<{ metric?: Metric; definition?: Definition; score: number }> {
  const canonical = new Map<string, Metric>();
  for (const m of data.metrics) {
    const id = formulaIdOf(data, m);
    if (!canonical.has(id) || (stubOf(data, canonical.get(id)!) && !stubOf(data, m))) canonical.set(id, m);
  }
  const candidates: Array<{ item: { metric?: Metric; definition?: Definition }; names: string[] }> = [
    ...[...canonical.values()].map((m) => ({ item: { metric: m }, names: [m.name, baseName(m.name), ...m.aliases] })),
    ...data.definitions.map((d) => ({ item: { definition: d }, names: [d.term, ...termParts(d.term)] })),
  ];
  return closest(query, candidates, limit).map(({ item, score }) => ({ ...item, score }));
}

function suggestions(data: StandardData, q: string, limit: number): SearchResult[] {
  return closestNames(data, q, limit).map(({ metric, definition }) => ({
    ...(metric ? metricResult(metric) : definitionResult(definition!)),
    matched: "similar name",
    didYouMean: true,
  }));
}

// ── exact resolution ─────────────────────────────────────────────────────────

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

/** Tier 1 of resolveMetric: the full name, the name without its abbreviation, the abbreviation or the graph node label. */
function namedBy(data: StandardData, q: string): (m: Metric) => boolean {
  const labelled = new Set(
    data.nodes
      .filter((n) => (!n.nodeType || n.nodeType === "metric") && (n.label.toLowerCase() === q || baseName(n.label) === q || abbreviation(n.label) === q))
      .map((n) => n.id),
  );
  return (m) => m.name.toLowerCase() === q || baseName(m.name) === q || abbreviation(m.name) === q || labelled.has(ownNodeId(data, m) ?? "");
}

export type Resolved =
  | { kind: "metric"; metric: Metric }
  /** Two or more non-stub metrics answer to the name equally; qualify by department or formula id */
  | { kind: "ambiguous"; candidates: Metric[] }
  | { kind: "definition"; definition: Definition }
  | { kind: "none" };

/**
 * Exact matches only, never a substring guess. Five tiers, first hit wins:
 * 1. the formula id or graph node id as typed ("support_escalation_rate",
 *    "nps"): unique keys, so never ambiguous;
 * 2. a name: the full name, the name without its abbreviation, the
 *    abbreviation, or the label of the metric's graph node;
 * 3. an alias;
 * 4. the slug;
 * 5. the formula id with spaces for underscores ("Support Escalation Rate").
 * Non-stub metrics are tried through every tier first, then as a name
 * qualified by department; a cross-reference stub answers only when no full
 * record matches. Two full records matching in the same tier are ambiguous.
 * Glossary terms are the last resort.
 */
export function resolveMetric(data: StandardData, name: string): Resolved {
  const q = name.toLowerCase().trim();
  if (!q) return { kind: "none" };
  const idq = q.replace(/[\s-]+/g, "_");
  const tiers: Array<(m: Metric) => boolean> = [
    (m) => formulaIdOf(data, m) === q || ownNodeId(data, m) === q,
    namedBy(data, q),
    (m) => m.aliases.some((a) => a.toLowerCase() === q),
    (m) => m.slug === q,
    (m) => formulaIdOf(data, m) === idq,
  ];
  const full = data.metrics.filter((m) => !stubOf(data, m));
  const stubs = data.metrics.filter((m) => stubOf(data, m));
  for (const tier of tiers) {
    const hits = full.filter(tier);
    if (hits.length === 1) return { kind: "metric", metric: hits[0] };
    if (hits.length > 1) return { kind: "ambiguous", candidates: hits };
  }
  // A name qualified by its department: "Support Escalation Rate", "Escalation Rate (Support)"
  for (const dept of new Set(full.map((m) => m.department))) {
    const d = dept.toLowerCase();
    const rest = q.startsWith(d + " ") ? q.slice(d.length + 1) : q.endsWith(` (${d})`) ? q.slice(0, -(d.length + 3)) : null;
    if (!rest) continue;
    const named = namedBy(data, rest.trim());
    const hits = full.filter((m) => m.department === dept && (named(m) || m.aliases.some((a) => a.toLowerCase() === rest.trim())));
    if (hits.length === 1) return { kind: "metric", metric: hits[0] };
  }
  for (const tier of tiers) {
    const hit = stubs.find(tier);
    if (hit) return { kind: "metric", metric: hit };
  }
  const def = data.definitions.find((d) => d.term.toLowerCase() === q || d.slug === q || termParts(d.term).includes(q));
  if (def) return { kind: "definition", definition: def };
  return { kind: "none" };
}

/** Find a metric by exact name, abbreviation, alias, slug or formula id (see resolveMetric). */
export function findMetric(
  data: StandardData,
  name: string
): Metric | undefined {
  const r = resolveMetric(data, name);
  return r.kind === "metric" ? r.metric : undefined;
}

/**
 * Find a glossary definition by term, slug or abbreviation.
 * "CEL" matches "CEL (Commercial Event Ledger)" via the parenthetical.
 */
export function findDefinition(
  data: StandardData,
  name: string
): Definition | undefined {
  const q = name.toLowerCase().trim();
  if (!q) return undefined;
  return (
    data.definitions.find((d) => d.term.toLowerCase() === q) ||
    data.definitions.find((d) => d.slug === q) ||
    data.definitions.find((d) => termParts(d.term).includes(q))
  );
}

export type NodeResolution =
  | { kind: "node"; node: RelationshipNode }
  | { kind: "ambiguous"; candidates: Metric[] }
  /** No node; `metric` is set when the name is a metric that sits outside the graph */
  | { kind: "none"; metric?: Metric };

/**
 * Resolve a name to a graph node by exact match only. Entities and concepts
 * match by id, label, label parts or bare name ("customer" → entity_customer).
 * Metric names go through resolveMetric, so a name gives the same metric (or
 * the same ambiguity) in every tool. Never a substring guess.
 */
export function resolveNodeResult(data: StandardData, name: string): NodeResolution {
  const q = name.toLowerCase().trim();
  if (!q) return { kind: "none" };
  const idq = q.replace(/[\s-]+/g, "_");
  const isMetricNode = (n: RelationshipNode) => !n.nodeType || n.nodeType === "metric";
  const others = data.nodes.filter((n) => !isMetricNode(n));
  const direct =
    others.find((n) => n.id === q || n.id === idq || n.id === `entity_${idq}` || n.id === `concept_${idq}`) ||
    others.find((n) => n.label.toLowerCase() === q) ||
    others.find((n) => baseName(n.label) === q) ||
    others.find((n) => abbreviation(n.label) === q);
  if (direct) return { kind: "node", node: direct };
  const r = resolveMetric(data, name);
  if (r.kind === "ambiguous") return r;
  if (r.kind === "metric") {
    const id = ownNodeId(data, r.metric);
    const node = id ? data.nodes.find((n) => n.id === id) : undefined;
    return node ? { kind: "node", node } : { kind: "none", metric: r.metric };
  }
  // Metric node ids and labels no metric record carries
  const node =
    data.nodes.find((n) => isMetricNode(n) && (n.id === q || n.id === idq)) ||
    data.nodes.find((n) => isMetricNode(n) && n.label.toLowerCase() === q);
  return node ? { kind: "node", node } : { kind: "none" };
}

/** The node resolveNodeResult finds, or undefined when there is none or the name is ambiguous. */
export function resolveNode(data: StandardData, name: string): RelationshipNode | undefined {
  const r = resolveNodeResult(data, name);
  return r.kind === "node" ? r.node : undefined;
}

/** Nearest node labels, offered as suggestions rather than returned as the answer. */
export function suggestNodes(data: StandardData, name: string, limit = 6): string {
  const q = name.toLowerCase().trim();
  if (!q) return "";
  const byWord = data.nodes.filter((n) => n.id.includes(q) || n.label.toLowerCase().includes(q));
  const near = closest(q, data.nodes.map((n) => ({ item: n, names: [n.label, n.id] })), limit).map((c) => c.item);
  const hits = [...new Set([...byWord, ...near])].map((n) => `${n.label} (${n.id})`).slice(0, limit);
  return hits.length
    ? ` Did you mean: ${hits.join("; ")}? Pass the exact name or id.`
    : " No node label or id is close to it. The graph holds the Core and department metrics, entities and concepts only; use search to find the metric and lookup_metric to see whether it is in the graph.";
}

/**
 * Every metric that reads an entity's datasets, from ontology entityMappings
 * (keyed by formula id). Wider than the graph's `measures` edges, which only
 * the graph metrics carry.
 */
export function metricsMeasuring(data: StandardData, entityId: string): Metric[] {
  const ids = data.ontology?.entityMappings?.[entityId] ?? [];
  if (!ids.length) return [];
  const byFormula = new Map<string, Metric>();
  for (const m of data.metrics) {
    const id = formulaIdOf(data, m);
    if (!byFormula.has(id) || (stubOf(data, byFormula.get(id)!) && !stubOf(data, m))) byFormula.set(id, m);
  }
  return ids.map((id) => byFormula.get(id)).filter((m): m is Metric => !!m);
}

/** Get relationships for a metric: upstream (what drives it) and downstream (what it drives) */
export function getRelationships(
  data: StandardData,
  metricId: string
): {
  node: RelationshipNode | undefined;
  upstream: Array<{ node: RelationshipNode; type: string }>;
  downstream: Array<{ node: RelationshipNode; type: string }>;
  /** For an entity node: every metric reading its datasets (ontology entityMappings) */
  measuredBy: Metric[];
  /** Set when the name matches several metrics equally */
  ambiguous?: Metric[];
  /** Set when the name is a metric outside the relationship graph */
  outsideGraph?: Metric;
} {
  const r = resolveNodeResult(data, metricId);

  if (r.kind !== "node") {
    return {
      node: undefined, upstream: [], downstream: [], measuredBy: [],
      ...(r.kind === "ambiguous" ? { ambiguous: r.candidates } : {}),
      ...(r.kind === "none" && r.metric ? { outsideGraph: r.metric } : {}),
    };
  }
  const node = r.node;

  // Upstream = edges where this node is the target
  const upstream = data.edges
    .filter((e) => e.target === node.id)
    .map((e) => ({
      node: data.nodes.find((n) => n.id === e.source)!,
      type: e.type,
    }))
    .filter((r) => r.node);

  // Downstream = edges where this node is the source
  const downstream = data.edges
    .filter((e) => e.source === node.id)
    .map((e) => ({
      node: data.nodes.find((n) => n.id === e.target)!,
      type: e.type,
    }))
    .filter((r) => r.node);

  const measuredBy = node.nodeType === "entity" ? metricsMeasuring(data, node.id.replace(/^entity_/, "")) : [];
  return { node, upstream, downstream, measuredBy };
}
