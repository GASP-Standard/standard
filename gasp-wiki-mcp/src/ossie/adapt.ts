/**
 * One mapping format: a company's warehouse mapping as an Apache Ossie mapping
 * document over their semantic model, with the v1 adapter accepted as input and
 * converted on load (docs/ossie-interop-spec.md, "One mapping format").
 *
 *   adapterToOssie   v1 adapter → a synthesised semantic model (their tables as
 *                    datasets, their columns as fields, a transform as a
 *                    calculated field) and a mapping of the GASP ontology onto it
 *   ossieToAdapter   Ossie mapping (+ their model) → the v1 shape every tool
 *                    already consumes: table per dataset, column per field
 *   checkMapping     either input, validated in layers: the Ossie schemas
 *                    (bundled, so it works offline), GASP's cross-document
 *                    checks against the GASP ontology, then the coverage,
 *                    transform and ownership checks of validate_mapping
 *
 * A mapping expression is `<dataset>.<field>` over the company's model. A field
 * whose model expression is not its bare column name carries that expression
 * as the adapter transform, so generate_query emits it verbatim.
 */
import { parse as parseYaml } from "yaml";
import type { ValidateFunction } from "ajv";
import { checkAdapter, columnOf, formatSchemaError, formatValidationReport, newAjv, resolveAdapter, type Adapter, type AdapterValidation, type Mapping } from "../tools.js";
import type { StandardData } from "../types.js";
import { checkExport } from "./check.js";
import { mappingOver, type MappingGap } from "./mapping.js";
import { ossieDataType, slug } from "./names.js";
import { exportOntology, planOntology } from "./ontology.js";
import { GASP_VENDOR, OSSIE_VERSION, expressionText, portable, readGaspExtension, type OssieDataset, type OssieField, type OssieLinkMapping, type OssieMapping, type OssieSemanticModel, normaliseExtensions } from "./types.js";

/** An identifier, not a location: it stays on gaspwiki.com (where it was first published) so mappings already written keep matching; the file itself is served on koinedata.com and gaspwiki.com redirects there. */
export const GASP_ONTOLOGY_IRI = "https://gaspwiki.com/downloads/ossie/gasp.ontology.yaml";
const REF = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/;

export const isV1Adapter = (doc: unknown): doc is Adapter =>
  typeof doc === "object" && doc !== null && Array.isArray((doc as { mappings?: unknown }).mappings);
export const isOssieMapping = (doc: unknown): doc is OssieMapping =>
  typeof doc === "object" && doc !== null && Array.isArray((doc as { concept_mappings?: unknown }).concept_mappings);
export const isOssieModel = (doc: unknown): doc is OssieSemanticModel =>
  typeof doc === "object" && doc !== null && Array.isArray((doc as { datasets?: unknown }).datasets);

/**
 * JSON first, then YAML (a YAML document is what the Ossie files are). Any
 * `custom_extensions[].data` given as an object (the apache/ossie #522 form)
 * is rewritten to the JSON string the pinned schema defines, so the schema
 * layer and every reader see one shape.
 */
export function parseDocument(text: string): { doc?: Record<string, unknown>; error?: string } {
  const object = (v: unknown) => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
  const parsed = (v: unknown) => { const doc = object(v); if (doc) normaliseExtensions(doc); return doc; };
  try {
    const doc = parsed(JSON.parse(text));
    return doc ? { doc } : { error: "The document is not an object." };
  } catch { /* not JSON */ }
  try {
    const doc = parsed(parseYaml(text));
    return doc ? { doc } : { error: "The document is not a YAML or JSON object." };
  } catch (e) {
    return { error: `The document is neither JSON nor YAML: ${(e as Error).message.split("\n")[0]}` };
  }
}

/** GASP dataset → GASP field → the company model's dataset and field that carry it. */
export type ModelRefs = Record<string, Record<string, { dataset: string; field: string }>>;

export interface OssieForm {
  model: OssieSemanticModel;
  mapping: OssieMapping;
  gaps: MappingGap[];
  refs: ModelRefs;
}

export { expressionText };

/** A v1 adapter as the two Ossie documents: the company's model and the GASP mapping onto it. */
export function adapterToOssie(adapter: Adapter, data: StandardData): OssieForm {
  const datasets = data.ontology?.datasets ?? {};
  const r = resolveAdapter(adapter, data);
  const org = adapter.organization?.trim() || "Company";
  const base = slug(org);
  const modelName = `${org} semantic model`;
  const dsIds = Object.keys(datasets).filter((ds) => r.tables[ds] || r.columns[ds]);

  // Model field name per (dataset, GASP field): the column, or the GASP id when a transform makes it a calculated field.
  const names: Record<string, Record<string, string>> = {};
  for (const ds of dsIds) {
    const used = new Set<string>();
    names[ds] = {};
    for (const f of data.ontology!.fields!) {
      const m = r.columns[ds]?.[f.id];
      if (!m) continue;
      let name = m.transform ? f.id : columnOf(m.warehouseRef);
      if (used.has(name)) name = f.id;
      used.add(name);
      names[ds][f.id] = name;
    }
  }
  const refs: ModelRefs = Object.fromEntries(dsIds.map((ds) => [ds, Object.fromEntries(Object.entries(names[ds]).map(([f, name]) => [f, { dataset: ds, field: name }]))]));
  const modelDatasets: OssieDataset[] = dsIds.map((ds) => {
    const meta = datasets[ds];
    const fields: OssieField[] = [];
    for (const f of data.ontology!.fields!) {
      const m = r.columns[ds]?.[f.id];
      if (!m) continue;
      const column = columnOf(m.warehouseRef);
      const expression = m.transform ? m.transform.replace(/\{\{value\}\}/g, column) : column;
      fields.push({
        name: names[ds][f.id],
        expression: portable(expression),
        ...(f.id === meta.date ? { dimension: { is_time: true } } : {}),
        datatype: ossieDataType(f.type),
        ...(f.description ? { description: f.description } : {}),
      });
    }
    const keyParts = [meta.key, ...(meta.kind === "snapshot" || meta.kind === "fact" ? [meta.date] : [])].filter((k) => names[ds][k]);
    return {
      name: ds,
      source: r.tables[ds] ?? ds,
      ...(keyParts.length === (meta.kind === "snapshot" || meta.kind === "fact" ? 2 : 1) ? { primary_key: keyParts.map((k) => names[ds][k]) } : {}),
      description: `${meta.label} (GASP dataset ${ds})${r.tables[ds] ? "" : "; no warehouse table named yet"}`,
      ...(fields.length ? { fields } : {}),
    };
  });
  const model: OssieSemanticModel = {
    version: OSSIE_VERSION,
    name: modelName,
    description: `${org}'s warehouse as the GASP datasets it carries, synthesised from a GASP adapter${adapter.version ? ` (v${adapter.version})` : ""}.`,
    datasets: modelDatasets,
  };
  const extension = { adapter_version: adapter.version, organization: adapter.organization, warehouse: adapter.warehouse, metricOwners: adapter.metricOwners };
  const { mapping, gaps } = mappingOver(data, {
    name: `gasp_mapping_${base}`,
    description: `Maps the GASP ontology onto ${modelName}.`,
    ontologyIri: GASP_ONTOLOGY_IRI,
    modelName,
    modelIri: `./${base}.semantic_model.yaml`,
    datasets: dsIds,
    include: (ds, f) => Boolean(names[ds]?.[f]),
    expr: (ds, f) => `${ds}.${names[ds][f]}`,
    custom_extensions: [{ vendor_name: GASP_VENDOR, data: JSON.stringify(extension) }],
  });
  return { model, mapping, gaps, refs };
}

/** An Ossie mapping (with the company's model when given) as the v1 adapter shape the tools consume. */
export function ossieToAdapter(mapping: OssieMapping, model: OssieSemanticModel | undefined, data: StandardData): { adapter: Adapter; problems: string[] } {
  const { adapter, problems } = resolveMapping(mapping, model, data);
  return { adapter, problems };
}

/**
 * An Ossie mapping resolved two ways at once: the v1 adapter shape (table per
 * dataset, column per field, a calculated field's expression as the transform)
 * and the model references (dataset and field names) the compiler writes into
 * a direct expression.
 */
export function resolveMapping(mapping: OssieMapping, model: OssieSemanticModel | undefined, data: StandardData): { adapter: Adapter; refs: ModelRefs; problems: string[] } {
  const plan = planOntology(data);
  const datasets = data.ontology?.datasets ?? {};
  const conceptDataset = Object.fromEntries(Object.entries(plan.datasetConcept).map(([ds, c]) => [c, ds]));
  const modelDs = new Map((model?.datasets ?? []).map((d) => [d.name, d]));
  const problems: string[] = [];
  const mappings: Mapping[] = [];
  const tables: Record<string, string> = {};
  const refs: ModelRefs = {};
  const seen = new Set<string>();

  const place = (gaspDs: string, gaspField: string, expression: string | undefined, where: string) => {
    if (!expression) return;
    const m = REF.exec(expression.trim());
    if (!m) {
      problems.push(`${where}: expression "${expression}" is not a <dataset>.<field> reference, so it cannot name a column.`);
      return;
    }
    const [, dsName, col] = m;
    const d = modelDs.get(dsName);
    const table = d?.source && !/\s/.test(d.source) ? d.source : dsName;
    const field = d?.fields?.find((f) => f.name === col);
    const text = field ? expressionText(field) : undefined;
    const transform = text && text.trim() !== col ? text : undefined;
    const key = `${gaspField}@${gaspDs}=${table}.${col}`;
    if (seen.has(key)) return;
    seen.add(key);
    tables[gaspDs] ??= table;
    (refs[gaspDs] ??= {})[gaspField] ??= { dataset: dsName, field: col };
    mappings.push({ gaspField, dataset: gaspDs, warehouseRef: `${table}.${col}`, ...(transform ? { transform } : {}) });
  };

  for (const cm of mapping.concept_mappings ?? []) {
    const ds = conceptDataset[cm.concept];
    if (!ds) continue; // a GASP concept rather than a dataset, or unknown: the cross-document checks report the latter
    const meta = datasets[ds];
    const fieldIds = new Set(plan.fieldsOf(ds).map((f) => f.id));
    for (const om of cm.object_mappings ?? []) {
      for (const rm of om.referent_mappings ?? []) if (rm.relationship === meta.key) place(ds, meta.key, rm.expression, `concept "${cm.concept}" object mapping`);
    }
    const walk = (lm: OssieLinkMapping, level: number, where: string) => {
      const om = lm.object_mapping ?? {};
      if (lm.relationship && fieldIds.has(lm.relationship)) {
        place(ds, lm.relationship, om.expression ?? om.referent_mappings?.[0]?.expression, `${where} "${lm.relationship}"`);
      } else if (!lm.relationship && level > 1 && om.expression) {
        // The dated level of a snapshot or fact dataset: the Date object carries the date column.
        place(ds, meta.date, om.expression, `${where} date`);
      }
      (lm.children ?? []).forEach((c, i) => walk(c, level + 1, `${where} > child ${i + 1}`));
    };
    (cm.link_mappings ?? []).forEach((lm, i) => walk(lm, 1, `concept "${cm.concept}" link mapping ${i + 1}`));
  }

  const meta = readGaspExtension<{ adapter_version?: string; organization?: string; warehouse?: string; metricOwners?: Adapter["metricOwners"] }>(mapping.custom_extensions) ?? {};
  const adapter: Adapter = {
    version: "1.1",
    organization: meta.organization ?? mapping.semantic_model_ref?.name?.replace(/ semantic model$/i, "") ?? undefined,
    ...(meta.warehouse ? { warehouse: meta.warehouse } : {}),
    ...(meta.metricOwners?.length ? { metricOwners: meta.metricOwners } : {}),
    datasets: tables,
    mappings,
  };
  return { adapter, refs, problems };
}

/** The company's model implied by a mapping's expressions, for the checks when no model was supplied. */
export function impliedModel(mapping: OssieMapping): OssieSemanticModel {
  const fields = new Map<string, Set<string>>();
  const visit = (expr?: string) => {
    const m = expr && REF.exec(expr.trim());
    if (m) (fields.get(m[1]) ?? fields.set(m[1], new Set()).get(m[1])!).add(m[2]);
  };
  const walkLink = (lm: OssieLinkMapping) => {
    visit(lm.object_mapping?.expression);
    lm.object_mapping?.referent_mappings?.forEach((r) => visit(r.expression));
    lm.children?.forEach(walkLink);
  };
  for (const cm of mapping.concept_mappings ?? []) {
    cm.object_mappings?.forEach((om) => { visit(om.expression); om.referent_mappings?.forEach((r) => visit(r.expression)); });
    cm.link_mappings?.forEach(walkLink);
  }
  return {
    version: OSSIE_VERSION,
    name: mapping.semantic_model_ref?.name ?? "implied model",
    datasets: [...fields.entries()].map(([name, cols]) => ({
      name,
      source: name,
      fields: [...cols].map((c) => ({ name: c, expression: portable(c) })),
    })),
  };
}

// ── schema checks against the bundled upstream schemas ───────────────────────

const RAW = "https://raw.githubusercontent.com/apache/ossie/main/";
const validators = new WeakMap<object, { mapping: ValidateFunction; model: ValidateFunction }>();

function ossieValidators(data: StandardData): { mapping: ValidateFunction; model: ValidateFunction } | null {
  const schemas = data.ossieSchemas;
  if (!schemas) return null;
  let v = validators.get(schemas);
  if (!v) {
    const ajv = newAjv();
    ajv.addFormat("iri", true); // the ontology schema's prefixes use it; ajv has no built-in and would warn on every load
    // The schemas reference each other by their raw.githubusercontent URLs; register each under that key and its $id.
    ajv.addSchema(schemas.model, `${RAW}core-spec/ossie-schema.json`);
    ajv.addSchema(schemas.ontology, `${RAW}ontology/ontology.json`);
    ajv.addSchema(schemas.mapping, `${RAW}ontology/mapping.json`);
    v = { mapping: ajv.getSchema(`${RAW}ontology/mapping.json`)!, model: ajv.getSchema(`${RAW}core-spec/ossie-schema.json`)! };
    validators.set(schemas, v);
  }
  return v;
}

/** One line per schema error, or null when the loaded data carries no Ossie schemas. */
export function ossieSchemaErrors(doc: unknown, kind: "mapping" | "model", data: StandardData): string[] | null {
  const v = ossieValidators(data);
  if (!v) return null;
  const validate = v[kind];
  return validate(doc) ? [] : (validate.errors ?? []).map(formatSchemaError);
}

// ── the layered check ────────────────────────────────────────────────────────

export interface MappingValidation {
  format: "v1" | "ossie";
  modelProvided: boolean;
  /** Ossie schema errors of the mapping (and the model, prefixed); null when the data carries no Ossie schemas */
  ossieSchemaErrors: string[] | null;
  /** GASP's cross-document checks against the GASP ontology and the model */
  crossProblems: string[];
  /** Expressions the conversion could not read as columns */
  conversionProblems: string[];
  /** Datasets or field groups the v1 conversion left out of the mapping */
  gaps: MappingGap[];
  adapter: Adapter;
  /** The validate_mapping checks over the (converted) adapter */
  coverage: AdapterValidation;
  ossie: { model: OssieSemanticModel; mapping: OssieMapping };
}

export function checkMapping(input: { document: unknown; model?: unknown }, data: StandardData): MappingValidation | { error: string } {
  const ontology = exportOntology(data);
  if (isV1Adapter(input.document)) {
    const adapter = input.document;
    const coverage = checkAdapter(adapter, data);
    if (!coverage.hasMappings) return { error: formatValidationReport(coverage, adapter, data) };
    const form = adapterToOssie(adapter, data);
    return {
      format: "v1", modelProvided: false,
      ossieSchemaErrors: ossieSchemaErrors(form.mapping, "mapping", data),
      crossProblems: checkExport({ ontology, model: form.model, mapping: form.mapping }, { extensionSchema: data.extensionSchema }),
      conversionProblems: [], gaps: form.gaps, adapter, coverage, ossie: { model: form.model, mapping: form.mapping },
    };
  }
  if (isOssieMapping(input.document)) {
    const mapping = input.document;
    const given = isOssieModel(input.model) ? input.model : undefined;
    const model = given ?? impliedModel(mapping);
    const schemaErrors = ossieSchemaErrors(mapping, "mapping", data);
    const modelErrors = given ? ossieSchemaErrors(given, "model", data) : [];
    const { adapter, problems } = ossieToAdapter(mapping, given, data);
    const coverage = checkAdapter(adapter, data);
    coverage.schemaErrors = null; // the v1 schema does not apply to a converted document
    return {
      format: "ossie", modelProvided: Boolean(given),
      ossieSchemaErrors: schemaErrors === null ? null : [...schemaErrors, ...(modelErrors ?? []).map((e) => `semantic model: ${e}`)],
      crossProblems: checkExport({ ontology, model, mapping }, { extensionSchema: data.extensionSchema }),
      conversionProblems: problems, gaps: [], adapter, coverage, ossie: { model, mapping },
    };
  }
  return { error: "The document is neither a GASP adapter (an object with a \"mappings\" array; template: https://koinedata.com/downloads/gasp-adapter-template.json) nor an Ossie mapping (an object with \"concept_mappings\"; reference: https://koinedata.com/downloads/ossie/gasp.mapping.yaml)." };
}

export function formatMappingReport(v: MappingValidation, data: StandardData): string {
  const org = v.adapter.organization || "unnamed";
  const p: string[] = [`# GASP Mapping Validation: ${org}`, ""];
  const datasets = v.ossie.model.datasets.length;
  const fields = v.ossie.model.datasets.reduce((n, d) => n + (d.fields?.length ?? 0), 0);
  p.push("## Format");
  if (v.format === "v1") {
    p.push(`GASP adapter${v.adapter.version ? ` v${v.adapter.version}` : ""}, converted on load to an Ossie mapping over a semantic model of ${datasets} dataset${datasets === 1 ? "" : "s"} and ${fields} field${fields === 1 ? "" : "s"} (\`${v.ossie.mapping.name}\` over \`${v.ossie.model.name}\`).`);
    for (const g of v.gaps) p.push(`- Dataset \`${g.dataset}\` is left out of the mapping: ${g.reason}.`);
  } else {
    p.push(v.modelProvided
      ? `Ossie mapping \`${v.ossie.mapping.name}\` with its semantic model \`${v.ossie.model.name}\` (${datasets} dataset${datasets === 1 ? "" : "s"}, ${fields} field${fields === 1 ? "" : "s"}).`
      : `Ossie mapping \`${v.ossie.mapping.name}\` without a semantic model: dataset and field names were taken from the mapping's expressions (${datasets} dataset${datasets === 1 ? "" : "s"}, ${fields} field${fields === 1 ? "" : "s"}); their types, keys and sources were not checked. Pass the model to check them.`);
  }
  p.push("");
  const se = v.ossieSchemaErrors;
  p.push(se === null ? "## Ossie schema" : se.length ? `## Ossie schema (${se.length} ${se.length === 1 ? "error" : "errors"})` : "## Ossie schema");
  if (se === null) p.push("The loaded standard data carries no Ossie schemas, so the schema was not applied.");
  else if (se.length) p.push("Against apache/ossie ontology/mapping.json:", ...se.map((x) => `- ${x}`));
  else p.push("Valid against apache/ossie ontology/mapping.json.");
  p.push("");
  const cp = [...v.crossProblems, ...v.conversionProblems];
  p.push(cp.length ? `## Cross-document checks (${cp.length} ${cp.length === 1 ? "problem" : "problems"})` : "## Cross-document checks");
  p.push(cp.length ? "Against the GASP ontology and the semantic model:" : "Every concept, relationship and field reference resolves against the GASP ontology and the semantic model.", ...cp.map((x) => `- ${x}`), "");
  const schemaSection = v.format === "v1" ? undefined : [];
  p.push(formatValidationReport(v.coverage, v.adapter, data, { title: "## Coverage", schemaSection }));
  return p.join("\n");
}

/** The validate_mapping report for a document (and optional model) given as text. */
export function validateMapping(documentText: string, modelText: string | undefined, data: StandardData): string {
  const doc = parseDocument(documentText);
  if (!doc.doc) return `Invalid document. ${doc.error}`;
  let model: unknown;
  if (modelText?.trim()) {
    const m = parseDocument(modelText);
    if (!m.doc) return `Invalid semantic model. ${m.error}`;
    if (!isOssieModel(m.doc)) return "The semantic model must be an Ossie semantic model document (an object with a \"datasets\" array).";
    model = m.doc;
  }
  const v = checkMapping({ document: doc.doc, model }, data);
  return "error" in v ? v.error : formatMappingReport(v, data);
}

/** A company's mapping in either format, resolved: the adapter shape, the model its metrics compile into and the references into it. */
export interface Company {
  format: "v1" | "ossie";
  adapter: Adapter;
  /** The company's model: given, implied from the mapping's expressions, or synthesised from a v1 adapter */
  model: OssieSemanticModel;
  modelProvided: boolean;
  refs: ModelRefs;
  /** Expressions the conversion could not read as columns */
  problems: string[];
}

/** The company behind a document (and optional model) given as text, in either format. */
export function resolveCompany(documentText: string, modelText: string | undefined, data: StandardData): Company | { error: string } {
  const doc = parseDocument(documentText);
  if (!doc.doc) return { error: `Invalid document. ${doc.error}` };
  if (isV1Adapter(doc.doc)) {
    const form = adapterToOssie(doc.doc, data);
    return { format: "v1", adapter: doc.doc, model: form.model, modelProvided: false, refs: form.refs, problems: [] };
  }
  if (isOssieMapping(doc.doc)) {
    let model: OssieSemanticModel | undefined;
    if (modelText?.trim()) {
      const m = parseDocument(modelText);
      if (!m.doc || !isOssieModel(m.doc)) return { error: `Invalid semantic model. ${m.error ?? "It must be an Ossie semantic model document."}` };
      model = m.doc;
    }
    const { adapter, refs, problems } = resolveMapping(doc.doc, model, data);
    return { format: "ossie", adapter, model: model ?? impliedModel(doc.doc), modelProvided: Boolean(model), refs, problems };
  }
  return { error: 'The document must be a GASP adapter (a "mappings" array) or an Ossie mapping (a "concept_mappings" array).' };
}

/** The adapter shape behind a document in either format, for generate_query. */
export function loadAdapter(documentText: string, modelText: string | undefined, data: StandardData): { adapter?: Adapter; format?: "v1" | "ossie"; error?: string } {
  const c = resolveCompany(documentText, modelText, data);
  return "error" in c ? { error: c.error } : { adapter: c.adapter, format: c.format };
}
