/**
 * Reference mapping: the GASP ontology (ontology.ts) onto the GASP reference
 * semantic model, whose datasets and fields carry the GASP ids as names
 * (names.ts). A customer's mapping has the same shape with their own
 * dataset and field names.
 *
 * Per dataset concept:
 *   object_mappings   the concept's key, `<dataset>.<key>`
 *   link_mappings     root: the key; one child per field relationship.
 *                     Snapshot and fact datasets nest the value children under
 *                     a Date object mapping (`<dataset>.<date>`) because their
 *                     relationships are ternary; foreign keys stay binary.
 *                     A second root per entityRelationships edge that some
 *                     dataset can populate (it carries both ends' keys).
 */
import type { StandardData } from "../types.js";
import type { OssieConceptMapping, OssieExtension, OssieLinkMapping, OssieMapping, OssieObjectMapping } from "./types.js";
import { OSSIE_VERSION } from "./types.js";
import { planOntology, type OntologyPlan } from "./ontology.js";

export const ONTOLOGY_IRI = "./gasp.ontology.yaml";
export const SEMANTIC_MODEL_IRI = "./gasp.semantic_model.yaml";
export const SEMANTIC_MODEL_NAME = "GASP reference model";

const keyRef = (plan: OntologyPlan, targetDataset: string, expression: string): OssieObjectMapping => ({
  concept: plan.datasetConcept[targetDataset],
  referent_mappings: [{ relationship: plan.datasets.find(([id]) => id === targetDataset)![1].key, expression }],
});

/** What a mapping covers and how it names things; the reference mapping covers everything under GASP ids. */
export interface MappingSpec {
  name: string;
  description: string;
  ontologyIri: string;
  modelName: string;
  modelIri: string;
  /** GASP dataset ids to map (default: every dataset) */
  datasets?: string[];
  /** Whether a GASP field of a dataset is in the model (default: all) */
  include?: (ds: string, fieldId: string) => boolean;
  /** The model-side expression for a GASP field on a dataset (default `<ds>.<fieldId>`) */
  expr?: (ds: string, fieldId: string) => string;
  custom_extensions?: OssieExtension[];
}

/** Why a dataset or a group of its fields was left out of a mapping. */
export interface MappingGap { dataset: string; reason: string }

function datasetMapping(plan: OntologyPlan, ds: string, spec: MappingSpec, gaps: MappingGap[]): OssieConceptMapping | undefined {
  const d = plan.datasets.find(([id]) => id === ds)![1];
  const inc = spec.include ?? (() => true);
  const expr = spec.expr ?? ((dsId: string, f: string) => `${dsId}.${f}`);
  if (!inc(ds, d.key)) {
    gaps.push({ dataset: ds, reason: `its key field \`${d.key}\` is not mapped, so the concept cannot be identified` });
    return undefined;
  }
  // A fresh object per use, so the YAML writer emits no anchors.
  const self = (): OssieObjectMapping => ({ referent_mappings: [{ relationship: d.key, expression: expr(ds, d.key) }] });
  const binary: OssieLinkMapping[] = [];
  const ternary: OssieLinkMapping[] = [];
  for (const f of plan.fieldsOf(ds)) {
    const role = plan.roleOf(ds, f.id);
    if (role.kind === "key" || role.kind === "snapshotDate" || !inc(ds, f.id)) continue;
    if (role.kind === "foreignKey") {
      binary.push({ object_mapping: keyRef(plan, role.target, expr(ds, f.id)), relationship: f.id });
      continue;
    }
    const child: OssieLinkMapping = { object_mapping: { concept: plan.roleConcept[f.id], expression: expr(ds, f.id) }, relationship: f.id };
    (role.ternary ? ternary : binary).push(child);
  }
  const children = [...binary];
  if (ternary.length) {
    if (inc(ds, d.date)) children.push({ object_mapping: { concept: plan.dateConcept(ds), expression: expr(ds, d.date) }, children: ternary });
    else gaps.push({ dataset: ds, reason: `its date field \`${d.date}\` is not mapped, so ${ternary.length} dated field${ternary.length === 1 ? "" : "s"} (${ternary.map((t) => t.relationship).join(", ")}) cannot be placed` });
  }

  const links: OssieLinkMapping[] = [];
  if (children.length) links.push({ object_mapping: self(), children });
  const concept = plan.datasetConcept[ds];
  const covered = new Set(spec.datasets ?? plan.datasets.map(([id]) => id));
  for (const e of plan.edges) {
    if (e.source !== concept || !e.join) continue;
    const j = e.join;
    if (!covered.has(j.dataset) || !inc(j.dataset, j.sourceKey) || !inc(j.dataset, j.targetKey) || !e.targetDataset || !covered.has(e.targetDataset)) continue;
    links.push({
      object_mapping: { referent_mappings: [{ relationship: j.sourceKey, expression: expr(j.dataset, j.sourceKey) }] },
      children: [{ object_mapping: keyRef(plan, e.targetDataset, expr(j.dataset, j.targetKey)), relationship: e.name }],
    });
  }
  return { concept, object_mappings: [self()], ...(links.length ? { link_mappings: links } : {}) };
}

/** A mapping of the GASP ontology onto any model that carries (some of) the GASP datasets, per `spec`. */
export function mappingOver(data: StandardData, spec: MappingSpec): { mapping: OssieMapping; gaps: MappingGap[] } {
  const plan = planOntology(data);
  const gaps: MappingGap[] = [];
  const ids = spec.datasets ?? plan.datasets.map(([id]) => id);
  const concept_mappings = ids.map((id) => datasetMapping(plan, id, spec, gaps)).filter((m): m is OssieConceptMapping => m !== undefined);
  return {
    mapping: {
      version: OSSIE_VERSION,
      name: spec.name,
      description: spec.description,
      ontology_ref: { name: "GASP", iri: spec.ontologyIri },
      semantic_model_ref: { name: spec.modelName, iri: spec.modelIri },
      concept_mappings,
      ...(spec.custom_extensions?.length ? { custom_extensions: spec.custom_extensions } : {}),
    },
    gaps,
  };
}

export function exportMapping(data: StandardData): OssieMapping {
  return mappingOver(data, {
    name: "gasp_reference_mapping",
    description:
      "Maps the GASP ontology onto the GASP reference semantic model, whose datasets and fields are named by their GASP ids. A customer mapping keeps this shape and swaps in its own dataset and field names.",
    ontologyIri: ONTOLOGY_IRI,
    modelName: SEMANTIC_MODEL_NAME,
    modelIri: SEMANTIC_MODEL_IRI,
  }).mapping;
}
