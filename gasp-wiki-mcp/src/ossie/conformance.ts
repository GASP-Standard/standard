/**
 * The GASP conformance set for Apache Ossie: one case per construct the
 * portable expression language cannot state yet (the staged reasons in
 * metrics.ts), each a complete Ossie semantic model, a standard SQL query over
 * its staged dataset, the expected result on the GASP fixture and the fixture
 * rows it reads.
 *
 * The shapes follow the two upstream compliance suites: a case directory holds
 * `model.ossie.yaml` (as compliance/portability's one-model-per-rung fixtures),
 * `reference.postgres.sql` and `expected.sql` (as compliance/query's
 * `reference.duckdb.sql` and `expected.sql`, a VALUES list in standard SQL), and
 * the shared `data/` directory holds one `CREATE TABLE` + `INSERT` script per
 * dataset plus the period spine. A case passes when an implementation loads the
 * data and the model, evaluates the metric for the period and returns the rows
 * of expected.sql.
 *
 * This module is pure: it picks the cases and shapes every file from the
 * export and from values the runner (scripts/ossie-conformance.ts) computes by
 * executing the staged sources on the fixture in PGlite.
 */
import type { MetricFormula, OntologyDataset, OntologyField, StandardData } from "../types.js";
import { formulaSource, type StagedReason } from "./metrics.js";
import type { OssieDataset, OssieExport, OssieMetric, OssieSemanticModel } from "./types.js";
import { OSSIE_VERSION } from "./types.js";

/** Reporting period every case is evaluated for: the fixture window, so every movement in the stories lands in it. */
export const CONFORMANCE_PERIOD = { start: "2026-01-01", end: "2026-06-30" } as const;

/**
 * One coverage entry per staged reason, in the order metrics.ts ranks the
 * reasons. Chosen for small datasets and for metrics the executed test suite
 * already pins, so every expected value is checked twice.
 */
export const CONFORMANCE_CASES: ReadonlyArray<{ reason: StagedReason; entry: string; construct: string }> = [
  { reason: "cohort", entry: "nrr", construct: "a cohort fixed at the opening of the period and followed through its events (Net Revenue Retention)" },
  { reason: "lag", entry: "mrr_growth_rate", construct: "the same aggregate one period earlier (period-over-period growth)" },
  { reason: "at period_start", entry: "logo_churn_rate", construct: "a snapshot read at the opening of the period beside events inside it" },
  { reason: "total", entry: "ticket_distribution_by_type", construct: "a share of the ungrouped total inside a breakdown" },
  { reason: "period bound in filter", entry: "win_rate", construct: "the reporting period bound to a field other than the dataset's time field (opportunities by close date on a snapshot)" },
  { reason: "to_date", entry: "ticket_backlog", construct: "an aggregate cumulative from the start of history to the period end" },
  { reason: "period_days", entry: "uptime", construct: "the number of days in the reporting period as a value" },
  { reason: "bucket", entry: "aging_buckets", construct: "a dimension defined by ranges over a per-row expression" },
  { reason: "window", entry: "dau_mau", construct: "trailing windows of different lengths ending at the period end (one day over thirty)" },
  { reason: "distinct pair", entry: "breadth_of_adoption", construct: "a count of distinct tuples (account and feature pairs)" },
  { reason: "all_time", entry: "user_retention_day_n", construct: "an unbounded range beside a bounded one (users who signed up in the period, active any time after)" },
];

export interface ConformanceCase {
  /** Directory name: a two-digit rank, the reason and the metric. */
  id: string;
  reason: StagedReason;
  construct: string;
  /** Coverage key (`formula id` or `formula id:variant`). */
  entry: string;
  /** The GASP formula id and the variant or form, if any. */
  formulaId: string;
  variant?: string;
  /** GASP grammar text of the entry expression. */
  formula: string;
  unit?: string;
  /** Ossie metric name and the staged dataset that carries it. */
  metric: string;
  stagedDataset: string;
  /** GASP datasets the staged source reads, in the order they appear in the model. */
  datasets: string[];
  /** Result columns other than the value: a breakdown's key and label columns. */
  dimensions: string[];
  canonicalUrl?: string;
  model: OssieSemanticModel;
}

/** A GASP dataset referenced in a staged source as `gasp.<dataset>`. */
const datasetRefs = (source: string): string[] => [...new Set([...source.matchAll(/\bgasp\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]))].filter((d) => d !== "period_spine");

export function buildConformanceCases(data: StandardData, exp: OssieExport): ConformanceCase[] {
  const byName = new Map<string, OssieDataset>(exp.model.datasets.map((d) => [d.name, d]));
  const metrics = new Map<string, OssieMetric>((exp.model.metrics ?? []).map((m) => [m.name, m]));
  const formulas = data.formulas ?? {};
  return CONFORMANCE_CASES.map(({ reason, entry, construct }, i) => {
    const c = exp.coverage[entry];
    if (!c || c.kind !== "staged") throw new Error(`Conformance case ${entry} is not a staged entry (${c?.kind ?? "missing"})`);
    if (c.reason !== reason) throw new Error(`Conformance case ${entry} is staged for "${c.reason}", not "${reason}"`);
    const staged = byName.get(c.stagedDataset);
    const metric = metrics.get(c.ossieName);
    if (!staged || !metric) throw new Error(`Conformance case ${entry}: ${c.stagedDataset} or ${c.ossieName} is missing from the model`);
    const [formulaId, variant] = entry.split(":");
    const f: MetricFormula | undefined = formulas[formulaId];
    const formula = f ? formulaSource(f, variant) : undefined;
    if (!formula) throw new Error(`Conformance case ${entry} has no formula text`);
    const datasets = exp.model.datasets.map((d) => d.name).filter((n) => datasetRefs(staged.source).includes(n));
    const dimensions = (staged.fields ?? []).map((x) => x.name).filter((n) => !["period_start", "period_end", "value"].includes(n));
    const instructions = typeof metric.ai_context === "object" && metric.ai_context ? String(metric.ai_context.instructions ?? "") : "";
    const canonicalUrl = /Canonical definition: (\S+?)\.?(?:\s|$)/.exec(instructions)?.[1];
    const id = `c${String(i + 1).padStart(2, "0")}_${reason.replace(/\W+/g, "_")}_${formulaId}${variant ? `_${variant}` : ""}`;
    const model: OssieSemanticModel = {
      version: OSSIE_VERSION,
      name: `gasp_conformance_${id}`,
      description: `GASP conformance case ${id}: ${construct}. The metric ${metric.name} is staged because its formula needs "${reason}", which OSSIE_SQL_2026 cannot state; its staged dataset carries the compiled SQL. Formula: ${formula}`,
      ai_context: { instructions: `Evaluate ${metric.name} for the period ${CONFORMANCE_PERIOD.start} to ${CONFORMANCE_PERIOD.end} (one row of gasp.period_spine) over the tables in ../../data/ and compare with expected.sql.` },
      datasets: [...datasets.map((n) => byName.get(n)!), staged],
      metrics: [metric],
    };
    return { id, reason, construct, entry, formulaId, variant, formula, unit: f?.unit, metric: metric.name, stagedDataset: staged.name, datasets, dimensions, canonicalUrl, model };
  });
}

/** The standard SQL query an implementation answers: the staged dataset's row for the period. */
export function referenceSql(c: ConformanceCase): string {
  const cols = [...c.dimensions, "value"].join(", ");
  const order = c.dimensions.length ? `\nORDER BY ${c.dimensions.join(", ")}` : "";
  return [
    `-- GASP conformance case ${c.id}: ${c.construct}.`,
    `-- Metric ${c.metric} (GASP formula: ${c.formula}) for the period ${CONFORMANCE_PERIOD.start} to ${CONFORMANCE_PERIOD.end}.`,
    `-- The subquery is the source of the staged dataset ${c.stagedDataset} in model.ossie.yaml,`,
    `-- compiled by GASP from the formula (Postgres dialect; the GASP extension on the dataset carries`,
    `-- Snowflake, BigQuery and Databricks). It reads the tables in ../../data/, including gasp.period_spine.`,
    `SELECT ${cols}`,
    `FROM (${c.model.datasets[c.model.datasets.length - 1].source}) AS s`,
    `WHERE period_start = DATE '${CONFORMANCE_PERIOD.start}'${order};`,
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
    // An approximate numeric literal, as compliance/query asks for a computed ratio.
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

/** data/period_spine.sql: the one reporting period every case evaluates. */
export function periodSpineSql(): string {
  return [
    "-- The reporting periods the staged sources compute for: one row per period. Every case uses the first half of 2026.",
    "CREATE SCHEMA gasp;",
    "CREATE TABLE gasp.period_spine (period_start DATE, period_end DATE);",
    `INSERT INTO gasp.period_spine (period_start, period_end) VALUES (DATE '${CONFORMANCE_PERIOD.start}', DATE '${CONFORMANCE_PERIOD.end}');`,
    "",
  ].join("\n");
}

export interface ConformanceManifest {
  description: string;
  period: typeof CONFORMANCE_PERIOD;
  data: Record<string, { rows: number; slice: string }>;
  cases: Array<{
    id: string; reason: StagedReason; construct: string; metric: string; gasp_id: string; variant?: string; formula: string; unit?: string;
    datasets: string[]; columns: string[]; expected: Array<Record<string, unknown>>; canonical?: string;
  }>;
}

export function manifest(cases: ConformanceCase[], expected: Record<string, Array<Record<string, unknown>>>, data: ConformanceManifest["data"]): ConformanceManifest {
  return {
    description: "GASP conformance set for Apache Ossie: one case per construct OSSIE_SQL_2026 cannot state (the staged reasons in the GASP export), each with a complete model, a standard SQL reference query, the expected result on the GASP fixture and the rows it reads. Written by npm run conformance in gasp-wiki-mcp.",
    period: CONFORMANCE_PERIOD,
    data,
    cases: cases.map((c) => ({
      id: c.id, reason: c.reason, construct: c.construct, metric: c.metric, gasp_id: c.formulaId, ...(c.variant ? { variant: c.variant } : {}),
      formula: c.formula, ...(c.unit ? { unit: c.unit } : {}), datasets: c.datasets, columns: [...c.dimensions, "value"], expected: expected[c.id] ?? [],
      ...(c.canonicalUrl ? { canonical: c.canonicalUrl } : {}),
    })),
  };
}

export function readme(cases: ConformanceCase[], data: ConformanceManifest["data"]): string {
  const rows = cases.map((c) => `| \`${c.id}\` | ${c.reason} | ${c.construct} | \`${c.formula.replace(/\|/g, "\\|")}\` |`);
  const tables = Object.entries(data).map(([d, x]) => `| \`${d}\` | ${x.rows} | ${x.slice} |`);
  return `# GASP conformance set for Apache Ossie

Generated from the GASP Standard by \`npm run conformance\` in \`gasp-wiki-mcp\`. Do not edit; edit \`/standard/\` or the fixture and re-run.

One case per construct the portable expression language (\`OSSIE_SQL_2026\`) cannot state yet. The GASP export stages ${cases.length} kinds of formula through a per-period dataset whose source is compiled SQL (\`coverage.json\` beside the Ossie files lists every staged entry and its reason); this directory holds one worked case for each reason, with an executed answer, so a proposal that adds the construct to the language can be tested against it.

## Layout

| Path | Contents |
| --- | --- |
| \`data/period_spine.sql\` | The schema and the one reporting period (${CONFORMANCE_PERIOD.start} to ${CONFORMANCE_PERIOD.end}) |
| \`data/<dataset>.sql\` | One GASP dataset as \`CREATE TABLE\` + \`INSERT\`, columns named by GASP field id, rows from the GASP test fixture |
| \`cases/<case>/model.ossie.yaml\` | A complete Ossie semantic model: the datasets the case reads, the staged dataset and the metric |
| \`cases/<case>/reference.postgres.sql\` | The staged dataset's source for the period, as a query over \`data/\` (Postgres dialect) |
| \`cases/<case>/expected.sql\` | The expected result as a \`VALUES\` list in standard SQL, in the shape of \`compliance/query\` upstream |
| \`manifest.json\` | Every case with its reason, formula, datasets, columns and expected rows |

A case passes when an implementation loads \`data/period_spine.sql\` and the \`data/<dataset>.sql\` files the case names, loads \`model.ossie.yaml\`, evaluates the metric for the period and returns the rows of \`expected.sql\` (columns by position, exact numerics equal, approximate numerics within a relative 1e-9). \`reference.postgres.sql\` is the non-normative derivation: run it on Postgres over the same data and it returns \`expected.sql\`. The test suite does exactly that on PGlite for every case.

## Cases

| Case | Reason | Construct | GASP formula |
| --- | --- | --- | --- |
${rows.join("\n")}

## Data

The rows come from the deterministic GASP fixture (\`gasp-wiki-mcp/test/fixture/generate.ts\`, seed 20260101, about twenty customers over 2026-01-01 to 2026-06-30 with snapshot history from 2025-06-01). A snapshot dataset is sliced to month-end rows where that reproduces the full result; every slice was verified against the full fixture when it was written.

| Dataset | Rows | Slice |
| --- | --- | --- |
${tables.join("\n")}
`;
}
