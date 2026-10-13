/** Signal type classification for metrics */
export type SignalType = 'outcome' | 'leading' | 'efficiency' | 'operational';

/** A single Operating or Market form within a dual-lens subsection */
export interface DualLensForm {
  label: string;            // "ARR-O", "Fully Loaded CAC (CAC-O)"
  description: string;      // Paragraph(s) before structured fields
  celSource: string;        // **CEL Source:** value
  atlInclusion: string;     // **ATL Inclusion:** value (may have bullets, empty for churn)
  formula: string | null;   // Code block content (null for shared churn)
  insight: string;          // **What it tells you:** value
}

/** The bridge reconciliation between Operating and Market forms */
export interface DualLensBridge {
  reconciliation: string | null;  // Code block (null for shared churn)
  diagnostic: string;             // **Diagnostic:** or **Bridge:** text
}

/** Full dual-lens content for a metric */
export interface DualLens {
  operating: DualLensForm;
  market: DualLensForm;
  bridge: DualLensBridge;
}

/** A parsed metric from the standard markdown files */
export interface Metric {
  /** Display name, e.g. "MRR (Monthly Recurring Revenue)" */
  name: string;
  /** Heading anchor slug, e.g. "mrr-monthly-recurring-revenue" */
  slug: string;
  /** Short definition from **Definition:** field */
  definition: string;
  /** Formula(s) from code blocks, may have multiple variants */
  formulas: string[];
  /** Benchmark ranges, if present */
  benchmarks: string | null;
  /** What it tells you blurb */
  insight: string | null;
  /** Common mistakes, if present */
  commonMistakes: string[] | null;
  /** Source URLs */
  sources: string[];
  /** The department file this was parsed from */
  department: string;
  /** The section heading (e.g. "Revenue Metrics", "Pipeline Metrics") */
  category: string;
  /** Abbreviations / aliases (e.g. ["MRR", "NDR"]) */
  aliases: string[];
  /** Full raw markdown of this metric section */
  rawMarkdown: string;
  /** Primary signal type classification */
  signalType: SignalType;
  /** Optional secondary signal type (for dual-tagged metrics) */
  signalTypeSecondary: SignalType | null;
  /** Dual-lens Operating/Market form content, if present */
  dualLens: DualLens | null;
  /** Dual-lens note (for metrics where O/M distinction doesn't apply) */
  dualLensNote: string | null;
}

/** A term from definitions.md */
export interface Definition {
  /** Term name */
  term: string;
  /** Slug for linking */
  slug: string;
  /** Definition text */
  definition: string;
  /** Section it belongs to (e.g. "Revenue Terms") */
  section: string;
  /** Canonical definition link, if present */
  canonicalLink: string | null;
  /** **Reference:** link for terms without a canonical definition (site path, e.g. "/v1/taxonomy") */
  referenceLink?: string | null;
  /** Markdown after the first line (bullets, examples), without link/metadata lines */
  body?: string | null;
  /** Departments that use this term */
  usedIn: string[];
}

/** A node in the relationship graph (metric or entity) */
export interface RelationshipNode {
  id: string;
  label: string;
  level: number;
  category: string;
  description: string;
  /** "entity" for business entity nodes, undefined for metric nodes */
  nodeType?: string;
  /** Department for metric nodes */
  department?: string;
  /** Signal type for metric nodes */
  signalType?: string;
  /** Metric nodes: slug of the canonical metric page (keys metricNodeIds) */
  slug?: string;
  /** Entity and concept nodes: glossary slug of the definition page, when one exists */
  definition?: string;
}

/** An entity from the ontology */
export interface OntologyEntity {
  id: string;
  label: string;
  aliases: string[];
  definition: string;
  level: string;
}

/** A structured formula input — reference to another metric or a field */
export interface FormulaInput {
  ref: string;
  /** numerator | denominator | addend | subtrahend | base | component */
  role: string;
  /** positive, negative or mixed: how the metric moves when the input rises */
  polarity?: "positive" | "negative" | "mixed";
  /**
   * True when the formula reads the input only as a baseline (under `at period_start`
   * or inside `lag(...)`): it enters the formula as a component, but nothing that
   * moves the input during the period moves the metric, so traversal stops there.
   */
  baseline?: boolean;
}

/** A structured formula decomposition for a metric */
export interface StructuredFormula {
  expression: string;
  inputs: FormulaInput[];
  fields?: string[];
}

/** A concept from the ontology (business concepts that bridge entities and metrics) */
export interface OntologyConcept {
  id: string;
  label: string;
  definition: string;
  provenance: string;
}

/** An entity-to-entity or entity-to-concept relationship */
export interface EntityRelationship {
  from: string;
  to: string;
  type: string;
  cardinality: string;
  description: string;
  provenance: string;
}

/** Ontology data loaded from /standard/ontology.json */
/** A canonical data field from the ontology */
export interface OntologyField {
  id: string;
  /** string | decimal | integer | boolean | date | timestamp | enum | json */
  type: string;
  /** Logical tables the field lives on (ontology.json datasets) */
  datasets?: string[];
  sources?: string[];
  /** Declared values for enum fields; filter literals must be one of these */
  values?: string[];
  description?: string;
  /** Group-by dimension; may exist without a formula referencing it */
  dimension?: boolean;
  /** Number of formulas that reference the field (derived) */
  metricCount?: number;
}

/** A logical table that fields belong to; the unit the adapter maps to a warehouse table */
export interface OntologyDataset {
  kind: "event" | "snapshot" | "fact";
  /** Field that places a row in time (event date, snapshot date or period start) */
  date: string;
  key: string;
  label: string;
  /** Business entities (ontology.entities ids) the dataset describes */
  entities?: string[];
  cel?: string;
  /** Grammar condition selecting live rows, used for cohort membership */
  activeWhen?: string;
}

export interface ValidationRule {
  /** benchmarks, min, max, unit, target, formula, window or period */
  type: string;
  value?: string | number;
  unit?: string;
  note?: string;
  ranges?: Array<{ threshold: string; label: string }>;
  source?: string;
}

export interface OntologyData {
  entities: OntologyEntity[];
  fields?: OntologyField[];
  datasets?: Record<string, OntologyDataset>;
  sourceCategories?: Array<{ id: string; label?: string; description?: string }>;
  entityMappings: Record<string, string[]>;
  concepts?: OntologyConcept[];
  entityRelationships?: {
    edges: EntityRelationship[];
    edgeTypeClassification?: Record<string, string[]>;
  };
  structuredFormulas?: Record<string, StructuredFormula>;
  /** Hard constraints and benchmark ranges per metric slug (ontology.json validationRules) */
  validationRules?: Record<string, ValidationRule[]>;
  accessControl?: {
    sensitivityTiers: Record<string, string>;
    accessScopes: Record<string, string>;
    classifications: Record<string, { sensitivityTier: string; accessScope: string }>;
  };
}

/** An edge in the relationship graph */
export interface RelationshipEdge {
  source: string;
  target: string;
  /**
   * Canonical relationship type (lowercase).
   *
   * Metric signal: drives · reduces · predicts · component · measures
   * Entity lifecycle: converts_to · parent_of · belongs_to
   * Entity ownership & access: owns · grants · priced_by
   * Entity interactions: manages · serves · engages_via · submits · represented_by · sources
   * Entity financial flows: generates · produces · contributes_to · incurs
   */
  type: string;
  /**
   * True when the source moves inversely to the target (e.g. high NPS predicts
   * low churn). Carried as an explicit property because the relationship is a
   * real-world judgment about leading-indicator polarity, not a formula
   * structure derivable from `structuredFormulas`.
   */
  inverse?: boolean;
}

/** A data requirement entry from the dashboard */
/**
 * What a metric needs from the warehouse, derived from its formula: the
 * transitive field set, their types and datasets, grain and an example query.
 */
export interface DataRequirement {
  metric: string;
  formulaId: string;
  fields: string[];
  fieldTypes: Record<string, string>;
  datasets: string[];
  source: string;
  frequency: string;
  grain: string;
  exampleQuery: string;
  description: string;
  department: string;
  /** Needs a staged dataset (cohort or lag) to run as a single aggregate */
  staged: boolean;
  /** Every (field, dataset) pair the compiled SQL reads, as "field@dataset" */
  placeholders: string[];
  /** What each declared O or M form reads, following metric refs (and form refs) as the main formula does */
  forms?: Partial<Record<"O" | "M", FormRequirement>>;
  /** Set when the formula is broken down by a field: the query returns one row per value */
  /** `field` is the output column: the breakdown field, or a bucketed breakdown's column with its `buckets` */
  breakdown?: { field: string; total?: boolean; expression?: string; buckets?: Record<string, [number, number | null]> };
}

/** The fields and datasets one O or M form of a formula reads */
export interface FormRequirement {
  fields: string[];
  datasets: string[];
  staged: boolean;
}

/** A parameterised query compiled from a metric's formula, keyed by formula id */
export interface QueryTemplate {
  metric: string;
  fields: string[];
  datasets: string[];
  /** The single dataset when the metric reads one table, else null */
  sourceTable: string | null;
  grain: string;
  frequency: string;
  source: string;
  /** SQL with {{field@dataset}}, {{_table:dataset}}, {{_period_start}} and {{_period_end}} placeholders */
  parameterizedQuery: string;
  staged: boolean;
  /** Every (field, dataset) pair the SQL reads, as "field@dataset"; the adapter maps each pair to a column */
  placeholders: string[];
  /** Set when the formula is broken down by a field: the query returns one row per value */
  /** `field` is the output column: the breakdown field, or a bucketed breakdown's column with its `buckets` */
  breakdown?: { field: string; total?: boolean; expression?: string; buckets?: Record<string, [number, number | null]> };
}

/** Display unit for a formula result. Percent formulas compute unscaled ratios. */
export type FormulaUnit = "currency" | "percent" | "ratio" | "count" | "days" | "months" | "hours" | "minutes" | "milliseconds" | "score";

/**
 * A canonical metric formula from standard/formulas.json, written in the GASP
 * formula grammar (see src/formula.ts). Either `formula` is set, or
 * `notComputable` explains why the metric has no single formula.
 */
export interface MetricFormula {
  formula?: string;
  unit?: FormulaUnit;
  /** Operating (O) and Market (M) forms where they differ from `formula` */
  forms?: Partial<Record<"O" | "M", string>>;
  /** Named variants, e.g. Adjusted NRR */
  variants?: Record<string, string>;
  notes?: string;
  notComputable?: string;
  /**
   * "field.<id>": the formula is computed once per value of that field. Every
   * aggregate not under total() is grouped by it (see src/formula.ts).
   */
  breakdown?: BreakdownSpec;
  /**
   * Named breakdowns, e.g. { "by_plan": "field.plan_id" }: each compiles the main
   * formula with that breakdown, addressed like a variant (compileMetric(id, ctx, "by_plan")).
   */
  breakdowns?: Record<string, BreakdownSpec>;
}

/**
 * A breakdown: "field.<id>", or { field: "field.<id>", total: true }. With
 * `total`, an aggregate whose dataset lacks the field stays whole (share of
 * total, such as cost by cost centre over all new customers) instead of being
 * a compile error.
 */
export type BreakdownSpec =
  | string
  | { field: string; total?: boolean }
  /**
   * Bucketed: a per-row expression over fields of one dataset, cut into labelled
   * inclusive ranges ([lo, hi], hi null for an open top bucket). The labels are
   * the domain; the column is the breakdown name, or `bucket` at entry level.
   */
  | { expression: string; buckets: Record<string, [number, number | null]>; total?: boolean };

/** The full loaded dataset */
export interface StandardData {
  metrics: Metric[];
  definitions: Definition[];
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  dataRequirements: DataRequirement[];
  ontology?: OntologyData;
  queryTemplates?: Record<string, QueryTemplate>;
  /**
   * Metric slug → graph node id (e.g. "net-revenue-retention-nrr" → "nrr").
   * Built from the `slug` on each metric node in standard/relationships.json. Keys ontology
   * lookups (accessControl, structuredFormulas, entityMappings).
   */
  metricNodeIds?: Record<string, string>;
  /** Formula id (graph node id, else slug with underscores) → canonical formula */
  formulas?: Record<string, MetricFormula>;
  /**
   * The adapter JSON Schema (draft 2020-12), from standard/gasp-adapter-schema.json.
   * validate_adapter applies it before the field and coverage checks. Optional so
   * data fetched from an older site build still loads.
   */
  adapterSchema?: Record<string, unknown>;
}
