/**
 * The GASP conformance set for Apache Ossie: one case per construct the
 * portable expression language cannot state yet (the staged reasons in
 * metrics.ts), each a complete Ossie semantic model, a standard SQL query over
 * its staged dataset, the expected result on the GASP fixture and the fixture
 * rows it reads. conformance-snapshot.ts adds the cases for a direct expression
 * over a snapshot dataset, which the language states and a query can still
 * misread.
 *
 * A case may list readings: the values a query returns when it makes a named
 * mistake (grade `wrong`) or takes a reading other tools use and GASP does not
 * (grade `alternative`). With them a result is graded as right, alternative,
 * wrong or failed (`GRADING`).
 *
 * A case directory holds `model.ossie.yaml` (one model per case, as
 * compliance/portability upstream keeps one per rung), `reference.postgres.sql`
 * and `expected.sql`, a VALUES list in standard SQL that needs no runner to
 * read, and `case.ost`, the same case as a script for upstream's ost runner
 * (conformance-ost.ts): upstream's compliance/query has been one ost script per
 * case since apache/ossie #769 (2026-11-21). The shared `data/` directory holds
 * one `CREATE TABLE` + `INSERT` script per dataset plus the period spine. A case
 * passes when an implementation loads the data and the model, evaluates the
 * metric for the period and returns the rows of expected.sql.
 *
 * This module is pure: it picks the cases and shapes every file from the
 * export and from values the runner (scripts/ossie-conformance.ts) computes by
 * executing the staged sources on the fixture in PGlite.
 */
import type { MetricFormula, OntologyDataset, OntologyField, StandardData } from "../types.js";
import { formulaSource, type StagedReason } from "./metrics.js";
import { cohortTableFor, stagedReasonsOf } from "./model.js";
import type { OssieDataset, OssieExport, OssieMetric, OssieSemanticModel } from "./types.js";
import { modelMetrics, placeMetrics, withoutMetrics } from "./scope.js";
import { OSSIE_VERSION, expressionText } from "./types.js";
import { OST_DOUBLE_DIGITS } from "./conformance-ost.js";

export interface ConformancePeriod { start: string; end: string }

/** Reporting period every staged case is evaluated for: the fixture window, so every movement in the stories lands in it. */
export const CONFORMANCE_PERIOD = { start: "2026-01-01", end: "2026-06-30" } as const;

/** `wrong` is a mistake; `alternative` is a reading in use elsewhere that GASP does not take. */
export type Grade = "wrong" | "alternative";

/** A value other than the expected one that a query returns for a case, and how it gets there. */
export interface Reading {
  grade: Grade;
  /** The name a grader reports. */
  name: string;
  /** What the query did. */
  description: string;
  /** A scalar query in parentheses over the tables in data/ (Postgres dialect). */
  query: string;
  /** The filter that returns this reading when the metric is asked of its dataset in the model. Absent when the reading changes the SQL of the model. */
  where?: string;
}

/** The four grades of a result, as the README and the manifest state them. */
export const GRADING = {
  right: "The rows of expected.sql.",
  alternative: "A value listed with grade alternative: a reading other tools take and GASP does not. Report it by name.",
  wrong: "Any other value. When it equals a value listed with grade wrong, the mistake is the one named there.",
  failed: "No value: the implementation rejects the model or the query, or the query errors.",
} as const;

/** A reading of a staged case: the case's staged source with every `find` replaced. */
export interface StagedReading { grade: Grade; name: string; description: string; find: string; replace: string }

/** One staged case: the entry, why it is staged and, off the default period, the period and a label for the id. */
export interface StagedCaseSpec {
  reason: StagedReason;
  entry: string;
  construct: string;
  readings?: StagedReading[];
  period?: ConformancePeriod;
  label?: string;
  group?: ConformanceCase["group"];
}

/** The members of a customer cohort fixed on the first day of the period, as the compiled source states them. */
const OPENING_MEMBERS = "SELECT customer_id FROM gasp.customer WHERE snapshot_date = p.period_start AND customer_status = 'active'";

/**
 * One coverage entry per staged reason, in the order metrics.ts ranks the
 * reasons. Chosen for small datasets and for metrics the executed test suite
 * already pins, so every expected value is checked twice.
 */
export const CONFORMANCE_CASES: ReadonlyArray<StagedCaseSpec> = [
  { reason: "cohort", entry: "nrr", construct: "a cohort fixed at the opening of the period and followed through its events (Net Revenue Retention)" },
  { reason: "lag", entry: "mrr_growth_rate", construct: "the same aggregate one period earlier (period-over-period growth)" },
  {
    reason: "at period_start", entry: "logo_churn_rate", construct: "a snapshot read at the opening of the period beside events inside it",
    readings: [
      {
        grade: "wrong", name: "closing_value",
        // The denominator alone: the cohort in the numerator stays the customers of the first day.
        find: `NULLIF(((SELECT COUNT(DISTINCT customer_id) FROM gasp.customer WHERE snapshot_date = p.period_start AND customer_status = 'active' AND customer_id IN (${OPENING_MEMBERS}))), 0)`,
        replace: "NULLIF(((SELECT COUNT(DISTINCT customer_id) FROM gasp.customer WHERE snapshot_date = p.period_end AND customer_status = 'active')), 0)",
        description: "the customers active on the last day of the period as the denominator, where the formula reads the first day",
      },
    ],
  },
  { reason: "total", entry: "ticket_distribution_by_type", construct: "a share of the ungrouped total inside a breakdown" },
  {
    reason: "period bound in filter", entry: "win_rate", construct: "the reporting period bound to a field other than the dataset's time field (opportunities by close date on a snapshot)",
    readings: [
      {
        grade: "wrong", name: "period_on_snapshot_date_only", find: " AND (close_date >= p.period_start AND close_date <= p.period_end)", replace: "",
        description: "the opportunities as they stand at the period end with no bound on the close date, so the period reaches the dataset's time field alone and every deal ever closed is counted",
      },
    ],
  },
  { reason: "to_date", entry: "ticket_backlog", construct: "an aggregate cumulative from the start of history to the period end" },
  { reason: "period_days", entry: "uptime", construct: "the number of days in the reporting period as a value" },
  { reason: "bucket", entry: "aging_buckets", construct: "a dimension defined by ranges over a per-row expression" },
  { reason: "window", entry: "dau_mau", construct: "trailing windows of different lengths ending at the period end (one day over thirty)" },
  { reason: "distinct pair", entry: "breadth_of_adoption", construct: "a count of distinct tuples (account and feature pairs)" },
  { reason: "all_time", entry: "user_retention_day_n", construct: "an unbounded range beside a bounded one (users who signed up in the period, active any time after)" },
];

/** The reason of a snapshot case, which no staged reason covers: the expression is direct. */
export const SNAPSHOT_REASON = "snapshot";

export interface ConformanceCase {
  /** Directory name: a two-digit rank, the reason and the metric. */
  id: string;
  /** `staged`: the metric reads a staged dataset. `direct`: an OSSIE_SQL_2026 expression over a snapshot dataset. */
  kind: "staged" | "direct";
  /** `construct`: the one case of a staged reason. `snapshot`: a case on which rows of a snapshot dataset a period reads. */
  group: "construct" | "snapshot";
  reason: StagedReason | typeof SNAPSHOT_REASON;
  construct: string;
  /** The reporting period the case is evaluated for. */
  period: ConformancePeriod;
  /** Coverage key (`formula id` or `formula id:variant`). */
  entry: string;
  /** The GASP formula id and the variant or form, if any. */
  formulaId: string;
  variant?: string;
  /** GASP grammar text of the entry expression. */
  formula: string;
  unit?: string;
  /** Ossie metric name and, on a staged case, the staged dataset that carries it. */
  metric: string;
  stagedDataset?: string;
  /** The staged dataset is a cohort table: one row per member per period, which the metric's expression sums. */
  cohortTable?: true;
  /** GASP datasets the case reads, in the order they appear in the model. */
  datasets: string[];
  /** Result columns other than the value: a breakdown's key and label columns. */
  dimensions: string[];
  canonicalUrl?: string;
  model: OssieSemanticModel;
  /** The reference query as one statement, without its header or semicolon. */
  sql: string;
  /** The filter that selects the case's period when the metric is asked of its dataset in the model (`SELECT AGG(metric) FROM model.dataset WHERE ...`). */
  where: string;
  /** The other values a query returns for the case, by name. */
  readings: Reading[];
  /** Snapshot rows on every date of this range are kept in the data, since a reading sums across them. */
  daily?: ConformancePeriod;
}

/** The canonical page a metric's `ai_context.instructions` names. */
export function canonicalUrlOf(metric: OssieMetric): string | undefined {
  const instructions = typeof metric.ai_context === "object" && metric.ai_context ? String(metric.ai_context.instructions ?? "") : "";
  return /Canonical definition: (\S+?)\.?(?:\s|$)/.exec(instructions)?.[1];
}

/** A staged source's row for a period as a scalar query. */
const stagedScalar = (source: string, period: ConformancePeriod): string => `(SELECT value FROM (${source}) AS s WHERE period_start = DATE '${period.start}')`;

/** A cohort table's rows for a period, aggregated as the metric's expression says. */
const cohortSelect = (expression: string, table: string, source: string, period: ConformancePeriod): string =>
  `SELECT ${expression} AS value\nFROM (${source}) AS ${table}\nWHERE period_start = DATE '${period.start}' AND period_end = DATE '${period.end}'`;

/** A GASP dataset referenced in a staged source as `gasp.<dataset>`. */
const datasetRefs = (source: string): string[] => [...new Set([...source.matchAll(/\bgasp\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]))].filter((d) => d !== "period_spine");

export function buildConformanceCases(data: StandardData, exp: OssieExport, specs: ReadonlyArray<StagedCaseSpec> = CONFORMANCE_CASES, offset = 0): ConformanceCase[] {
  const byName = new Map<string, OssieDataset>(exp.model.datasets.map((d) => [d.name, d]));
  const metrics = new Map<string, OssieMetric>(modelMetrics(exp.model).map((m) => [m.name, m]));
  const formulas = data.formulas ?? {};
  return specs.map(({ reason, entry, construct, readings: listed, period = CONFORMANCE_PERIOD, label, group = "construct" }, i) => {
    const c = exp.coverage[entry];
    if (!c || c.kind !== "staged") throw new Error(`Conformance case ${entry} is not a staged entry (${c?.kind ?? "missing"})`);
    // An entry can be staged for several reasons (a cohort formula that reads the opening of the period); coverage names the first.
    const reasons = stagedReasonsOf(data, entry);
    if (!reasons.includes(reason)) throw new Error(`Conformance case ${entry} is staged for "${reasons.join(", ")}", not "${reason}"`);
    const metric = metrics.get(c.ossieName);
    // A cohort table is cut to the columns this one metric reads.
    const staged = c.cohortTable && metric ? cohortTableFor(data, [metric]) : byName.get(c.stagedDataset);
    if (!staged || !metric) throw new Error(`Conformance case ${entry}: ${c.stagedDataset} or ${c.ossieName} is missing from the model`);
    const [formulaId, variant] = entry.split(":");
    const f: MetricFormula | undefined = formulas[formulaId];
    const formula = f ? formulaSource(f, variant) : undefined;
    if (!formula) throw new Error(`Conformance case ${entry} has no formula text`);
    const datasets = exp.model.datasets.map((d) => d.name).filter((n) => datasetRefs(staged.source).includes(n));
    const dimensions = c.cohortTable ? [] : (staged.fields ?? []).map((x) => x.name).filter((n) => !["period_start", "period_end", "value"].includes(n));
    const expression = expressionText(metric) ?? "";
    const canonicalUrl = canonicalUrlOf(metric);
    // The case's one metric, declared in its scope: under the staged dataset it reads.
    const placed = placeMetrics([...datasets.map((n) => byName.get(n)!), staged].map(withoutMetrics), [metric]);
    const id = `c${String(offset + i + 1).padStart(2, "0")}_${reason.replace(/\W+/g, "_")}_${formulaId}${variant ? `_${variant}` : ""}${label ? `_${label}` : ""}`;
    const model: OssieSemanticModel = {
      version: OSSIE_VERSION,
      name: `gasp_conformance_${id}`,
      description: `GASP conformance case ${id}: ${construct}. The metric ${metric.name} is staged because its formula needs "${reason}", which OSSIE_SQL_2026 cannot state; ${c.cohortTable ? `the staged dataset ${staged.name} carries the compiled SQL, one row per cohort member per period, and the metric's expression sums it` : "its staged dataset carries the compiled SQL"}. Formula: ${formula}`,
      ai_context: { instructions: `Evaluate ${metric.name} for the period ${period.start} to ${period.end} (one row of gasp.period_spine) over the tables in ../../data/ and compare with expected.sql.` },
      datasets: placed.datasets,
      ...(placed.metrics.length ? { metrics: placed.metrics } : {}),
    };
    const order = dimensions.length ? `\nORDER BY ${dimensions.join(", ")}` : "";
    const sql = c.cohortTable
      ? cohortSelect(expression, staged.name, staged.source, period)
      : `SELECT ${[...dimensions, "value"].join(", ")}\nFROM (${staged.source}) AS s\nWHERE period_start = DATE '${period.start}'${order}`;
    if (listed?.length && dimensions.length) throw new Error(`Conformance case ${entry} lists readings, which need a single value, and has the dimensions ${dimensions.join(", ")}`);
    const readings: Reading[] = (listed ?? []).map((r) => {
      if (!staged.source.includes(r.find)) throw new Error(`Conformance case ${entry}: the reading ${r.name} rewrites "${r.find}", which the compiled source no longer holds`);
      const source = staged.source.split(r.find).join(r.replace);
      return { grade: r.grade, name: r.name, description: r.description, query: c.cohortTable ? `(${cohortSelect(expression, staged.name, source, period).replace(/\n/g, " ")})` : stagedScalar(source, period) };
    });
    return { id, kind: "staged" as const, group, reason, construct, period, entry, formulaId, variant, formula, unit: f?.unit, metric: metric.name, stagedDataset: staged.name, ...(c.cohortTable ? { cohortTable: true as const } : {}), datasets, dimensions, canonicalUrl, model, sql, where: `period_start = DATE '${period.start}' AND period_end = DATE '${period.end}'`, readings };
  });
}

/** The standard SQL query an implementation answers: the staged dataset's row for the period, or the direct expression read on the period's last snapshot date. */
export function referenceSql(c: ConformanceCase): string {
  const head = [
    `-- GASP conformance case ${c.id}: ${c.construct}.`,
    `-- Metric ${c.metric} (GASP formula: ${c.formula}) for the period ${c.period.start} to ${c.period.end}.`,
  ];
  const how = c.kind === "staged" ? [
    ...(c.cohortTable ? [`-- The select list is the metric's OSSIE_SQL_2026 expression with each field named by its dataset, evaluated over the rows of the period.`] : []),
    `-- The subquery is the source of the staged dataset ${c.stagedDataset} in model.ossie.yaml,`,
    `-- ${c.cohortTable ? "one row per cohort member per period, " : ""}compiled by GASP from the formula (Postgres dialect; the GASP extension on the dataset carries`,
    `-- Snowflake, BigQuery and Databricks). It reads the tables in ../../data/, including gasp.period_spine.`,
  ] : [
    `-- The metric is a direct OSSIE_SQL_2026 expression in model.ossie.yaml. Each aggregate is evaluated over its`,
    `-- dataset's rows on the last snapshot date of the period, the one reading GASP takes. Nothing in the expression`,
    `-- says so, and readings.sql holds what the other readings return. It reads the tables in ../../data/.`,
  ];
  return [...head, ...how, `${c.sql};`, ""].join("\n");
}

/** A graded value for display: an integer as it is, another number to twelve significant digits. */
export const displayValue = (v: number | null): string => (v === null ? "NULL" : String(Number(v.toPrecision(12))));

/** readings.sql: one row per named reading of the case, with the value each returns on the data. */
export function readingsSql(c: ConformanceCase, values: Record<string, number | null>): string {
  const members = c.readings.map((r) => [
    `  -- ${r.name}: ${r.description}. Returns ${displayValue(values[r.name] ?? null)}.`,
    `  SELECT '${r.grade}' AS grade, '${r.name}' AS reading, CAST(${r.query} AS DOUBLE PRECISION) AS value`,
  ].join("\n"));
  return [
    `-- The other readings of case ${c.id}: what a query returns for ${c.metric} when it reads the data another way.`,
    "-- Grade wrong is a mistake. Grade alternative is a reading other tools take and GASP does not.",
    "-- A result that differs from expected.sql is graded against these rows (see Grading in ../../README.md).",
    "-- Postgres dialect, over the tables in ../../data/.",
    "SELECT grade, reading, value",
    "FROM (",
    members.join("\n  UNION ALL\n"),
    ") AS readings",
    "ORDER BY reading;",
    "",
  ].join("\n");
}

/** A result value as a standard SQL literal: exact for integers and strings, approximate for other numbers. */
export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && !/^0\d/.test(v))) {
    const n = Number(v);
    if (Number.isInteger(n)) return String(n);
    // An approximate numeric literal for a computed ratio, compared within a relative 1e-9.
    return n.toExponential(15).replace(/\.?0+e/, "e").toUpperCase();
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** expected.sql: the rows of referenceSql as a VALUES list, in the column order of the query. */
export function expectedSql(c: ConformanceCase, rows: Array<Record<string, unknown>>): string {
  const cols = [...c.dimensions, "value"];
  const head = `-- Expected result of reference.postgres.sql for case ${c.id}, as standard SQL over literals.\n-- A non-integer value is an approximate numeric literal; compare with a relative tolerance of 1e-9.\n`;
  if (rows.length === 0) {
    return `${head}SELECT *\nFROM (VALUES (${cols.map((col) => (col === "value" ? "CAST(NULL AS DECIMAL)" : "CAST(NULL AS VARCHAR(100))")).join(", ")})) AS expected (${cols.join(", ")})\nWHERE 1 = 0;\n`;
  }
  const values = rows.map((r) => `(${cols.map((col) => sqlLiteral(r[col])).join(", ")})`);
  return `${head}SELECT *\nFROM (VALUES\n  ${values.join(",\n  ")}\n) AS expected (${cols.join(", ")});\n`;
}

const SQL_TYPES: Record<string, string> = { date: "DATE", timestamp: "TIMESTAMP", decimal: "DECIMAL(18, 6)", integer: "INTEGER", boolean: "BOOLEAN" };

/** Standard SQL type for a GASP field. */
export const sqlType = (f: Pick<OntologyField, "type">): string => SQL_TYPES[f.type] ?? "VARCHAR(1000)";

/** A fixture value as a typed literal for the data scripts. */
export function dataLiteral(v: unknown, f: Pick<OntologyField, "type">): string {
  if (v === null || v === undefined) return "NULL";
  if (f.type === "date") return `DATE '${v}'`;
  if (f.type === "timestamp") return `TIMESTAMP '${v}'`;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** data/<dataset>.sql: the table under its GASP field ids and the fixture rows a case needs. */
export function dataSql(dataset: string, meta: OntologyDataset, fields: OntologyField[], rows: Array<Record<string, unknown>>, note: string): string {
  const ddl = `CREATE TABLE gasp.${dataset} (\n  ${fields.map((f) => `${f.id} ${sqlType(f)}`).join(",\n  ")}\n);`;
  const lines = [`-- GASP dataset ${dataset} (${meta.kind}; ${meta.label}). ${note}`, `-- Generated from the GASP test fixture (gasp-wiki-mcp/test/fixture/generate.ts, seed 20260101) by npm run conformance.`, ddl];
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((r) => `  (${fields.map((f) => dataLiteral(r[f.id], f)).join(", ")})`);
    lines.push(`INSERT INTO gasp.${dataset} (${fields.map((f) => f.id).join(", ")}) VALUES\n${chunk.join(",\n")};`);
  }
  return lines.join("\n") + "\n";
}

/** data/period_spine.sql: the reporting periods the staged sources compute for, the first half of 2026 unless given. */
export function periodSpineSql(periods: ReadonlyArray<ConformancePeriod> = [CONFORMANCE_PERIOD]): string {
  const rows = periods.map((p) => `(DATE '${p.start}', DATE '${p.end}')`);
  return [
    periods.length === 1
      ? "-- The reporting periods the staged sources compute for: one row per period. Every case uses the first half of 2026."
      : "-- The reporting periods the staged sources compute for: one row per period. A case reads the row for its own period.",
    "CREATE SCHEMA gasp;",
    "CREATE TABLE gasp.period_spine (period_start DATE, period_end DATE);",
    `INSERT INTO gasp.period_spine (period_start, period_end) VALUES ${rows.join(", ")};`,
    "",
  ].join("\n");
}

export interface ConformanceManifest {
  description: string;
  period: typeof CONFORMANCE_PERIOD;
  grading: typeof GRADING;
  data: Record<string, { rows: number; slice: string }>;
  cases: Array<{
    id: string; kind: ConformanceCase["kind"]; group: ConformanceCase["group"]; reason: ConformanceCase["reason"]; construct: string; metric: string; gasp_id: string; variant?: string; formula: string; unit?: string;
    period: ConformancePeriod; datasets: string[]; columns: string[]; expected: Array<Record<string, unknown>>;
    readings?: Array<{ grade: Grade; name: string; description: string; value: number | null }>; canonical?: string;
  }>;
}

/** Each case's reading values by reading name, as the runner computed them. */
export type ReadingValues = Record<string, Record<string, number | null>>;

export function manifest(cases: ConformanceCase[], expected: Record<string, Array<Record<string, unknown>>>, readings: ReadingValues, data: ConformanceManifest["data"]): ConformanceManifest {
  return {
    description: "GASP conformance set for Apache Ossie: one case per construct OSSIE_SQL_2026 cannot state (the staged reasons in the GASP export) and the cases for a direct expression over a snapshot dataset, each with a complete model, a standard SQL reference query, the expected result on the GASP fixture and the rows it reads. A case with readings also lists the values a query returns under each named mistake or alternative reading. Written by npm run conformance in gasp-wiki-mcp.",
    period: CONFORMANCE_PERIOD,
    grading: GRADING,
    data,
    cases: cases.map((c) => ({
      id: c.id, kind: c.kind, group: c.group, reason: c.reason, construct: c.construct, metric: c.metric, gasp_id: c.formulaId, ...(c.variant ? { variant: c.variant } : {}),
      formula: c.formula, ...(c.unit ? { unit: c.unit } : {}), period: { start: c.period.start, end: c.period.end }, datasets: c.datasets, columns: [...c.dimensions, "value"], expected: expected[c.id] ?? [],
      ...(c.readings.length ? { readings: c.readings.map((r) => ({ grade: r.grade, name: r.name, description: r.description, value: readings[c.id]?.[r.name] ?? null })) } : {}),
      ...(c.canonicalUrl ? { canonical: c.canonicalUrl } : {}),
    })),
  };
}

export function readme(cases: ConformanceCase[], data: ConformanceManifest["data"], expected: Record<string, Array<Record<string, unknown>>>, readings: ReadingValues, ostCommit: string): string {
  const constructs = cases.filter((c) => c.group === "construct");
  const snapshots = cases.filter((c) => c.group === "snapshot");
  const direct = snapshots.filter((c) => c.kind === "direct");
  const opening = snapshots.filter((c) => c.kind === "staged");
  const periods = cases.filter((c) => c.kind === "staged").map((c) => `${c.period.start} to ${c.period.end}`).filter((p, i, all) => all.indexOf(p) === i);
  const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const rows = cases.map((c) => `| \`${c.id}\` | ${c.reason} | ${c.period.start} to ${c.period.end} | ${c.construct} | \`${c.formula.replace(/\|/g, "\\|")}\` |`);
  const tables = Object.entries(data).map(([d, x]) => `| \`${d}\` | ${x.rows} | ${x.slice} |`);
  const value = (v: unknown): string => displayValue(v === null || v === undefined ? null : Number(v));
  const graded = cases.filter((c) => c.readings.length).flatMap((c) => [
    `| \`${c.id}\` | right | | ${value(expected[c.id]?.[0]?.value)} | ${c.construct} |`,
    ...c.readings.map((r) => `| | ${r.grade} | \`${r.name}\` | ${value(readings[c.id]?.[r.name])} | ${r.description} |`),
  ]);
  return `# GASP conformance set for Apache Ossie

Generated from the GASP Standard by \`npm run conformance\` in \`gasp-wiki-mcp\`. Do not edit; edit \`/standard/\` or the fixture and re-run.

This directory holds two groups of case.

${count(constructs.length, "case")} cover the constructs the portable expression language (\`OSSIE_SQL_2026\`) cannot state yet. The GASP export stages ${constructs.length} kinds of formula through a dataset whose source is compiled SQL, one row per period holding the value or, for the retention metrics over a cohort of customers, one row per customer per period that the expression sums (\`coverage.json\` beside the Ossie files lists every staged entry and its reason); there is one worked case for each reason, with an executed answer, so a proposal that adds the construct to the language can be tested against it.

${count(snapshots.length, "case")} cover which rows of a snapshot dataset a reporting period reads. A snapshot dataset holds one row per entity per \`snapshot_date\`. ${direct.length} of them take a direct expression whose GASP formula ends \`at period_end\`, which the Ossie expression has no place to say. The expression validates and runs, and a query that sums it across dates returns a number with no error. ${opening.length} ${opening.length === 1 ? "takes" : "take"} the opening value of a period that begins on the day a customer starts, where the snapshot dated on the first day and the last snapshot before it differ. On the calendar months of the fixture those two agree. Each of these cases carries the expected value and the value every other listed reading returns (Grading, below).

## Layout

| Path | Contents |
| --- | --- |
| \`data/period_spine.sql\` | The schema and the reporting periods the staged sources compute for (${periods.join("; ")}) |
| \`data/<dataset>.sql\` | One GASP dataset as \`CREATE TABLE\` + \`INSERT\`, columns named by GASP field id, rows from the GASP test fixture |
| \`cases/<case>/model.ossie.yaml\` | A complete Ossie semantic model: the datasets the case reads, the staged dataset where the case has one and the metric, declared under the dataset it reads |
| \`cases/<case>/reference.postgres.sql\` | The staged dataset's source read for the period, or the direct expression read on the period's last snapshot date, as a query over \`data/\` (Postgres dialect) |
| \`cases/<case>/expected.sql\` | The expected result as a \`VALUES\` list in standard SQL |
| \`cases/<case>/readings.sql\` | On the cases listed under Grading: one row per named mistake or alternative reading with the value it returns (Postgres dialect) |
| \`cases/<case>/case.ost\` | The case as a script for \`ost\`, the SQL test runner in the Apache Ossie repository, with the expanded SQL and the result under each command |
| \`manifest.json\` | Every case with its reason, formula, period, datasets, columns, expected rows and readings |

A case passes when an implementation loads \`data/period_spine.sql\` and the \`data/<dataset>.sql\` files the case names, loads \`model.ossie.yaml\`, evaluates the metric for the case's period and returns the rows of \`expected.sql\` (columns by position, exact numerics equal, approximate numerics within a relative 1e-9). \`reference.postgres.sql\` is the non-normative derivation: run it on Postgres over the same data and it returns \`expected.sql\`. The test suite does exactly that on PGlite for every case.

## Running a case with ost

\`ost\` is the SQL test runner in the Apache Ossie repository (\`ost/\`, the format in \`ost/docs/ost.md\`). The cases under \`compliance/query\` there are scripts for it. \`case.ost\` creates the tables the case reads, loads \`model.ossie.yaml\` from its own directory and asks for the metric with \`executeExpand\`, which expands \`AGG(metric)\` through the upstream view expander into SQL over those tables and runs it on DuckDB. From this directory, with a checkout of \`apache/ossie\`:

\`\`\`bash
uv run --project <apache/ossie checkout>/ost ost -d . cases/<case>/case.ost
\`\`\`

The text under each command is the expected output, the expanded SQL followed by the result table. A run passes when the runner writes the same text (it leaves the script it regenerated under \`target/ost/\` here, or under the directory \`--output-dir\` names). It was written by the runner at \`apache/ossie\` \`${ostCommit}\`. The table is the conformance result: each one was held to \`expected.sql\` and to the reading values before it was published. The expansion above it is that expander's text, so another expander may write other SQL for the same table.

On a snapshot case with a direct expression the script also asks for each listed reading that keeps the expression and reads other snapshot dates, under a comment naming its grade. A reading that changes the SQL of the model (the expression, or the source of a staged dataset) is in \`readings.sql\` only. A double is written with ${OST_DOUBLE_DIGITS} digits after the point. The tables are copied into each script because \`ost\` has no command that runs a SQL file, so the scripts are most of the size of this directory.

## Cases

| Case | Reason | Period | Construct | GASP formula |
| --- | --- | --- | --- | --- |
${rows.join("\n")}

## Grading

A result has one of four grades.

| Grade | Result |
| --- | --- |
| right | ${GRADING.right.replace("expected.sql", "\`expected.sql\`")} |
| alternative | ${GRADING.alternative.replace("grade alternative", "grade \`alternative\`")} |
| wrong | ${GRADING.wrong.replace("grade wrong", "grade \`wrong\`")} |
| failed | ${GRADING.failed} |

Failed is kept apart from wrong because every wrong value listed here comes from a query that runs without an error or a warning. An implementation that refuses a query it cannot evaluate over a snapshot has returned no wrong number.

${graded.length ? `The values below were computed by running each reading on the data, as \`readings.sql\` in the case directory does. A wrong value that is not listed is still wrong.

| Case | Grade | Reading | Value | What the query did |
| --- | --- | --- | --- | --- |
${graded.join("\n")}
` : ""}
## Data

The rows come from the deterministic GASP fixture (\`gasp-wiki-mcp/test/fixture/generate.ts\`, seed 20260101, about twenty customers over 2026-01-01 to 2026-06-30 with snapshot history from 2025-06-01). A snapshot dataset is sliced to month-end rows where that reproduces the full result, plus the bounds of a period off the calendar month and every date of a period a listed reading sums across; every slice was verified against the full fixture when it was written, the expected rows and the reading values alike.

| Dataset | Rows | Slice |
| --- | --- | --- |
${tables.join("\n")}
`;
}
