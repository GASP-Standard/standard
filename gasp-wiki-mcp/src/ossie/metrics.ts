/**
 * GASP formula → Apache Ossie metric expression (OSSIE_SQL_2026).
 *
 * An Ossie metric is one aggregate expression over `dataset.field` references:
 * no SELECT, no WHERE, no subqueries and no reporting period. The query layer
 * filters each dataset's time field. So a GASP formula is emitted directly only
 * when its period semantics are exactly that filter:
 *
 *   - event and fact aggregates with no `at`, `to_date`, `lag`, `window` or
 *     `all_time`. An `in_period(x)` on the dataset's own date field is the
 *     query layer's filter and is dropped; any other period bound is not.
 *   - snapshot aggregates with no `at` or `at period_end`, on the convention
 *     that the query layer selects one snapshot date (the period end).
 *   - no `over cohort` anywhere, including inside referenced metrics.
 *
 * Filters become the aggregate filter clause the expression language requires
 * (`SUM(x) FILTER (WHERE w)`, SQL:2003 T612; since apache/ossie#382). A sum is
 * wrapped in COALESCE so a sum over no matching rows is 0, as it is in the
 * compiled SQL (compile.ts); avg, min, max and percentiles over no rows stay
 * NULL on both sides. Metric references are inlined, division
 * casts the numerator to DECIMAL and guards zero with NULLIF, and date
 * subtraction uses DATEDIFF (timestamps in seconds / 86400, so elapsed days
 * stay fractional as the grammar defines). Anything else is staged: model.ts
 * wraps the compiled SQL (compile.ts) in a per-period dataset.
 *
 * A multi-argument count_distinct (distinct tuples) needs a subquery, so it is
 * staged ("distinct pair"). An entry with a breakdown is emitted ungrouped; the
 * model marks it with `gasp_breakdown` so the consumer adds the dimension. One
 * that uses total() is staged ("total"): a share of total needs two populations.
 *
 * A formula over a cohort is staged ("cohort"). Where the cohort is the one a
 * cohort table holds (cohorts.ts) and every aggregate in the formula sits in a
 * fragment the table has a column for, the emission also carries the formula as
 * an expression over that table: each fragment a `SUM(<table>.<column>)`, the
 * arithmetic around them unchanged. model.ts writes that expression and the one
 * table in place of a staged dataset per metric. A breakdown of such a formula
 * by a field the cohort key's dataset carries (NRR by segment) is served too:
 * the compiler groups the cohort's members by it (compile.ts), so the table
 * carries the field as a column and the metric is the same expression, marked
 * with `gasp_breakdown`.
 *
 * The dataset an aggregate reads is chosen exactly as compile.ts chooses it:
 * the datasets every field in the aggregate shares, preferring one keyed by
 * one of those fields, else the first declared.
 *
 * With `dialect` set the same expression is written in a warehouse dialect
 * instead (the compile targets, src/targets/, ask for this; the Ossie model never
 * does): a filtered aggregate puts the filter inside it as `CASE WHEN w THEN x
 * END`, since only Postgres has the FILTER clause, and the date differences,
 * the numerator cast and percentiles come from the dialect table (dialect.ts).
 */
import { cohortGroupsBy } from "../compile.js";
import { DIALECT, type DialectName } from "../dialect.js";
import { parseFormula, type Form, type Formula, type Node, type Point } from "../formula.js";
import type { MetricFormula, OntologyDataset, OntologyField } from "../types.js";
import { ACCOUNT_COHORTS, cohortColumn, sameCohort, type CohortTableSpec } from "./cohorts.js";

export interface EmitContext {
  fields: Record<string, OntologyField>;
  datasets: Record<string, OntologyDataset>;
  formulas: Record<string, MetricFormula>;
  /** How a field reference is written: `<dataset>.<field>` in the reference model, the company's own names when compiling into their model */
  ref?: (dataset: string, field: string) => string;
  /** Write the expression in this warehouse dialect instead of OSSIE_SQL_2026 (compile targets only) */
  dialect?: DialectName;
}

/** Why a formula needs a staged dataset, highest priority first (the first that applies is reported). */
export const STAGED_REASONS = ["cohort", "lag", "window", "all_time", "distinct pair", "bucket", "total", "to_date", "at period_start", "period bound in filter", "period bound", "period_days"] as const;
export type StagedReason = (typeof STAGED_REASONS)[number];

export type Emission =
  | { kind: "direct"; expression: string; datasets: string[]; snapshots: string[] }
  | {
      kind: "staged";
      reason: StagedReason;
      reasons: StagedReason[];
      /** Set when a cohort table serves the entry: the dataset, the expression over it, the columns it reads and the member fields a breakdown groups by */
      table?: { dataset: string; expression: string; columns: string[]; dimensions: string[] };
    }
  | { kind: "notComputable"; reason: string };

interface Scope {
  point?: Point;
  toDate: boolean;
  dataset?: string;
  path: string[];
}

const TEMPORAL = new Set(["date", "timestamp"]);

/** The grammar text of a formula entry expression: main formula, a form (O, M), a named variant or a named breakdown (the main formula). */
export function formulaSource(f: MetricFormula, variant?: string): string | undefined {
  if (!variant) return f.formula;
  return (f.forms as Record<string, string> | undefined)?.[variant] ?? f.variants?.[variant] ?? (f.breakdowns?.[variant] !== undefined ? f.formula : undefined);
}

/**
 * The breakdown of an entry expression (a named breakdown, else the entry-level
 * one): its output column (the field id, or a bucketed breakdown's column) and
 * total mode. `buckets` is set for a bucketed breakdown.
 */
export function breakdownSpecOf(f: MetricFormula, variant?: string): { field: string; total: boolean; buckets?: string[] } | undefined {
  const named = variant && !(f.forms as Record<string, string> | undefined)?.[variant] && !f.variants?.[variant] ? f.breakdowns?.[variant] : undefined;
  const spec = named ?? f.breakdown;
  if (spec === undefined) return undefined;
  if (typeof spec === "string") return { field: spec.replace(/^field\./, ""), total: false };
  if ("expression" in spec) return { field: named !== undefined ? variant! : "bucket", total: spec.total === true, buckets: Object.keys(spec.buckets ?? {}) };
  return { field: spec.field.replace(/^field\./, ""), total: spec.total === true };
}

/** The breakdown field id of an entry expression: a named breakdown's field, else the entry-level breakdown. */
export function breakdownOf(f: MetricFormula, variant?: string): string | undefined {
  return breakdownSpecOf(f, variant)?.field;
}

/** The first notComputable reason reachable from a formula through metric refs, if any. */
function notComputableIn(src: string, ctx: EmitContext, seen = new Set<string>()): string | undefined {
  for (const ref of metricRefs(parseFormula(src).expr)) {
    if (seen.has(`${ref.id}.${ref.form ?? ""}`)) continue;
    seen.add(`${ref.id}.${ref.form ?? ""}`);
    const f = ctx.formulas[ref.id];
    if (!f) return `metric.${ref.id} has no formula entry`;
    if (f.notComputable) return `references metric.${ref.id}, which is not computable: ${f.notComputable}`;
    const inner = ref.form ? f.forms?.[ref.form] : f.formula;
    if (!inner) return `metric.${ref.id} declares no ${ref.form ?? "main"} formula`;
    const deeper = notComputableIn(inner, ctx, seen);
    if (deeper) return deeper;
  }
  return undefined;
}

function metricRefs(n: Node, out: Array<{ id: string; form?: Form }> = []): Array<{ id: string; form?: Form }> {
  if (n.kind === "metric") out.push({ id: n.id, form: n.form });
  for (const c of children(n)) metricRefs(c, out);
  return out;
}

function children(n: Node): Node[] {
  switch (n.kind) {
    case "binary": case "logic": case "compare": return [n.left, n.right];
    case "in": return [n.arg, ...n.values];
    case "scalar": return n.args;
    case "neg": case "lag": case "window": case "all_time": case "total": case "at": case "to_date": case "not": case "isnull": return [n.arg];
    case "agg": case "percentile": return [n.arg, ...(n.kind === "agg" ? n.more ?? [] : []), ...(n.where ? [n.where] : [])];
    default: return [];
  }
}

/**
 * Emit one formula entry expression of `id` (main formula, a form or a variant)
 * as an Ossie metric expression, or say why it is staged or not computable.
 */
export function emitMetric(id: string, ctx: EmitContext, variant?: string): Emission {
  const f = ctx.formulas[id];
  if (!f) throw new Error(`No formula for '${id}'`);
  if (f.notComputable && !variant) return { kind: "notComputable", reason: f.notComputable };
  const src = formulaSource(f, variant);
  if (!src) throw new Error(`'${id}' has no ${variant ?? "formula"}`);
  const nc = notComputableIn(src, ctx);
  if (nc) return { kind: "notComputable", reason: nc };
  const e = new Emitter(ctx);
  const expression = e.formula(parseFormula(src), { toDate: false, path: [id] });
  // A breakdown in total mode keeps some aggregates whole: two populations, like total().
  const bd = breakdownSpecOf(f, variant);
  if (bd?.total) e.reasons.add("total");
  // A bucketed breakdown groups by a CASE over a per-row expression: no Ossie dimension expresses it.
  if (bd?.buckets) e.reasons.add("bucket");
  if (e.reasons.size) {
    const reasons = STAGED_REASONS.filter((r) => e.reasons.has(r));
    // A plain field breakdown is a dimension of the cohort table when the compiler groups the members by it.
    const dimensions = bd && !bd.total && !bd.buckets ? [bd.field] : [];
    const table = !bd || dimensions.length ? overCohortTable(ACCOUNT_COHORTS, id, src, ctx, dimensions) : undefined;
    return { kind: "staged", reason: reasons[0], reasons, ...(table ? { table } : {}) };
  }
  return { kind: "direct", expression, datasets: [...e.datasets].sort(), snapshots: [...e.snapshots].sort() };
}

/**
 * The formula as an expression over a cohort table, when the table serves it:
 * the formula declares the table's cohort, every aggregate in it falls inside a
 * fragment that is one of the table's columns and nothing else in it needs
 * staging. The table has one row per member, so a breakdown is served only by
 * a field the member itself carries on the cohort's day (`dimensions`), which
 * is how compile.ts groups a breakdown under a cohort: the expression is the
 * ungrouped one and the consumer groups the rows by the table's column.
 */
function overCohortTable(t: CohortTableSpec, id: string, src: string, ctx: EmitContext, dimensions: string[] = []): { dataset: string; expression: string; columns: string[]; dimensions: string[] } | undefined {
  const f = parseFormula(src);
  if (!sameCohort(t, f.cohort)) return undefined;
  if (dimensions.some((d) => !cohortGroupsBy(t.cohort.key, d, ctx))) return undefined;
  const e = new Emitter(ctx, t);
  const expression = e.formula(f, { toDate: false, path: [id] });
  if (e.unserved || !e.used.size || [...e.reasons].some((r) => r !== "cohort")) return undefined;
  return { dataset: t.name, expression, columns: t.columns.map((c) => c.name).filter((c) => e.used.has(c)), dimensions };
}

/** A cohort table entry's expression in a warehouse dialect, or undefined when no cohort table serves the entry. */
export function cohortExpressionFor(id: string, ctx: EmitContext, dialect: DialectName, variant?: string): string | undefined {
  const e = emitMetric(id, { ...ctx, dialect }, variant);
  return e.kind === "staged" ? e.table?.expression : undefined;
}

/** A direct entry's expression in a warehouse dialect, or undefined when the entry is staged or not computable. */
export function directExpressionFor(id: string, ctx: EmitContext, dialect: DialectName, variant?: string): string | undefined {
  const e = emitMetric(id, { ...ctx, dialect }, variant);
  return e.kind === "direct" ? e.expression : undefined;
}

class Emitter {
  reasons = new Set<StagedReason>();
  datasets = new Set<string>();
  snapshots = new Set<string>();
  /** Table mode: the columns read so far, and whether an aggregate fell outside every column */
  used = new Set<string>();
  unserved = false;
  /** With `table`, a fragment that equals one of its columns is written as the sum of that column. */
  constructor(private ctx: EmitContext, private table?: CohortTableSpec) {}

  formula(f: Formula, scope: Scope): string {
    if (f.cohort) this.reasons.add("cohort");
    return this.expr(f.expr, scope);
  }

  private type(id: string): string | undefined {
    return this.ctx.fields[id]?.type;
  }

  private isTemporal(n: Node): boolean {
    return (n.kind === "field" && TEMPORAL.has(this.type(n.id) ?? "")) || n.kind === "period_bound";
  }

  private expr(n: Node, scope: Scope, inWhere = false): string {
    // A column holds its fragment as declared, so it stands in only where nothing outside has moved the period.
    if (this.table && !scope.dataset && !scope.point && !scope.toDate) {
      const column = cohortColumn(this.table, n);
      if (column) {
        this.used.add(column);
        return `SUM(${this.table.name}.${column})`;
      }
    }
    switch (n.kind) {
      case "number": return String(n.value);
      case "string": return `'${n.value.replace(/'/g, "''")}'`;
      case "boolean": return n.value ? "TRUE" : "FALSE";
      case "field":
        if (!scope.dataset) throw new Error(`field.${n.id} outside an aggregate`);
        return this.ctx.ref ? this.ctx.ref(scope.dataset, n.id) : `${scope.dataset}.${n.id}`;
      case "period_bound":
        this.reasons.add(inWhere ? "period bound in filter" : "period bound");
        return n.point.toUpperCase();
      case "period_days":
        this.reasons.add("period_days");
        return "PERIOD_DAYS";
      case "metric": return this.metric(n.id, scope, n.form);
      case "neg": return `(-${this.expr(n.arg, scope, inWhere)})`;
      case "binary": {
        const l = this.expr(n.left, scope, inWhere);
        const r = this.expr(n.right, scope, inWhere);
        if (n.op === "-" && this.isTemporal(n.left) && this.isTemporal(n.right)) {
          // DATEDIFF(part, start, end) is end - start. Elapsed days, fractional for timestamps.
          const ts = [n.left, n.right].some((x) => x.kind === "field" && this.type(x.id) === "timestamp");
          const d = this.ctx.dialect ? DIALECT[this.ctx.dialect] : undefined;
          if (d) return ts ? `(${d.secondsBetween(l, r)} / 86400.0)` : d.daysBetween(l, r);
          return ts ? `(DATEDIFF(second, ${r}, ${l}) / 86400.0)` : `DATEDIFF(day, ${r}, ${l})`;
        }
        // Cast the numerator so COUNT / COUNT is not integer division; guard a zero denominator.
        if (n.op === "/") {
          const num = this.ctx.dialect ? DIALECT[this.ctx.dialect].toDouble(l) : `CAST(${l} AS DECIMAL)`;
          return n.right.kind === "number" ? `(${num} / ${r})` : `(${num} / NULLIF(${r}, 0))`;
        }
        return `(${l} ${n.op} ${r})`;
      }
      case "scalar": {
        const fn = { min: "LEAST", max: "GREATEST", abs: "ABS", coalesce: "COALESCE" }[n.fn];
        return `${fn}(${n.args.map((a) => this.expr(a, scope, inWhere)).join(", ")})`;
      }
      case "compare": return `${this.expr(n.left, scope, inWhere)} ${n.op === "!=" ? "<>" : n.op} ${this.expr(n.right, scope, inWhere)}`;
      case "in": return `${this.expr(n.arg, scope, inWhere)} ${n.negated ? "NOT IN" : "IN"} (${n.values.map((v) => this.expr(v, scope, inWhere)).join(", ")})`;
      case "isnull": return `${this.expr(n.arg, scope, inWhere)} IS ${n.negated ? "NOT " : ""}NULL`;
      case "logic": return `(${this.expr(n.left, scope, inWhere)} ${n.op.toUpperCase()} ${this.expr(n.right, scope, inWhere)})`;
      case "not": return `NOT (${this.expr(n.arg, scope, inWhere)})`;
      case "at": return this.expr(n.arg, { ...scope, point: scope.point ?? n.point }, inWhere); // outer at wins
      case "to_date": return this.expr(n.arg, { ...scope, toDate: true }, inWhere);
      case "lag": this.reasons.add("lag"); return this.expr(n.arg, scope, inWhere);
      case "window": this.reasons.add("window"); return this.expr(n.arg, scope, inWhere);
      case "all_time": this.reasons.add("all_time"); return this.expr(n.arg, scope, inWhere);
      case "total": this.reasons.add("total"); return this.expr(n.arg, scope, inWhere);
      case "agg": case "percentile": return this.aggregate(n, scope);
    }
  }

  /** Inline a referenced metric's main formula or named form. */
  private metric(id: string, scope: Scope, form?: Form): string {
    if (scope.path.includes(id)) throw new Error(`Cycle: ${[...scope.path, id].join(" -> ")}`);
    const f = this.ctx.formulas[id];
    const src = form ? f?.forms?.[form] : f?.formula;
    if (!src) throw new Error(`metric.${id} has no ${form ?? "main"} formula`);
    return `(${this.formula(parseFormula(src), { ...scope, path: [...scope.path, id] })})`;
  }

  private fieldsIn(n: Node, out = new Set<string>()): Set<string> {
    if (n.kind === "field") out.add(n.id);
    for (const c of children(n)) this.fieldsIn(c, out);
    return out;
  }

  /** Same rule as compile.ts so the Ossie metric and the SQL template read the same table. */
  private datasetFor(fieldIds: string[]): string {
    const sets = fieldIds.map((id) => {
      const f = this.ctx.fields[id];
      if (!f) throw new Error(`Unknown field '${id}'`);
      return f.datasets ?? [];
    });
    const shared = sets.reduce((a, b) => a.filter((x) => b.includes(x)));
    if (shared.length === 0) throw new Error(`Fields share no dataset: ${fieldIds.join(", ")}`);
    return shared.find((d) => fieldIds.includes(this.ctx.datasets[d]?.key)) ?? shared[0];
  }

  /** True for the parsed form of `in_period(field.<date>)`: date >= period_start and date <= period_end. */
  private isInPeriodOn(n: Node, date: string): boolean {
    if (n.kind !== "logic" || n.op !== "and") return false;
    const { left: l, right: r } = n;
    return l.kind === "compare" && l.op === ">=" && l.left.kind === "field" && l.left.id === date && l.right.kind === "period_bound" && l.right.point === "period_start"
      && r.kind === "compare" && r.op === "<=" && r.left.kind === "field" && r.left.id === date && r.right.kind === "period_bound" && r.right.point === "period_end";
  }

  /** Drop `in_period(<date>)` conjuncts; the query layer's time filter already does that. */
  private dropInPeriod(n: Node | undefined, date: string): Node | undefined {
    if (!n) return undefined;
    if (this.isInPeriodOn(n, date)) return undefined;
    if (n.kind === "logic" && n.op === "and") {
      const left = this.dropInPeriod(n.left, date);
      const right = this.dropInPeriod(n.right, date);
      if (!left) return right;
      if (!right) return left;
      return { ...n, left, right };
    }
    return n;
  }

  private aggregate(n: Extract<Node, { kind: "agg" | "percentile" }>, scope: Scope): string {
    if (this.table) this.unserved = true; // an aggregate no column holds
    const ds = this.datasetFor([...this.fieldsIn(n)]);
    const meta = this.ctx.datasets[ds];
    if (!meta) throw new Error(`Unknown dataset '${ds}'`);
    this.datasets.add(ds);
    if (meta.kind === "snapshot") {
      if (scope.point === "period_start") this.reasons.add("at period_start");
      this.snapshots.add(ds);
    } else {
      if (scope.point === "period_start") this.reasons.add("at period_start");
      else if (scope.point || scope.toDate) this.reasons.add("to_date"); // an event `at` reads everything up to the point
    }
    const s: Scope = { ...scope, dataset: ds };
    const where = meta.kind === "snapshot" ? n.where : this.dropInPeriod(n.where, meta.date);
    if (n.kind === "agg" && n.more?.length) {
      this.reasons.add("distinct pair");
      n.more.forEach((m) => this.expr(m, s));
    }
    const arg = this.expr(n.arg, s);
    const w = where ? this.expr(where, s, true) : undefined;
    if (this.ctx.dialect) {
      // The filter moves inside the aggregate: a row that fails it contributes NULL, which every aggregate skips.
      const d = DIALECT[this.ctx.dialect];
      const x = w ? `CASE WHEN ${w} THEN ${arg} END` : arg;
      if (n.kind === "percentile") return d.percentile(n.p, x);
      if (n.fn === "median") return d.percentile(0.5, x);
      if (n.fn === "count_distinct") return `COUNT(DISTINCT ${x})`;
      if (n.fn === "sum") return `COALESCE(SUM(${x}), 0)`;
      return `${n.fn.toUpperCase()}(${x})`;
    }
    const filter = w ? ` FILTER (WHERE ${w})` : "";
    if (n.kind === "percentile") return `PERCENTILE_CONT(${n.p}) WITHIN GROUP (ORDER BY ${arg})${filter}`;
    if (n.fn === "count_distinct") return `COUNT(DISTINCT ${arg})${filter}`;
    if (n.fn === "sum") return `COALESCE(SUM(${arg})${filter}, 0)`; // a sum over no matching rows is 0, as in the compiled SQL
    return `${n.fn.toUpperCase()}(${arg})${filter}`;
  }
}
