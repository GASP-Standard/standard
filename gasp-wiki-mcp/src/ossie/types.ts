/**
 * Apache Ossie (incubating) document shapes, as far as the GASP exporters use
 * them. Mirrors core-spec/ossie-schema.json, ontology/ontology.json and
 * ontology/mapping.json at apache/ossie 4a315fa (2026-11-22). Every shape is
 * `additionalProperties: false` upstream, so add nothing that is not here.
 */

import { OSSIE_DIALECT_OF } from "../dialect.js";

export const OSSIE_VERSION = "0.3.0.dev0";
/** The development version 0.3.0.dev0 replaced (apache/ossie #691); `migrateDocument` reads a document declaring it. */
export const LEGACY_OSSIE_VERSION = "0.2.0.dev0";
/** The only dialect whose semantics Ossie defines (core-spec/expression_language.md). */
export const OSSIE_DIALECT = "OSSIE_SQL_2026";
export const GASP_VENDOR = "GASP";

/**
 * A vendor or dialect name in the form names are compared in: ASCII `a` to `z`
 * as `A` to `Z`, every other character as written (apache/ossie #712, which
 * makes both names case-insensitive; open when this was written, so the pinned
 * validator still compares exactly and GASP writes the uppercase form).
 */
export const canonicalName = (name: string): string => name.replace(/[a-z]+/g, (m) => m.toUpperCase());
/** True when two vendor or dialect names are the same name, whatever their case. */
export const sameName = (a: unknown, b: string): boolean => typeof a === "string" && canonicalName(a) === canonicalName(b);

/** The dialect names GASP reads by name: the portable one and the registered name of each compiler dialect. */
const KNOWN_DIALECTS = [OSSIE_DIALECT, ...new Set(Object.values(OSSIE_DIALECT_OF))];

/** A table source's part: a plain identifier, which GASP's SQL writers place unquoted. */
const PLAIN_PART = /^[A-Za-z_][\w$]*$/;

/**
 * A dataset `source` as the string GASP's readers take. A string is returned as
 * is. A table object, `{ kind: table, identifier: [...] }` with each part a
 * name or `{ name, level }` (apache/ossie #704, open when this was written),
 * becomes its parts joined by `.`, which upstream defines as the same table in
 * shorthand; the level labels are not kept. Anything GASP cannot read as a
 * table is a problem rather than a guess: another `kind`, an empty or malformed
 * identifier, or a part that is not a plain identifier, since the SQL writers
 * place table names unquoted and upstream forbids flattening such a part.
 */
export function sourceText(source: unknown): { text: string } | { problem: string } {
  if (typeof source === "string") return { text: source };
  if (typeof source !== "object" || source === null || Array.isArray(source)) return { problem: "source is neither a string nor an object" };
  const s = source as { kind?: unknown; identifier?: unknown };
  if (s.kind !== "table") return { problem: `source kind ${JSON.stringify(s.kind)} is not supported; GASP reads a string or a table source, { kind: table, identifier: [...] }` };
  if (!Array.isArray(s.identifier) || !s.identifier.length) return { problem: "table source has no identifier parts" };
  const parts: string[] = [];
  for (const part of s.identifier as unknown[]) {
    const name = typeof part === "string" ? part : typeof part === "object" && part !== null ? (part as { name?: unknown }).name : undefined;
    if (typeof name !== "string" || !name.trim()) return { problem: `table source has an identifier part with no name: ${JSON.stringify(part)}` };
    if (!PLAIN_PART.test(name)) return { problem: `table source part ${JSON.stringify(name)} is not a plain identifier (letters, digits, _ and $). GASP writes table names unquoted and cannot name this table; a source of plain parts, such as a view over it, loads` };
    parts.push(name);
  }
  return { text: parts.join(".") };
}

/** Every dataset source in a parsed document that GASP cannot read, named by dataset; empty when all load. Run after `migrateDocument`. */
export function sourceProblems(doc: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (typeof v !== "object" || v === null) return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === EXTENSIONS_KEY || k === LEGACY_EXTENSIONS_KEY) continue;
      if (k === "datasets" && Array.isArray(x)) {
        for (const d of x) {
          if (typeof d !== "object" || d === null || !("source" in d)) continue;
          const r = sourceText((d as { source: unknown }).source);
          if ("problem" in r) out.push(`Dataset ${JSON.stringify((d as { name?: unknown }).name ?? "?")}: ${r.problem}.`);
        }
      }
      walk(x);
    }
  };
  walk(doc);
  return out;
}

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
  return extensionData(exts?.find((x) => sameName(x.vendor_name, GASP_VENDOR))) as T | undefined;
}

/** The key `nonportable_extensions` replaced; `migrateDocument` folds it into the current key. */
export const LEGACY_EXTENSIONS_KEY = "custom_extensions";
const EXTENSIONS_KEY = "nonportable_extensions";

/**
 * A parsed document rewritten to the current shape in place: a root `version`
 * of 0.2.0.dev0 becomes `OSSIE_VERSION`, every `custom_extensions` array,
 * anywhere in the document, becomes `nonportable_extensions` (after any entries
 * already under that key) and every extension `data` given as a JSON string
 * that holds an object becomes that object. A `primary_key` that names a field
 * twice keeps the first of each: `adapterToOssie` wrote one for a dataset whose
 * key is its date until 2026-11-19, and upstream rejects it since apache/ossie
 * #705. Returns the number of rewrites.
 * Two forms upstream has proposed are read the same way. A `vendor_name` that
 * is GASP's and a `dialect` GASP reads by name become their uppercase spelling
 * whatever case they were written in (apache/ossie #712); another vendor's name
 * and a dialect GASP does not know keep their spelling, since the pinned
 * validator still compares exactly. A dataset `source` given as a table object
 * becomes the string `sourceText` gives for it (apache/ossie #704); one it
 * cannot read is left for `sourceProblems` to name.
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
    const key = o.primary_key;
    if (Array.isArray(key) && key.every((k) => typeof k === "string") && new Set(key).size < key.length) {
      o.primary_key = [...new Set(key)];
      n++;
    }
    if (Array.isArray(o.dialects)) {
      for (const d of o.dialects as unknown[]) {
        if (typeof d !== "object" || d === null) continue;
        const name = (d as { dialect?: unknown }).dialect;
        const known = KNOWN_DIALECTS.find((k) => sameName(name, k));
        if (known && name !== known) { (d as { dialect: unknown }).dialect = known; n++; }
      }
    }
    if (Array.isArray(o.datasets)) {
      for (const d of o.datasets as unknown[]) {
        if (typeof d !== "object" || d === null || typeof (d as { source?: unknown }).source !== "object") continue;
        const r = sourceText((d as { source: unknown }).source);
        if ("text" in r) { (d as { source: unknown }).source = r.text; n++; }
      }
    }
    for (const [k, x] of Object.entries(o)) {
      if (k === EXTENSIONS_KEY && Array.isArray(x)) {
        for (const e of x) {
          if (typeof e !== "object" || e === null) continue;
          const vendor = (e as { vendor_name?: unknown }).vendor_name;
          if (vendor !== GASP_VENDOR && sameName(vendor, GASP_VENDOR)) { (e as { vendor_name: unknown }).vendor_name = GASP_VENDOR; n++; }
          if (typeof (e as { data?: unknown }).data !== "string") continue;
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
  return [gaspExtension(value), ...(exts ?? []).filter((x) => !sameName(x.vendor_name, GASP_VENDOR))];
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
  return portableSql(e) ?? (e?.dialects?.find((d) => sameName(d.dialect, OSSIE_DIALECT)) ?? e?.dialects?.[0])?.expression;
}

/** The `sql` field when it is a non-empty string; an empty or non-string value is treated as absent. */
const portableSql = (e: OssieExpression | undefined): string | undefined => (typeof e?.sql === "string" && e.sql.trim() ? e.sql : undefined);

/** Every entry of an expression as dialect and text: `sql` as OSSIE_SQL_2026 first, then the dialect entries it does not supersede. An OSSIE_SQL_2026 entry written in another case comes back under that spelling. */
export function portableEntries(e: OssieExpression | undefined): Array<{ dialect: string; expression: string }> {
  const out: Array<{ dialect: string; expression: string }> = [];
  const sql = portableSql(e);
  if (sql) out.push({ dialect: OSSIE_DIALECT, expression: sql });
  for (const d of e?.dialects ?? []) {
    const portableEntry = sameName(d.dialect, OSSIE_DIALECT);
    if (!(sql && portableEntry)) out.push(portableEntry ? { ...d, dialect: OSSIE_DIALECT } : d);
  }
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
  /** A physical table reference or a query. A document that gives a table object is read into this string on load (`sourceText`). */
  source: string;
  primary_key?: string[];
  unique_keys?: string[][];
  description?: string;
  ai_context?: OssieAIContext | string;
  fields?: OssieField[];
  /** Dataset-scoped metrics: each names this dataset's fields by single-part name. Read them through `modelMetrics` (scope.ts). */
  metrics?: OssieMetric[];
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
  /** Model-scoped metrics: each names fields as `dataset.field`. The metrics that read one dataset sit in that dataset's `metrics`. */
  metrics?: OssieMetric[];
  nonportable_extensions?: OssieExtension[];
}

// ── ontology (ontology/ontology.json) ────────────────────────────────────────

export type ConceptType = "EntityType" | "ValueType";
export type Multiplicity = "ManyToOne" | "OneToOne";

/**
 * The open slot the ontology gives for what its core cannot express: any keys,
 * any JSON values, kept as written by a tool that does not know them. GASP's
 * own keys start `gasp_` (ontology.ts).
 */
export type OssieAnnotations = Record<string, unknown>;

export interface OssieRole {
  concept: string;
  /** Required when the same concept plays more than one role in the relationship */
  name?: string;
  annotations?: OssieAnnotations;
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
  /** A full IRI, or `prefix:local` read against the ontology's `prefixes` */
  iri?: string;
  annotations?: OssieAnnotations;
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
  /** A full IRI, or `prefix:local` read against the ontology's `prefixes` */
  iri?: string;
  annotations?: OssieAnnotations;
}

export interface OssieOntology {
  version: string;
  name: string;
  description?: string;
  ai_context?: OssieAIContext | string;
  requires?: string[];
  /** Namespace prefix → the IRI it abbreviates, for `iri` values written as `prefix:local` */
  prefixes?: Record<string, string>;
  annotations?: OssieAnnotations;
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
  | { kind: "direct"; ossieName: string; rung: "M0" | "M2" | "M3" | "M4" | "M5" | "M6" | "M7" | "M8"; constructs: string[] }
  /** `cohortTable`: the staged dataset is a cohort table shared with other entries and the metric is an expression over its columns, not `SUM(value)` */
  | { kind: "staged"; ossieName: string; stagedDataset: string; reason: string; cohortTable?: true }
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
