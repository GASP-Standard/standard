/**
 * Portability profile of a direct Ossie metric expression.
 *
 * Upstream `compliance/portability/` (apache/ossie#596, extended to M8 since) is
 * a ladder of fixtures, M0 to M8, that a converter round-trips and a grader
 * scores. It measures converters, not models. The profile turns it round for an
 * adopter: each direct GASP expression is tagged with the highest rung whose
 * construct it uses, so a converter's graded rung says which share of GASP
 * survives it.
 *
 *   M0  one dataset, one field, one bare SUM
 *   M1  a scalar field expression (a field construct; a metric never sits here)
 *   M2  the core aggregate set: SUM, COUNT, COUNT DISTINCT, AVG, MIN, MAX
 *   M3  a filtered aggregate, as SUM(CASE WHEN ... THEN x END) and with FILTER (WHERE ...)
 *   M4  a cross-dataset metric: fields of two or more datasets in one expression
 *   M5  metric composition, carried with the expressions inlined: arithmetic over aggregates
 *   M6  date and time scalars: YEAR, DATE_TRUNC, DATEDIFF
 *   M7  window functions with an ORDER BY: LAG, a running SUM, RANK
 *   M8  ratio to total: x / SUM(x) OVER () and OVER (PARTITION BY ...)
 *
 * A GASP formula that references another metric is exported with that metric's
 * expression inlined, which is the form M5 carries, so ARR (`metric.mrr * 12`)
 * and a ratio of two aggregates both sit on M5. No direct entry rests on M4:
 * each GASP aggregate reads one dataset, so an expression across two datasets
 * combines an aggregate from each and is M5 or above, with `cross-dataset`
 * among its constructs. No direct entry reaches M7 or M8 either: every formula
 * that needs a window or an offset is staged (metrics.ts).
 * The profiler still reads both, so the upstream fixtures classify to their
 * own rungs.
 *
 * The rungs are read as a ladder: an entry on M5 may also read two datasets
 * (M4) and filter an aggregate (M3). `constructs` names each thing an
 * expression uses, in the ladder's words where it has them, including three no
 * rung states: a count of distinct values taken apart from COUNT, a percentile
 * and the null guard. Every GASP sum is `COALESCE(SUM(...), 0)` (a sum over no
 * matching rows is 0, as the compiled SQL returns), a scalar over an aggregate
 * that no rung states; it is the `null guard` construct, and no GASP
 * expression is a bare M0 sum.
 *
 * GASP writes a filtered aggregate as `SUM(x) FILTER (WHERE w)`, the form
 * `expression_language.md` requires since apache/ossie#382. M3 carries that
 * form beside the `CASE WHEN` one, so a converter graded on both keeps it.
 */
import type { MetricCoverage } from "./types.js";

export const RUNGS = ["M0", "M2", "M3", "M4", "M5", "M6", "M7", "M8"] as const;
export type Rung = (typeof RUNGS)[number];

export const CONSTRUCTS = [
  "filtered aggregate", // M3's construct, in either form
  "count distinct", // in M2's set, listed because many converters treat it apart from COUNT
  "arithmetic over aggregates", // a ratio or scale of aggregates in one expression: M5, metric composition after inlining
  "cross-dataset", // fields of two or more datasets in one expression: M4
  "date scalar", // DATEDIFF, DATE_TRUNC, EXTRACT, DATE_PART, YEAR and the like: M6
  "percentile", // MEDIAN or PERCENTILE_CONT, outside the core aggregate set
  "null guard", // COALESCE over an aggregate: every GASP sum is COALESCE(SUM(...), 0), so a sum over no rows is 0
] as const;
export type Construct = (typeof CONSTRUCTS)[number];

export interface Profile {
  rung: Rung;
  constructs: Construct[];
}

const AGGREGATE_SOURCE = String.raw`\b(SUM|COUNT|AVG|MIN|MAX|MEDIAN|PERCENTILE_CONT)\s*\(`;
/** A fresh regex each time: a shared global regex carries its lastIndex between calls. */
const aggregateRegex = () => new RegExp(AGGREGATE_SOURCE, "g");
const CORE = new Set(["SUM", "COUNT", "AVG", "MIN", "MAX"]);
const DATE_SCALAR = /\b(DATEDIFF|DATE_TRUNC|EXTRACT|DATE_PART|YEAR|QUARTER|MONTH|WEEK|DAY)\s*\(|\bCURRENT_DATE\b|\bINTERVAL\b/;
const CASE_FILTER = /\b(SUM|COUNT|AVG|MIN|MAX)\s*\(\s*CASE\s+WHEN\b/;

/** The end of a parenthesised clause that follows offset j when `head` matches there, else j. */
function clauseEnd(expr: string, j: number, head: RegExp): number {
  const h = head.exec(expr.slice(j + 1));
  if (!h) return j;
  let d = 0;
  let k = j + h[0].length;
  for (; k < expr.length; k++) {
    if (expr[k] === "(") d++;
    else if (expr[k] === ")" && --d === 0) break;
  }
  return k;
}

/** The span of every aggregate call in an expression, its WITHIN GROUP and FILTER clauses included: [start, end) offsets. */
export function aggregateSpans(expr: string): Array<{ start: number; end: number }> {
  const re = aggregateRegex();
  const spans: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < expr.length) {
    re.lastIndex = i;
    const m = re.exec(expr);
    if (!m) break;
    // the matching close paren of the call
    let depth = 0;
    let j = m.index + m[0].length - 1;
    for (; j < expr.length; j++) {
      if (expr[j] === "(") depth++;
      else if (expr[j] === ")" && --depth === 0) break;
    }
    // An ordered-set aggregate's WITHIN GROUP clause and a FILTER clause belong to the call.
    j = clauseEnd(expr, j, /^\s*WITHIN\s+GROUP\s*\(/);
    j = clauseEnd(expr, j, /^\s*FILTER\s*\(/);
    spans.push({ start: m.index, end: j + 1 });
    i = j + 1;
  }
  return spans;
}

/** The text inside each OVER (...) clause of an expression. */
function overClauses(expr: string): string[] {
  const out: string[] = [];
  for (const m of expr.matchAll(/\bOVER\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    out.push(expr.slice(open + 1, clauseEnd(expr, open - 1, /^\(/)));
  }
  return out;
}

/** The expression with every aggregate call removed, so what is left is the arithmetic around them. */
function outsideAggregates(expr: string): string {
  let out = "";
  let at = 0;
  for (const s of aggregateSpans(expr)) {
    out += expr.slice(at, s.start);
    at = s.end;
  }
  return out + expr.slice(at);
}

/** Classify one direct metric expression (OSSIE_SQL_2026, as metrics.ts emits it). */
export function profileExpression(expr: string): Profile {
  const aggregates = [...expr.matchAll(aggregateRegex())].map((m) => m[1]);
  const constructs = new Set<Construct>();
  if (/\bFILTER\s*\(\s*WHERE\b/.test(expr) || CASE_FILTER.test(expr)) constructs.add("filtered aggregate");
  if (/\bCOUNT\s*\(\s*DISTINCT\b/.test(expr)) constructs.add("count distinct");
  if (/[-+*/]/.test(outsideAggregates(expr).replace(/\b\d+(\.\d+)?\b/g, ""))) constructs.add("arithmetic over aggregates");
  const datasets = new Set([...expr.matchAll(/\b([a-z_][a-z0-9_]*)\.[a-z_][a-z0-9_]*\b/g)].map((m) => m[1]));
  if (datasets.size > 1) constructs.add("cross-dataset");
  if (DATE_SCALAR.test(expr)) constructs.add("date scalar");
  if (aggregates.some((a) => !CORE.has(a))) constructs.add("percentile");
  if (/\bCOALESCE\s*\(/.test(outsideAggregates(expr))) constructs.add("null guard");
  // The highest rung whose construct the expression uses. A window is read from its OVER clause:
  // with an ORDER BY it is M7, without one (the whole set or a partition) the ratio-to-total rung, M8.
  const windows = overClauses(expr);
  const rung: Rung = windows.some((w) => !/\bORDER\s+BY\b/.test(w)) ? "M8"
    : windows.length ? "M7"
    : constructs.has("date scalar") ? "M6"
    : constructs.has("arithmetic over aggregates") ? "M5"
    : constructs.has("cross-dataset") ? "M4"
    : constructs.has("filtered aggregate") ? "M3"
    : aggregates.length === 1 && aggregates[0] === "SUM" && constructs.size === 0 ? "M0"
    : "M2";
  return { rung, constructs: CONSTRUCTS.filter((c) => constructs.has(c)) };
}

export interface PortabilitySummary {
  description: string;
  rungs: Record<Rung, number>;
  constructs: Record<Construct, number>;
}

/** Counts over the direct entries of a coverage map, for coverage.json. */
export function summarisePortability(coverage: Record<string, MetricCoverage>): PortabilitySummary {
  const rungs = Object.fromEntries(RUNGS.map((r) => [r, 0])) as Record<Rung, number>;
  const constructs = Object.fromEntries(CONSTRUCTS.map((c) => [c, 0])) as Record<Construct, number>;
  for (const c of Object.values(coverage)) {
    if (c.kind !== "direct") continue;
    rungs[c.rung]++;
    for (const k of c.constructs as Construct[]) constructs[k]++;
  }
  return {
    description: "Direct entries by the highest rung of the upstream portability ladder (compliance/portability, M0 to M8) whose construct they use, and each construct counted per entry. An entry on a rung may use the constructs of the rungs below it: M4 is a cross-dataset metric, M5 arithmetic over aggregates (metric composition with the expressions inlined), M6 a date scalar. Each GASP aggregate reads one dataset, so a cross-dataset entry combines two aggregates and sits on M5 or above, which leaves M4 at 0. M7 and M8 are window functions, which GASP stages, so both are 0. A filtered aggregate is written FILTER (WHERE ...), the form the expression language requires and M3 carries. Every sum is COALESCE(SUM(...), 0), the null guard construct, so no entry is a bare M0 sum.",
    rungs,
    constructs,
  };
}
