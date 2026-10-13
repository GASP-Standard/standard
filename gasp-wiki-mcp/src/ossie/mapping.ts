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
import type { OssieConceptMapping, OssieLinkMapping, OssieMapping, OssieObjectMapping } from "./types.js";
import { OSSIE_VERSION } from "./types.js";
import { planOntology, type OntologyPlan } from "./ontology.js";

export const ONTOLOGY_IRI = "./gasp.ontology.yaml";
export const SEMANTIC_MODEL_IRI = "./gasp.semantic_model.yaml";
export const SEMANTIC_MODEL_NAME = "GASP reference model";

const keyRef = (plan: OntologyPlan, targetDataset: string, expression: string): OssieObjectMapping => ({
  concept: plan.datasetConcept[targetDataset],
  referent_mappings: [{ relationship: plan.datasets.find(([id]) => id === targetDataset)![1].key, expression }],
});

function datasetMapping(plan: OntologyPlan, ds: string): OssieConceptMapping {
  const d = plan.datasets.find(([id]) => id === ds)![1];
  // A fresh object per use, so the YAML writer emits no anchors.
  const self = (): OssieObjectMapping => ({ referent_mappings: [{ relationship: d.key, expression: `${ds}.${d.key}` }] });
  const binary: OssieLinkMapping[] = [];
  const ternary: OssieLinkMapping[] = [];
  for (const f of plan.fieldsOf(ds)) {
    const role = plan.roleOf(ds, f.id);
    if (role.kind === "key" || role.kind === "snapshotDate") continue;
    if (role.kind === "foreignKey") {
      binary.push({ object_mapping: keyRef(plan, role.target, `${ds}.${f.id}`), relationship: f.id });
      continue;
    }
    const child: OssieLinkMapping = { object_mapping: { concept: plan.roleConcept[f.id], expression: `${ds}.${f.id}` }, relationship: f.id };
    (role.ternary ? ternary : binary).push(child);
  }
  const children = [...binary];
  if (ternary.length) children.push({ object_mapping: { concept: plan.dateConcept(ds), expression: `${ds}.${d.date}` }, children: ternary });

  const links: OssieLinkMapping[] = [];
  if (children.length) links.push({ object_mapping: self(), children });
  const concept = plan.datasetConcept[ds];
  for (const e of plan.edges) {
    if (e.source !== concept || !e.join) continue;
    const j = e.join;
    links.push({
      object_mapping: { referent_mappings: [{ relationship: j.sourceKey, expression: `${j.dataset}.${j.sourceKey}` }] },
      children: [{ object_mapping: keyRef(plan, e.targetDataset!, `${j.dataset}.${j.targetKey}`), relationship: e.name }],
    });
  }
  return { concept, object_mappings: [self()], ...(links.length ? { link_mappings: links } : {}) };
}

export function exportMapping(data: StandardData): OssieMapping {
  const plan = planOntology(data);
  return {
    version: OSSIE_VERSION,
    name: "gasp_reference_mapping",
    description:
      "Maps the GASP ontology onto the GASP reference semantic model, whose datasets and fields are named by their GASP ids. A customer mapping keeps this shape and swaps in its own dataset and field names.",
    ontology_ref: { name: "GASP", iri: ONTOLOGY_IRI },
    semantic_model_ref: { name: SEMANTIC_MODEL_NAME, iri: SEMANTIC_MODEL_IRI },
    concept_mappings: plan.datasets.map(([id]) => datasetMapping(plan, id)),
  };
}
