/**
 * Portability profile of a direct Ossie metric expression.
 *
 * Upstream `compliance/portability/` (apache/ossie#596) is a ladder of fixtures,
 * M0 to M3, that a converter round-trips and a grader scores. It measures
 * converters, not models. The profile turns it round for an adopter: each direct
 * GASP expression is tagged with the highest published rung whose construct it
 * uses, so a converter's graded rung says which share of GASP survives it.
 *
 *   M0  one dataset, one field, one bare SUM
 *   M1  a scalar field expression (a field construct; a metric never sits here)
 *   M2  the core aggregate set: SUM, COUNT, COUNT DISTINCT, AVG, MIN, MAX
 *   M3  a filtered aggregate
 *
 * Rungs M4 to M8 (relationships and cross-dataset metrics, metric composition,
 * date and time scalars, window and offset functions) are announced but held
 * upstream pending #354, #591 and #587. `constructs` names the things an
 * expression uses that the published rungs do not measure, in the ladder's
 * words where it has them, so the held rungs can be mapped onto GASP the day
 * they land. Window and offset functions never appear: every formula that
 * needs one is staged (metrics.ts).
 *
 * One mismatch to know: GASP writes a filtered aggregate as
 * `SUM(x) FILTER (WHERE w)`, the form `expression_language.md` requires since
 * apache/ossie#382, while the M3 fixture is written `SUM(CASE WHEN w THEN x
 * ELSE 0 END)`. Both count as M3 here. A converter graded M3 on the fixture may
 * still lack the FILTER clause; the profile says how much that would cost.
 */
import type { MetricCoverage } from "./types.js";

export const RUNGS = ["M0", "M2", "M3"] as const;
export type Rung = (typeof RUNGS)[number];

export const CONSTRUCTS = [
  "filtered aggregate", // M3's construct, in either form
  "count distinct", // in M2's set, listed because many converters treat it apart from COUNT
  "arithmetic over aggregates", // a ratio or scale of aggregates in one expression (M5 after inlining)
  "cross-dataset", // fields of two or more datasets in one expression (M4)
  "date scalar", // DATEDIFF, DATE_TRUNC, EXTRACT, DATE_PART (M6)
  "percentile", // MEDIAN or PERCENTILE_CONT, outside the core aggregate set
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
const DATE_SCALAR = /\b(DATEDIFF|DATE_TRUNC|EXTRACT|DATE_PART)\s*\(|\bCURRENT_DATE\b|\bINTERVAL\b/;
const CASE_FILTER = /\b(SUM|COUNT|AVG|MIN|MAX)\s*\(\s*CASE\s+WHEN\b/;

/** The span of every aggregate call in an expression, its FILTER clause included: [start, end) offsets. */
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
    // a FILTER clause belongs to the call
    const f = /^\s*FILTER\s*\(/.exec(expr.slice(j + 1));
    if (f) {
      let d = 0;
      let k = j + f[0].length;
      for (; k < expr.length; k++) {
        if (expr[k] === "(") d++;
        else if (expr[k] === ")" && --d === 0) break;
      }
      j = k;
    }
    spans.push({ start: m.index, end: j + 1 });
    i = j + 1;
  }
  return spans;
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
  const rung: Rung = constructs.has("filtered aggregate") ? "M3"
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
    description: "Direct entries by the highest rung of the upstream portability ladder (compliance/portability, M0 to M3) whose construct they use, and the constructs the published rungs do not measure yet. A filtered aggregate is written FILTER (WHERE ...) as the expression language requires; the M3 fixture uses the CASE WHEN form.",
    rungs,
    constructs,
  };
}
