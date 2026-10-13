/**
 * Apache Ossie (incubating) document shapes, as far as the GASP exporters use
 * them. Mirrors core-spec/ossie-schema.json, ontology/ontology.json and
 * ontology/mapping.json at apache/ossie 2b1f9bf (2026-10-12). Every shape is
 * `additionalProperties: false` upstream, so add nothing that is not here.
 */

export const OSSIE_VERSION = "0.2.0.dev0";
/** The only dialect whose semantics Ossie defines (core-spec/expression_language.md). */
export const OSSIE_DIALECT = "OSSIE_SQL_2026";
export const GASP_VENDOR = "GASP";

export type OssieDataType = "String" | "Integer" | "Decimal" | "Float" | "Boolean" | "Date" | "Time" | "DateTime" | "DateTimeTz" | "Opaque";

export interface OssieExpression {
  dialects: Array<{ dialect: string; expression: string }>;
}

export interface OssieExtension {
  vendor_name: string;
  /** JSON string */
  data: string;
}

export interface OssieAIContext {
  synonyms?: string[];
  instructions?: string;
  [k: string]: unknown;
}

// ── semantic model (core-spec) ───────────────────────────────────────────────

export interface OssieField {
  name: string;
  expression: OssieExpression;
  dimension?: { is_time?: boolean; [k: string]: unknown };
  label?: string;
  description?: string;
  datatype?: OssieDataType;
  ai_context?: OssieAIContext | string;
  custom_extensions?: OssieExtension[];
}

export interface OssieDataset {
  name: string;
  /** A physical table reference or a query */
  source: string;
  primary_key?: string[];
  unique_keys?: string[][];
  description?: string;
  ai_context?: OssieAIContext | string;
  fields?: OssieField[];
  custom_extensions?: OssieExtension[];
}

export interface OssieRelationship {
  name: string;
  from: string;
  to: string;
  from_columns: string[];
  to_columns: string[];
  ai_context?: OssieAIContext | string;
  custom_extensions?: OssieExtension[];
}

export interface OssieMetric {
  name: string;
  expression: OssieExpression;
  description?: string;
  datatype?: OssieDataType;
  ai_context?: OssieAIContext | string;
  custom_extensions?: OssieExtension[];
}

export interface OssieSemanticModel {
  version: string;
  name: string;
  description?: string;
  ai_context?: OssieAIContext | string;
  datasets: OssieDataset[];
  relationships?: OssieRelationship[];
  metrics?: OssieMetric[];
  custom_extensions?: OssieExtension[];
}

// ── ontology (ontology/ontology.json) ────────────────────────────────────────

export type ConceptType = "EntityType" | "ValueType";
export type Multiplicity = "ManyToOne" | "OneToOne";

export interface OssieRole {
  concept: string;
  /** Required when the same concept plays more than one role in the relationship */
  name?: string;
}

export interface OssieOntologyRelationship {
  name: string;
  description?: string;
  multiplicity?: Multiplicity;
  roles?: OssieRole[];
  derived_by?: string[];
  requires?: string[];
  /** One pattern per phrasing; every role appears as {Concept} or {Concept:role} */
  verbalizes: string[];
  iri?: string;
}

export interface OssieConcept {
  concept: string;
  type: ConceptType;
  description?: string;
  extends?: string[];
  derived_by?: string[];
  identify_by?: string[];
  requires?: string[];
  relationships?: OssieOntologyRelationship[];
  iri?: string;
}

export interface OssieOntology {
  version: string;
  name: string;
  description?: string;
  ai_context?: OssieAIContext | string;
  requires?: string[];
  prefixes?: Record<string, string>;
  ontology: OssieConcept[];
}

// ── mapping (ontology/mapping.json) ──────────────────────────────────────────

export interface OssieDocumentRef {
  name: string;
  iri?: string;
}

export interface OssieReferentMapping {
  relationship: string;
  expression?: string;
  referent_mappings?: OssieReferentMapping[];
}

export interface OssieObjectMapping {
  concept?: string;
  expression?: string;
  referent_mappings?: OssieReferentMapping[];
}

export interface OssieLinkMapping {
  object_mapping: OssieObjectMapping;
  relationship?: string;
  children?: OssieLinkMapping[];
}

export interface OssieConceptMapping {
  concept: string;
  object_mappings?: OssieObjectMapping[];
  link_mappings?: OssieLinkMapping[];
}

export interface OssieMapping {
  version: string;
  name: string;
  description?: string;
  ontology_ref: OssieDocumentRef;
  semantic_model_ref: OssieDocumentRef;
  concept_mappings: OssieConceptMapping[];
  custom_extensions?: OssieExtension[];
}

// ── export result ────────────────────────────────────────────────────────────

export type MetricCoverage =
  | { kind: "direct"; ossieName: string }
  | { kind: "staged"; ossieName: string; stagedDataset: string; reason: string }
  | { kind: "notComputable"; reason: string };

export interface OssieExport {
  ontology: OssieOntology;
  model: OssieSemanticModel;
  mapping: OssieMapping;
  /** Formula id (plus `:O`, `:M` or `:variant`) → how it was exported */
  coverage: Record<string, MetricCoverage>;
}
