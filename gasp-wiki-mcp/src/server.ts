/**
 * The GASP Standard MCP server: the data load, the 23 tools and their
 * annotations. `createServer()` builds a fresh McpServer over the data loaded
 * once at import; `index.ts` serves it over stdio and `http.ts` over Streamable
 * HTTP, one server per request. Every standard tool is read-only, so each
 * carries `readOnlyHint: true` beside its title, the two annotations the Claude
 * connectors directory requires. With `workspace` set (the hosted server with
 * GASP Workspace configured) two more tools are registered, `save_workspace`
 * and `load_workspace`, which read the signed-in company from the call's
 * `authInfo`; `save_workspace` writes, so it is not marked read-only.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
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
import { formatCanonicalFormula, resolveMetric, suggestMatches, formatAmbiguous, fillTemplate, formatDataRequirement, breakdownTemplate, breakdownRequirement, chooseDialect } from "./tools.js";
import { loadAdapter, validateMapping, parseDocument } from "./ossie/adapt.js";
import { compileModelFromText } from "./ossie/company.js";
import { compileTargetFromText, TARGETS } from "./targets/index.js";
import { scoreDriftFromText } from "./ossie/drift.js";
import { profileSchemaFromText } from "./ossie/profile.js";
import { proposeMappingFromText } from "./ossie/propose.js";
import { recordDecisionFromText } from "./ossie/decide.js";
import { deriveCelFromText } from "./cel.js";
import { generateChecksFromText, planFixesFromText } from "./checks.js";
import { readinessFromText } from "./readiness.js";
import { DIALECTS } from "./dialect.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { StandardData, RelationshipNode, Definition, Metric } from "./types.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { parseDecisions } from "./ossie/decide.js";
import { parseResults } from "./checks.js";
import { callerOf, storeFor, DOCUMENT_KINDS, type DocumentKind, type WorkspaceOptions } from "./workspace/index.js";

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

export const PKG_VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version;

/** The title each tool shows in clients that read annotations; the keys are the tool names, so a tool without a title does not compile. */
export const TOOL_TITLES = {
  lookup_metric: "Look up a GASP metric",
  lookup_definition: "Look up a GASP definition",
  list_metrics: "List GASP metrics",
  get_formula: "Get a canonical formula",
  get_relationships: "Get a metric's relationships",
  get_data_requirements: "Get a metric's data requirements",
  search: "Search the GASP Standard",
  generate_query: "Generate SQL for a metric",
  validate_mapping: "Validate a mapping",
  validate_adapter: "Validate an adapter",
  compile_model: "Compile GASP metrics into an Ossie model",
  compile_target: "Compile GASP metrics into your engine's own format",
  score_drift: "Score drift from the canonical metrics",
  profile_schema: "Profile a warehouse schema",
  propose_mapping: "Propose a GASP mapping",
  record_decision: "Record mapping decisions",
  derive_cel: "Derive revenue and credit events",
  generate_checks: "Generate readiness checks",
  plan_fixes: "Plan readiness fixes",
  readiness_report: "Report readiness level",
  infer_drivers: "Infer a metric's drivers",
  explain_path: "Explain the path between two metrics",
  coverage_gap: "Find the coverage gap for a metric",
} as const;
/** The GASP Workspace tools, registered only when the server is built with `workspace`. */
export const WORKSPACE_TOOL_TITLES = {
  save_workspace: "Save documents to your GASP Workspace",
  load_workspace: "Load documents from your GASP Workspace",
} as const;
export type ToolName = keyof typeof TOOL_TITLES | keyof typeof WORKSPACE_TOOL_TITLES;
/** The standard tools, served by every server. */
export const TOOL_COUNT = Object.keys(TOOL_TITLES).length;
export const WORKSPACE_TOOL_COUNT = Object.keys(WORKSPACE_TOOL_TITLES).length;
/** How many tools a server built with or without the Workspace serves. */
export const toolCount = (workspace: boolean): number => TOOL_COUNT + (workspace ? WORKSPACE_TOOL_COUNT : 0);
const ALL_TITLES: Record<ToolName, string> = { ...TOOL_TITLES, ...WORKSPACE_TOOL_TITLES };

/** One tool call, as the hosted server logs it: the tool, how long it took, whether it succeeded and which client asked. Never the arguments or the result. */
export interface ToolCallRecord {
  event: "tool";
  tool: ToolName;
  ms: number;
  ok: boolean;
  /** `name/version` from the client's initialize handshake, when known. */
  client?: string;
  /** The WorkOS organisation id when the call carried a valid token; never the user or the email. */
  company?: string;
}

/** The tools that load PGlite, an in-process Postgres, and run queries for a few seconds: the ones a shared host caps. */
export const HEAVY_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>(["score_drift", "readiness_report"]);

/** A cap on how many heavy tool calls run at once, shared by every server the HTTP entry point builds. `running` is the live count. */
export interface HeavyLimit {
  limit: number;
  running: number;
}

export interface ServerOptions {
  /** Called after every tool call with its record; the HTTP server writes it to stderr as one JSON line. Unset for stdio. */
  onToolCall?: (record: ToolCallRecord) => void;
  /** When set, a heavy tool call beyond `limit` returns a busy error instead of running. Unset for stdio, where one user owns the process. */
  heavy?: HeavyLimit;
  /** GASP Workspace: when set, the workspace tools are registered over its store. Unset for stdio and for a hosted server without the Workspace. */
  workspace?: WorkspaceOptions;
}

/** The result a heavy tool returns when the host is at its cap: an error the client can retry, never an exception. */
export const BUSY_TEXT = "The server is running its maximum number of drift and readiness computations at once. Retry in a few seconds.";

/** A new server over the loaded data with every tool registered. Cheap enough to build per request. */
export function createServer(options: ServerOptions = {}): McpServer {
const server = new McpServer({
  name: "gasp-standard",
  version: PKG_VERSION,
});

/** Registers a tool with its title and the read-only annotations every GASP tool carries (a workspace tool overrides them), timed and recorded when `onToolCall` is set. */
function tool<Args extends ZodRawShapeCompat>(name: ToolName, description: string, params: Args, cb: ToolCallback<Args>, annotations: Partial<ToolAnnotations> = {}): void {
  const record = options.onToolCall;
  const heavy = options.heavy && HEAVY_TOOLS.has(name) ? options.heavy : undefined;
  const run = cb as unknown as (a: unknown, e: unknown) => CallToolResult | Promise<CallToolResult>;
  const guarded = async (args: unknown, extra: unknown): Promise<CallToolResult> => {
    if (!heavy) return run(args, extra);
    if (heavy.running >= heavy.limit) return { content: [{ type: "text", text: BUSY_TEXT }], isError: true };
    heavy.running++;
    try { return await run(args, extra); } finally { heavy.running--; }
  };
  const handler: ToolCallback<Args> = record
    ? (async (args: Parameters<ToolCallback<Args>>[0], extra: Parameters<ToolCallback<Args>>[1]) => {
        const started = performance.now();
        const client = server.server.getClientVersion();
        const company = callerOf((extra as { authInfo?: AuthInfo }).authInfo)?.orgId;
        const done = (ok: boolean) => record({ event: "tool", tool: name, ms: Math.round(performance.now() - started), ok, ...(client ? { client: `${client.name}/${client.version}` } : {}), ...(company ? { company } : {}) });
        try {
          const result = await guarded(args, extra);
          done(!result.isError);
          return result;
        } catch (err) {
          done(false);
          throw err;
        }
      }) as ToolCallback<Args>
    : heavy ? (guarded as unknown as ToolCallback<Args>) : cb;
  // registerTool sets the top-level `title` the directory portal reads; the same title goes in the annotations for clients that read only those.
  server.registerTool(name, {
    title: ALL_TITLES[name],
    description,
    inputSchema: params,
    annotations: { title: ALL_TITLES[name], readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, ...annotations },
  }, handler);
}

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
tool(
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
tool(
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
tool(
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
tool(
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
tool(
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
tool(
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
tool(
  "generate_query",
  "SQL for one GASP Standard metric against your warehouse, compiled from its canonical formula and filled from your adapter: one scalar subquery per aggregate, each reading the table mapped to its GASP dataset, with :period_start and :period_end date parameters (both inclusive). Pairs you have not mapped stay as {{field@dataset}} placeholders, where the tag names the GASP dataset the column must come from; the output lists them with any dataset that has no table and any mapping conflict, plus the URL, dialect, datasets, grain and the mapping it used. breakdown names a breakdown the metric declares (get_formula lists them, e.g. 'by_plan' on MRR) and returns one row per value. The dialect (postgres, snowflake, bigquery or databricks; postgres also covers Redshift) is the dialect argument, else the adapter's warehouse when it names one of them, else postgres. Check the adapter with validate_adapter first.",
  {
    metric: z.string().describe("Exact metric name, abbreviation, alias or formula id (e.g. 'NRR', 'CAC', 'Pipeline Value', 'ARR'), resolved as in lookup_metric"),
    adapter: z.string().describe("Your mapping as text: a GASP adapter (JSON; schema: https://gaspwiki.com/schemas/gasp-adapter-v1.json) or an Ossie mapping document (YAML or JSON). Check it with validate_mapping first."),
    semantic_model: z.string().optional().describe("With an Ossie mapping: your semantic model document (YAML or JSON), so table names and field expressions resolve. Ignored for a GASP adapter."),
    breakdown: z.string().optional().describe("Name of a breakdown the metric declares (e.g. 'by_plan' on MRR). The query returns one row per value of the breakdown's field or bucket. An unknown name lists the declared ones."),
    dialect: z.enum(DIALECTS).optional().describe("SQL dialect: postgres (also Redshift), snowflake, bigquery or databricks. Omit to use the adapter's warehouse when it names one of them (postgresql and redshift read as postgres), else postgres."),
  },
  async ({ metric: metricName, adapter: adapterJson, semantic_model, breakdown, dialect: requestedDialect }) => {
    const resolved = resolveMetric(data, metricName);
    if (resolved.kind === "ambiguous") {
      return { content: [{ type: "text" as const, text: formatAmbiguous(data, metricName, resolved.candidates) }] };
    }
    if (resolved.kind !== "metric") {
      return { content: [{ type: "text" as const, text: notAMetric(metricName, resolved) }] };
    }
    const loaded = loadAdapter(adapterJson, semantic_model, data);
    if (!loaded.adapter) return { content: [{ type: "text" as const, text: loaded.error! }] };
    const adapter = loaded.adapter;
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

// --- Tool 8: validate_mapping (validate_adapter is the same tool under its original name) ---
const VALIDATE_DESCRIPTION =
  "Check a warehouse mapping against the GASP Standard and score its coverage. Accepts either format: a GASP adapter (JSON; schema https://gaspwiki.com/schemas/gasp-adapter-v1.json, versions 1.0 and 1.1) or an Apache Ossie mapping document (YAML or JSON) over your semantic model, which you can pass as semantic_model. A GASP adapter is converted on load into an Ossie mapping over a model synthesised from its tables and columns. Layers, each reported in its own section: the schema (the adapter JSON Schema with each violation's JSON path, and the Ossie mapping schema for the Ossie form), GASP's cross-document checks (every concept, relationship and field reference resolves against the GASP ontology and the model), then coverage: unknown fields and datasets, fields mapped to a dataset that does not carry them, bare column names on fields that live on several datasets, datasets whose fields point at different tables, pairs mapped twice, the field and dataset pairs mapped, every metric with a formula scored against the pairs its compiled SQL reads (fully covered, partially covered with the missing pairs, not covered), enum fields mapped without a transform, covered metrics with no declared owner, owners naming unknown metrics and up to 15 unmapped pairs ranked by how many partially covered metrics need them. Run it before generate_query.";
const VALIDATE_PARAMS = {
  adapter: z.string().describe("The mapping as text: a GASP adapter (JSON; template: https://gaspwiki.com/downloads/gasp-adapter-template.json) or an Ossie mapping document (YAML or JSON; reference: https://gaspwiki.com/downloads/ossie/gasp.mapping.yaml)."),
  semantic_model: z.string().optional().describe("With an Ossie mapping: your semantic model document (YAML or JSON), so its datasets, fields, keys and sources are checked. Without it, names are taken from the mapping's expressions."),
};
const validateHandler = async ({ adapter, semantic_model }: { adapter: string; semantic_model?: string }) =>
  ({ content: [{ type: "text" as const, text: validateMapping(adapter, semantic_model, data) }] });
tool("validate_mapping", VALIDATE_DESCRIPTION, VALIDATE_PARAMS, validateHandler);
tool("validate_adapter", `Same as validate_mapping, under the tool's original name. ${VALIDATE_DESCRIPTION}`, VALIDATE_PARAMS, validateHandler);

// --- Tool 9: compile_model ---
tool(
  "compile_model",
  "Compile the GASP Standard metrics your mapping covers into your Apache Ossie semantic model. Takes the same input as validate_mapping (a GASP adapter, or an Ossie mapping with your semantic_model) and returns your model with a gasp_ metric for every formula entry whose fields are all mapped (main formula, O and M forms, variants and named breakdowns): a direct OSSIE_SQL_2026 expression over your datasets and fields where the expression language can state it, else staged through a gasp_staged_ per-period dataset whose source is the compiled SQL over your tables in your warehouse dialect, reading a period spine table you provide (one row per reporting period; gasp.period_spine unless you pass period_spine). Entries with unmapped pairs are left out and listed with the pairs they need; recompiling replaces every gasp_ metric and staged dataset and leaves the rest of the model as it was. The compiled metrics are checked against the bundled Ossie model schema and GASP's reference checks. A GASP adapter compiles into the model synthesised from its tables and columns, which validate_mapping shows. Pass metrics or department to compile a subset, output 'report' to get the coverage without the document.",
  {
    adapter: z.string().describe("Your mapping as text: a GASP adapter (JSON; schema: https://gaspwiki.com/schemas/gasp-adapter-v1.json) or an Ossie mapping document (YAML or JSON). Check it with validate_mapping first."),
    semantic_model: z.string().optional().describe("With an Ossie mapping: your semantic model document (YAML or JSON). The metrics compile into it, reading its sources and field expressions. Without it, dataset names stand for tables and every field is its bare column."),
    dialect: z.enum(DIALECTS).optional().describe("SQL dialect of the staged sources: postgres (also Redshift), snowflake, bigquery or databricks. Omit to use the adapter's warehouse when it names one of them, else postgres."),
    metrics: z.string().optional().describe("Comma-separated metric names, abbreviations, aliases or formula ids to compile (each resolved as in lookup_metric), with their forms, variants and breakdowns. Omit for every metric."),
    department: z.string().optional().describe("Compile every metric of one department (e.g. 'Core'); combines with metrics."),
    period_spine: z.string().optional().describe("The table of (period_start, period_end) rows the staged sources read, as it is named in your warehouse. Default gasp.period_spine."),
    output: z.enum(["model", "report"]).optional().describe("'model' (default) returns the coverage report with the compiled model as YAML; 'report' returns the coverage alone."),
  },
  async ({ adapter, semantic_model, dialect, metrics, department, period_spine, output }) =>
    ({ content: [{ type: "text" as const, text: compileModelFromText(adapter, semantic_model, data, { dialect, metrics, department, spine: period_spine, document: output !== "report" }) }] }),
);

// --- Tool 9b: compile_target ---
tool(
  "compile_target",
  "Compile the GASP Standard metrics your mapping covers into the files of your semantic-layer engine. Takes the same input as compile_model (a GASP adapter, or an Ossie mapping with your semantic_model), compiles the metrics the same way and writes them in the engine's own format and your warehouse's SQL: target 'snowflake' gives a Cortex Analyst semantic model YAML (tables with database.schema.table base tables, time dimensions, dimensions, facts, relationships and the gasp_ metrics; loadable as a semantic view) plus staged_views.sql, the views the staged metrics read and the period spine table, to run first; target 'cube' gives a Cube data model, one cube per table with its joins, a dimension per field and the metrics as measures, and one view joining the cubes from revenue_event. A filtered aggregate is written as a CASE inside the aggregate, which every warehouse runs, and each staged table's query is the compiled source in the target dialect. Entries with unmapped pairs or no computable formula are listed and left out. Pass metrics or department for a subset.",
  {
    adapter: z.string().describe("Your mapping as text: a GASP adapter (JSON; schema: https://gaspwiki.com/schemas/gasp-adapter-v1.json) or an Ossie mapping document (YAML or JSON). Check it with validate_mapping first."),
    semantic_model: z.string().optional().describe("With an Ossie mapping: your semantic model document (YAML or JSON), whose sources and field expressions the files read."),
    target: z.enum(TARGETS).describe("The engine: 'snowflake' (Cortex Analyst semantic model YAML plus staged views SQL) or 'cube' (Cube data-model directory)."),
    dialect: z.enum(DIALECTS).optional().describe("Cube only: the SQL dialect of the measures and staged cubes (postgres, snowflake, bigquery or databricks). Omit to use the adapter's warehouse, else postgres. The snowflake target always writes Snowflake SQL."),
    database: z.string().optional().describe("Snowflake: the database prepended to schema.table sources, since a Cortex Analyst base table is database.schema.table. Cube does not need it."),
    staged_schema: z.string().optional().describe("Snowflake: the schema the staged views are created in. Default: the schema of the first mapped table."),
    metrics: z.string().optional().describe("Comma-separated metric names, abbreviations, aliases or formula ids to write (each resolved as in lookup_metric). Omit for every metric."),
    department: z.string().optional().describe("Write every metric of one department (e.g. 'Core'); combines with metrics."),
    period_spine: z.string().optional().describe("The table of (period_start, period_end) rows the staged queries read, as named in your warehouse. Default gasp.period_spine."),
    output: z.enum(["full", "files", "report"]).optional().describe("'full' (default): the report followed by every file in a fenced block; 'files': the files alone, each under a ### <path> heading; 'report': the coverage and notes alone."),
  },
  async ({ adapter, semantic_model, target, dialect, database, staged_schema, metrics, department, period_spine, output }) =>
    ({ content: [{ type: "text" as const, text: compileTargetFromText(adapter, semantic_model, data, { target, dialect, database, staged_schema, metrics, department, spine: period_spine, output }) }] }),
);

// --- Tool 10: score_drift ---
tool(
  "score_drift",
  "Score how far your own metrics drift from the GASP Standard's canonical definitions, by result. Takes your mapping (a GASP adapter or an Ossie mapping, as validate_mapping does) and your semantic_model holding your metrics. Each metric is matched to a GASP metric by exact name, by the synonyms in its ai_context or by a pair you pass in matches, and a name or synonym ending in -O or -M (NRR-O, cac_m) matches that declared form; near names are listed for review and never scored on a guess. For every match the canonical metric is compiled into your dataset and field names (as compile_model does) and both run on the GASP synthetic SaaS dataset, six monthly periods, in an in-process Postgres (PGlite). Where the numbers differ the report gives both values per period, the largest difference and the likely cause read from the canonical formula: a null on one side (a sum over no rows that is NULL in your SQL and 0 in GASP's, or a canonical average or ratio with nothing to read), a construct one expression cannot state (a cohort, an opening value at period start, a period bound to a business date), a filter one side applies and the other does not, a dataset one side reads or an aggregate whose value has no equal on the other side. Metrics that read fields your mapping lacks are reported as not runnable with the field named. Your values are also checked against the standard's range for the metric (NRR at least 0, GRR at most 100%) per period, and where both the O and M forms of a dual-lens metric are matched the report scores the bridge between them (the Durability Gap for ARR, the Expansion Integrity Gap for NRR, the Activation Delta for CAC, the Contribution Leakage for LTV, the Services Drag for Gross Margin): your M minus O beside the canonical gap, per period.",
  {
    adapter: z.string().describe("Your mapping as text: a GASP adapter (JSON) or an Ossie mapping document (YAML or JSON). Check it with validate_mapping first."),
    semantic_model: z.string().describe("Your metrics: your Ossie semantic model document (YAML or JSON); with a GASP adapter as the mapping, any document with a metrics list will do. Each metric with a name and an OSSIE_SQL_2026 expression over your datasets and fields. With a GASP adapter, write them over the dataset names and columns of the model validate_mapping synthesises (the GASP dataset ids and your column names)."),
    matches: z.string().optional().describe("Explicit pairs for metrics the names do not settle, comma separated: \"acme_nrr=NRR, lost_mrr=Churned MRR\". The GASP side is a name, abbreviation, alias or formula id as lookup_metric resolves it, with an optional :O, :M or :variant."),
    metrics: z.string().optional().describe("Comma-separated names of your metrics to score. Omit for every metric in the document."),
    output: z.enum(["report", "json"]).optional().describe("'report' (default) is the markdown report; 'json' returns the matches, the per-period values and the causes as data."),
  },
  async ({ adapter, semantic_model, matches, metrics, output }) =>
    ({ content: [{ type: "text" as const, text: await scoreDriftFromText(adapter, semantic_model, data, { matches, metrics, output }) }] }),
);

// --- Tool 11: profile_schema ---
tool(
  "profile_schema",
  "Profile a warehouse schema into a minimal Apache Ossie semantic model, the first step towards a GASP mapping (readiness level 1). Pass the schema as the rows of information_schema.columns (JSON or CSV with table, column and type), an object with a tables list, or CREATE TABLE statements, read through your own warehouse MCP or from a dump. Optionally pass statistics per column (rows, nulls, distinct, min, max, values); output: statistics returns the query that gathers them. For every table the profile infers the key, the time field and the kind (snapshot, event, fact or reference), each with its evidence and confidence, plus the relationships the columns imply; a low-confidence inference is left out of the model and listed as a question for the Decide step rather than guessed. The report ends with the model as YAML, to pass to propose_mapping as semantic_model; the questions go to record_decision.",
  {
    schema: z.string().describe("The schema: information_schema.columns rows as JSON (array of objects with table_name, column_name, data_type, optionally table_schema and is_nullable) or CSV with those headers; or { tables: [{ name, schema?, columns: [{ name, type }] }] }; or CREATE TABLE statements (PRIMARY KEY and REFERENCES clauses are read)."),
    statistics: z.string().optional().describe("Per-column statistics as JSON rows or CSV: table, column, rows (or row_count), nulls (or null_count or null_rate), distinct (or distinct_count), min, max, values (a JSON array or a | separated list for a short list of values). Optional; the profile says what they would settle."),
    organization: z.string().optional().describe("The company's name, used in the model's name."),
    output: z.enum(["report", "model", "json", "statistics"]).optional().describe("'report' (default): the profile with evidence, questions and the model as YAML; 'model': the YAML alone; 'json': the profile and the model as data; 'statistics': the SQL that gathers the statistics for this schema."),
    dialect: z.enum(["postgres", "snowflake", "bigquery", "databricks"]).optional().describe("With output: statistics, the warehouse the query is written for (the string type of its min and max columns); postgres by default."),
  },
  async ({ schema, statistics, organization, output, dialect }) =>
    ({ content: [{ type: "text" as const, text: profileSchemaFromText(schema, statistics, data, { organization, output, dialect }) }] }),
);

// --- Tool 12: propose_mapping ---
tool(
  "propose_mapping",
  "Propose a GASP mapping for a warehouse from its profiled semantic model (readiness level 2). Pass semantic_model (the model profile_schema returned, or your own Ossie model) or schema (profiled on the way in, with optional statistics). Every table is scored against every GASP dataset on its columns, its profiled kind, key and time field and its name; every column of a proposed table against the dataset's fields by name, structural role (the table's time field is the dataset's date), a short synonym list, word order and near names, each checked against the warehouse type and, for an enum field, the listed values. A column in cents gets a divide-by-100 transform and enum values the standard does not use a CASE recode when one is known. Only high-confidence pairs enter the mapping; medium ones are listed as candidates with their evidence and what would settle them; the rest are unmatched. Returns the report and the Ossie mapping over the model (a transform becomes a calculated field): the candidates go to record_decision with both documents, then the mapping to validate_mapping, compile_model and score_drift; output: adapter gives the same pairs as a GASP adapter.",
  {
    semantic_model: z.string().optional().describe("The Ossie semantic model to map, as YAML or JSON: the one profile_schema returned (its profile and listed values are read) or the company's own."),
    schema: z.string().optional().describe("Instead of semantic_model: the warehouse schema as profile_schema accepts it (information_schema rows, a tables list or CREATE TABLE statements), profiled on the way in."),
    statistics: z.string().optional().describe("With schema: per-column statistics as profile_schema accepts them; the listed values of enum columns drive the recode transforms."),
    organization: z.string().optional().describe("The company's name, used in the mapping's name."),
    output: z.enum(["report", "mapping", "model", "adapter", "json"]).optional().describe("'report' (default): the proposal with evidence, candidates and the mapping as YAML; 'mapping': the Ossie mapping alone; 'model': the model with any calculated fields the transforms added; 'adapter': the pairs as a GASP adapter (JSON); 'json': everything as data."),
  },
  async ({ semantic_model, schema, statistics, organization, output }) =>
    ({ content: [{ type: "text" as const, text: proposeMappingFromText(semantic_model, schema, statistics, data, { organization, output }) }] }),
);

// --- Tool 13: record_decision ---
tool(
  "record_decision",
  "Record the decisions people make on a profiled and proposed warehouse, the Decide step of readiness level 2. Pass semantic_model and mapping (the ones propose_mapping returned) and decisions: a YAML or JSON list where each entry names what it is about, the subject by content and its owner. about: key, time, kind or type answers a profiler question and is written into the model (dataset, answer: the key columns or \"none\", the time column or \"none\", snapshot|event|fact|reference or an Ossie datatype with column); about: table accepts (or with accept: false rejects) a table as a GASP dataset (dataset, to: the GASP dataset) and maps its columns as the proposer would; about: field accepts or rejects a column as a GASP field of the dataset its table is mapped to (dataset, column, to: the GASP field, optional transform over {{value}}, which becomes a calculated field); about: owner names the team that owns a metric (metric, owner, optional contact), the slot validate_mapping reads; about: topic records a judgement call GASP cannot apply, such as which system owns customer identity, the reporting currency or what date marks churn (topic, answer). Every decision carries owner, an optional date (today when omitted) and note, and lands in the mapping's GASP extension; a later decision on the same subject replaces the earlier one. With no decisions it lists what is open: the questions no decision or model state has settled, the candidates no decision has settled and the covered metrics without an owner. Level 2 is reached when no question and no candidate is open. Returns the report with the updated mapping and, when it changed, the model, to pass on to validate_mapping, compile_model and score_drift.",
  {
    semantic_model: z.string().describe("The Ossie semantic model the mapping reads, as YAML or JSON: the one propose_mapping returned (its profile questions are read from the GASP extension)."),
    mapping: z.string().describe("The Ossie mapping propose_mapping returned, as YAML or JSON; its candidates and the decisions already on file are read from the GASP extension, and the decisions are written back into it."),
    decisions: z.string().optional().describe("The decisions as a YAML or JSON list: [{about: key, dataset: usage_daily, answer: [account_id, workspace_id, day], owner: Data platform}, {about: table, dataset: plan_prices, to: plan, accept: false, owner: Billing}, {about: field, dataset: subscriptions, column: plan_code, to: plan_id, owner: Billing}, {about: owner, metric: Net Revenue Retention, owner: Finance, contact: fp&a@example.com}, {about: topic, topic: reporting currency, answer: USD, owner: Finance, note: ...}]. Omit it to list what is open."),
    output: z.enum(["report", "mapping", "model", "json"]).optional().describe("'report' (default): what was applied, what is open and the updated documents as YAML; 'mapping': the mapping alone; 'model': the model alone; 'json': everything as data."),
  },
  async ({ semantic_model, mapping, decisions, output }) =>
    ({ content: [{ type: "text" as const, text: recordDecisionFromText(semantic_model, mapping, decisions, data, { output }) }] }),
);

// --- Tool 14: derive_cel ---
tool(
  "derive_cel",
  "SQL that derives CEL Revenue_Events from your billing data, or Credit_Events from your usage records, by the rules in the standard (cel.md, 'Deriving Revenue Events from a Subscription Ledger', 'Deriving Revenue Events from an Invoice Ledger', 'Deriving Usage Realisation' and 'Deriving Credit Events'). Most billing systems hold subscriptions or invoices, not events. source: subscription (default) turns the subscription dataset your mapping covers (subscription_id, customer_id, snapshot_date, mrr, subscription_status, segment, as snapshots at any cadence or a version history) into one revenue_event row per movement: a step is a change in a subscription's active MRR, the ledger's first date is the opening balance, prior_mrr and new_mrr are the customer's MRR chained so prior_mrr + mrr_change = new_mrr holds on every row, and the event type (new, expansion, contraction, churn, reactivation) is read from the customer's MRR around the step, with the ATL lifecycle tag, change_nature permanent and an empty expansion_classification (the ledger cannot know it). source: invoice reads the invoice dataset instead (invoice_id, subscription_id, customer_id, snapshot_date, service_period_start, service_period_end, recurring_amount): each invoice is one service period whose MRR is the recurring amount over the months it covers, and the same rules apply. When the mapping covers the usage_record dataset (subscription_id, customer_id, period_start, period_end, committed_amount, usage_amount), or usage is true, each period whose usage exceeds its commitment adds an expansion tagged usage_realisation with change_nature temporary dated the period's end and its scheduled_reversal the next day, chained with the ledger's steps. A mapping that covers no usage records but covers a credit ledger (the credit_event dataset: subscription_id, customer_id, event_date, credit_event_type, consumption_basis, credit_amount), or usage_source: credit_event, gives the same pairs from its consumption events with basis overage, summed per subscription and calendar month and dated the month's last day; with both mapped the usage records are the source, so nothing is derived twice. target: credit_event writes credit_event rows instead: one consumption event with basis overage per usage period over its commitment, dated the period's end, for the overage the period bills, with empty balances (usage within a ratable commitment is no event; a prepaid balance and its expiries come from the billing system's credit ledger). Takes the same mapping as generate_query (a GASP adapter or an Ossie mapping with its semantic_model) and the ledger's currency; the dialect is the one asked for, else the adapter's warehouse, else postgres. Unmapped fields stay as {{field@dataset}} placeholders and are listed. Run the result to build the revenue_event table, map it, and the MRR movement metrics compile over it.",
  {
    adapter: z.string().describe("Your mapping as text: a GASP adapter (JSON; schema: https://gaspwiki.com/schemas/gasp-adapter-v1.json) or an Ossie mapping document (YAML or JSON). It must cover the subscription dataset (or the invoice dataset with source: invoice). Check it with validate_mapping first."),
    currency: z.string().describe("ISO 4217 code of the ledger's currency (USD, EUR, GBP ...), written on every derived event."),
    semantic_model: z.string().optional().describe("With an Ossie mapping: your semantic model document (YAML or JSON), so table names and field expressions resolve. Ignored for a GASP adapter."),
    source: z.enum(["subscription", "invoice"]).optional().describe("The ledger to read: 'subscription' (default), the subscription dataset as snapshots or a version history; 'invoice', the invoice dataset read as one row per service period (recurring_amount over the months between service_period_start and service_period_end). Use invoice when the billing system keeps no subscription history."),
    usage: z.boolean().optional().describe("Add the usage realisation pairs, read from usage_source. Default: true when the mapping covers usage_record or credit_event, else false."),
    usage_source: z.enum(["usage_record", "credit_event"]).optional().describe("Where the usage realisation pairs come from: 'usage_record', the usage records' periods over their commitment; 'credit_event', the credit ledger's consumption events with basis overage, summed per subscription and calendar month. Default: usage_record when the mapping covers it, else credit_event when the mapping covers it. One source only, so the overage is never derived twice."),
    target: z.enum(["revenue_event", "credit_event"]).optional().describe("What to derive: 'revenue_event' (default), the revenue events from the ledger; 'credit_event', one consumption event with basis overage per usage_record period over its commitment, for a company with usage records and no credit ledger (source, first_snapshot and usage are ignored)."),
    dialect: z.enum(DIALECTS).optional().describe("SQL dialect: postgres (also Redshift), snowflake, bigquery or databricks. Omit to use the adapter's warehouse when it names one of them, else postgres."),
    first_snapshot: z.enum(["opening", "steps"]).optional().describe("What the rows on the ledger's first date are. 'opening' (default): opening balances that seed each customer's MRR and produce no event, for a ledger that starts after the oldest subscription. 'steps': steps from 0, for a ledger that starts with the business."),
    output: z.enum(["report", "sql"]).optional().describe("'report' (default): the SQL with the mapping it used, the unmapped fields and what the source can and cannot say; 'sql': the query alone."),
  },
  async ({ adapter, currency, semantic_model, source, usage, usage_source, target, dialect, first_snapshot, output }) =>
    ({ content: [{ type: "text" as const, text: deriveCelFromText(adapter, semantic_model, data, { dialect, currency, firstSnapshot: first_snapshot, source, usage, usageSource: usage_source, target, output }) }] }),
);

// --- Tool 15: generate_checks ---
tool(
  "generate_checks",
  "The readiness checks the GASP Standard states, as SQL over the datasets your mapping covers (readiness level 3, the Check step). From cel.md and atl.md: CEL row identity (prior_mrr + mrr_change = new_mrr on every revenue event), MRR continuity (a subscription's mrr_start equals its mrr on the previous snapshot), unique event_id per event dataset, the ATL tags (one lifecycle_attribution per event, an expansion_classification on every expansion, contraction and reactivation revenue event and every amendment, a cost_function on every cost event), customer identity both ways (every revenue event's customer is a known customer, every customer active on the latest snapshot has a revenue event) freshness (the latest date per dataset within a window) and, for every fully mapped metric with a hard range rule in the ontology (NRR at least 0, GRR at most 100%, Gross Margin, ARR and others), its value in every reporting period of your period spine (the table compile_model reads; period_spine names another). One statement, one row per check with its violation count. GASP has no warehouse access: run it, then pass the rows back as results to get pass or fail per check and per metric; each check names the metrics whose formulas read what it covers. Checks whose fields the mapping lacks are listed with what they need. Takes the mapping generate_query takes; the dialect is the one asked for, else the warehouse's, else postgres. Follow with plan_fixes for the ranked list.",
  {
    adapter: z.string().describe("Your mapping as text: a GASP adapter (JSON; schema: https://gaspwiki.com/schemas/gasp-adapter-v1.json) or an Ossie mapping document (YAML or JSON). Check it with validate_mapping first."),
    semantic_model: z.string().optional().describe("With an Ossie mapping: your semantic model document (YAML or JSON), so table names and field expressions resolve. Ignored for a GASP adapter."),
    dialect: z.enum(DIALECTS).optional().describe("SQL dialect: postgres (also Redshift), snowflake, bigquery or databricks. Omit to use the adapter's warehouse when it names one of them, else postgres."),
    window: z.number().int().min(0).optional().describe("Freshness window in days (default 2): the latest date in each dataset must be within this many days of as_of."),
    as_of: z.string().optional().describe("The date freshness is measured from, as YYYY-MM-DD. Default: the warehouse's current date."),
    period_spine: z.string().optional().describe("The table of (period_start, period_end) rows the range checks evaluate each metric over, as it is named in your warehouse; the same table compile_model reads. Default gasp.period_spine."),
    results: z.string().optional().describe("The rows the checks statement returned, as JSON (objects with check_id and violations, [check_id, violations] pairs, or an object keyed by check id) or CSV. With results the report gives pass or fail per check and per metric."),
    output: z.enum(["report", "sql", "json"]).optional().describe("'report' (default): the checks, what each protects and the SQL to run (or, with results, pass and fail per check and per metric); 'sql': the statement alone; 'json': the report as data."),
  },
  async ({ adapter, semantic_model, dialect, window, as_of, period_spine, results, output }) =>
    ({ content: [{ type: "text" as const, text: generateChecksFromText(adapter, semantic_model, data, { dialect, window, asOf: as_of, spine: period_spine, results, output }) }] }),
);

// --- Tool 16: plan_fixes ---
tool(
  "plan_fixes",
  "The ranked fix list for a mapping (readiness level 3, the Plan step): every GASP field a partly covered metric still needs, and every readiness check that failed, ordered by the Core metrics each fix unlocks, then all metrics unlocked, then metrics it helps, with an effort class (small for a mapping, medium for a tag backfill or a pipeline fix, large for cross-system identity work) shown and used only as a tiebreak. A fix unlocks a metric when it is the last thing between that metric and covered-and-passing; a metric with two blockers counts as helped by each. Pass the results generate_checks produced to rank data fixes beside mapping gaps; without them the plan covers mapping gaps alone. Takes the mapping generate_query takes.",
  {
    adapter: z.string().describe("Your mapping as text: a GASP adapter (JSON) or an Ossie mapping document (YAML or JSON)."),
    semantic_model: z.string().optional().describe("With an Ossie mapping: your semantic model document (YAML or JSON). Ignored for a GASP adapter."),
    dialect: z.enum(DIALECTS).optional().describe("SQL dialect used to decide which checks are runnable; omit to use the warehouse's, else postgres."),
    results: z.string().optional().describe("The rows the generate_checks statement returned, as JSON or CSV with check_id and violations."),
    period_spine: z.string().optional().describe("The period spine table the range checks read, as passed to generate_checks. Default gasp.period_spine."),
    limit: z.number().int().min(1).optional().describe("How many fixes to show (default 25)."),
    output: z.enum(["report", "json"]).optional().describe("'report' (default) or 'json' (every fix as data)."),
  },
  async ({ adapter, semantic_model, dialect, results, period_spine, limit, output }) =>
    ({ content: [{ type: "text" as const, text: planFixesFromText(adapter, semantic_model, data, { dialect, results, spine: period_spine, limit, output }) }] }),
);

// --- Tool 17: readiness_report ---
tool(
  "readiness_report",
  "Which readiness level a company has reached on the GASP pipeline and what stands between it and the next, read from the documents the other tools produced. L1 Profiled: a semantic model exists (profiled by profile_schema, your own, or synthesised from a GASP adapter). L2 Mapped: at least one metric is fully covered and no profiler question and no proposer candidate is open (the line record_decision draws). L3 Clean core: the CEL revenue events are mapped, the checks have been run and every Core metric the mapping covers passes every check that protects it. L4 LLM-ready: the canonical metrics are compiled into the model (compile_model) and none of your own metrics differs from its canonical counterpart (score_drift, run here on the synthetic dataset when the model carries metrics of your own). Levels are cumulative. Pass the mapping (either format), the semantic_model it reads (with an adapter, the model compile_model returned, so the compiled metrics and your own are seen) and the results of the generate_checks statement; without results level 3 is blocked and the report says what to run. Each blocker names the tool that clears it; the Next line is the one action to take. Nothing runs against your warehouse.",
  {
    adapter: z.string().describe("Your mapping as text: a GASP adapter (JSON; schema: https://gaspwiki.com/schemas/gasp-adapter-v1.json) or an Ossie mapping document (YAML or JSON), with the candidates and decisions in its GASP extension when propose_mapping and record_decision wrote them."),
    semantic_model: z.string().optional().describe("The Ossie semantic model (YAML or JSON): with an Ossie mapping, the model it reads (its profile questions, compiled gasp_ metrics and your own metrics are read); with a GASP adapter, the model compile_model returned, if you have one."),
    results: z.string().optional().describe("The rows the generate_checks statement returned, as JSON or CSV with check_id and violations. Without them level 3 cannot be assessed."),
    matches: z.string().optional().describe("Explicit pairs for your own metrics the names do not settle, as score_drift takes them: \"acme_nrr=NRR, lost_mrr=Churned MRR\"."),
    dialect: z.enum(DIALECTS).optional().describe("SQL dialect used to decide which checks are runnable; omit to use the warehouse's, else postgres."),
    window: z.number().int().min(0).optional().describe("Freshness window in days (default 2), as passed to generate_checks."),
    as_of: z.string().optional().describe("The date freshness was measured from, as YYYY-MM-DD, as passed to generate_checks."),
    period_spine: z.string().optional().describe("The period spine table, as passed to generate_checks and compile_model. Default gasp.period_spine."),
    output: z.enum(["report", "json"]).optional().describe("'report' (default): the level, a table of the four levels with their blockers, the detail per level and the next action; 'json': the same as data."),
  },
  async ({ adapter, semantic_model, results, matches, dialect, window, as_of, period_spine, output }) =>
    ({ content: [{ type: "text" as const, text: await readinessFromText(adapter, semantic_model, data, { results, matches, dialect, window, asOf: as_of, spine: period_spine, output }) }] }),
);

// --- Tool 18: infer_drivers ---
tool(
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

// --- Tool 19: explain_path ---
tool(
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

// --- Tool 20: coverage_gap ---
tool(
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
// --- Tool 21: lookup_definition ---
tool(
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

if (options.workspace) registerWorkspaceTools(options.workspace, tool);

  return server;
}

type Register = <Args extends ZodRawShapeCompat>(name: ToolName, description: string, params: Args, cb: ToolCallback<Args>, annotations?: Partial<ToolAnnotations>) => void;

const textResult = (text: string, isError = false): CallToolResult => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

const SIGN_IN_TEXT = "This tool needs a signed-in GASP Workspace company, and this call carried no token. Connect the GASP Standard server in Claude and sign in when it asks; see https://gaspwiki.com/workspace.";

const KIND_LABEL: Record<DocumentKind, string> = { mapping: "Mapping", model: "Semantic model", decisions: "Decisions", results: "Check results" };

/** save_workspace and load_workspace, over the store for the signed-in caller's company. */
function registerWorkspaceTools(ws: WorkspaceOptions, tool: Register): void {
  const companyFor = async (extra: unknown) => {
    const auth = (extra as { authInfo?: AuthInfo }).authInfo;
    const caller = callerOf(auth);
    if (!auth || !caller) return undefined;
    const store = await storeFor(ws);
    const { company } = await store.ensureCompany(auth);
    return { store, company, caller };
  };

  tool(
    "save_workspace",
    "Save the current documents to your company's GASP Workspace, each as a new version beside the earlier ones: the mapping (a GASP adapter or an Ossie mapping), the semantic model, the decisions recorded with record_decision and the rows the generate_checks statement returned. Pass at least one. Each is checked the way the pipeline tools read it before anything is written, so a document they could not read is refused and nothing is saved. Needs a signed-in company (sign-in through GASP Workspace when the server asks); the history is kept, so saving never overwrites.",
    {
      mapping: z.string().optional().describe("The mapping: a GASP adapter (JSON) or an Ossie mapping (YAML or JSON)."),
      semantic_model: z.string().optional().describe("The Ossie semantic model the mapping reads (YAML or JSON)."),
      decisions: z.string().optional().describe("The decisions as a YAML or JSON list, in the form record_decision takes."),
      results: z.string().optional().describe("The rows the generate_checks statement returned, as JSON or CSV with check_id and violations."),
    },
    async ({ mapping, semantic_model, decisions, results }, extra) => {
      const parsed: Array<[DocumentKind, unknown]> = [];
      const problems: string[] = [];
      for (const [kind, text] of [["mapping", mapping], ["model", semantic_model]] as const) {
        if (!text?.trim()) continue;
        const p = parseDocument(text);
        if (p.error || !p.doc) problems.push(`${KIND_LABEL[kind]}: ${p.error}`); else parsed.push([kind, p.doc]);
      }
      if (decisions?.trim()) {
        const d = parseDecisions(decisions);
        if ("error" in d) problems.push(`Decisions: ${d.error}`); else parsed.push(["decisions", d.decisions]);
      }
      if (results?.trim()) {
        const r = parseResults(results);
        if (r.error || !r.results) problems.push(`Check results: ${r.error}`); else parsed.push(["results", r.results]);
      }
      if (problems.length) return textResult(`Nothing was saved.\n\n${problems.map((p) => `- ${p}`).join("\n")}`, true);
      if (!parsed.length) return textResult("Pass at least one of mapping, semantic_model, decisions or results.", true);
      const ctx = await companyFor(extra);
      if (!ctx) return textResult(SIGN_IN_TEXT, true);
      const written: string[] = [];
      for (const [kind, body] of parsed) {
        const version = await ctx.store.saveDocument(ctx.company.id, kind, body, ctx.caller.userId);
        written.push(`- ${KIND_LABEL[kind]}: version ${version}`);
      }
      return textResult(`# Saved to the workspace of ${ctx.company.name ?? ctx.company.workos_org_id}\n\n${written.join("\n")}\n\nload_workspace reads the latest of each back; load_workspace with versions: true lists the history.`);
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  );

  tool(
    "load_workspace",
    "Load your company's saved documents from GASP Workspace: the latest version of the mapping, the semantic model, the decisions and the check results, each under its heading with its version, author and date, ready to pass to the pipeline tools. `kind` narrows it to one document; `versions: true` lists every saved version instead of the contents. Needs a signed-in company; a company only ever sees its own documents.",
    {
      kind: z.enum(DOCUMENT_KINDS).optional().describe("One kind of document: mapping, model, decisions or results. Omit it for all four."),
      versions: z.boolean().optional().describe("List the saved versions (kind, version, author, date) instead of the latest contents."),
    },
    async ({ kind, versions }, extra) => {
      const ctx = await companyFor(extra);
      if (!ctx) return textResult(SIGN_IN_TEXT, true);
      const who = ctx.company.name ?? ctx.company.workos_org_id;
      if (versions) {
        const list = await ctx.store.listVersions(ctx.company.id, kind);
        if (!list.length) return textResult(`The workspace of ${who} has no saved ${kind ? KIND_LABEL[kind].toLowerCase() : "documents"} yet. save_workspace writes them.`);
        return textResult(`# Saved versions: ${who}\n\n| Document | Version | Author | Saved |\n|---|---|---|---|\n${list.map((v) => `| ${KIND_LABEL[v.kind]} | ${v.version} | ${v.author_user_id ?? ""} | ${v.created_at} |`).join("\n")}`);
      }
      const docs = (await ctx.store.latestDocuments(ctx.company.id)).filter((d) => !kind || d.kind === kind);
      if (!docs.length) return textResult(`The workspace of ${who} has no saved ${kind ? KIND_LABEL[kind].toLowerCase() : "documents"} yet. save_workspace writes them.`);
      const order = (k: DocumentKind) => DOCUMENT_KINDS.indexOf(k);
      const parts = docs.sort((a, b) => order(a.kind) - order(b.kind)).map((d) =>
        `## ${KIND_LABEL[d.kind]}\n\nVersion ${d.version}, saved ${d.created_at}${d.author_user_id ? ` by ${d.author_user_id}` : ""}.\n\n\`\`\`json\n${JSON.stringify(d.body, null, 2)}\n\`\`\``);
      return textResult(`# Workspace: ${who}\n\n${parts.join("\n\n")}`);
    },
  );
}
