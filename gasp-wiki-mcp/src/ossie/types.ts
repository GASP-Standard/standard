/**
 * Apache Ossie (incubating) document shapes, as far as the GASP exporters use
 * them. Mirrors core-spec/ossie-schema.json, ontology/ontology.json and
 * ontology/mapping.json at apache/ossie ec1d089 (2026-11-11). Every shape is
 * `additionalProperties: false` upstream, so add nothing that is not here.
 */

export const OSSIE_VERSION = "0.3.0.dev0";
/** The development version 0.3.0.dev0 replaced (apache/ossie #691); `migrateDocument` reads a document declaring it. */
export const LEGACY_OSSIE_VERSION = "0.2.0.dev0";
/** The only dialect whose semantics Ossie defines (core-spec/expression_language.md). */
export const OSSIE_DIALECT = "OSSIE_SQL_2026";
export const GASP_VENDOR = "GASP";

/**
 * A non-portable extension entry: a vendor name and a `data` object whose keys
 * are the vendor's own (apache/ossie #522, merged 2026-11-11). GASP writes this
 * form under `nonportable_extensions`. Documents written before the merge carry
 * the key `custom_extensions` with `data` as a JSON string; `migrateDocument`
 * rewrites a parsed document into the current shape, so every check downstream
 * sees one key and one form, and `extensionData` reads either.
 */
export interface OssieExtension {
  vendor_name: string;
  data: Record<string, unknown>;
}

/** The payload of an extension entry in either form: an object as is, a JSON string decoded; undefined when neither gives an object. */
export function extensionData(e: { data?: unknown } | undefined): Record<string, unknown> | undefined {
  let d = e?.data;
  if (typeof d === "string") {
    try { d = JSON.parse(d) as unknown; } catch { return undefined; }
  }
  return typeof d === "object" && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : undefined;
}

/** A document's GASP extension; undefined when absent or unreadable. */
export function readGaspExtension<T = Record<string, unknown>>(exts: OssieExtension[] | undefined): T | undefined {
  return extensionData(exts?.find((x) => x.vendor_name === GASP_VENDOR)) as T | undefined;
}

/** The key `nonportable_extensions` replaced; `migrateDocument` folds it into the current key. */
export const LEGACY_EXTENSIONS_KEY = "custom_extensions";
const EXTENSIONS_KEY = "nonportable_extensions";

/**
 * A parsed document rewritten to the current shape in place: a root `version`
 * of 0.2.0.dev0 becomes `OSSIE_VERSION`, every `custom_extensions` array,
 * anywhere in the document, becomes `nonportable_extensions` (after any entries
 * already under that key) and every extension `data` given as a JSON string
 * that holds an object becomes that object. Returns the number of rewrites.
 * A string that is not a JSON object is left for the schema check to name, and
 * nothing under an extension's `data` is walked, since those keys are the
 * vendor's own.
 */
export function migrateDocument(doc: unknown): number {
  let n = 0;
  if (typeof doc === "object" && doc !== null && (doc as { version?: unknown }).version === LEGACY_OSSIE_VERSION) {
    (doc as { version: unknown }).version = OSSIE_VERSION;
    n++;
  }
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (typeof v !== "object" || v === null) return;
    const o = v as Record<string, unknown>;
    if (Array.isArray(o[LEGACY_EXTENSIONS_KEY])) {
      const legacy = o[LEGACY_EXTENSIONS_KEY] as unknown[];
      o[EXTENSIONS_KEY] = Array.isArray(o[EXTENSIONS_KEY]) ? [...(o[EXTENSIONS_KEY] as unknown[]), ...legacy] : legacy;
      delete o[LEGACY_EXTENSIONS_KEY];
      n++;
    }
    for (const [k, x] of Object.entries(o)) {
      if (k === EXTENSIONS_KEY && Array.isArray(x)) {
        for (const e of x) {
          if (typeof e !== "object" || e === null || typeof (e as { data?: unknown }).data !== "string") continue;
          const data = extensionData(e as { data?: unknown });
          if (data) { (e as { data: unknown }).data = data; n++; }
        }
      } else walk(x);
    }
  };
  walk(doc);
  return n;
}

/**
 * A GASP extension entry holding `value` as plain JSON: a copy, so the document
 * shares nothing with the caller, with undefined members dropped as a JSON
 * writer drops them. Upstream requires `data` to be representable as JSON.
 */
export function gaspExtension(value: Record<string, unknown>): OssieExtension {
  return { vendor_name: GASP_VENDOR, data: JSON.parse(JSON.stringify(value)) as Record<string, unknown> };
}

/** The extensions with the GASP one set to `value`, first; other vendors kept. */
export function writeGaspExtension(exts: OssieExtension[] | undefined, value: Record<string, unknown>): OssieExtension[] {
  return [gaspExtension(value), ...(exts ?? []).filter((x) => x.vendor_name !== GASP_VENDOR)];
}

export type OssieDataType = "String" | "Integer" | "Decimal" | "Float" | "Boolean" | "Date" | "Time" | "DateTime" | "DateTimeTz" | "Opaque";

/**
 * An expression: `sql` is the portable OSSIE_SQL_2026 form and authoritative upstream;
 * `dialects` carries vendor forms, or the portable one in documents written before
 * `sql` existed. At least one is present. GASP writes `sql` alone (`portable`) and
 * reads either (`expressionText`, `portableEntries`).
 */
export interface OssieExpression {
  sql?: string;
  dialects?: Array<{ dialect: string; expression: string }>;
}

/** The expression GASP writes: the portable form alone. */
export const portable = (sql: string): OssieExpression => ({ sql });

/** The portable text of a field's or metric's expression: `sql` first, else the OSSIE_SQL_2026 dialect entry, else the first entry. */
export function expressionText(f: { expression: OssieExpression | string }): string | undefined {
  const e = f.expression;
  if (typeof e === "string") return e;
  return portableSql(e) ?? (e?.dialects?.find((d) => d.dialect === OSSIE_DIALECT) ?? e?.dialects?.[0])?.expression;
}

/** The `sql` field when it is a non-empty string; an empty or non-string value is treated as absent. */
const portableSql = (e: OssieExpression | undefined): string | undefined => (typeof e?.sql === "string" && e.sql.trim() ? e.sql : undefined);

/** Every entry of an expression as dialect and text: `sql` as OSSIE_SQL_2026 first, then the dialect entries it does not supersede. */
export function portableEntries(e: OssieExpression | undefined): Array<{ dialect: string; expression: string }> {
  const out: Array<{ dialect: string; expression: string }> = [];
  const sql = portableSql(e);
  if (sql) out.push({ dialect: OSSIE_DIALECT, expression: sql });
  for (const d of e?.dialects ?? []) if (!(sql && d.dialect === OSSIE_DIALECT)) out.push(d);
  return out;
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
  nonportable_extensions?: OssieExtension[];
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
  nonportable_extensions?: OssieExtension[];
}

export interface OssieRelationship {
  name: string;
  from: string;
  to: string;
  from_columns: string[];
  to_columns: string[];
  ai_context?: OssieAIContext | string;
  nonportable_extensions?: OssieExtension[];
}

export interface OssieMetric {
  name: string;
  expression: OssieExpression;
  description?: string;
  datatype?: OssieDataType;
  ai_context?: OssieAIContext | string;
  nonportable_extensions?: OssieExtension[];
}

export interface OssieSemanticModel {
  version: string;
  name: string;
  description?: string;
  ai_context?: OssieAIContext | string;
  datasets: OssieDataset[];
  relationships?: OssieRelationship[];
  metrics?: OssieMetric[];
  nonportable_extensions?: OssieExtension[];
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
  nonportable_extensions?: OssieExtension[];
}

// ── export result ────────────────────────────────────────────────────────────

export type MetricCoverage =
  | { kind: "direct"; ossieName: string; rung: "M0" | "M2" | "M3"; constructs: string[] }
  | { kind: "staged"; ossieName: string; stagedDataset: string; reason: string }
  | { kind: "notComputable"; reason: string }
  /** Compiling into a company's model: the entry reads `field@dataset` pairs the mapping lacks (never in the reference export) */
  | { kind: "unmapped"; ossieName: string; missing: string[] };

export interface OssieExport {
  ontology: OssieOntology;
  model: OssieSemanticModel;
  mapping: OssieMapping;
  /** Formula id (plus `:O`, `:M` or `:variant`) → how it was exported */
  coverage: Record<string, MetricCoverage>;
}
