/**
 * SQL dialects for the compiled templates (src/compile.ts).
 *
 * The compiler emits ANSI SQL except for the constructs below, which every
 * warehouse spells differently. Each dialect is one row of this table; adding a
 * dialect is adding a row (and a column to the README's generate_query entry).
 *
 *   construct                 postgres (default)                      snowflake                         bigquery                                  databricks
 *   date shift (a - n unit)   (a - INTERVAL 'n unit'), quarter=3 month DATEADD(unit, -n, a)              DATE_SUB(a, INTERVAL n UNIT)              DATEADD(UNIT, -n, a)
 *   date shift (a + n unit)   (a + INTERVAL 'n unit')                 DATEADD(unit, n, a)               DATE_ADD(a, INTERVAL n UNIT)              DATEADD(UNIT, n, a)
 *   date as timestamp         a                                       a                                 TIMESTAMP(a)                              a
 *   date difference in days   (a - b)                                 DATEDIFF(day, b, a)               DATE_DIFF(a, b, DAY)                      DATEDIFF(a, b)
 *   period length in days     (end - start + 1)                       (DATEDIFF(day, start, end) + 1)   (DATE_DIFF(end, start, DAY) + 1)          (DATEDIFF(end, start) + 1)
 *   timestamp difference (s)  EXTRACT(EPOCH FROM (a - b))             DATEDIFF(second, b, a)            TIMESTAMP_DIFF(a, b, SECOND)              TIMESTAMPDIFF(SECOND, b, a)
 *   numerator cast            CAST(x AS DOUBLE PRECISION)             CAST(x AS DOUBLE)                 CAST(x AS FLOAT64)                        CAST(x AS DOUBLE)
 *   percentile p / median     PERCENTILE_CONT(p) WITHIN GROUP         PERCENTILE_CONT(p) WITHIN GROUP   APPROX_QUANTILES(x, 1000)[OFFSET(p*1000)] PERCENTILE(x, p)
 *                             (ORDER BY x)                            (ORDER BY x)                      (approximate: BigQuery has no exact
 *                                                                                                       aggregate percentile)
 *
 * Everything else the compiler emits (scalar subqueries, COUNT(DISTINCT), NULLIF,
 * CASE, LEAST/GREATEST, ABS, COALESCE, UNION ALL of literals, correlated
 * subqueries on a derived table) runs unchanged on all four.
 *
 * Redshift: `postgres` covers it. Every construct in the postgres column runs
 * on Redshift (INTERVAL literals, date subtraction, EXTRACT(EPOCH ...),
 * DOUBLE PRECISION, PERCENTILE_CONT ... WITHIN GROUP), so it waits for an
 * upstream Ossie dialect value rather than a row here.
 *
 * Timestamp columns against the DATE period bounds (src/compile.ts): the lower
 * bound is `>= start`, the upper `< end + 1 day` (so the whole last day counts),
 * and the date is wrapped as a timestamp where the dialect does not coerce
 * (BigQuery's TIMESTAMP(...); Postgres, Snowflake and Databricks coerce).
 */
import type { LagUnit } from "./formula.js";

export const DIALECTS = ["postgres", "snowflake", "bigquery", "databricks"] as const;
export type DialectName = (typeof DIALECTS)[number];

export interface Dialect {
  name: DialectName;
  /** The date `a` moved back by n units */
  minus(a: string, n: number, unit: LagUnit): string;
  /** The date `a` moved forward by n units */
  plus(a: string, n: number, unit: LagUnit): string;
  /** A date used against a timestamp column: cast where the dialect does not coerce */
  toTimestamp(a: string): string;
  /** Whole days from b to a (a - b) */
  daysBetween(a: string, b: string): string;
  /** Days in the period, both bounds inclusive */
  periodDays(end: string, start: string): string;
  /** Seconds from b to a (a - b), for timestamps */
  secondsBetween(a: string, b: string): string;
  /** Cast to a double so COUNT / COUNT is not integer division */
  toDouble(x: string): string;
  /** Aggregate percentile p (0 < p < 1) of x; median is p = 0.5 */
  percentile(p: number, x: string): string;
  /** Postgres-only tokens that must not appear in this dialect's output (tests sweep for them) */
  forbidden: string[];
}

const pgInterval = (n: number, unit: LagUnit) => (unit === "quarter" ? `INTERVAL '${n * 3} month'` : `INTERVAL '${n} ${unit}'`);
const PG_ONLY = ["DOUBLE PRECISION", "EXTRACT(EPOCH", "INTERVAL '"];

export const DIALECT: Record<DialectName, Dialect> = {
  postgres: {
    name: "postgres",
    minus: (a, n, unit) => `(${a} - ${pgInterval(n, unit)})`,
    plus: (a, n, unit) => `(${a} + ${pgInterval(n, unit)})`,
    toTimestamp: (a) => a,
    daysBetween: (a, b) => `(${a} - ${b})`,
    periodDays: (end, start) => `(${end} - ${start} + 1)`,
    secondsBetween: (a, b) => `EXTRACT(EPOCH FROM (${a} - ${b}))`,
    toDouble: (x) => `CAST(${x} AS DOUBLE PRECISION)`,
    percentile: (p, x) => `PERCENTILE_CONT(${p}) WITHIN GROUP (ORDER BY ${x})`,
    forbidden: [],
  },
  snowflake: {
    name: "snowflake",
    minus: (a, n, unit) => `DATEADD(${unit}, -${n}, ${a})`,
    plus: (a, n, unit) => `DATEADD(${unit}, ${n}, ${a})`,
    toTimestamp: (a) => a,
    daysBetween: (a, b) => `DATEDIFF(day, ${b}, ${a})`,
    periodDays: (end, start) => `(DATEDIFF(day, ${start}, ${end}) + 1)`,
    secondsBetween: (a, b) => `DATEDIFF(second, ${b}, ${a})`,
    toDouble: (x) => `CAST(${x} AS DOUBLE)`,
    percentile: (p, x) => `PERCENTILE_CONT(${p}) WITHIN GROUP (ORDER BY ${x})`,
    forbidden: PG_ONLY,
  },
  bigquery: {
    name: "bigquery",
    minus: (a, n, unit) => `DATE_SUB(${a}, INTERVAL ${n} ${unit.toUpperCase()})`,
    plus: (a, n, unit) => `DATE_ADD(${a}, INTERVAL ${n} ${unit.toUpperCase()})`,
    toTimestamp: (a) => `TIMESTAMP(${a})`,
    daysBetween: (a, b) => `DATE_DIFF(${a}, ${b}, DAY)`,
    periodDays: (end, start) => `(DATE_DIFF(${end}, ${start}, DAY) + 1)`,
    secondsBetween: (a, b) => `TIMESTAMP_DIFF(${a}, ${b}, SECOND)`,
    toDouble: (x) => `CAST(${x} AS FLOAT64)`,
    percentile: (p, x) => `APPROX_QUANTILES(${x}, 1000)[OFFSET(${Math.round(p * 1000)})]`,
    forbidden: [...PG_ONLY, "WITHIN GROUP", "PERCENTILE_CONT"],
  },
  databricks: {
    name: "databricks",
    minus: (a, n, unit) => `DATEADD(${unit.toUpperCase()}, -${n}, ${a})`,
    plus: (a, n, unit) => `DATEADD(${unit.toUpperCase()}, ${n}, ${a})`,
    toTimestamp: (a) => a,
    daysBetween: (a, b) => `DATEDIFF(${a}, ${b})`,
    periodDays: (end, start) => `(DATEDIFF(${end}, ${start}) + 1)`,
    secondsBetween: (a, b) => `TIMESTAMPDIFF(SECOND, ${b}, ${a})`,
    toDouble: (x) => `CAST(${x} AS DOUBLE)`,
    percentile: (p, x) => `PERCENTILE(${x}, ${p})`,
    forbidden: [...PG_ONLY, "WITHIN GROUP", "PERCENTILE_CONT"],
  },
};

/** Ossie's Dialect enum value for each dialect; postgres has none (the staged source keeps it). */
export const OSSIE_DIALECT_OF: Partial<Record<DialectName, "SNOWFLAKE" | "BIGQUERY" | "DATABRICKS">> = {
  snowflake: "SNOWFLAKE",
  bigquery: "BIGQUERY",
  databricks: "DATABRICKS",
};

/** A dialect named by an adapter's `warehouse` (postgres, postgresql and redshift map to postgres), else undefined. */
export function dialectOfWarehouse(warehouse: unknown): DialectName | undefined {
  const w = typeof warehouse === "string" ? warehouse.trim().toLowerCase() : "";
  if (w === "postgres" || w === "postgresql" || w === "redshift") return "postgres";
  return (DIALECTS as readonly string[]).includes(w) ? (w as DialectName) : undefined;
}
