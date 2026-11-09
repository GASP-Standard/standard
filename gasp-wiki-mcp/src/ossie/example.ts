/**
 * The compact GASP example for apache/ossie `examples/`: the Core department
 * (MRR, ARR, NRR, GRR, churn, CAC, LTV and the rest) cut out of the full export
 * as three documents that stand on their own, in the layout of the upstream
 * flights example (`flights.ontology.yaml`, `flights.semantic_model.yaml`,
 * `flights.mapping.yaml`).
 *
 * Everything is filtered from the full documents rather than regenerated, so
 * the example says exactly what the full export says about each thing it
 * keeps. The ontology keeps the concept of every dataset the Core metrics read,
 * the relationships among those concepts and the value types they use; the
 * model keeps those datasets, the relationships between them, the staged
 * datasets the kept metrics need and the metrics (main formula and Operating
 * and Market forms; variants and breakdowns stay in the full export); the
 * mapping keeps the concept mappings of the kept concepts, pruned to the
 * datasets and concepts the example has. checkExport runs on the result, so a
 * dangling reference fails the derive.
 */
import { DEMO_PERIOD } from "./demo.js";
import { isMetricStub, metricFormulaId } from "../loader.js";
import type { StandardData } from "../types.js";
import { checkExport } from "./check.js";
import { planOntology } from "./ontology.js";
import {
  portableEntries,
  type OssieConcept, type OssieConceptMapping, type OssieExport, type OssieLinkMapping, type OssieMapping, type OssieObjectMapping, type OssieOntology,
  type OssieReferentMapping, type OssieSemanticModel,
} from "./types.js";

export const EXAMPLE_DEPARTMENT = "Core";
export const EXAMPLE_BASENAME = "gasp_saas";
const BUILT_INS = new Set(["Any", "Boolean", "Date", "DateTime", "Decimal", "Float", "Integer", "String"]);

export interface OssieExample {
  ontology: OssieOntology;
  model: OssieSemanticModel;
  mapping: OssieMapping;
  /** Coverage keys of the metric entries kept, in model order. */
  entries: string[];
  /** GASP datasets kept, in model order. */
  datasets: string[];
}

const datasetRefs = (text: string, known: Set<string>): string[] =>
  [...new Set([...text.matchAll(/\b([a-z_][a-z0-9_]*)\.[a-z_][a-z0-9_]*\b/g)].map((m) => m[1]).filter((d) => known.has(d)))];

export function exportExample(data: StandardData, exp: OssieExport): OssieExample {
  const plan = planOntology(data);
  const formulas = data.formulas ?? {};
  const coreIds = new Set(data.metrics.filter((m) => m.department === EXAMPLE_DEPARTMENT && !isMetricStub(m)).map((m) => metricFormulaId(data, m)));

  // ── metrics: the main entry and the O and M forms of every Core formula ──
  const entries = Object.keys(exp.coverage).filter((key) => {
    const [id, variant] = key.split(":");
    if (!coreIds.has(id)) return false;
    if (!variant) return true;
    return Boolean((formulas[id]?.forms as Record<string, string> | undefined)?.[variant]);
  });
  const metricNames = new Set<string>();
  const stagedNames = new Set<string>();
  for (const key of entries) {
    const c = exp.coverage[key];
    if (c.kind === "notComputable") continue;
    metricNames.add(c.ossieName);
    if (c.kind === "staged") stagedNames.add(c.stagedDataset);
  }
  const metrics = (exp.model.metrics ?? []).filter((m) => metricNames.has(m.name));

  // ── datasets: what the kept expressions and staged sources read ──
  const gaspDatasets = new Set(Object.keys(data.ontology!.datasets!));
  const byName = new Map(exp.model.datasets.map((d) => [d.name, d]));
  const read = new Set<string>();
  for (const m of metrics) for (const d of portableEntries(m.expression)) for (const ds of datasetRefs(d.expression, gaspDatasets)) read.add(ds);
  for (const name of stagedNames) {
    for (const m of byName.get(name)!.source.matchAll(/\bgasp\.([a-z_][a-z0-9_]*)/g)) if (gaspDatasets.has(m[1])) read.add(m[1]);
  }
  const keptDatasets = exp.model.datasets.filter((d) => read.has(d.name) || stagedNames.has(d.name));
  const keptNames = new Set(keptDatasets.map((d) => d.name));
  const datasets = keptDatasets.map((d) => d.name).filter((n) => read.has(n));

  const model: OssieSemanticModel = {
    ...exp.model,
    name: "GASP SaaS core",
    description: `The Core metrics of the GASP Standard (Generally Accepted SaaS Principles) as an Apache Ossie semantic model: ${metrics.length} metrics over ${datasets.length} datasets, cut from the full reference model at https://koinedata.com/downloads/ossie/. Each metric carries its canonical page and its GASP formula.`,
    datasets: keptDatasets,
    relationships: (exp.model.relationships ?? []).filter((r) => keptNames.has(r.from) && keptNames.has(r.to)),
    metrics,
  };

  // ── ontology: the kept datasets' concepts, the value types they use, the relationships among them ──
  const conceptByName = new Map(exp.ontology.ontology.map((c) => [c.concept, c]));
  const entityConcepts = new Set(datasets.map((d) => plan.datasetConcept[d]));
  const isValueType = (name: string): boolean => BUILT_INS.has(name) || conceptByName.get(name)?.type === "ValueType";
  const valueTypes = new Set<string>();
  const addValueType = (name: string) => {
    if (BUILT_INS.has(name) || valueTypes.has(name)) return;
    valueTypes.add(name);
    for (const parent of conceptByName.get(name)?.extends ?? []) addValueType(parent);
  };
  const keptRelationships = new Map<string, Set<string>>();
  const entities: OssieConcept[] = [];
  for (const c of exp.ontology.ontology) {
    if (!entityConcepts.has(c.concept)) continue;
    const relationships = (c.relationships ?? []).filter((r) => (r.roles ?? []).every((role) => entityConcepts.has(role.concept) || isValueType(role.concept)));
    for (const r of relationships) for (const role of r.roles ?? []) if (isValueType(role.concept)) addValueType(role.concept);
    const names = new Set(relationships.map((r) => r.name));
    keptRelationships.set(c.concept, names);
    const identify = (c.identify_by ?? []).filter((n) => names.has(n));
    entities.push({ ...c, ...(relationships.length ? { relationships } : { relationships: undefined }), ...(identify.length ? { identify_by: identify } : { identify_by: undefined }) });
  }
  const kept = new Set([...entityConcepts, ...valueTypes]);
  const concepts = exp.ontology.ontology
    .filter((c) => kept.has(c.concept))
    .map((c) => entities.find((e) => e.concept === c.concept) ?? c)
    .map((c) => JSON.parse(JSON.stringify(c)) as OssieConcept); // drop the undefined keys
  const mentions = (line: string) => [...line.matchAll(/\b([A-Z][A-Za-z0-9]*)\b/g)].map((m) => m[1]).filter((n) => conceptByName.has(n));
  const ontology: OssieOntology = {
    ...exp.ontology,
    name: "GASP SaaS core",
    description: `The concepts behind the Core metrics of the GASP Standard: ${entityConcepts.size} entity types (one per dataset the metrics read), their relationships and ${valueTypes.size} value types, cut from the full GASP ontology at https://koinedata.com/downloads/ossie/.`,
    ...(exp.ontology.requires ? { requires: exp.ontology.requires.filter((line) => mentions(line).every((n) => kept.has(n))) } : {}),
    ontology: concepts,
  };

  // ── mapping: the kept concepts, pruned to kept datasets and concepts ──
  const okExpression = (e?: string) => !e || datasetRefs(e, gaspDatasets).every((d) => read.has(d));
  const pruneReferents = (items?: OssieReferentMapping[]): OssieReferentMapping[] | undefined => {
    const out = (items ?? []).filter((r) => okExpression(r.expression)).map((r) => ({ ...r, ...(r.referent_mappings ? { referent_mappings: pruneReferents(r.referent_mappings) } : {}) }));
    return out.length ? out : undefined;
  };
  const okObject = (o: OssieObjectMapping): boolean => (!o.concept || kept.has(o.concept)) && okExpression(o.expression) && (o.referent_mappings ?? []).every((r) => okExpression(r.expression));
  const pruneLinks = (concept: string, links?: OssieLinkMapping[]): OssieLinkMapping[] | undefined => {
    const names = keptRelationships.get(concept);
    const out = (links ?? [])
      .filter((l) => okObject(l.object_mapping) && (!l.relationship || !names || names.has(l.relationship)))
      .map((l) => ({ ...l, object_mapping: { ...l.object_mapping, ...(l.object_mapping.referent_mappings ? { referent_mappings: pruneReferents(l.object_mapping.referent_mappings) } : {}) }, ...(l.children ? { children: pruneLinks(l.object_mapping.concept ?? concept, l.children) } : {}) }))
      .map((l) => (l.children && l.children.length === 0 ? { ...l, children: undefined } : l));
    return out.length ? (JSON.parse(JSON.stringify(out)) as OssieLinkMapping[]) : undefined;
  };
  const conceptMappings: OssieConceptMapping[] = exp.mapping.concept_mappings
    .filter((cm) => entityConcepts.has(cm.concept))
    .map((cm) => {
      const object_mappings = (cm.object_mappings ?? []).filter(okObject).map((o) => ({ ...o, ...(o.referent_mappings ? { referent_mappings: pruneReferents(o.referent_mappings) } : {}) }));
      const link_mappings = pruneLinks(cm.concept, cm.link_mappings);
      return JSON.parse(JSON.stringify({ concept: cm.concept, ...(object_mappings.length ? { object_mappings } : {}), ...(link_mappings ? { link_mappings } : {}) })) as OssieConceptMapping;
    });
  const mapping: OssieMapping = {
    ...exp.mapping,
    name: "gasp_saas_mapping",
    description: "Maps the GASP SaaS core ontology onto the GASP SaaS core semantic model.",
    ontology_ref: { name: ontology.name, iri: `./${EXAMPLE_BASENAME}.ontology.yaml` },
    semantic_model_ref: { name: model.name, iri: `./${EXAMPLE_BASENAME}.semantic_model.yaml` },
    concept_mappings: conceptMappings,
  };

  const problems = checkExport({ ontology, model, mapping }, { extensionSchema: data.extensionSchema });
  if (problems.length) throw new Error(`Ossie example failed GASP's cross-reference checks:\n- ${problems.join("\n- ")}`);
  return { ontology, model, mapping, entries, datasets };
}

/** README.md for the example directory. */
export function exampleReadme(ex: OssieExample, data: StandardData): string {
  const byName = new Map(data.metrics.map((m) => [metricFormulaId(data, m), m]));
  const rows = ex.entries.map((key) => {
    const [id, form] = key.split(":");
    const m = byName.get(id);
    const f = data.formulas?.[id];
    const text = form ? (f?.forms as Record<string, string> | undefined)?.[form] : f?.formula ?? f?.notComputable;
    return `| ${m?.name ?? id}${form ? ` (${form === "O" ? "Operating" : "Market"} form)` : ""} | \`${(text ?? "").replace(/\|/g, "\\|")}\` |`;
  });
  return `# GASP SaaS core: an Apache Ossie example

Generated from the GASP Standard (https://koinedata.com) by \`npm run derive\` in \`gasp-wiki-mcp\`. Do not edit; edit \`/standard/\` and re-run.

The Core department of the GASP Standard (Generally Accepted SaaS Principles) as three Apache Ossie (incubating) documents, in the layout of the upstream \`examples/flights.*\` set: an ontology, a semantic model and the mapping between them. It is the compact form of the full export beside it, cut to the ${ex.datasets.length} datasets the ${ex.entries.length} Core metric entries read, and is the draft of the example GASP proposes to contribute to \`apache/ossie/examples/\`.

| File | Contents |
| --- | --- |
| \`${EXAMPLE_BASENAME}.ontology.yaml\` | ${ex.ontology.ontology.filter((c) => c.type === "EntityType").length} entity types (one per dataset), their relationships and ${ex.ontology.ontology.filter((c) => c.type === "ValueType").length} value types with enum constraints |
| \`${EXAMPLE_BASENAME}.semantic_model.yaml\` | ${ex.datasets.length} datasets (${ex.datasets.join(", ")}), ${ex.model.relationships?.length ?? 0} relationships, ${ex.model.datasets.length - ex.datasets.length} staged datasets and ${ex.model.metrics?.length ?? 0} metrics |
| \`${EXAMPLE_BASENAME}.mapping.yaml\` | The ontology mapped onto the model, by name and relative IRI |

Every metric is an \`OSSIE_SQL_2026\` expression where the language can state it; a metric that needs a cohort, a prior period, an opening snapshot or a period bound on a non-time field is staged through a per-period dataset whose source is the compiled SQL (see \`../coverage.json\` for the reason per entry and \`../conformance/\` for one executed case per reason). Physical sources are \`gasp.<dataset>\` with columns named by GASP field id; an adopter's mapping replaces both.

## Metrics

| Metric | GASP formula |
| --- | --- |
${rows.join("\n")}

## Running it

\`demo/\` runs the model on a standard SQL engine. \`demo/data.sql\` creates the ${ex.datasets.length} tables under \`gasp.<dataset>\` with the fixture rows the metrics need, plus \`gasp.period_spine\` holding the reporting period (${DEMO_PERIOD.start} to ${DEMO_PERIOD.end}); \`demo/metrics.sql\` returns one row per metric, each direct metric as its expression with every aggregate evaluated over its dataset's rows for the period and each staged metric as its staged dataset's row; \`demo/expected.sql\` is the result as a VALUES list. On DuckDB, the engine the upstream query compliance suite uses:

\`\`\`bash
cat demo/data.sql demo/metrics.sql | duckdb
\`\`\`

or without the CLI, \`uv run --with duckdb python -c "import duckdb; c = duckdb.connect(); c.execute(open('demo/data.sql').read()); print(c.sql(open('demo/metrics.sql').read()))"\`. The same scripts run on Postgres. The GASP test suite checks the DuckDB result against \`expected.sql\` on every build, and the expected values against the GASP compiled SQL on the full fixture.

## Validating

From a clone of apache/ossie, with the three files in one directory:

\`\`\`bash
uv run validation/validate.py ${EXAMPLE_BASENAME}.semantic_model.yaml
uv run validation/validate.py ${EXAMPLE_BASENAME}.ontology.yaml --schema ontology/ontology.json
uv run validation/validate.py ${EXAMPLE_BASENAME}.mapping.yaml --schema ontology/mapping.json
\`\`\`

The GASP test suite runs the same three commands on every build.
`;
}
