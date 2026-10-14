#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  loadStandard,
  loadBundled,
  loadRemote,
  findDefinition,
  metricNodeId,
  getRelationships,
  resolveNodeResult,
  suggestNodes,
  search, metricFormulaId, isMetricStub } from "./loader.js";
import {
  buildContext,
  inferDrivers,
  findPaths,
  coverageGap,
  noDriversMessage,
  type PathStep,
  type TraversalCandidate,
} from "./traversal.js";
import { SITE, metricUrl, definitionUrl, nodeUrl, resolveDocLink } from "./urls.js";
import { formatCanonicalFormula, resolveMetric, suggestMatches, formatAmbiguous, fillTemplate, validateAdapter, formatDataRequirement, breakdownTemplate, breakdownRequirement, chooseDialect } from "./tools.js";
import { DIALECTS } from "./dialect.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { StandardData, RelationshipNode, Definition, Metric } from "./types.js";

// Load data: local repo files → bundled JSON → remote fetch from gaspwiki.com
let data: StandardData;
try {
  data = loadStandard();
} catch {
  try {
    data = loadBundled();
  } catch {
    try {
      data = await loadRemote();
    } catch (err) {
      console.error("Failed to load GASP Standard data:", err);
      process.exit(1);
    }
  }
}

// Background version check: non-blocking, stderr only
const VERSION_URL = "https://gaspwiki.com/api/standard-version.json";
(async () => {
  try {
    const res = await fetch(VERSION_URL);
    if (!res.ok) return;
    const remote = await res.json() as { metricCount: number; definitionCount: number; buildDate: string; contentHash?: string };
    const local = { metricCount: data.metrics.length, definitionCount: data.definitions.length };
    // Counts alone miss edits to existing metrics, so compare a hash of the full data when both sides have one.
    const localHash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
    const changed = remote.contentHash
      ? remote.contentHash !== localHash
      : remote.metricCount !== local.metricCount || remote.definitionCount !== local.definitionCount;
    if (changed) {
      console.error(
        `[gasp-standard] Update available: your data has ${local.metricCount} metrics / ${local.definitionCount} definitions, ` +
        `latest has ${remote.metricCount} / ${remote.definitionCount} (${remote.buildDate}). ` +
        `Run: npx gasp-standard-mcp@latest`
      );
    }
  } catch {
    // Offline or gaspwiki.com unreachable: silently ignore
  }
})();

const PKG_VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version;
const server = new McpServer({
  name: "gasp-standard",
  version: PKG_VERSION,
});

// Build traversal context once at startup. Used by infer_drivers, explain_path,
// and coverage_gap. Reads canonical structuredFormulas + edgeTypeClassification
// from ontology.json plus the edge `inverse` flag from relationships.json.
const traversalCtx = buildContext(data.nodes, data.edges, data.ontology);

/**
 * Resolve a user-supplied name to a graph node, exact matches only (see loader
 * resolveNodeResult). On a miss, `text` says why: several metrics share the
 * name, the metric sits outside the graph, or nothing matched.
 */
function resolveNode(name: string): { node: RelationshipNode; text?: undefined } | { node?: undefined; text: string } {
  const r = resolveNodeResult(data, name);
  if (r.kind === "node") return { node: r.node };
  if (r.kind === "ambiguous") return { text: formatAmbiguous(data, name, r.candidates) };
  if (r.metric) return { text: `${r.metric.name} (${r.metric.department}, ${metricUrl(r.metric)}) is not in the relationship graph.` };
  return { text: `No graph node is named "${name}".${suggestNodes(data, name)}` };
}

/** Department names as the data spells them, matched case-insensitively; undefined with the reply text on a miss. */
function matchDepartment(department: string, departments: string[]): { dept: string; text?: undefined } | { dept?: undefined; text: string } {
  const q = department.toLowerCase().trim();
  const exact = departments.find((d) => d.toLowerCase() === q || d.toLowerCase().replace(/\s+/g, "-") === q);
  if (exact) return { dept: exact };
  const near = departments.filter((d) => d.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || d.toLowerCase().startsWith(q));
  const hint = near.length ? ` Did you mean: ${near.join(", ")}?` : "";
  return { text: `No department is named "${department}".${hint}\n\nDepartments: ${departments.join(", ")}` };
}

/** Render a path as a markdown one-liner: `from → [type] to → [type] to`. */
function renderPath(path: PathStep[]): string {
  if (path.length === 0) return "(direct)";
  const parts: string[] = [path[0].from];
  for (const step of path) {
    const flip = step.directionFlip ? " ↓" : "";
    parts.push(`→ [${step.edgeType}${flip}] ${step.to}`);
  }
  return parts.join(" ");
}

function renderClassifications(path: PathStep[]): string {
  if (path.length === 0) return "";
  const counts = new Map<string, number>();
  for (const s of path) counts.set(s.classification, (counts.get(s.classification) ?? 0) + 1);
  return [...counts.entries()].map(([k, v]) => `${k}×${v}`).join(", ");
}

/** Markdown for a glossary definition, with absolute links so agents never guess URLs */
function formatDefinition(def: Definition): string {
  const absolutise = (md: string) => md.replace(/\]\((\/[^)]*)\)/g, `](${SITE}$1)`);
  const parts = [`# ${def.term}`, `**Type:** Definition (${def.section})`, `**URL:** ${definitionUrl(def)}`];
  parts.push(`\n**Definition:** ${absolutise(def.definition)}`);
  if (def.body) parts.push(absolutise(def.body));
  const canonical = def.canonicalLink ? resolveDocLink(def.canonicalLink) : null;
  if (canonical) parts.push(`\n**Canonical definition:** ${canonical}`);
  const reference = def.referenceLink ? resolveDocLink(def.referenceLink) : null;
  if (reference) parts.push(`\n**Reference:** ${reference}`);
  if (def.usedIn.length > 0) parts.push(`**Used in:** ${def.usedIn.join(", ")}`);
  return parts.join("\n").replace(/\bEOM Standard\b/g, "GASP Standard");
}

/** The reply when a name given to a metric-only tool is a glossary term or matches nothing. */
function notAMetric(name: string, resolved: { kind: "definition"; definition: Definition } | { kind: "none" }): string {
  if (resolved.kind === "definition") return `"${name}" is a glossary term, not a metric: use lookup_definition (${definitionUrl(resolved.definition)}).`;
  return `No metric is named "${name}".${suggestMatches(data, name)}`;
}

// --- Tool 1: lookup_metric ---
server.tool(
  "lookup_metric",
  "The full record of one GASP Standard metric: department, category, signal type, page URL, definition, the formulas as written, the canonical GASP grammar formula (unit, forms, variants, breakdowns, fields and datasets), benchmarks, validation rules, common mistakes, sources, aliases, the entities it measures, operating and market forms, any adjusted variant and the recommended sensitivity tier and access scope. The name must match exactly, ignoring case: formula id, graph node id, full name, name without its abbreviation, abbreviation, graph label, alias or slug. A name several departments use (e.g. 'Activation Rate') returns each candidate with department, formula id and URL; prefix the department ('Product Activation Rate') or pass the formula id. A glossary term (e.g. 'Signal Type') returns its definition and a miss returns close names to retry with. Use get_formula for the formula alone and search when you do not know the name.",
  { name: z.string().describe("Exact metric name, abbreviation, alias, slug or formula id, case-insensitive (e.g. 'MRR', 'Net Revenue Retention', 'CAC Payback', 'product_activation_rate'). Prefix the department to pick between metrics that share a name.") },
  async ({ name }) => {
    const resolved = resolveMetric(data, name);
    if (resolved.kind === "ambiguous") {
      return { content: [{ type: "text" as const, text: formatAmbiguous(data, name, resolved.candidates) }] };
    }
    if (resolved.kind === "definition") {
      return { content: [{ type: "text" as const, text: `No metric named "${name}". Matching glossary term:\n\n${formatDefinition(resolved.definition)}` }] };
    }
    if (resolved.kind === "none") {
      return { content: [{ type: "text" as const, text: `No metric or definition is named "${name}".${suggestMatches(data, name)}` }] };
    }
    const metric = resolved.metric;

    // Build response with branding swap
    const signalLabel = metric.signalType.charAt(0).toUpperCase() + metric.signalType.slice(1);
    const signalLine = metric.signalTypeSecondary
      ? `**Signal Type:** ${signalLabel} (+ ${metric.signalTypeSecondary.charAt(0).toUpperCase() + metric.signalTypeSecondary.slice(1)})`
      : `**Signal Type:** ${signalLabel}`;
    const parts: string[] = [
      `# ${metric.name}`,
      `**Department:** ${metric.department}`,
      `**Category:** ${metric.category}`,
      signalLine,
      `**URL:** ${metricUrl(metric)}`,
    ];

    if (metric.definition) {
      parts.push(`\n**Definition:** ${metric.definition}`);
    }

    if (metric.formulas.length > 0) {
      parts.push("\n**Formula(s):**");
      for (const f of metric.formulas) {
        parts.push("```\n" + f + "\n```");
      }
    }
    parts.push(...formatCanonicalFormula(data, metric));

    if (metric.benchmarks) {
      parts.push(`\n**Benchmarks:**\n${metric.benchmarks}`);
    }

    const rules = formatValidation(data, metric);
    if (rules) parts.push(`\n**Validation:** ${rules}`);

    if (metric.insight) {
      parts.push(`\n**What it tells you:** ${metric.insight}`);
    }

    if (metric.commonMistakes && metric.commonMistakes.length > 0) {
      parts.push(
        "\n**Common mistakes:**\n" +
          metric.commonMistakes.map((m) => `- ${m}`).join("\n")
      );
    }

    if (metric.sources.length > 0) {
      parts.push(
        "\n**Sources:**\n" + metric.sources.map((s) => `- ${s}`).join("\n")
      );
    }

    if (metric.aliases.length > 0) {
      parts.push(`\n**Aliases:** ${metric.aliases.join(", ")}`);
    }

    // Graph node id keys every ontology lookup below. Only the tested slug map
    // counts: the slug-prefix fallback would hand Product's Activation Rate the Onboarding node.
    const nodeId = data.metricNodeIds ? data.metricNodeIds[metric.slug] : metricNodeId(data, metric);

    // Entities whose datasets the formula reads (entityMappings is keyed by formula id)
    if (data.ontology?.entityMappings) {
      const formulaId = metricFormulaId(data, metric);
      const entities = Object.entries(data.ontology.entityMappings)
        .filter(([, metricIds]) => (metricIds as string[]).includes(formulaId))
        .map(([entityId]) => data.ontology!.entities.find((e) => e.id === entityId))
        .filter((e): e is NonNullable<typeof e> => !!e);
      if (entities.length) {
        parts.push(`\n**Measures:** ${entities.map((e) => `${e.label}${e.aliases.length ? ` (${e.aliases.join(", ")})` : ""}`).join("; ")}`);
      }
    }

    // Dual-lens content
    if (metric.dualLens) {
      const dl = metric.dualLens;
      parts.push("\n## Dual-Lens: Operating / Market Forms");

      parts.push(`\n### Operating Form: ${dl.operating.label}`);
      if (dl.operating.description) parts.push(dl.operating.description);
      if (dl.operating.celSource) parts.push(`**CEL Source:** ${dl.operating.celSource}`);
      if (dl.operating.atlInclusion) parts.push(`**ATL Inclusion:** ${dl.operating.atlInclusion}`);
      if (dl.operating.formula) parts.push("```\n" + dl.operating.formula + "\n```");
      if (dl.operating.insight) parts.push(`**What it tells you:** ${dl.operating.insight}`);

      parts.push(`\n### Market Form: ${dl.market.label}`);
      if (dl.market.description) parts.push(dl.market.description);
      if (dl.market.celSource) parts.push(`**CEL Source:** ${dl.market.celSource}`);
      if (dl.market.atlInclusion) parts.push(`**ATL Inclusion:** ${dl.market.atlInclusion}`);
      if (dl.market.formula) parts.push("```\n" + dl.market.formula + "\n```");
      if (dl.market.insight) parts.push(`**What it tells you:** ${dl.market.insight}`);

      parts.push("\n### Bridge");
      if (dl.bridge.reconciliation) parts.push("**Reconciliation:**\n```\n" + dl.bridge.reconciliation + "\n```");
      if (dl.bridge.diagnostic) parts.push(`**Diagnostic:** ${dl.bridge.diagnostic}`);
    }

    if (metric.dualLensNote) {
      parts.push(`\n## Dual-Lens Note\n\n${metric.dualLensNote}`);
    }

    // Adjusted variant from structured formulas (e.g. NRR, GRR)
    const sfMap = data.ontology?.structuredFormulas;
    if (sfMap && nodeId) {
      const sf = sfMap[nodeId];
      if (sf && typeof sf === 'object' && 'adjustedVariant' in sf) {
        parts.push(`\n## Adjusted Variant\n\n${(sf as any).adjustedVariant}`);
      }
    }

    // Access control classification (if available)
    const acMap = data.ontology?.accessControl?.classifications;
    if (acMap && nodeId) {
      const ac = acMap[nodeId];
      if (ac) {
        parts.push(
          `\n## Recommended Access Control\n` +
          `- **Sensitivity:** ${ac.sensitivityTier} (${SITE}/v1/definitions/sensitivity-tier)\n` +
          `- **Scope:** ${ac.accessScope} (${SITE}/v1/definitions/access-scope)\n` +
          `See ${SITE}/v1/governance for policy patterns (Cedar, OPA, warehouse RLS).`
        );
      }
    }

    // A glossary term with the exact name the caller asked for
    const shadowed = data.definitions.find((d) => d.term.toLowerCase() === name.toLowerCase().trim());
    if (shadowed) {
      parts.push(`\n**See also:** glossary term "${shadowed.term}" (${definitionUrl(shadowed)}), via lookup_definition`);
    }

    // Swap EOM → GASP branding
    const text = parts.join("\n").replace(/\bEOM Standard\b/g, "GASP Standard");

    return { content: [{ type: "text" as const, text }] };
  }
);

// --- Tool 2: list_metrics ---
server.tool(
  "list_metrics",
  "List GASP Standard metric names grouped by department and category, with the total, optionally filtered by department, signal type or both. Names only: use lookup_metric or get_formula for a metric's details. A metric cross-referenced from another department is listed under both (NRR under Core and Customer Success). The Core tier is the 'Core' department. An unknown department returns close names and the department list.",
  {
    department: z
      .string()
      .optional()
      .describe(
        "Department name, case-insensitive, with spaces or hyphens (e.g. 'Sales', 'customer success', 'customer-success', 'Core'). Omit to list every department."
      ),
    signalType: z
      .enum(["outcome", "leading", "efficiency", "operational"])
      .optional()
      .describe(
        "outcome, leading, efficiency or operational. Matches a metric's primary or secondary signal type."
      ),
  },
  async ({ department, signalType }) => {
    let filtered = data.metrics;
    if (department) {
      const match = matchDepartment(department, [...new Set(data.metrics.map((m) => m.department))].sort());
      if (match.text !== undefined) return { content: [{ type: "text" as const, text: match.text }] };
      filtered = filtered.filter((m) => m.department === match.dept);
    }
    if (signalType) {
      filtered = filtered.filter(
        (m) => m.signalType === signalType || m.signalTypeSecondary === signalType
      );
    }

    if (filtered.length === 0) {
      const departments = [
        ...new Set(data.metrics.map((m) => m.department)),
      ].sort();
      return {
        content: [
          {
            type: "text" as const,
            text: `No metrics found${department ? ` for department "${department}"` : ""}${signalType ? ` with signal type ${signalType}` : ""}.\n\nAvailable departments: ${departments.join(", ")}`,
          },
        ],
      };
    }

    // Group by department then category
    const grouped = new Map<string, Map<string, string[]>>();
    for (const m of filtered) {
      if (!grouped.has(m.department)) {
        grouped.set(m.department, new Map());
      }
      const dept = grouped.get(m.department)!;
      if (!dept.has(m.category)) {
        dept.set(m.category, []);
      }
      dept.get(m.category)!.push(m.name);
    }

    // A metric cross-referenced from another department is listed under both but counted once.
    const distinct = new Set(filtered.map((m) => metricFormulaId(data, m))).size;
    const parts: string[] = [`# GASP Standard Metrics (${distinct} total${distinct < filtered.length ? `, ${filtered.length} listings` : ""})\n`];
    for (const [dept, categories] of grouped) {
      parts.push(`## ${dept}`);
      for (const [cat, names] of categories) {
        if (cat) parts.push(`### ${cat}`);
        for (const n of names) {
          parts.push(`- ${n}`);
        }
      }
      parts.push("");
    }

    return { content: [{ type: "text" as const, text: parts.join("\n") }] };
  }
);

// --- Tool 3: get_formula ---
server.tool(
  "get_formula",
  "The canonical formula of one GASP Standard metric in the GASP grammar, with its unit, operating (O) and market (M) forms, named variants, breakdowns (one row per value of a field or bucket; total() reads the whole population), notes, the metrics it reads with role and polarity, the fields and datasets the formula and each form read, the enum filters each form applies (so forms reading the same fields show where they differ) and the formula as written in the standard. A metric that cannot be computed as one formula gives the reason. Names resolve as in lookup_metric. Use get_data_requirements for field types and example SQL and generate_query for SQL against your own tables.",
  { metric: z.string().describe("Exact metric name, abbreviation, alias or formula id (e.g. 'NRR', 'LTV', 'CAC Payback', 'aging_buckets'). A name several departments use returns the candidates to choose from.") },
  async ({ metric: name }) => {
    const resolved = resolveMetric(data, name);
    if (resolved.kind === "ambiguous") {
      return { content: [{ type: "text" as const, text: formatAmbiguous(data, name, resolved.candidates) }] };
    }
    if (resolved.kind !== "metric") {
      return { content: [{ type: "text" as const, text: notAMetric(name, resolved) }] };
    }
    const metric = resolved.metric;
    const parts = [`# ${metric.name}: Formula`, `**URL:** ${metricUrl(metric)}`, ""];
    const canonical = formatCanonicalFormula(data, metric);
    if (canonical.length === 0 && metric.formulas.length === 0) {
      parts.push(`${metric.name} has no formula in the standard.`);
    }
    parts.push(...canonical);
    if (metric.formulas.length > 0) {
      parts.push("\n## As written in the standard");
      for (let i = 0; i < metric.formulas.length; i++) {
        if (metric.formulas.length > 1) parts.push(`**Formula ${i + 1}:**`);
        parts.push("```\n" + metric.formulas[i] + "\n```");
      }
    }
    const text = parts.join("\n").replace(/\bEOM Standard\b/g, "GASP Standard");
    return { content: [{ type: "text" as const, text }] };
  }
);

/** One-line summary of a metric's hard constraints from ontology validationRules (benchmarks are shown separately). */
function formatValidation(d: StandardData, metric: Metric): string {
  const rules = d.ontology?.validationRules?.[metric.slug];
  if (!rules) return "";
  const bits: string[] = [];
  for (const r of rules) {
    const unit = r.unit ? ` ${r.unit}` : "";
    const note = r.note ? ` (${r.note})` : "";
    if (r.type === "min") bits.push(`at least ${r.value}${unit}${note}`);
    else if (r.type === "max") bits.push(`at most ${r.value}${unit}${note}`);
    else if (r.type === "target") bits.push(`target ${r.value}${unit}${note}`);
    else if (r.type === "window" || r.type === "period") bits.push(`${r.type} ${String(r.value).replace(/_/g, " ")}${note}`);
    else if (r.type === "unit") bits.push(`unit ${r.value}`);
  }
  const bench = rules.filter((r) => r.type === "benchmarks" && r.ranges?.length).length;
  if (bench) bits.push("benchmark ranges in the standard");
  return bits.join("; ");
}

// --- Tool 4: get_relationships ---
server.tool(
  "get_relationships",
  "One node of the GASP relationship graph (a metric, entity or concept) with its description, category and level and its direct edges, each neighbour with its edge type and description: upstream (edges into it), the metrics that measure it, downstream (edges out of it) and, for a metric, the entities it measures. For an entity it also lists every metric whose formula reads the entity's datasets, with department and URL. Edge types: drives, reduces, predicts, component and measures (metric signal); converts_to, parent_of and belongs_to (lifecycle); owns, grants and priced_by (ownership); manages, serves, engages_via, submits, represented_by and sources (interaction); generates, produces, contributes_to and incurs (financial flow). Metric names resolve as in lookup_metric; a metric outside the graph says so and a miss lists every node. Use infer_drivers or explain_path to walk more than one hop.",
  { metric: z.string().describe("Metric name, abbreviation or graph id (e.g. 'NRR', 'arr'), entity (e.g. 'customer', 'subscription') or concept (e.g. 'revenue', 'bookings'). Entity and concept names win over a metric with the same name.") },
  async ({ metric: name }) => {
    const { node, upstream, downstream, measuredBy: readers, ambiguous, outsideGraph } = getRelationships(data, name);

    if (ambiguous) return { content: [{ type: "text" as const, text: formatAmbiguous(data, name, ambiguous) }] };
    if (outsideGraph) {
      return { content: [{ type: "text" as const, text: `${outsideGraph.name} (${outsideGraph.department}, ${metricUrl(outsideGraph)}) is not in the relationship graph, which holds ${data.nodes.filter((n) => !n.nodeType || n.nodeType === "metric").length} metrics. Use get_formula for the metrics and fields it reads.` }] };
    }
    if (!node) {
      const available = data.nodes.map((n) => `${n.label} (${n.id})`).join(", ");
      return {
        content: [
          {
            type: "text" as const,
            text: `No relationship node is named "${name}".${suggestNodes(data, name)}\n\nAvailable nodes: ${available}`,
          },
        ],
      };
    }

    const kind = node.nodeType ?? "metric";
    const parts: string[] = [
      `# ${node.label}: relationships\n`,
      `**Description:** ${node.description}`,
      `**Category:** ${node.category}`,
      `**Level:** ${node.level}`,
      `**URL:** ${nodeUrl(node)}\n`,
    ];
    const neighbour = (r: { node: RelationshipNode; type: string }) => `- **${r.node.label}** (${r.type}): ${r.node.description} ${nodeUrl(r.node)}`;

    const upDrivers = upstream.filter((r) => r.type !== "measures");
    const measuredBy = upstream.filter((r) => r.type === "measures");
    const downDriven = downstream.filter((r) => r.type !== "measures");
    const measures = downstream.filter((r) => r.type === "measures");

    if (upDrivers.length > 0) {
      parts.push(kind === "metric" ? "## Upstream (what drives this metric)" : `## Upstream (edges into this ${kind})`);
      for (const r of upDrivers) parts.push(neighbour(r));
      parts.push("");
    } else {
      parts.push(kind === "metric" ? "## Upstream\nNo upstream drivers (this is a top-level metric).\n" : `## Upstream\nNo edges lead into this ${kind}.\n`);
    }

    if (measuredBy.length > 0) {
      parts.push("## Measured by (metrics that measure this)");
      for (const r of measuredBy) parts.push(neighbour(r));
      parts.push("");
    }

    if (downDriven.length > 0) {
      parts.push(kind === "metric" ? "## Downstream (what this metric drives)" : `## Downstream (edges out of this ${kind})`);
      for (const r of downDriven) parts.push(neighbour(r));
    } else {
      parts.push(kind === "metric" ? "## Downstream\nNo downstream metrics (this is a leaf metric)." : `## Downstream\nNo edges lead out of this ${kind}.`);
    }

    if (measures.length > 0) {
      parts.push("\n## Measures (what this metric measures)");
      for (const r of measures) parts.push(neighbour(r));
    }

    if (readers.length > 0) {
      parts.push(`\n## Measured by, from the ontology (${readers.length} metrics reading this entity's datasets)`);
      for (const m of readers) parts.push(`- **${m.name}** (${m.department}): ${metricUrl(m)}`);
    }

    return { content: [{ type: "text" as const, text: parts.join("\n") }] };
  }
);

// --- Tool 5: get_data_requirements ---
server.tool(
  "get_data_requirements",
  "What a warehouse needs to compute GASP Standard metrics: per metric, a row for each field and dataset pair the canonical formula reads with its type, whether it is staged (a cohort or prior-period comparison), source system, grain, frequency, page URL and example SQL compiled from the formula. Pass metric for one metric (resolved as in lookup_metric), department for every metric in it, both to pick between metrics that share a name and neither for every metric with a formula. breakdown names a breakdown the metric declares (get_formula lists them, e.g. 'by_plan' on MRR): the fields then include the dimension and the SQL returns one row per value. dialect (postgres, snowflake, bigquery or databricks; postgres is the default and also covers Redshift) sets the example SQL's syntax. A metric with no formula gives the reason. Use generate_query to fill the SQL from your adapter.",
  {
    metric: z
      .string()
      .optional()
      .describe("Exact metric name, abbreviation, alias or formula id (e.g. 'ARR', 'Pipeline Coverage Ratio', 'CSAT')"),
    department: z
      .string()
      .optional()
      .describe(
        "Department name, case-insensitive (e.g. 'Sales', 'Engineering', 'customer success'). Alone it returns every requirement in the department; with metric it picks between metrics that share a name."
      ),
    breakdown: z.string().optional().describe("Name of a breakdown the metric declares (e.g. 'by_plan' or 'by_segment' on MRR); needs metric. The requirement then covers the breakdown's query, one row per value. An unknown name lists the declared ones."),
    dialect: z.enum(DIALECTS).optional().describe("Dialect of the example SQL: postgres (default, also Redshift), snowflake, bigquery or databricks. Any but postgres needs metric."),
  },
  async ({ metric, department, breakdown, dialect }) => {
    const all = data.dataRequirements || [];
    const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
    let dept: string | undefined;
    if (department) {
      const match = matchDepartment(department, [...new Set(data.metrics.map((m) => m.department))].sort());
      if (match.text !== undefined) return text(match.text);
      dept = match.dept;
    }
    let filtered = dept ? all.filter((dr) => dr.department === dept) : all;

    if (metric) {
      let resolved = resolveMetric(data, metric);
      if (resolved.kind === "ambiguous" && dept) {
        const inDept = resolved.candidates.filter((m) => m.department === dept);
        if (inDept.length === 1) resolved = { kind: "metric", metric: inDept[0] };
      }
      if (resolved.kind === "ambiguous") return text(formatAmbiguous(data, metric, resolved.candidates));
      if (resolved.kind !== "metric") return text(notAMetric(metric, resolved));
      const id = metricFormulaId(data, resolved.metric);
      filtered = all.filter((dr) => dr.formulaId === id);
      if (filtered.length === 0) {
        const f = data.formulas?.[id];
        const why = f?.notComputable ? `it has no single formula: ${f.notComputable}` : "it has no canonical formula yet";
        return text(`${resolved.metric.name} (${resolved.metric.department}, ${metricUrl(resolved.metric)}) has no data requirements: ${why}.`);
      }
      if (breakdown || (dialect && dialect !== "postgres")) {
        const b = breakdownRequirement(data, id, breakdown, dialect);
        if ("error" in b) return text(b.error);
        filtered = [b.requirement];
      }
    } else if (breakdown) {
      return text("breakdown needs metric: name the metric whose breakdown you want (e.g. metric 'MRR', breakdown 'by_plan').");
    } else if (dialect && dialect !== "postgres") {
      return text("dialect needs metric: name the metric whose SQL you want in that dialect.");
    }

    if (filtered.length === 0) {
      return text(`No data requirements found in department "${dept}".`);
    }

    // Formula id → metric page, preferring the full record over a cross-reference stub
    const pages = new Map<string, string>();
    for (const m of data.metrics) {
      const id = metricFormulaId(data, m);
      if (!pages.has(id) || !isMetricStub(m)) pages.set(id, metricUrl(m));
    }

    const parts: string[] = [
      `# Data Requirements (${filtered.length} ${filtered.length === 1 ? "entry" : "entries"}${metric && dialect ? `, example SQL in ${dialect}` : ""})\n`,
    ];

    // Group by department
    const grouped = new Map<string, typeof filtered>();
    for (const dr of filtered) {
      if (!grouped.has(dr.department)) grouped.set(dr.department, []);
      grouped.get(dr.department)!.push(dr);
    }

    for (const [dept, drs] of grouped) {
      parts.push(`## ${dept}\n`);
      for (const dr of drs) parts.push(formatDataRequirement(dr, pages.get(dr.formulaId)));
    }

    return text(parts.join("\n"));
  }
);

// --- Tool 6: search ---
server.tool(
  "search",
  "Find GASP Standard metrics and glossary terms when you do not know the exact name. The query matches as a phrase of whole words, the last word allowing a plural or verb ending ('churn' finds 'churned'), against metric names, aliases, definitions, formulas, the fields each formula reads, categories and departments, plus glossary terms, definitions and sections. Returns up to 10 results, one per metric or term, each with its type, department, what matched, a snippet and its URL. Names, aliases and terms rank first, then words within them, then definitions, then formulas and fields. When nothing matches (e.g. a misspelling) it returns up to 6 close names labelled 'Did you mean'. Pass a result's name to lookup_metric or lookup_definition.",
  { query: z.string().describe("Words to find (e.g. 'churn', 'retention', 'pipeline coverage', 'opportunity_stage')") },
  async ({ query: q }) => {
    const results = search(data, q, 10);

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No results found for "${q}". Try fewer or broader words, or list_metrics to browse by department.`,
          },
        ],
      };
    }

    const parts: string[] = results[0].didYouMean
      ? [`# No matches for "${q}". Did you mean:\n`]
      : [`# Search results for "${q}" (${results.length} matches)\n`];
    for (const r of results) {
      const dept = r.department ? ` [${r.department}]` : "";
      parts.push(`### ${r.name}${dept}`);
      parts.push(`*${r.type}*${r.didYouMean ? "" : ` (matched ${r.matched})`}: ${r.snippet}`);
      parts.push(r.url ? `URL: ${r.url}\n` : "");
    }

    return { content: [{ type: "text" as const, text: parts.join("\n") }] };
  }
);

// --- Tool 7: generate_query ---
server.tool(
  "generate_query",
  "SQL for one GASP Standard metric against your warehouse, compiled from its canonical formula and filled from your adapter: one scalar subquery per aggregate, each reading the table mapped to its GASP dataset, with :period_start and :period_end date parameters (both inclusive). Pairs you have not mapped stay as {{field@dataset}} placeholders, where the tag names the GASP dataset the column must come from; the output lists them with any dataset that has no table and any mapping conflict, plus the URL, dialect, datasets, grain and the mapping it used. breakdown names a breakdown the metric declares (get_formula lists them, e.g. 'by_plan' on MRR) and returns one row per value. The dialect (postgres, snowflake, bigquery or databricks; postgres also covers Redshift) is the dialect argument, else the adapter's warehouse when it names one of them, else postgres. Check the adapter with validate_adapter first.",
  {
    metric: z.string().describe("Exact metric name, abbreviation, alias or formula id (e.g. 'NRR', 'CAC', 'Pipeline Value', 'ARR'), resolved as in lookup_metric"),
    adapter: z.string().describe("Your GASP adapter as a JSON string (schema: https://gaspwiki.com/schemas/gasp-adapter-v1.json; check it with validate_adapter)"),
    breakdown: z.string().optional().describe("Name of a breakdown the metric declares (e.g. 'by_plan' on MRR). The query returns one row per value of the breakdown's field or bucket. An unknown name lists the declared ones."),
    dialect: z.enum(DIALECTS).optional().describe("SQL dialect: postgres (also Redshift), snowflake, bigquery or databricks. Omit to use the adapter's warehouse when it names one of them (postgresql and redshift read as postgres), else postgres."),
  },
  async ({ metric: metricName, adapter: adapterJson, breakdown, dialect: requestedDialect }) => {
    const resolved = resolveMetric(data, metricName);
    if (resolved.kind === "ambiguous") {
      return { content: [{ type: "text" as const, text: formatAmbiguous(data, metricName, resolved.candidates) }] };
    }
    if (resolved.kind !== "metric") {
      return { content: [{ type: "text" as const, text: notAMetric(metricName, resolved) }] };
    }
    let adapter: any;
    try { adapter = JSON.parse(adapterJson); } catch { return { content: [{ type: "text" as const, text: "Invalid adapter JSON: pass the adapter as a JSON string." }] }; }
    if (!Array.isArray(adapter?.mappings)) {
      return { content: [{ type: "text" as const, text: 'Adapter must have a "mappings" array. Template: https://gaspwiki.com/downloads/gasp-adapter-template.json' }] };
    }
    const id = metricFormulaId(data, resolved.metric);
    let template = data.queryTemplates?.[id];
    if (!template) {
      const f = data.formulas?.[id];
      const why = f?.notComputable ? `It has no single formula: ${f.notComputable}` : "It has no canonical formula yet.";
      return { content: [{ type: "text" as const, text: `${resolved.metric.name} cannot be compiled to SQL. ${why}` }] };
    }
    const chosen = chooseDialect(requestedDialect, adapter.warehouse);
    if ("error" in chosen) return { content: [{ type: "text" as const, text: chosen.error }] };
    if (breakdown || chosen.dialect !== "postgres") {
      const b = breakdownTemplate(data, id, breakdown, chosen.dialect);
      if ("error" in b) return { content: [{ type: "text" as const, text: b.error }] };
      template = b.template;
    }
    const r = fillTemplate(template, adapter, data);
    const parts: string[] = [
      `# ${resolved.metric.name}: Generated SQL`, `**URL:** ${metricUrl(resolved.metric)}`,
      `**Warehouse:** ${adapter.warehouse || "not specified"}`, `**Dialect:** ${chosen.note}`, `**Datasets:** ${template.datasets.join(", ")}`, `**Grain:** ${template.grain}`,
      `**Fields mapped:** ${r.mapped.length} / ${template.placeholders.length} (field and dataset pairs)`,
    ];
    if (template.breakdown) parts.push(`**Breakdown${breakdown ? ` \`${breakdown}\`` : ""}:** the query returns one row per \`${template.breakdown.field}\` value${template.breakdown.via ? `, with its \`${template.breakdown.via.key}\` (read from ${template.breakdown.via.dataset})` : ""}.`);
    if (template.staged) parts.push("**Note:** this metric uses a cohort or a prior-period comparison; the query is correct but each aggregate re-reads the table. A staged dataset makes it cheaper.");
    if (r.missingFields.length) parts.push(`**Unmapped fields (left as placeholders):** \`${r.missingFields.join("\`, \`")}\``);
    if (r.missingTables.length) parts.push(`**Datasets with no table:** ${r.missingTables.join(", ")}. Name a table for each under \"datasets\" in the adapter, or map one of its fields with a schema.table column reference.`);
    for (const c of r.conflicts) parts.push(`**Conflict:** ${c}`);
    parts.push("", "Parameters: `:period_start` and `:period_end` are the first and last dates of the reporting period, both inclusive.", "", "```sql\n" + r.sql + "\n```");
    if (r.mapped.length) {
      parts.push("\n**Field mapping used:**");
      for (const m of r.mapped) parts.push(`- \`${m.field}\` (${m.dataset}) → \`${m.ref}\`${m.transform ? ` (transform: ${m.transform})` : ""}`);
    }
    return { content: [{ type: "text" as const, text: parts.join("\n") }] };
  }
);

// --- Tool 8: validate_adapter ---
server.tool(
  "validate_adapter",
  "Check a GASP adapter against the standard and score its coverage. It first applies the adapter JSON Schema (https://gaspwiki.com/schemas/gasp-adapter-v1.json, versions 1.0 and 1.1) and lists each violation with its JSON path: missing version or mappings, unknown version values, keys the schema does not allow and values of the wrong type. Then, whether or not the schema passed, it reports gaspField values not in the ontology, unknown datasets, fields mapped to a dataset that does not carry them, bare column names on fields that live on several datasets, datasets whose fields point at different tables and pairs mapped twice. It counts the field and dataset pairs mapped and the datasets with a table, scores every metric with a formula against the pairs its compiled SQL reads (fully covered, partially covered with the missing pairs, not covered), lists enum fields mapped without a transform, covered metrics with no declared owner and owners naming unknown metrics. It also ranks up to 15 unmapped pairs by how many partially covered metrics need them. Without a mappings array only the schema result is returned. Run it before generate_query.",
  { adapter: z.string().describe("The adapter JSON as a string. Template: https://gaspwiki.com/downloads/gasp-adapter-template.json") },
  async ({ adapter: adapterJson }) => {
    let adapter: any;
    try { adapter = JSON.parse(adapterJson); } catch { return { content: [{ type: "text" as const, text: "Invalid JSON. The adapter must be a valid JSON object." }] }; }
    const text = validateAdapter(adapter, data);
    return { content: [{ type: "text" as const, text }] };
  }
);

// --- Tool 9: infer_drivers ---
server.tool(
  "infer_drivers",
  "Rank the upstream metrics that could explain an observed movement in a metric. Walks the GASP relationship graph backwards from the metric up to maxDepth edges and returns up to 25 candidates, each with the direction it would have moved, a score and its path to the metric. Direction flips across a reduces edge and across an input with negative polarity (a denominator or subtracted term), marked ↓ in the path. A baseline input (read at period start, as NRR reads MRR) is listed as a candidate but not walked through, since its own drivers cannot move the metric within the period. Scores are products of edge attenuations: they rank structural links and say nothing about magnitude. Works on metric nodes only. Follow up with explain_path for the chain behind a candidate or coverage_gap to check you track it; for 'what if' simulation use the TWIN Modifier at https://gaspwiki.com/v1/twin-modifier.",
  {
    metric: z.string().describe("Metric name, abbreviation or graph id (e.g. 'ARR', 'Net Revenue Retention', 'nrr'), resolved as in lookup_metric. It must be a metric in the relationship graph."),
    direction: z.enum(["up", "down"]).describe("Observed movement of the metric: up or down"),
    maxDepth: z.number().int().min(1).max(8).optional().describe("Maximum number of edges to walk back, 1 to 8 (default 6)"),
  },
  async ({ metric: name, direction: dirStr, maxDepth }) => {
    const { node, text: missing } = resolveNode(name);
    if (!node) {
      return { content: [{ type: "text" as const, text: missing! }] };
    }
    if (!traversalCtx.metricNodeIds.has(node.id)) {
      return {
        content: [{ type: "text" as const, text: `"${node.label}" is ${node.nodeType === "concept" ? "a concept" : "an entity"}, not a metric. infer_drivers works on metric nodes only; use get_relationships for an entity or concept.` }],
      };
    }

    const observedDirection = dirStr === "up" ? 1 : -1;
    const candidates = inferDrivers(node.id, observedDirection, traversalCtx, { maxDepth });

    if (candidates.length === 0) {
      return {
        content: [{ type: "text" as const, text: `# ${node.label} ${dirStr}\n\n${noDriversMessage(node.id, traversalCtx)}` }],
      };
    }

    const arrow = (d: 1 | -1) => (d === 1 ? "↑" : "↓");
    const parts: string[] = [
      `# ${node.label} ${arrow(observedDirection as 1 | -1)}: candidate drivers (${candidates.length})\n`,
      `_Structural reasoning, not numeric forecasting. Scores are attenuation products (0–1) along the chain; they rank candidates but do not estimate magnitudes._\n`,
      `| # | Driver | Implied direction | Score | Path |`,
      `|---|--------|------------------|-------|------|`,
    ];

    for (let i = 0; i < Math.min(candidates.length, 25); i++) {
      const c = candidates[i];
      parts.push(`| ${i + 1} | ${c.label ?? c.id} (\`${c.id}\`) | ${arrow(c.direction)} | ${c.score.toFixed(3)} | ${renderPath(c.path)} |`);
    }
    if (candidates.length > 25) {
      parts.push(`\n_Showing top 25 of ${candidates.length}._`);
    }

    return { content: [{ type: "text" as const, text: parts.join("\n") }] };
  }
);

// --- Tool 10: explain_path ---
server.tool(
  "explain_path",
  "How a movement in one graph node reaches another: up to 5 chains of edges followed forward from `from` to `to`, shortest first, then by highest score. Each step gives the edge type, its classification (metric_signal, structural, lifecycle, behavioral, assignment or generative), its attenuation and whether it inverts direction; each path gives its score and the direction the target moves when the source rises. A baseline edge (MRR into NRR) can only start a path. Names resolve as in get_relationships, so entities and concepts work too. No path means no forward chain within maxDepth: try the reverse. Use it on a candidate from infer_drivers.",
  {
    from: z.string().describe("Starting node: a metric name, abbreviation or graph id, or an entity or concept (e.g. 'Health Score', 'customer')"),
    to: z.string().describe("Target node, in the same forms as from (e.g. 'NRR')"),
    maxDepth: z.number().int().min(1).max(8).optional().describe("Maximum chain length in edges, 1 to 8 (default 6)"),
  },
  async ({ from, to, maxDepth }) => {
    const fromHit = resolveNode(from);
    const toHit = resolveNode(to);
    if (!fromHit.node || !toHit.node) {
      return { content: [{ type: "text" as const, text: (fromHit.text ?? toHit.text)! }] };
    }
    const fromNode = fromHit.node;
    const toNode = toHit.node;

    const paths = findPaths(fromNode.id, toNode.id, traversalCtx, { maxDepth });

    if (paths.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `# ${fromNode.label} → ${toNode.label}\n\nNo forward path found within depth ${maxDepth ?? 6}. They may be connected only in the other direction (swap from and to) or the chain may be longer than maxDepth.`,
        }],
      };
    }

    const parts: string[] = [
      `# ${fromNode.label} → ${toNode.label}: ${paths.length} path${paths.length === 1 ? "" : "s"}\n`,
      `_End direction: how ${toNode.label} moves when ${fromNode.label} rises along that path. Scores are products of edge attenuations and say nothing about magnitude._\n`,
    ];

    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      parts.push(`## Path ${i + 1}: ${p.path.length} step${p.path.length === 1 ? "" : "s"}, score ${p.score.toFixed(3)}, end direction ${p.direction === 1 ? "↑" : "↓"}`);
      parts.push(`Classifications: ${renderClassifications(p.path)}\n`);
      for (let j = 0; j < p.path.length; j++) {
        const s = p.path[j];
        const flip = s.directionFlip ? " (↓ inverts direction)" : "";
        const fromLabel = traversalCtx.nodeById.get(s.from)?.label ?? s.from;
        const toLabel = traversalCtx.nodeById.get(s.to)?.label ?? s.to;
        parts.push(`${j + 1}. **${fromLabel}** → **${toLabel}**: \`${s.edgeType}\` (${s.classification}, attenuation ${s.attenuation.toFixed(2)})${flip}`);
      }
      parts.push("");
    }

    return { content: [{ type: "text" as const, text: parts.join("\n") }] };
  }
);

// --- Tool 11: coverage_gap ---
server.tool(
  "coverage_gap",
  "Audit a set of tracked metrics against the GASP relationship graph. Returns three lists: upstream missing (metrics with a direct edge into the set that the set leaves out), downstream missing (metrics with a direct edge from the set that it leaves out) and disconnected (graph metrics with no path of any length, in either direction and through any node, to the set; the first 25 shown). Names resolve as in lookup_metric; an input that is ambiguous, outside the graph, not a metric or unknown is listed as unresolved with the reason. Use it before instrumenting a dashboard, then infer_drivers or explain_path on the candidates.",
  {
    metrics: z.array(z.string()).min(1).describe("The metrics you track, as names, abbreviations or graph ids (e.g. ['ARR', 'NRR', 'CAC'])"),
  },
  async ({ metrics }) => {
    const resolved: string[] = [];
    const unresolved: string[] = [];
    for (const m of metrics) {
      const { node } = resolveNode(m);
      if (node && traversalCtx.metricNodeIds.has(node.id)) {
        resolved.push(node.id);
      } else {
        const r = resolveNodeResult(data, m);
        unresolved.push(
          r.kind === "ambiguous" ? `${m} (ambiguous: ${r.candidates.map((c) => `\`${metricFormulaId(data, c)}\``).join(" or ")})`
          : r.kind === "node" ? `${m} (${r.node.nodeType === "concept" ? "a concept" : "an entity"}, not a metric)`
          : r.metric ? `${m} (not in the relationship graph)`
          : `${m} (no match)`,
        );
      }
    }

    if (resolved.length === 0) {
      return {
        content: [{ type: "text" as const, text: `No input resolved to a metric in the relationship graph: ${unresolved.join(", ")}. Pass graph ids ('arr', 'nrr', 'cac') or names ('NRR', 'Net Revenue Retention').` }],
      };
    }

    const result = coverageGap(new Set(resolved), traversalCtx);

    const labelOf = (id: string) => traversalCtx.nodeById.get(id)?.label ?? id;
    const formatList = (ids: string[]) =>
      ids.length === 0 ? "_(none)_" : ids.map((id) => `- ${labelOf(id)} (\`${id}\`)`).join("\n");

    const parts: string[] = [
      `# Coverage gap: ${resolved.length} metric${resolved.length === 1 ? "" : "s"}\n`,
      `**Tracked:** ${resolved.map((id) => `${labelOf(id)} (\`${id}\`)`).join(", ")}`,
    ];
    if (unresolved.length > 0) {
      parts.push(`**Unresolved input:** ${unresolved.join(", ")}`);
    }
    parts.push("");

    parts.push(`## Upstream missing (${result.upstreamMissing.length})`);
    parts.push(`_Metrics with a direct edge into the tracked set that you do not track. Adding them shows what moves the set._\n`);
    parts.push(formatList(result.upstreamMissing));
    parts.push("");

    parts.push(`## Downstream missing (${result.downstreamMissing.length})`);
    parts.push(`_Metrics with a direct edge from the tracked set that you do not track. Adding them shows what the set moves._\n`);
    parts.push(formatList(result.downstreamMissing));
    parts.push("");

    parts.push(`## Disconnected (${result.disconnected.length})`);
    parts.push(`_Graph metrics with no path of any length, in either direction, to the tracked set._\n`);
    if (result.disconnected.length > 25) {
      parts.push(formatList(result.disconnected.slice(0, 25)));
      parts.push(`\n_…and ${result.disconnected.length - 25} more._`);
    } else {
      parts.push(formatList(result.disconnected));
    }

    return { content: [{ type: "text" as const, text: parts.join("\n") }] };
  }
);

// Start the server
// --- Tool 12: lookup_definition ---
server.tool(
  "lookup_definition",
  "Look up a GASP Standard glossary term (e.g. 'Signal Type', 'Sensitivity Tier', 'Access Scope', 'Metric Owner', 'CEL'): the full definition and body, its section, the canonical or reference link, where it is used and the page URL. The term must match exactly, ignoring case: the term, its slug or either part of 'Term (Abbreviation)', so 'CEL' finds 'CEL (Commercial Event Ledger)'. A metric name points you to lookup_metric and a miss returns close names. Some metrics also have a short glossary entry (Logo Churn Rate, Win Rate); lookup_metric gives their formula and benchmarks.",
  { term: z.string().describe("Exact term, abbreviation or slug, case-insensitive (e.g. 'Signal Type', 'CEL', 'metric-owner')") },
  async ({ term }) => {
    const def = findDefinition(data, term);
    if (!def) {
      const r = resolveMetric(data, term);
      const hint = r.kind === "metric"
        ? ` "${r.metric.name}" is a metric: use lookup_metric (${metricUrl(r.metric)}).`
        : r.kind === "ambiguous"
          ? ` It is a metric name:\n\n${formatAmbiguous(data, term, r.candidates)}`
          : suggestMatches(data, term);
      return { content: [{ type: "text" as const, text: `No definition is named "${term}".${hint}` }] };
    }
    return { content: [{ type: "text" as const, text: formatDefinition(def) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
