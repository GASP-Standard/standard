/**
 * The example's runnable demo: every metric of the Core example evaluated as a
 * standalone SQL query over the `gasp.<dataset>` tables, so a reviewer can run
 * the model on DuckDB (the engine upstream `compliance/query` uses) or any
 * standard SQL engine and see each number come out.
 *
 * The queries follow the Relational Query Interface's reading of a metric: each
 * aggregate is evaluated over its dataset's rows for the reporting period, which
 * the query layer selects (snapshot rows on the period end, event and fact rows
 * dated in the period). A direct metric's expression is rewritten with each
 * aggregate call as a scalar subquery over its dataset; a staged metric reads
 * its staged dataset's row for the period. The expected values come from the
 * GASP compiled SQL on the full test fixture, and the data scripts are the
 * fixture rows that reproduce them (scripts/ossie-conformance.ts writes both).
 */
import type { OntologyDataset, OntologyField } from "../types.js";
import { CONFORMANCE_PERIOD, sqlLiteral } from "./conformance.js";
import { aggregateSpans } from "./portability.js";
import { expressionText, readGaspExtension, type OssieExtension, type OssieSemanticModel } from "./types.js";

export const DEMO_PERIOD = CONFORMANCE_PERIOD;
export type Period = { start: string; end: string };

export interface DemoMetric {
  /** Ossie metric name */
  name: string;
  /** The metric's description from the model */
  description: string;
  /** GASP formula text */
  formula: string;
  kind: "direct" | "staged";
  /** A scalar query in parentheses: the metric's value for the period */
  query: string;
}

const dayAfter = (d: string): string => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

/** The query layer's period filter on one dataset's rows. */
export function periodFilter(meta: OntologyDataset, fields: Record<string, OntologyField>, period: Period = DEMO_PERIOD, column: string = meta.date): string {
  if (meta.kind === "snapshot") return `${column} = DATE '${period.end}'`;
  // A timestamp time dimension covers the whole last day, as the compiled templates do.
  const upper = fields[meta.date]?.type === "timestamp" ? `${column} < DATE '${dayAfter(period.end)}'` : `${column} <= DATE '${period.end}'`;
  return `${column} >= DATE '${period.start}' AND ${upper}`;
}

/** The physical side of a direct query: the reference model's `gasp.<dataset>` tables by canonical column unless given. */
export interface Physical {
  table: (dataset: string) => string;
  /** The column that carries the dataset's date field */
  date: (dataset: string) => string;
}

const DATASET_REF = /\b([a-z_][a-z0-9_]*)\.[a-z_][a-z0-9_]*\b/g;

/**
 * A direct expression as a scalar query: each aggregate call evaluated over its
 * dataset's rows for the period. The expression's dataset names are GASP
 * dataset ids (the reference model, or a model synthesised from a v1 adapter);
 * `physical` names the table and date column behind each.
 */
export function directQuery(expression: string, datasets: Record<string, OntologyDataset>, fields: Record<string, OntologyField>, period: Period = DEMO_PERIOD, physical?: Physical): string {
  let out = "";
  let at = 0;
  for (const span of aggregateSpans(expression)) {
    const call = expression.slice(span.start, span.end);
    const refs = [...new Set([...call.matchAll(DATASET_REF)].map((m) => m[1]).filter((d) => datasets[d]))];
    if (refs.length !== 1) throw new Error(`An aggregate must read one dataset, this one reads ${refs.length}: ${call}`);
    const ds = refs[0];
    // The call qualifies its columns by dataset name, so a physical table is aliased to it.
    const table = physical ? `${physical.table(ds)} AS ${ds}` : `gasp.${ds}`;
    out += `${expression.slice(at, span.start)}(SELECT ${call} FROM ${table} WHERE ${periodFilter(datasets[ds], fields, period, physical?.date(ds))})`;
    at = span.end;
  }
  out += expression.slice(at);
  return `(${out})`;
}

/** A staged metric as a scalar query: its staged dataset's row for the period. */
export function stagedQuery(source: string, period: Period = DEMO_PERIOD): string {
  return `(SELECT value FROM (${source}) AS s WHERE period_start = DATE '${period.start}')`;
}

const STAGED_READ = /^SUM\((gasp_staged_[a-z0-9_]+)\.value\)$/;

const extension = (x: { nonportable_extensions?: OssieExtension[] }): Record<string, unknown> => readGaspExtension(x.nonportable_extensions) ?? {};

/** One demo query per metric of the model, in model order. */
export function demoMetrics(model: OssieSemanticModel, datasets: Record<string, OntologyDataset>, fields: Record<string, OntologyField>, period: Period = DEMO_PERIOD): DemoMetric[] {
  const sources = new Map(model.datasets.map((d) => [d.name, d.source]));
  return (model.metrics ?? []).map((m) => {
    const expression = expressionText(m) ?? "";
    const ext = extension(m);
    const formula = String(ext.formula ?? "");
    const staged = STAGED_READ.exec(expression);
    if (staged) {
      const source = sources.get(staged[1]);
      if (!source) throw new Error(`${m.name} reads ${staged[1]}, which the model does not declare`);
      return { name: m.name, description: m.description ?? "", formula, kind: "staged", query: stagedQuery(source, period) };
    }
    return { name: m.name, description: m.description ?? "", formula, kind: "direct", query: directQuery(expression, datasets, fields, period) };
  });
}

/** demo/metrics.sql: one row per metric, value for the period. */
export function demoMetricsSql(metrics: DemoMetric[], period: Period = DEMO_PERIOD): string {
  const members = metrics.map((m) => [
    `  -- ${m.name} (${m.kind}): ${m.formula}`,
    `  SELECT '${m.name}' AS metric, ${m.query} AS value`,
  ].join("\n"));
  return [
    `-- Every metric of the GASP SaaS core example for the period ${period.start} to ${period.end}, over the tables in data.sql.`,
    "-- A direct metric is its OSSIE_SQL_2026 expression with each aggregate evaluated over its dataset's rows for the period",
    "-- (snapshot rows on the period end, event and fact rows dated in the period), as the query layer would. A staged",
    "-- metric reads its staged dataset's row for the period; the subquery is that dataset's source in the model.",
    "-- Standard SQL; runs on DuckDB and Postgres. expected.sql holds the values this returns.",
    "SELECT metric, value",
    "FROM (",
    members.join("\n  UNION ALL\n"),
    ") AS demo",
    "ORDER BY metric;",
    "",
  ].join("\n");
}

/** demo/expected.sql: the rows metrics.sql returns, as a VALUES list. */
export function demoExpectedSql(rows: Array<{ metric: string; value: unknown }>, period: Period = DEMO_PERIOD): string {
  const head = `-- Expected result of metrics.sql for the period ${period.start} to ${period.end}, as standard SQL over literals.\n-- A non-integer value is an approximate numeric literal; compare with a relative tolerance of 1e-9.\n`;
  const values = rows.map((r) => `('${r.metric}', ${r.value === null || r.value === undefined ? "CAST(NULL AS DECIMAL)" : sqlLiteral(r.value)})`);
  return `${head}SELECT *\nFROM (VALUES\n  ${values.join(",\n  ")}\n) AS expected (metric, value)\nORDER BY metric;\n`;
}
