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
    // taxonomy.json not yet created — default to operational
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
  // Some metrics intentionally appear in multiple department files — e.g. NRR
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
    // dualLens and dualLensNote are intentionally NOT enriched — they are a
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

  return { metrics, definitions, nodes, edges, dataRequirements, ontology, queryTemplates, metricNodeIds, formulas };
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
    const fieldTypes = Object.fromEntries(compiled.fields.map((fid) => [fid, fields[fid]?.type === "enum" ? "string" : fields[fid]?.type ?? "string"]));
    dataRequirements.push({
      metric: m.name, formulaId: id, fields: compiled.fields, fieldTypes, datasets: compiled.datasets, source, frequency, grain,
      exampleQuery: exampleSql(compiled.sql), description: m.definition, department: m.department, staged: compiled.staged,
      placeholders: compiled.placeholders,
    });
    queryTemplates[id] = {
      metric: m.name, fields: compiled.fields, datasets: compiled.datasets,
      sourceTable: compiled.datasets.length === 1 ? compiled.datasets[0] : null,
      grain, frequency, source, parameterizedQuery: compiled.sql, staged: compiled.staged, placeholders: compiled.placeholders,
    };
  }
  return { dataRequirements, queryTemplates };
}

/** True for cross-reference stubs ("See [Core](core.md#...)") that defer to another metric. */
export function isMetricStub(metric: Pick<Metric, "rawMarkdown">): boolean {
  return /See \[[^\]]+\]\([^)#]*#[^)]+\)/.test(metric.rawMarkdown);
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
 * Search metrics + definitions for a query string.
 * Returns top N matches ranked by relevance.
 */
export interface SearchResult {
  type: "metric" | "definition" | "data_requirement";
  name: string;
  snippet: string;
  department?: string;
  /** gaspwiki.com page for this result (absent for data requirements) */
  url?: string;
}

export function search(
  data: StandardData,
  query: string,
  limit: number = 10
): SearchResult[] {
  const q = query.toLowerCase();
  const results: Array<SearchResult & { score: number }> = [];

  for (const m of data.metrics) {
    const score = scoreMetric(m, q);
    if (score > 0) {
      const signalLabel = m.signalType.charAt(0).toUpperCase() + m.signalType.slice(1);
      results.push({
        type: "metric",
        name: m.name,
        snippet: `[${signalLabel}] ${m.definition || m.insight || ""}`,
        department: m.department,
        url: metricUrl(m),
        score,
      });
    }
  }

  for (const d of data.definitions) {
    const score = scoreDefinition(d, q);
    if (score > 0) {
      results.push({
        type: "definition",
        name: d.term,
        snippet: d.definition,
        url: definitionUrl(d),
        score,
      });
    }
  }

  for (const dr of data.dataRequirements || []) {
    let score = 0;
    if (dr.metric.toLowerCase() === q) score += 70;
    else if (dr.metric.toLowerCase().includes(q)) score += 35;
    if (dr.description.toLowerCase().includes(q)) score += 10;
    if (dr.fields.some((f) => f.toLowerCase().includes(q))) score += 15;
    if (dr.department.toLowerCase().includes(q)) score += 5;
    if (score > 0) {
      results.push({
        type: "data_requirement",
        name: dr.metric,
        snippet: `[${dr.department}] ${dr.description} (grain: ${dr.grain})`,
        department: dr.department,
        score,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map(({ score: _, ...rest }) => rest);
}

/** Score a metric against a query */
function scoreMetric(m: Metric, q: string): number {
  let score = 0;

  // Exact name match
  if (m.name.toLowerCase() === q) score += 100;
  // Name contains query
  else if (m.name.toLowerCase().includes(q)) score += 50;

  // Alias match
  for (const alias of m.aliases) {
    if (alias.toLowerCase() === q) score += 90;
    else if (alias.toLowerCase().includes(q)) score += 40;
  }

  // Definition contains query
  if (m.definition.toLowerCase().includes(q)) score += 20;

  // Formula contains query
  for (const f of m.formulas) {
    if (f.toLowerCase().includes(q)) score += 15;
  }

  // Category/department match
  if (m.department.toLowerCase().includes(q)) score += 10;
  if (m.category.toLowerCase().includes(q)) score += 10;

  // Raw markdown contains query (catch-all)
  if (score === 0 && m.rawMarkdown.toLowerCase().includes(q)) score += 5;

  return score;
}

/** Score a definition against a query */
function scoreDefinition(d: Definition, q: string): number {
  let score = 0;
  if (d.term.toLowerCase() === q) score += 80;
  else if (d.term.toLowerCase().includes(q)) score += 40;
  if (d.definition.toLowerCase().includes(q)) score += 15;
  if (d.section.toLowerCase().includes(q)) score += 5;
  return score;
}

/** Find a metric by name, abbreviation, or slug */
export function findMetric(
  data: StandardData,
  name: string
): Metric | undefined {
  const q = name.toLowerCase().trim();

  return (
    data.metrics.find((m) => m.name.toLowerCase() === q) ||
    data.metrics.find((m) =>
      m.aliases.some((a) => a.toLowerCase() === q)
    ) ||
    data.metrics.find((m) => m.slug === q) ||
    data.metrics.find((m) => m.name.toLowerCase().includes(q)) ||
    data.metrics.find((m) =>
      m.aliases.some((a) => a.toLowerCase().includes(q))
    )
  );
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
  const parts = (term: string) => {
    const m = term.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    return m ? [m[1].toLowerCase().trim(), m[2].toLowerCase().trim()] : [];
  };

  return (
    data.definitions.find((d) => d.term.toLowerCase() === q) ||
    data.definitions.find((d) => d.slug === q) ||
    data.definitions.find((d) => parts(d.term).includes(q))
  );
}

/**
 * Resolve a name to a graph node by exact match only: node id, label, label
 * without its abbreviation, the abbreviation, or a metric name, alias or slug
 * that maps to a node through metricNodeIds. Never a substring guess.
 */
export function resolveNode(data: StandardData, name: string): RelationshipNode | undefined {
  const q = name.toLowerCase().trim();
  if (!q) return undefined;
  const idq = q.replace(/[\s-]+/g, "_");
  const base = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase().trim();
  const abbr = (s: string) => s.match(/\(([^)]+)\)\s*$/)?.[1].toLowerCase();
  const direct =
    data.nodes.find((n) => n.id === q || n.id === idq) ||
    data.nodes.find((n) => n.label.toLowerCase() === q) ||
    data.nodes.find((n) => base(n.label) === q) ||
    data.nodes.find((n) => abbr(n.label) === q) ||
    data.nodes.find((n) => n.id === `entity_${idq}` || n.id === `concept_${idq}`);
  if (direct) return direct;
  const metric =
    data.metrics.find((m) => m.name.toLowerCase() === q) ||
    data.metrics.find((m) => base(m.name) === q) ||
    data.metrics.find((m) => m.aliases.some((a) => a.toLowerCase() === q)) ||
    data.metrics.find((m) => m.slug === q) ||
    data.metrics.find((m) => abbr(m.name) === q);
  const nodeId = metric && data.metricNodeIds?.[metric.slug];
  return nodeId ? data.nodes.find((n) => n.id === nodeId) : undefined;
}

/** Nearest node labels, offered as suggestions rather than returned as the answer. */
export function suggestNodes(data: StandardData, name: string, limit = 6): string {
  const q = name.toLowerCase().trim();
  if (!q) return "";
  const hits = data.nodes.filter((n) => n.id.includes(q) || n.label.toLowerCase().includes(q)).map((n) => `${n.label} (${n.id})`).slice(0, limit);
  return hits.length ? ` Did you mean: ${hits.join("; ")}? Pass the exact name or id.` : "";
}

/** Get relationships for a metric: upstream (what drives it) and downstream (what it drives) */
export function getRelationships(
  data: StandardData,
  metricId: string
): {
  node: RelationshipNode | undefined;
  upstream: Array<{ node: RelationshipNode; type: string }>;
  downstream: Array<{ node: RelationshipNode; type: string }>;
} {
  const node = resolveNode(data, metricId);

  if (!node) {
    return { node: undefined, upstream: [], downstream: [] };
  }

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

  return { node, upstream, downstream };
}
