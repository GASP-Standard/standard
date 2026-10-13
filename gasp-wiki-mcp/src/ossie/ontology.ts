/**
 * GASP ontology → Apache Ossie ontology document (ontology/ontology.json).
 *
 *   dataset (47)          EntityType concept, identified by its key field
 *   GASP concept (7)      EntityType concept without an identifier
 *   field (251)           ValueType concept extending the built-in for its type,
 *                         except date and timestamp fields, which play Date / DateTime
 *   field on a dataset    relationship on the dataset concept named by the field id:
 *                           key           identifying, OneToOne
 *                           foreign key   binary, role played by the referenced dataset concept
 *                           snapshot/fact ternary (snapshot date, value)
 *                           event         binary (value)
 *   entityRelationships   relationship on the source concept named by the edge type
 *
 * `planOntology` holds every naming and resolution decision so the mapping
 * exporter (mapping.ts) and the tests read the same answers.
 */
import type { StandardData, OntologyField, OntologyDataset, EntityRelationship } from "../types.js";
import type { OssieConcept, OssieOntology, OssieOntologyRelationship, OssieRole } from "./types.js";
import { OSSIE_VERSION } from "./types.js";
import { builtInFor, conceptName, enumRequires, isBuiltInRole, pascal, valueTypeName } from "./names.js";

const BUILT_INS = new Set(["Any", "Boolean", "Date", "DateTime", "Decimal", "Float", "Integer", "String"]);

/** How one field sits on one dataset. */
export type FieldRole =
  | { kind: "key" }
  | { kind: "foreignKey"; target: string }
  | { kind: "snapshotDate" }
  | { kind: "value"; ternary: boolean };

export interface ResolvedEdge {
  edge: EntityRelationship;
  /** Concept names of the two ends */
  source: string;
  target: string;
  /** Dataset ids of the two ends, when the end is a dataset concept */
  sourceDataset?: string;
  targetDataset?: string;
  /** Relationship name on the source concept */
  name: string;
  /**
   * Dataset whose rows carry both ends' keys, so the mapping can populate the
   * relationship. Undefined when no dataset carries both (the relationship is
   * then declared in the ontology but has no link mapping in the reference model).
   */
  join?: { dataset: string; sourceKey: string; targetKey: string };
}

export interface OntologyPlan {
  datasets: Array<[string, OntologyDataset]>;
  fields: OntologyField[];
  fieldById: Map<string, OntologyField>;
  /** dataset id → concept name */
  datasetConcept: Record<string, string>;
  /** GASP concept id → concept name */
  gaspConcept: Record<string, string>;
  /** field id → concept that plays the field's value role (value type or built-in) */
  roleConcept: Record<string, string>;
  /** key field id → dataset it identifies when it appears on another dataset */
  foreignKeyTarget: Record<string, string>;
  /** entity id → its primary dataset */
  entityDataset: Record<string, string>;
  /** "<plain> → <renamed> (<reason>)" for every concept renamed to avoid a collision */
  renames: string[];
  edges: ResolvedEdge[];
  /** Edges with an end that is neither a dataset concept nor a GASP concept */
  unmappedEdges: string[];
  /** Fields of one dataset, in ontology.json field order */
  fieldsOf(datasetId: string): OntologyField[];
  roleOf(datasetId: string, fieldId: string): FieldRole;
  /** Concept playing the snapshot or period date role of a dataset */
  dateConcept(datasetId: string): string;
  /** True when the dataset's own fields are ternary (snapshot or fact keyed by something other than its date) */
  isTernary(datasetId: string): boolean;
}

const cache = new WeakMap<StandardData, OntologyPlan>();

export function planOntology(data: StandardData): OntologyPlan {
  const hit = cache.get(data);
  if (hit) return hit;
  const ont = data.ontology;
  if (!ont?.datasets || !ont.fields) throw new Error("ontology.json has no datasets or fields");
  const datasets = Object.entries(ont.datasets);
  const datasetMap = ont.datasets;
  const fields = ont.fields;
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const renames: string[] = [];

  // ── concept names; datasets first, then GASP concepts, then value types ──
  const taken = new Set<string>(BUILT_INS);
  const datasetConcept: Record<string, string> = {};
  for (const [id] of datasets) {
    const name = conceptName(id);
    if (taken.has(name)) throw new Error(`dataset ${id} concept name ${name} collides`);
    taken.add(name);
    datasetConcept[id] = name;
  }
  const gaspConcept: Record<string, string> = {};
  for (const c of ont.concepts ?? []) {
    let name = pascal(c.id);
    if (taken.has(name)) {
      renames.push(`concept ${c.id}: ${name} → ${name}Concept (dataset concept ${name} exists)`);
      name = `${name}Concept`;
    }
    taken.add(name);
    gaspConcept[c.id] = name;
  }
  const roleConcept: Record<string, string> = {};
  for (const f of fields) {
    if (isBuiltInRole(f.type)) {
      roleConcept[f.id] = builtInFor(f.type);
      continue;
    }
    let name = valueTypeName(f);
    if (taken.has(name)) {
      const clash = Object.values(gaspConcept).includes(name) ? "GASP concept" : Object.values(datasetConcept).includes(name) ? "dataset concept" : BUILT_INS.has(name) ? "built-in" : "value type";
      renames.push(`field ${f.id}: ${name} → ${name}Value (${clash} ${name} exists)`);
      name = `${name}Value`;
      if (taken.has(name)) throw new Error(`field ${f.id} value type ${name} still collides`);
    }
    taken.add(name);
    roleConcept[f.id] = name;
  }

  // ── entity → primary dataset: the dataset with the entity's id, else the first listing it ──
  const entityDataset: Record<string, string> = {};
  for (const e of ont.entities) {
    const ds = datasetMap[e.id] ? e.id : datasets.find(([, d]) => d.entities?.includes(e.id))?.[0];
    if (ds) entityDataset[e.id] = ds;
  }

  // ── foreign keys ──
  // A field is a foreign key when it is the key of some dataset. Date keys
  // (period_start on financials and forecast, snapshot_date on balance_sheet)
  // are excluded: on every other dataset they are that dataset's own date.
  // When a key identifies several datasets (subscription_id, onboarding_id,
  // event_id), the target is chosen deterministically: the dataset whose id is
  // the key without `_id`, else the first (in ontology.json order) whose
  // `entities` includes that entity, else the first that has the key.
  const keyedBy = new Map<string, string[]>();
  for (const [id, d] of datasets) keyedBy.set(d.key, [...(keyedBy.get(d.key) ?? []), id]);
  const foreignKeyTarget: Record<string, string> = {};
  for (const [key, owners] of keyedBy) {
    const f = fieldById.get(key);
    if (!f || isBuiltInRole(f.type)) continue;
    const entity = key.replace(/_id$/, "");
    foreignKeyTarget[key] = owners.find((d) => d === entity) ?? owners.find((d) => datasetMap[d].entities?.includes(entity)) ?? owners[0];
  }

  const fieldsByDataset = new Map<string, OntologyField[]>();
  for (const f of fields) for (const d of f.datasets ?? []) fieldsByDataset.set(d, [...(fieldsByDataset.get(d) ?? []), f]);

  const isTernary = (ds: string) => {
    const d = datasetMap[ds];
    return d.kind !== "event" && d.key !== d.date;
  };
  const roleOf = (ds: string, fieldId: string): FieldRole => {
    const d = datasetMap[ds];
    if (fieldId === d.key) return { kind: "key" };
    const target = foreignKeyTarget[fieldId];
    if (target && target !== ds) return { kind: "foreignKey", target };
    if (fieldId === d.date && isTernary(ds)) return { kind: "snapshotDate" };
    return { kind: "value", ternary: isTernary(ds) };
  };

  // ── entityRelationships ──
  const endConcept = (id: string): { concept: string; dataset?: string } | undefined => {
    const ds = entityDataset[id];
    if (ds) return { concept: datasetConcept[ds], dataset: ds };
    if (gaspConcept[id]) return { concept: gaspConcept[id] };
    return undefined;
  };
  const edges: ResolvedEdge[] = [];
  const unmappedEdges: string[] = [];
  const rawEdges = ont.entityRelationships?.edges ?? [];
  for (const edge of rawEdges) {
    const s = endConcept(edge.from);
    const t = endConcept(edge.to);
    if (!s || !t) {
      const missing = [!s && edge.from, !t && edge.to].filter(Boolean).join(" and ");
      unmappedEdges.push(`${edge.from} ${edge.type} ${edge.to}: no dataset or GASP concept for ${missing}`);
      continue;
    }
    let name = edge.type.toLowerCase();
    // Two edges of one type from one source (customer BELONGS_TO cohort and segment) need distinct names.
    const sameType = rawEdges.filter((e) => e.from === edge.from && e.type === edge.type && endConcept(e.to));
    if (sameType.length > 1) name = `${name}_${edge.to}`;
    if (s.dataset && fieldById.get(name)?.datasets?.includes(s.dataset)) name = `${name}_${edge.to}`;
    let join: ResolvedEdge["join"];
    if (s.dataset && t.dataset && s.dataset !== t.dataset) {
      const sk = datasetMap[s.dataset].key;
      const tk = datasetMap[t.dataset].key;
      const carries = (ds: string, key: string) => fieldById.get(key)?.datasets?.includes(ds) && foreignKeyTarget[key] !== undefined;
      if (carries(t.dataset, sk) && foreignKeyTarget[sk] === s.dataset) join = { dataset: t.dataset, sourceKey: sk, targetKey: tk };
      else if (carries(s.dataset, tk) && foreignKeyTarget[tk] === t.dataset) join = { dataset: s.dataset, sourceKey: sk, targetKey: tk };
    }
    edges.push({ edge, source: s.concept, target: t.concept, sourceDataset: s.dataset, targetDataset: t.dataset, name, join });
  }

  const plan: OntologyPlan = {
    datasets,
    fields,
    fieldById,
    datasetConcept,
    gaspConcept,
    roleConcept,
    foreignKeyTarget,
    entityDataset,
    renames,
    edges,
    unmappedEdges,
    fieldsOf: (ds) => fieldsByDataset.get(ds) ?? [],
    roleOf,
    dateConcept: (ds) => builtInFor(fieldById.get(datasetMap[ds].date)?.type ?? "date"),
    isTernary,
  };
  cache.set(data, plan);
  return plan;
}

const words = (id: string) => id.replace(/_/g, " ");
/** Verb phrase for an edge type: OWNS → owns, PARENT_OF → is parent of. */
const edgeVerb = (type: string) => `${/_(OF|BY)$/.test(type) ? "is " : ""}${words(type.toLowerCase())}`;
const ref = (r: OssieRole) => (r.name ? `{${r.concept}:${r.name}}` : `{${r.concept}}`);

/** Role names for self edges, where the target concept also plays the first role. */
const SELF_ROLE: Record<string, string> = { PARENT_OF: "child" };

function datasetRelationships(plan: OntologyPlan, ds: string): OssieOntologyRelationship[] {
  const me = plan.datasetConcept[ds];
  const out: OssieOntologyRelationship[] = [];
  for (const f of plan.fieldsOf(ds)) {
    const role = plan.roleOf(ds, f.id);
    const description = f.description;
    if (role.kind === "snapshotDate") continue;
    if (role.kind === "key") {
      const r: OssieRole = { concept: plan.roleConcept[f.id] };
      out.push({ name: f.id, description, roles: [r], multiplicity: "OneToOne", verbalizes: [`{${me}} is identified by ${ref(r)}`] });
      continue;
    }
    if (role.kind === "foreignKey") {
      const r: OssieRole = { concept: plan.datasetConcept[role.target] };
      out.push({ name: f.id, description, roles: [r], multiplicity: "ManyToOne", verbalizes: [`{${me}} belongs to ${ref(r)}`] });
      continue;
    }
    const value = plan.roleConcept[f.id];
    const builtIn = isBuiltInRole(f.type);
    const has = builtIn ? `has ${words(f.id)}` : "has";
    if (role.ternary) {
      const date: OssieRole = { concept: plan.dateConcept(ds) };
      const v: OssieRole = value === date.concept ? { concept: value, name: f.id } : { concept: value };
      out.push({ name: f.id, description, roles: [date, v], multiplicity: "ManyToOne", verbalizes: [`{${me}} on ${ref(date)} ${has} ${ref(v)}`] });
    } else {
      const v: OssieRole = { concept: value };
      out.push({ name: f.id, description, roles: [v], multiplicity: "ManyToOne", verbalizes: [`{${me}} ${has} ${ref(v)}`] });
    }
  }
  return out;
}

function edgeRelationship(e: ResolvedEdge): OssieOntologyRelationship {
  const r: OssieRole = e.source === e.target ? { concept: e.target, name: SELF_ROLE[e.edge.type] ?? "other" } : { concept: e.target };
  return { name: e.name, description: e.edge.description, roles: [r], verbalizes: [`{${e.source}} ${edgeVerb(e.edge.type)} ${ref(r)}`] };
}

function datasetDescription(data: StandardData, plan: OntologyPlan, ds: string, d: OntologyDataset): string {
  const parts = [`${d.label} (${d.kind} dataset \`${ds}\`).`];
  const entity = data.ontology!.entities.find((e) => plan.entityDataset[e.id] === ds && (e.id === ds || d.entities?.includes(e.id)));
  if (entity) {
    parts.push(entity.definition);
    if (entity.aliases.length) parts.push(`Also known as: ${entity.aliases.join(", ")}.`);
  }
  if (d.cel) parts.push(`CEL class: ${d.cel}.`);
  return parts.join(" ");
}

export function exportOntology(data: StandardData): OssieOntology {
  const plan = planOntology(data);
  const concepts: OssieConcept[] = [];
  const edgesFrom = (concept: string) => plan.edges.filter((e) => e.source === concept).map(edgeRelationship);

  for (const [id, d] of plan.datasets) {
    const name = plan.datasetConcept[id];
    concepts.push({
      concept: name,
      type: "EntityType",
      description: datasetDescription(data, plan, id, d),
      identify_by: [d.key],
      relationships: [...datasetRelationships(plan, id), ...edgesFrom(name)],
    });
  }
  for (const c of data.ontology!.concepts ?? []) {
    const name = plan.gaspConcept[c.id];
    const rels = edgesFrom(name);
    concepts.push({ concept: name, type: "EntityType", description: `${c.label}. ${c.definition}`, ...(rels.length ? { relationships: rels } : {}) });
  }
  for (const f of plan.fields) {
    if (isBuiltInRole(f.type)) continue;
    const name = plan.roleConcept[f.id];
    const vt: OssieConcept = { concept: name, type: "ValueType", description: f.description, extends: [builtInFor(f.type)] };
    if (f.type === "enum" && f.values?.length) vt.requires = [enumRequires(name, f.values)];
    concepts.push(vt);
  }

  return {
    version: OSSIE_VERSION,
    name: "GASP",
    description:
      "GASP Standard (Generally Accepted SaaS Principles) ontology: the datasets, fields and business concepts SaaS metrics are computed from. Generated from /standard/ontology.json; see https://gaspwiki.com.",
    ontology: concepts,
  };
}

/** Edges from ontology.json entityRelationships that could not be expressed (an end with no concept). */
export function unmappedEdges(data: StandardData): string[] {
  return [...planOntology(data).unmappedEdges];
}

/** Edges declared in the ontology that no reference dataset can populate (no dataset carries both keys). */
export function edgesWithoutJoin(data: StandardData): string[] {
  return planOntology(data)
    .edges.filter((e) => !e.join)
    .map((e) => `${e.source}.${e.name} → ${e.target}`);
}
