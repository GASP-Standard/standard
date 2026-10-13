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
  resolveNode as resolveGraphNode,
  suggestNodes,
  search, metricFormulaId } from "./loader.js";
import {
  buildContext,
  inferDrivers,
  findPaths,
  coverageGap,
  type PathStep,
  type TraversalCandidate,
} from "./traversal.js";
import { SITE, metricUrl, definitionUrl, resolveDocLink } from "./urls.js";
import { formatCanonicalFormula, resolveMetric, suggestMatches, fillTemplate, validateAdapter } from "./tools.js";
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

// Background version check — non-blocking, stderr only
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
    // Offline or gaspwiki.com unreachable — silently ignore
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

/** Resolve a user-supplied metric name to a graph node, exact matches only (see loader resolveNode). */
function resolveNode(name: string): RelationshipNode | undefined {
  return resolveGraphNode(data, name);
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

// --- Tool 1: lookup_metric ---
server.tool(
  "lookup_metric",
  "Look up a GASP Standard metric by name or abbreviation. Returns definition, formula, benchmarks, time period, department and page URL. Falls back to glossary terms (e.g. 'Signal Type', 'Metric Owner') when no metric matches; use lookup_definition to ask for a term directly.",
  { name: z.string().describe("Metric name or abbreviation (e.g. 'MRR', 'Net Revenue Retention', 'CAC Payback')") },
  async ({ name }) => {
    const resolved = resolveMetric(data, name);
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

    // Graph node id keys every ontology lookup below
    const nodeId = metricNodeId(data, metric);

    // Entity mapping from ontology
    if (nodeId && data.ontology?.entityMappings) {
      const entityId = Object.entries(data.ontology.entityMappings)
        .find(([, metricIds]) => (metricIds as string[]).includes(nodeId))?.[0];
      const entity = entityId && data.ontology.entities.find(e => e.id === entityId);
      if (entity) {
        parts.push(`\n**Measures:** ${entity.label} (${entity.aliases.join(", ")})`);
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
  "List all GASP Standard metrics, optionally filtered by department and/or signal type. Returns metric names grouped by category.",
  {
    department: z
      .string()
      .optional()
      .describe(
        "Filter by department name (e.g. 'sales', 'marketing', 'core'). Case-insensitive. Omit to list all."
      ),
    signalType: z
      .enum(["outcome", "leading", "efficiency", "operational"])
      .optional()
      .describe(
        "Filter by signal type. Returns metrics where primary or secondary type matches."
      ),
  },
  async ({ department, signalType }) => {
    let filtered = data.metrics;
    if (department) {
      const q = department.toLowerCase();
      filtered = filtered.filter(
        (m) => m.department.toLowerCase().includes(q)
      );
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
            text: `No metrics found for department "${department}".\n\nAvailable departments: ${departments.join(", ")}`,
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

    const parts: string[] = [`# GASP Standard Metrics (${filtered.length} total)\n`];
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
  "Get the canonical formula for a GASP Standard metric: the machine-readable GASP grammar formula with its unit, operating and market forms and named variants, the metrics and fields it reads, plus the formula as written in the standard.",
  { metric: z.string().describe("Metric name or abbreviation (e.g. 'NRR', 'LTV', 'CAC Payback')") },
  async ({ metric: name }) => {
    const resolved = resolveMetric(data, name);
    if (resolved.kind !== "metric") {
      return { content: [{ type: "text" as const, text: `No metric is named "${name}".${suggestMatches(data, name)}` }] };
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
        if (metric.formulas.length > 1) parts.push(`**Variant ${i + 1}:**`);
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
  "Get the upstream (what drives it) and downstream (what it drives) relationships for a metric, entity, or concept from the GASP relationship graph. Relationship types: metric signal (DRIVES, REDUCES, PREDICTS, COMPONENT_OF, MEASURES), entity lifecycle (CONVERTS_TO, PARENT_OF, BELONGS_TO), entity ownership (OWNS, GRANTS, PRICED_BY), entity interactions (MANAGES, SERVES, ENGAGES_VIA, SUBMITS, REPRESENTED_BY, SOURCES), entity financial flows (GENERATES, PRODUCES, CONTRIBUTES_TO, INCURS).",
  { metric: z.string().describe("Metric name or ID (e.g. 'arr', 'NRR'), entity (e.g. 'customer', 'subscription'), or concept (e.g. 'revenue', 'bookings')") },
  async ({ metric: name }) => {
    const { node, upstream, downstream } = getRelationships(data, name);

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

    const parts: string[] = [
      `# ${node.label} — Relationships\n`,
      `**Description:** ${node.description}`,
      `**Category:** ${node.category}`,
      `**Level:** ${node.level}\n`,
    ];

    const upDrivers = upstream.filter((r) => r.type !== "measures");
    const measuredBy = upstream.filter((r) => r.type === "measures");
    const downDriven = downstream.filter((r) => r.type !== "measures");
    const measures = downstream.filter((r) => r.type === "measures");

    if (upDrivers.length > 0) {
      parts.push("## Upstream (what drives this metric)");
      for (const r of upDrivers) {
        parts.push(`- **${r.node.label}** (${r.type}) — ${r.node.description}`);
      }
      parts.push("");
    } else {
      parts.push("## Upstream\nNo upstream drivers (this is a top-level metric).\n");
    }

    if (measuredBy.length > 0) {
      parts.push("## Measured by (metrics that measure this)");
      for (const r of measuredBy) {
        parts.push(`- **${r.node.label}** (${r.type}) — ${r.node.description}`);
      }
      parts.push("");
    }

    if (downDriven.length > 0) {
      parts.push("## Downstream (what this metric drives)");
      for (const r of downDriven) {
        parts.push(`- **${r.node.label}** (${r.type}) — ${r.node.description}`);
      }
    } else {
      parts.push("## Downstream\nNo downstream metrics (this is a leaf metric).");
    }

    if (measures.length > 0) {
      parts.push("\n## Measures (what this metric measures)");
      for (const r of measures) {
        parts.push(`- **${r.node.label}** (${r.type}) — ${r.node.description}`);
      }
    }

    return { content: [{ type: "text" as const, text: parts.join("\n") }] };
  }
);

// --- Tool 5: get_data_requirements ---
server.tool(
  "get_data_requirements",
  "Get the data requirements for implementing a GASP Standard metric or department dashboard. Returns required fields with types, reporting grain, source system, and example SQL query.",
  {
    metric: z
      .string()
      .optional()
      .describe("Metric name to search for (e.g. 'ARR', 'Pipeline', 'CSAT')"),
    department: z
      .string()
      .optional()
      .describe(
        "Department name (e.g. 'Sales', 'Engineering', 'Executive'). Omit to search all."
      ),
  },
  async ({ metric, department }) => {
    let filtered = data.dataRequirements || [];

    if (department) {
      const q = department.toLowerCase();
      filtered = filtered.filter(
        (dr) => dr.department.toLowerCase().includes(q)
      );
    }

    if (metric) {
      const q = metric.toLowerCase();
      filtered = filtered.filter(
        (dr) =>
          dr.metric.toLowerCase() === q ||
          dr.metric.toLowerCase().includes(q) ||
          dr.fields.some((f) => f.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      const depts = [
        ...new Set((data.dataRequirements || []).map((dr) => dr.department)),
      ].sort();
      return {
        content: [
          {
            type: "text" as const,
            text: `No data requirements found${metric ? ` for metric "${metric}"` : ""}${department ? ` in department "${department}"` : ""}.\n\nAvailable departments: ${depts.join(", ")}`,
          },
        ],
      };
    }

    const parts: string[] = [
      `# Data Requirements (${filtered.length} entries)\n`,
    ];

    // Group by department
    const grouped = new Map<string, typeof filtered>();
    for (const dr of filtered) {
      if (!grouped.has(dr.department)) grouped.set(dr.department, []);
      grouped.get(dr.department)!.push(dr);
    }

    for (const [dept, drs] of grouped) {
      parts.push(`## ${dept}\n`);
      for (const dr of drs) {
        parts.push(`### ${dr.metric}`);
        parts.push(`- **Source:** ${dr.source}`);
        parts.push(`- **Grain:** ${dr.grain}`);
        parts.push(`- **Frequency:** ${dr.frequency}`);
        parts.push(`- **Description:** ${dr.description}`);
        parts.push("");

        // Field table
        parts.push("| Field | Type |");
        parts.push("|-------|------|");
        for (const field of dr.fields) {
          const fieldType = dr.fieldTypes?.[field] || "unknown";
          parts.push(`| \`${field}\` | ${fieldType} |`);
        }
        parts.push("");

        // SQL
        parts.push("**Example SQL:**");
        parts.push("```sql\n" + dr.exampleQuery + "\n```\n");
      }
    }

    return { content: [{ type: "text" as const, text: parts.join("\n") }] };
  }
);

// --- Tool 6: search ---
server.tool(
  "search",
  "Search across all GASP Standard metrics and definitions. Returns top 10 matches ranked by relevance.",
  { query: z.string().describe("Search query (e.g. 'churn', 'retention', 'pipeline coverage')") },
  async ({ query: q }) => {
    const results = search(data, q, 10);

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No results found for "${q}".`,
          },
        ],
      };
    }

    const parts: string[] = [`# Search results for "${q}" (${results.length} matches)\n`];
    for (const r of results) {
      const dept = r.department ? ` [${r.department}]` : "";
      parts.push(`### ${r.name}${dept}`);
      parts.push(`*${r.type}*: ${r.snippet}`);
      parts.push(r.url ? `URL: ${r.url}\n` : "");
    }

    return { content: [{ type: "text" as const, text: parts.join("\n") }] };
  }
);

// --- Tool 7: generate_query ---
server.tool(
  "generate_query",
  "Generate SQL for a GASP metric from your adapter. The query is compiled from the metric's canonical formula: one scalar subquery per aggregate, each on the warehouse table you mapped to that GASP dataset, with :period_start and :period_end parameters. Fields you have not mapped stay as {{field@dataset}} placeholders, where the tag names the GASP dataset the column must come from.",
  {
    metric: z.string().describe("Metric name or abbreviation (e.g. 'NRR', 'CAC', 'Pipeline Value', 'ARR')"),
    adapter: z.string().describe("Your GASP adapter JSON string (see validate_adapter)"),
  },
  async ({ metric: metricName, adapter: adapterJson }) => {
    const resolved = resolveMetric(data, metricName);
    if (resolved.kind !== "metric") {
      return { content: [{ type: "text" as const, text: `No metric is named "${metricName}".${suggestMatches(data, metricName)}` }] };
    }
    let adapter: any;
    try { adapter = JSON.parse(adapterJson); } catch { return { content: [{ type: "text" as const, text: "Invalid adapter JSON." }] }; }
    if (!Array.isArray(adapter?.mappings)) {
      return { content: [{ type: "text" as const, text: 'Adapter must have a "mappings" array. Template: https://gaspwiki.com/downloads/gasp-adapter-template.json' }] };
    }
    const id = metricFormulaId(data, resolved.metric);
    const template = data.queryTemplates?.[id];
    if (!template) {
      const f = data.formulas?.[id];
      const why = f?.notComputable ? `It has no single formula: ${f.notComputable}` : "It has no canonical formula yet.";
      return { content: [{ type: "text" as const, text: `${resolved.metric.name} cannot be compiled to SQL. ${why}` }] };
    }
    const r = fillTemplate(template, adapter, data);
    const parts: string[] = [
      `# ${resolved.metric.name}: Generated SQL`, `**URL:** ${metricUrl(resolved.metric)}`,
      `**Warehouse:** ${adapter.warehouse || "not specified"}`, `**Datasets:** ${template.datasets.join(", ")}`, `**Grain:** ${template.grain}`,
      `**Fields mapped:** ${r.mapped.length} / ${template.placeholders.length} (field and dataset pairs)`,
    ];
    if (template.staged) parts.push("**Note:** this metric uses a cohort or a prior-period comparison; the query is correct but each aggregate re-reads the table. A staged dataset makes it cheaper.");
    if (r.missingFields.length) parts.push(`**Unmapped fields (left as placeholders):** \`${r.missingFields.join("\`, \`")}\``);
    if (r.missingTables.length) parts.push(`**Datasets with no table:** ${r.missingTables.join(", ")}. Add them under \"datasets\" in the adapter or map a field from each.`);
    for (const c of r.conflicts) parts.push(`**Conflict:** ${c}`);
    parts.push("", "Parameters: `:period_start` and `:period_end` are dates bounding the reporting period.", "", "```sql\n" + r.sql + "\n```");
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
  "Validate a GASP adapter against the standard. Checks the file against the adapter schema, rejects unknown fields, checks warehouse references, reports datasets whose fields point at different tables, scores every metric against the fields its canonical formula reads (fully covered, partially covered, not covered), lists enum fields that need a value mapping, and lists covered metrics with no declared owner.",
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
  "Diagnose what could explain an observed metric movement. Walks the GASP relationship graph in reverse and ranks upstream metrics whose movement (in the inferred direction) is consistent with the observation. Returns ranked candidates with full path and per-step edge classifications. Structural reasoning, not numeric forecasting — scores are attenuation products, not magnitude estimates. Compose with explain_path to scrutinise a chain or coverage_gap to check whether a candidate is being measured. For counterfactual 'what if' simulation, use the TWIN Modifier at https://gaspwiki.com/v1/twin-modifier instead.",
  {
    metric: z.string().describe("Metric name, abbreviation, or graph id (e.g. 'ARR', 'NRR', 'arr')"),
    direction: z.enum(["up", "down"]).describe("Observed direction of movement"),
    maxDepth: z.number().int().min(1).max(8).optional().describe("Maximum traversal depth (default 6)"),
  },
  async ({ metric: name, direction: dirStr, maxDepth }) => {
    const node = resolveNode(name);
    if (!node) {
      return {
        content: [{ type: "text" as const, text: `No graph node is named "${name}".${suggestNodes(data, name)}` }],
      };
    }
    if (!traversalCtx.metricNodeIds.has(node.id)) {
      return {
        content: [{ type: "text" as const, text: `"${node.label}" is not a metric node — infer_drivers operates on metrics only. Try get_relationships for entity/concept nodes.` }],
      };
    }

    const observedDirection = dirStr === "up" ? 1 : -1;
    const candidates = inferDrivers(node.id, observedDirection, traversalCtx, { maxDepth });

    if (candidates.length === 0) {
      return {
        content: [{ type: "text" as const, text: `# ${node.label} ${dirStr}\n\nNo upstream candidates found within the traversal depth limit.` }],
      };
    }

    const arrow = (d: 1 | -1) => (d === 1 ? "↑" : "↓");
    const parts: string[] = [
      `# ${node.label} ${arrow(observedDirection as 1 | -1)} — Candidate drivers (${candidates.length})\n`,
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
  "Explain how one metric reaches another by enumerating edge chains in the GASP relationship graph. Each step carries the canonical edge type and a classification bucket (metric_signal / structural / lifecycle / behavioral / assignment / generative). Returns up to 5 distinct paths sorted by length then attenuation. Empty if disconnected in the forward direction. Compose with infer_drivers to scrutinise a candidate chain.",
  {
    from: z.string().describe("Source metric or node (name, abbreviation, or id)"),
    to: z.string().describe("Target metric or node"),
    maxDepth: z.number().int().min(1).max(8).optional().describe("Maximum chain length (default 6)"),
  },
  async ({ from, to, maxDepth }) => {
    const fromNode = resolveNode(from);
    const toNode = resolveNode(to);
    if (!fromNode || !toNode) {
      const missing = !fromNode ? from : to;
      return {
        content: [{ type: "text" as const, text: `No graph node is named "${missing}".${suggestNodes(data, missing)}` }],
      };
    }

    const paths = findPaths(fromNode.id, toNode.id, traversalCtx, { maxDepth });

    if (paths.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `# ${fromNode.label} → ${toNode.label}\n\nNo forward path found within depth ${maxDepth ?? 6}. They may be disconnected in this direction (try the reverse, or use coverage_gap to inspect connectivity).`,
        }],
      };
    }

    const parts: string[] = [
      `# ${fromNode.label} → ${toNode.label} — ${paths.length} path${paths.length === 1 ? "" : "s"}\n`,
    ];

    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      parts.push(`## Path ${i + 1} — ${p.path.length} step${p.path.length === 1 ? "" : "s"}, score ${p.score.toFixed(3)}, end direction ${p.direction === 1 ? "↑" : "↓"}`);
      parts.push(`Classifications: ${renderClassifications(p.path)}\n`);
      for (let j = 0; j < p.path.length; j++) {
        const s = p.path[j];
        const flip = s.directionFlip ? " (↓ inverts direction)" : "";
        const fromLabel = traversalCtx.nodeById.get(s.from)?.label ?? s.from;
        const toLabel = traversalCtx.nodeById.get(s.to)?.label ?? s.to;
        parts.push(`${j + 1}. **${fromLabel}** → **${toLabel}** — \`${s.edgeType}\` (${s.classification}, attenuation ${s.attenuation.toFixed(2)})${flip}`);
      }
      parts.push("");
    }

    return { content: [{ type: "text" as const, text: parts.join("\n") }] };
  }
);

// --- Tool 11: coverage_gap ---
server.tool(
  "coverage_gap",
  "Audit a metric set against the GASP relationship graph. Returns three groups: upstream_missing (one-hop drivers not in the set), downstream_missing (one-hop downstream metrics not in the set), and disconnected (in-graph metrics with no path of any length to/from the set). Operates on metric nodes only — entities and concepts are ignored. Use to identify gaps before instrumenting a dashboard, then compose with infer_drivers or explain_path to investigate specific candidates.",
  {
    metrics: z.array(z.string()).min(1).describe("Metric names, abbreviations, or graph ids (e.g. ['ARR', 'NRR', 'CAC'])"),
  },
  async ({ metrics }) => {
    const resolved: string[] = [];
    const unresolved: string[] = [];
    for (const m of metrics) {
      const node = resolveNode(m);
      if (node && traversalCtx.metricNodeIds.has(node.id)) {
        resolved.push(node.id);
      } else {
        unresolved.push(m);
      }
    }

    if (resolved.length === 0) {
      return {
        content: [{ type: "text" as const, text: `No metric nodes resolved from input: ${metrics.join(", ")}. Try ids like 'arr', 'nrr', 'cac' or labels like 'NRR'.` }],
      };
    }

    const result = coverageGap(new Set(resolved), traversalCtx);

    const labelOf = (id: string) => traversalCtx.nodeById.get(id)?.label ?? id;
    const formatList = (ids: string[]) =>
      ids.length === 0 ? "_(none)_" : ids.map((id) => `- ${labelOf(id)} (\`${id}\`)`).join("\n");

    const parts: string[] = [
      `# Coverage gap — ${resolved.length} metric${resolved.length === 1 ? "" : "s"}\n`,
      `**Tracked:** ${resolved.map((id) => `${labelOf(id)} (\`${id}\`)`).join(", ")}`,
    ];
    if (unresolved.length > 0) {
      parts.push(`**Unresolved input:** ${unresolved.join(", ")}`);
    }
    parts.push("");

    parts.push(`## Upstream missing (${result.upstreamMissing.length})`);
    parts.push(`_Direct drivers of the tracked set that aren't tracked. Add to capture root-cause signal._\n`);
    parts.push(formatList(result.upstreamMissing));
    parts.push("");

    parts.push(`## Downstream missing (${result.downstreamMissing.length})`);
    parts.push(`_Metrics directly fed by the tracked set, not tracked. Add to see what the inputs translate into._\n`);
    parts.push(formatList(result.downstreamMissing));
    parts.push("");

    parts.push(`## Disconnected (${result.disconnected.length})`);
    parts.push(`_In-graph metrics with no path (any length, either direction) to the tracked set._\n`);
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
  "Look up a GASP Standard glossary term (e.g. 'Signal Type', 'Sensitivity Tier', 'Access Scope', 'Metric Owner', 'Logo Churn Rate', 'CEL'). Returns the full definition, its section, related links and page URL. Use lookup_metric for metrics.",
  { term: z.string().describe("Term name, abbreviation or slug (e.g. 'Signal Type', 'CEL', 'metric-owner')") },
  async ({ term }) => {
    const def = findDefinition(data, term);
    if (!def) {
      const r = resolveMetric(data, term);
      const hint = r.kind === "metric"
        ? ` "${r.metric.name}" is a metric: use lookup_metric (${metricUrl(r.metric)}).`
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
