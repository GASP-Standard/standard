#!/usr/bin/env node
/**
 * Regenerates everything that derives from standard/formulas.json so no
 * hand-maintained copy can drift from the canon:
 *
 *   standard/ontology.json                          structuredFormulas, entityMappings, field metricCount
 *   standard/relationships.json                     component and measures edges
 *   standard/exports/gasp-knowledge-graph.cypher    whole file
 *   standard/exports/gasp-adapter-template.json     whole file
 *   standard/exports/ossie/gasp.ontology.yaml       Apache Ossie ontology (src/ossie/)
 *   standard/exports/ossie/gasp.semantic_model.yaml Ossie reference model with every canonical metric
 *   standard/exports/ossie/gasp.mapping.yaml        Ossie mapping of the ontology onto the model
 *   standard/exports/ossie/coverage.json            how each formula was exported (direct, staged, not computable)
 *
 * The website build (gasp-wiki-frontend/scripts/generate-content.ts) copies
 * standard/exports/ to public/downloads/ and standard/gasp-adapter-schema.json
 * to public/schemas/gasp-adapter-v1.json.
 *
 * Usage: npm run derive          write the files
 *        npm run derive:check    exit 1 if any file differs (used by tests)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { exportOssie, ossieYaml } from "./ossie/index.js";
import { join } from "node:path";
import { loadStandard, metricFormulaId, isMetricStub } from "./loader.js";
import { parseFormula, analyzeFormula } from "./formula.js";
import { compileMetric } from "./compile.js";
import { metricUrl } from "./urls.js";
import type { StandardData, Metric } from "./types.js";

const root = join(new URL(".", import.meta.url).pathname, "..", "..");
const exportsDir = join(root, "standard", "exports");
export const DERIVED_FILES = {
  ontology: join(root, "standard", "ontology.json"),
  relationships: join(root, "standard", "relationships.json"),
  cypher: join(exportsDir, "gasp-knowledge-graph.cypher"),
  template: join(exportsDir, "gasp-adapter-template.json"),
  ossieOntology: join(exportsDir, "ossie", "gasp.ontology.yaml"),
  ossieModel: join(exportsDir, "ossie", "gasp.semantic_model.yaml"),
  ossieMapping: join(exportsDir, "ossie", "gasp.mapping.yaml"),
  ossieCoverage: join(exportsDir, "ossie", "coverage.json"),
};
/** The canonical adapter schema, the only copy in the standard; the website serves it at /schemas/gasp-adapter-v1.json. */
export const SCHEMA_SOURCE = join(root, "standard", "gasp-adapter-schema.json");

/** Replace one top-level key's value in a JSON document without reformatting the rest. */
export function replaceJsonSection(raw: string, key: string, value: unknown): string {
  const marker = `\n  "${key}": `;
  const start = raw.indexOf(marker);
  if (start < 0) throw new Error(`Section "${key}" not found`);
  const valueStart = start + marker.length;
  let depth = 0, inStr = false, i = valueStart;
  for (; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (depth === 0) { i++; break; } }
  }
  const body = JSON.stringify(value, null, 2).split("\n").map((l, idx) => (idx ? "  " + l : l)).join("\n");
  return raw.slice(0, valueStart) + body + raw.slice(i);
}

const q = (s: string) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export function computeDerived(data: StandardData, current: Record<keyof typeof DERIVED_FILES, string>) {
  const ont = data.ontology!;
  const formulas = data.formulas!;
  const fields = Object.fromEntries(ont.fields!.map((f) => [f.id, f]));
  const ctx = { fields, datasets: ont.datasets!, formulas };
  const nodeIds = new Set(data.nodes.filter((n) => !n.nodeType || n.nodeType === "metric").map((n) => n.id));
  const byId = new Map<string, Metric>();
  for (const m of data.metrics) if (!isMetricStub(m)) byId.set(metricFormulaId(data, m), m);
  const slugOf = (id: string) => byId.get(id)?.slug;

  // ── per-formula analysis ────────────────────────────────────────────────
  // Field usage counts every field a metric's compiled SQL reads: direct refs, dataset date
  // and cohort key fields, and fields reached through metric refs, across forms and variants.
  const usage = new Map<string, Set<string>>();
  const compiled = new Map<string, ReturnType<typeof compileMetric>>();
  for (const [id, f] of Object.entries(formulas)) {
    if (!f.formula) continue;
    compiled.set(id, compileMetric(id, ctx));
    const variants = [...Object.keys(f.forms ?? {}), ...Object.keys(f.variants ?? {})];
    for (const c of [compiled.get(id)!, ...variants.map((v) => compileMetric(id, ctx, v))]) {
      for (const fid of c.fields) (usage.get(fid) ?? usage.set(fid, new Set()).get(fid)!).add(id);
    }
  }

  // ── ontology: structuredFormulas, entityMappings, metricCount ─────────────
  const structured: Record<string, unknown> = {
    description: "Derived from formulas.json by `npm run derive` (gasp-wiki-mcp). Each graph metric: its canonical formula, the metrics it reads (with arithmetic role and polarity: how the metric moves when the input rises) and the fields it reads, for graph traversal.",
  };
  for (const id of [...nodeIds].sort()) {
    const f = formulas[id];
    if (!f?.formula) continue;
    const a = analyzeFormula(parseFormula(f.formula));
    const entry: Record<string, unknown> = {
      expression: f.formula,
      inputs: a.metricRefs.map((ref) => ({ ref, role: a.metricRoles[ref], polarity: a.metricPolarity[ref].length > 1 ? "mixed" : a.metricPolarity[ref][0] })),
      fields: compiled.get(id)!.fields,
    };
    if (f.variants?.adjusted) entry.adjustedVariant = f.variants.adjusted;
    structured[id] = entry;
  }
  const keyEntity = new Map<string, string>();
  for (const [dsId, ds] of Object.entries(ont.datasets!)) for (const e of ds.entities ?? []) if (ds.key.endsWith("_id")) keyEntity.set(ds.key, e);
  const entityMappings: Record<string, string[]> = Object.fromEntries(ont.entities.map((e) => [e.id, [] as string[]]));
  for (const [id, c] of compiled) {
    const ents = new Set<string>();
    for (const d of c.datasets) for (const e of ont.datasets![d].entities ?? []) ents.add(e);
    for (const fid of c.fields) { const e = keyEntity.get(fid); if (e) ents.add(e); }
    for (const e of ents) entityMappings[e]?.push(id);
  }
  for (const k of Object.keys(entityMappings)) entityMappings[k].sort();
  const fieldsOut = ont.fields!.map((f) => {
    const { metricCount: _old, ...rest } = f as any;
    const out: Record<string, unknown> = {};
    for (const k of ["id", "type", "datasets", "sources", "values", "dimension", "description"]) if (rest[k] !== undefined) out[k] = rest[k];
    out.metricCount = usage.get(f.id)?.size ?? 0;
    return out;
  });
  let ontology = replaceJsonSection(current.ontology, "fields", fieldsOut);
  ontology = replaceJsonSection(ontology, "entityMappings", entityMappings);
  ontology = replaceJsonSection(ontology, "structuredFormulas", structured);

  // ── relationships.json: component + measures edges ───────────────────────
  const rel = JSON.parse(current.relationships);
  const kept = rel.edges.filter((e: any) => e.type !== "component" && e.type !== "measures");
  const component: any[] = [];
  for (const id of [...nodeIds].sort()) {
    const f = formulas[id];
    if (!f?.formula) continue;
    for (const ref of analyzeFormula(parseFormula(f.formula)).metricRefs) if (nodeIds.has(ref)) component.push({ source: ref, target: id, type: "component" });
  }
  const measures: any[] = [];
  const entityNodes = new Set(data.nodes.filter((n) => n.nodeType === "entity").map((n) => n.id));
  for (const [e, ids] of Object.entries(entityMappings)) for (const id of ids) if (nodeIds.has(id) && entityNodes.has(`entity_${e}`)) measures.push({ source: id, target: `entity_${e}`, type: "measures" });
  rel.edges = [...kept.filter((e: any) => nodeIds.has(e.source) && nodeIds.has(e.target)), ...component, ...measures, ...kept.filter((e: any) => !(nodeIds.has(e.source) && nodeIds.has(e.target)))];
  const relationships = JSON.stringify(rel, null, 2) + "\n";

  // ── cypher ────────────────────────────────────────────────────────────────
  const L: string[] = [];
  const metricNodes = data.nodes.filter((n) => nodeIds.has(n.id));
  const entityEdges = ont.entityRelationships?.edges ?? [];
  const metricEdges = rel.edges.filter((e: any) => nodeIds.has(e.source) && nodeIds.has(e.target));
  const temporal = JSON.parse(current.ontology);
  const sourcedFrom = ont.fields!.flatMap((f) => (f.sources ?? []).map((s) => [f.id, s] as const));
  const belongs = ont.fields!.flatMap((f) => (f.datasets ?? []).map((d) => [f.id, d] as const));
  L.push("// ═══════════════════════════════════════════════════════════════",
    "// GASP Standard — SaaS Metric Knowledge Graph (Full Ontology)",
    "// Generated from the GASP Standard (https://gaspwiki.com) by `npm run derive`",
    "// ═══════════════════════════════════════════════════════════════", "//",
    `// Nodes: ${metricNodes.length} Metrics, ${ont.entities.length} Entities, ${ont.concepts!.length} Concepts, ${Object.keys(ont.datasets!).length} Datasets, ${ont.fields!.length} Fields, ${ont.sourceCategories!.length} Source Categories`,
    `// Edges: ${metricEdges.length} metric relationships, ${measures.length} MEASURES, ${entityEdges.length} entity/concept relationships, ${belongs.length} BELONGS_TO, ${sourcedFrom.length} SOURCED_FROM`, "//",
    "// Relationship types (metric signal): DRIVES, REDUCES, PREDICTS, COMPONENT_OF, MEASURES",
    "// Relationship types (entity): " + Object.values(ont.entityRelationships?.edgeTypeClassification ?? {}).flat().join(", "),
    "// Relationship types (data lineage): BELONGS_TO (Field → Dataset), SOURCED_FROM (Field → SourceCategory)", "//",
    "// Import: paste into Neo4j Browser or pipe to cypher-shell",
    "// ═══════════════════════════════════════════════════════════════", "",
    "// Clean slate (optional, uncomment to clear existing data)", "// MATCH (n) DETACH DELETE n;", "");
  L.push(`// ─── Metric Nodes (${metricNodes.length}) ─────────────────────────`);
  for (const n of metricNodes) {
    const m = byId.get(n.id) ?? data.metrics.find((x) => metricFormulaId(data, x) === n.id);
    const t = temporal.temporalSemantics?.[temporal.temporalMapping?.[n.id]] ?? {};
    const props = [`id: ${q(n.id)}`, `name: ${q(n.label)}`, `department: ${q(n.department ?? m?.department ?? "")}`, `signalType: ${q(n.signalType ?? "")}`, `level: ${n.level ?? 0}`,
      `definition: ${q(m?.definition ?? n.description ?? "")}`, `formula: ${q(formulas[n.id]?.formula ?? m?.formulas?.[0] ?? "")}`, `url: ${q(m ? metricUrl(m) : "")}`];
    if (t.grain) props.push(`grain: ${q(t.grain)}`, `frequency: ${q(t.frequency)}`, `period: ${q(t.period)}`);
    L.push(`CREATE (:Metric {${props.join(", ")}});`);
  }
  L.push("", `// ─── Entity Nodes (${ont.entities.length}) ──────────────────────────`);
  for (const e of ont.entities as any[]) L.push(`CREATE (:Entity {id: ${q(e.id)}, name: ${q(e.label)}, aliases: ${q((e.aliases ?? []).join(", "))}, definition: ${q(e.definition)}, level: ${q(e.level ?? "")}});`);
  L.push("", `// ─── Concept Nodes (${ont.concepts!.length}) ───────────────────────`);
  for (const c of ont.concepts!) L.push(`CREATE (:Concept {id: ${q(c.id)}, name: ${q(c.label)}, definition: ${q(c.definition)}});`);
  L.push("", `// ─── Source Category Nodes (${ont.sourceCategories!.length}) ──────────────`);
  for (const s of ont.sourceCategories!) L.push(`CREATE (:SourceCategory {id: ${q(s.id)}, name: ${q(s.label ?? s.id)}, description: ${q(s.description ?? "")}});`);
  L.push("", `// ─── Dataset Nodes (${Object.keys(ont.datasets!).length}) ─────────────────────────────`);
  for (const [id, d] of Object.entries(ont.datasets!)) L.push(`CREATE (:Dataset {id: ${q(id)}, name: ${q(d.label)}, kind: ${q(d.kind)}, dateField: ${q(d.date)}, keyField: ${q(d.key)}${d.cel ? `, cel: ${q(d.cel)}` : ""}});`);
  L.push("", `// ─── Field Nodes (${ont.fields!.length}) ─────────────────────────────`);
  for (const f of fieldsOut as any[]) L.push(`CREATE (:Field {id: ${q(f.id)}, type: ${q(f.type)}, metricCount: ${f.metricCount}${f.values ? `, values: ${q(f.values.join("|"))}` : ""}});`);
  L.push("", `// ─── Metric Relationships (${metricEdges.length}) ──────────────────`);
  for (const e of metricEdges) L.push(`MATCH (a:Metric {id: ${q(e.source)}}), (b:Metric {id: ${q(e.target)}})`, `CREATE (a)-[:${e.type === "component" ? "COMPONENT_OF" : String(e.type).toUpperCase()}${e.inverse ? " {inverse: true}" : ""}]->(b);`);
  L.push("", `// ─── MEASURES Edges (${measures.length}) ──────────────────────────`);
  for (const e of measures) L.push(`MATCH (m:Metric {id: ${q(e.source)}}), (e:Entity {id: ${q(e.target.replace("entity_", ""))}})`, `CREATE (m)-[:MEASURES]->(e);`);
  L.push("", `// ─── BELONGS_TO Edges (${belongs.length}) ─────────────────────────────`);
  for (const [f, d] of belongs) L.push(`MATCH (f:Field {id: ${q(f)}}), (d:Dataset {id: ${q(d)}})`, `CREATE (f)-[:BELONGS_TO]->(d);`);
  L.push("", `// ─── SOURCED_FROM Edges (${sourcedFrom.length}) ─────────────────────────────`);
  for (const [f, s] of sourcedFrom) L.push(`MATCH (f:Field {id: ${q(f)}}), (s:SourceCategory {id: ${q(s)}})`, `CREATE (f)-[:SOURCED_FROM]->(s);`);
  const conceptIds = new Set(ont.concepts!.map((c) => c.id));
  const classOf = (type: string) => Object.entries(ont.entityRelationships?.edgeTypeClassification ?? {}).find(([, ts]) => ts.includes(type))?.[0] ?? "other";
  L.push("", `// ─── Entity Relationships (${entityEdges.length}) ──────────────`);
  for (const cls of [...new Set(entityEdges.map((e) => classOf(e.type)))]) {
    L.push(`// ${cls[0].toUpperCase()}${cls.slice(1)}`);
    for (const e of entityEdges.filter((x) => classOf(x.type) === cls)) {
      const target = conceptIds.has(e.to) ? `(t:Concept {id: ${q(e.to)}})` : `(t:Entity {id: ${q(e.to)}})`;
      L.push(`MATCH (s:Entity {id: ${q(e.from)}}), ${target}`, `CREATE (s)-[:${e.type} {cardinality: ${q(e.cardinality)}, provenance: ${q(e.provenance)}}]->(t);`);
    }
  }
  L.push("", "// ─── Indexes ──────────────────────────────────────────",
    "CREATE INDEX metric_id IF NOT EXISTS FOR (m:Metric) ON (m.id);", "CREATE INDEX metric_dept IF NOT EXISTS FOR (m:Metric) ON (m.department);",
    "CREATE INDEX metric_signal IF NOT EXISTS FOR (m:Metric) ON (m.signalType);", "CREATE INDEX entity_id IF NOT EXISTS FOR (e:Entity) ON (e.id);",
    "CREATE INDEX concept_id IF NOT EXISTS FOR (c:Concept) ON (c.id);", "CREATE INDEX dataset_id IF NOT EXISTS FOR (d:Dataset) ON (d.id);",
    "CREATE INDEX field_id IF NOT EXISTS FOR (f:Field) ON (f.id);", "CREATE INDEX source_id IF NOT EXISTS FOR (s:SourceCategory) ON (s.id);", "");
  const cypher = L.join("\n");

  // ── adapter template ──────────────────────────────────────────────────────
  const label = new Map(ont.sourceCategories!.map((s) => [s.id, s.label ?? s.id]));
  const template = {
    $schema: "https://gaspwiki.com/schemas/gasp-adapter-v1.json",
    version: "1.1",
    organization: "",
    warehouse: "",
    _instructions: "Map a warehouse table to each dataset you have (schema.table) and a column to each field (a bare column name, or schema.table.column). Fields that live on several datasets appear once per dataset; fill the ones you have. Fields you cannot map can be left with an empty warehouseRef or removed. Enum fields list the values the column must produce after transform. Run validate_adapter (GASP MCP) to see which metrics you can compute and which owners are missing.",
    metricOwners: [] as unknown[],
    datasets: Object.fromEntries(Object.keys(ont.datasets!).sort().map((d) => [d, ""])),
    mappings: ont.fields!.flatMap((f) => {
      const usedBy = [...(usage.get(f.id) ?? [])].map((id) => byId.get(id)?.name ?? id).sort();
      const row = (dataset?: string) => {
        const m: Record<string, unknown> = { gaspField: f.id };
        if (dataset) m.dataset = dataset;
        m.type = f.type;
        m.warehouseRef = "";
        if (f.values) m.values = f.values;
        m.source = label.get(f.sources?.[0] ?? "") ?? "";
        m.usedBy = usedBy;
        return m;
      };
      return (f.datasets ?? []).length > 1 ? f.datasets!.map((d) => row(d)) : [row()];
    }),
  };
  // ── Apache Ossie export ───────────────────────────────────────────────────
  const ossie = exportOssie(data);
  const coverage = { description: "How each canonical formula was exported to the Ossie reference model: direct (one portable expression), staged (a per-period dataset carrying the compiled SQL) or notComputable. Written by npm run derive.", ...summarise(ossie.coverage), metrics: ossie.coverage };

  return {
    ontology, relationships, cypher, template: JSON.stringify(template, null, 2) + "\n",
    ossieOntology: ossieYaml(ossie.ontology), ossieModel: ossieYaml(ossie.model), ossieMapping: ossieYaml(ossie.mapping),
    ossieCoverage: JSON.stringify(coverage, null, 2) + "\n",
  };
}

function summarise(coverage: Record<string, { kind: string; reason?: string }>) {
  const counts: Record<string, number> = { direct: 0, staged: 0, notComputable: 0 };
  const stagedReasons: Record<string, number> = {};
  for (const c of Object.values(coverage)) {
    counts[c.kind] = (counts[c.kind] ?? 0) + 1;
    if (c.kind === "staged" && c.reason) stagedReasons[c.reason] = (stagedReasons[c.reason] ?? 0) + 1;
  }
  return { counts, stagedReasons };
}

/** Current contents of every derived file; a file that does not exist yet reads as empty so the first derive writes it. */
export function readCurrent(): Record<keyof typeof DERIVED_FILES, string> {
  return Object.fromEntries(Object.entries(DERIVED_FILES).map(([k, p]) => [k, existsSync(p) ? readFileSync(p, "utf-8") : ""])) as any;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!.replace(/\.ts$/, ".js")) || process.argv[1]?.endsWith("derive.ts");
if (isMain) {
  const check = process.argv.includes("--check");
  const current = readCurrent();
  const out = computeDerived(loadStandard(), current);
  const changed = (Object.keys(out) as Array<keyof typeof out>).filter((k) => out[k] !== current[k]);
  if (check) {
    if (changed.length) { console.error(`Derived files out of date: ${changed.join(", ")}. Run npm run derive.`); process.exit(1); }
    console.log("Derived files are current.");
  } else {
    for (const k of changed) { mkdirSync(dirname(DERIVED_FILES[k]), { recursive: true }); writeFileSync(DERIVED_FILES[k], out[k]); }
    console.log(changed.length ? `Updated ${changed.join(", ")}` : "No changes.");
  }
}
