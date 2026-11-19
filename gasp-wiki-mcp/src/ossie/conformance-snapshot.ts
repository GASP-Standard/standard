/**
 * The snapshot cases of the GASP conformance set: which rows of a snapshot
 * dataset a reporting period reads.
 *
 * A snapshot dataset holds one row per entity per `snapshot_date`. A direct
 * metric over one (MRR, Total Customers) is a plain OSSIE_SQL_2026 aggregate:
 * it validates and it runs, and nothing in it says that the period reads one
 * snapshot date. GASP reads the last date of the period. A query that reads
 * every date in the period, or the closing value of every month in a quarter,
 * returns a number with no error. Each direct case here carries the expected
 * value and those other values by name (`readings` in conformance.ts), each one
 * computed on the fixture by the runner.
 *
 * The opening value of a period has two readings in use: the snapshot dated on
 * the first day of the period (GASP) and the last snapshot before it (the prior
 * period's close). They agree whenever nothing changes on the first day, which
 * is every calendar month of the fixture, so one staged case evaluates Logo
 * Churn Rate over four weeks that begin on the day a customer starts.
 */
import type { OntologyDataset, StandardData } from "../types.js";
import { formulaSource } from "./metrics.js";
import {
  SNAPSHOT_REASON, buildConformanceCases, canonicalUrlOf,
  type ConformanceCase, type ConformancePeriod, type Grade, type Reading, type StagedCaseSpec,
} from "./conformance.js";
import { aggregateQuery } from "./demo.js";
import { expressionText, OSSIE_VERSION, type OssieExport, type OssieSemanticModel } from "./types.js";

/** Which snapshot dates of the period a reading's aggregates run over. */
type Rows = "every_date" | "first_date" | "month_ends";

interface SnapshotReading {
  grade: Grade;
  name: string;
  description: string;
  rows: Rows;
  /** A change to the expression before it runs, as text that must be found in it. */
  rewrite?: { find: string; replace: string };
}

export interface SnapshotCaseSpec {
  /** Coverage key of a direct entry that reads snapshot datasets only. */
  entry: string;
  /** Closes the case id: the length of the period. */
  label: string;
  period: ConformancePeriod;
  construct: string;
  readings: SnapshotReading[];
}

const JUNE: ConformancePeriod = { start: "2026-06-01", end: "2026-06-30" };
const Q2: ConformancePeriod = { start: "2026-04-01", end: "2026-06-30" };

export const SNAPSHOT_CASES: ReadonlyArray<SnapshotCaseSpec> = [
  {
    entry: "mrr", label: "month", period: JUNE,
    construct: "a sum over a snapshot dataset for a month, read on the last snapshot date of the month",
    readings: [
      { grade: "wrong", name: "summed_over_every_date", rows: "every_date", description: "the sum taken over every snapshot date in the period, so each subscription is added once per day" },
      { grade: "wrong", name: "opening_value", rows: "first_date", description: "the sum on the first snapshot date of the period, where the formula reads the last" },
    ],
  },
  {
    entry: "mrr", label: "quarter", period: Q2,
    construct: "a sum over a snapshot dataset for a quarter, read on the last snapshot date of the quarter",
    readings: [
      { grade: "wrong", name: "month_ends_summed", rows: "month_ends", description: "the closing value of each month in the period added together, where the formula reads the closing value of the last" },
      { grade: "wrong", name: "opening_value", rows: "first_date", description: "the sum on the first snapshot date of the period, where the formula reads the last" },
    ],
  },
  {
    entry: "total_customers", label: "month", period: JUNE,
    construct: "a distinct count over a snapshot dataset for a month, read on the last snapshot date of the month",
    readings: [
      { grade: "wrong", name: "distinct_over_every_date", rows: "every_date", description: "the distinct count taken over every snapshot date in the period, so a customer active on any day of it is counted, one who left before the last day included" },
      { grade: "wrong", name: "rows_over_every_date", rows: "every_date", rewrite: { find: "COUNT(DISTINCT ", replace: "COUNT(" }, description: "the active rows on every snapshot date in the period counted without DISTINCT, which gives customer days" },
      { grade: "wrong", name: "opening_value", rows: "first_date", description: "the count on the first snapshot date of the period, where the formula reads the last" },
    ],
  },
];

/** The opening case: four weeks from Monday 2026-02-09, the day a customer starts, so the two opening readings differ. */
export const OPENING_CASES: ReadonlyArray<StagedCaseSpec> = [
  {
    reason: "at period_start", entry: "logo_churn_rate", label: "four_weeks", group: "snapshot",
    period: { start: "2026-02-09", end: "2026-03-08" },
    construct: "the opening value of a period that begins on the day a customer starts, read from the snapshot dated on the first day of the period",
    readings: [
      {
        grade: "alternative", name: "prior_period_close", find: "snapshot_date = p.period_start", replace: "snapshot_date = (p.period_start - INTERVAL '1' DAY)",
        description: "the opening value read from the last snapshot date before the period (the prior period's close), which leaves out the customer who starts on the first day",
      },
    ],
  },
];

/** The number of snapshot cases, for a count that does not need the cases built. */
export const SNAPSHOT_CASE_COUNT = SNAPSHOT_CASES.length + OPENING_CASES.length;

/** The last day of every month that ends inside the period. */
export function monthEnds(period: ConformancePeriod): string[] {
  const out: string[] = [];
  const [y, m] = period.start.split("-").map(Number);
  for (let i = 0; ; i++) {
    const end = new Date(Date.UTC(y, m + i, 0)).toISOString().slice(0, 10);
    if (end > period.end) return out;
    if (end >= period.start) out.push(end);
  }
}

const date = (d: string): string => `DATE '${d}'`;

/** The rows of a snapshot dataset a reading runs over, as a filter on its date field. */
function rowFilter(rows: Rows | "last_date", column: string, period: ConformancePeriod): string {
  if (rows === "last_date") return `${column} = ${date(period.end)}`;
  if (rows === "first_date") return `${column} = ${date(period.start)}`;
  if (rows === "month_ends") return `${column} IN (${monthEnds(period).map(date).join(", ")})`;
  return `${column} >= ${date(period.start)} AND ${column} <= ${date(period.end)}`;
}

const DATASET_REF = /\b([a-z_][a-z0-9_]*)\.[a-z_][a-z0-9_]*\b/g;

/** The snapshot cases, numbered after `offset` cases: the direct ones, then the opening case. */
export function buildSnapshotCases(data: StandardData, exp: OssieExport, offset: number): ConformanceCase[] {
  const datasets = (data.ontology?.datasets ?? {}) as Record<string, OntologyDataset>;
  const byName = new Map(exp.model.datasets.map((d) => [d.name, d]));
  const metrics = new Map((exp.model.metrics ?? []).map((m) => [m.name, m]));
  const direct = SNAPSHOT_CASES.map((spec, i): ConformanceCase => {
    const { entry, label, period, construct } = spec;
    const c = exp.coverage[entry];
    if (!c || c.kind !== "direct") throw new Error(`Snapshot case ${entry} is not a direct entry (${c?.kind ?? "missing"})`);
    const metric = metrics.get(c.ossieName);
    const expression = metric && expressionText(metric);
    if (!metric || !expression) throw new Error(`Snapshot case ${entry}: ${c.ossieName} is missing from the model or has no expression`);
    const [formulaId, variant] = entry.split(":");
    const f = data.formulas?.[formulaId];
    const formula = f ? formulaSource(f, variant) : undefined;
    if (!formula) throw new Error(`Snapshot case ${entry} has no formula text`);
    const read = new Set([...expression.matchAll(DATASET_REF)].map((m) => m[1]).filter((d) => datasets[d]));
    const names = exp.model.datasets.map((d) => d.name).filter((n) => read.has(n));
    const other = names.filter((n) => datasets[n].kind !== "snapshot");
    if (!names.length || other.length) throw new Error(`Snapshot case ${entry} must read snapshot datasets only and reads ${names.length ? other.join(", ") : "none"}`);
    const scalar = (rows: Rows | "last_date", text = expression): string => aggregateQuery(text, datasets, (ds) => rowFilter(rows, datasets[ds].date, period));
    const readings: Reading[] = spec.readings.map((r) => {
      if (r.rewrite && !expression.includes(r.rewrite.find)) throw new Error(`Snapshot case ${entry}: the reading ${r.name} rewrites "${r.rewrite.find}", which the expression no longer holds`);
      const text = r.rewrite ? expression.split(r.rewrite.find).join(r.rewrite.replace) : expression;
      return { grade: r.grade, name: r.name, description: r.description, query: scalar(r.rows, text) };
    });
    const id = `c${String(offset + i + 1).padStart(2, "0")}_${SNAPSHOT_REASON}_${formulaId}${variant ? `_${variant}` : ""}_${label}`;
    const model: OssieSemanticModel = {
      version: OSSIE_VERSION,
      name: `gasp_conformance_${id}`,
      description: `GASP conformance case ${id}: ${construct}. The metric ${metric.name} is a direct OSSIE_SQL_2026 expression over ${names.join(" and ")}, a snapshot dataset with one row per entity per snapshot date. GASP evaluates it on the last snapshot date of the period. Formula: ${formula}`,
      ai_context: { instructions: `Evaluate ${metric.name} for the period ${period.start} to ${period.end} over the tables in ../../data/ and compare with expected.sql.` },
      datasets: names.map((n) => byName.get(n)!),
      metrics: [metric],
    };
    const everyDate = spec.readings.some((r) => r.rows === "every_date");
    return {
      id, kind: "direct", group: "snapshot", reason: SNAPSHOT_REASON, construct, period, entry, formulaId, variant, formula, unit: f?.unit,
      metric: metric.name, datasets: names, dimensions: [], canonicalUrl: canonicalUrlOf(metric), model,
      sql: `SELECT ${scalar("last_date")} AS value`, readings, ...(everyDate ? { daily: period } : {}),
    };
  });
  return [...direct, ...buildConformanceCases(data, exp, OPENING_CASES, offset + direct.length)];
}
