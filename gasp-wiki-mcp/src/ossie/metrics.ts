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
 * Filters become conditional aggregates (`SUM(CASE WHEN w THEN x ELSE 0 END)`,
 * `COUNT(CASE WHEN w THEN x END)`), metric references are inlined, division
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
 * The dataset an aggregate reads is chosen exactly as compile.ts chooses it:
 * the datasets every field in the aggregate shares, preferring one keyed by
 * one of those fields, else the first declared.
 */
import { parseFormula, type Form, type Formula, type Node, type Point } from "../formula.js";
import type { MetricFormula, OntologyDataset, OntologyField } from "../types.js";

export interface EmitContext {
  fields: Record<string, OntologyField>;
  datasets: Record<string, OntologyDataset>;
  formulas: Record<string, MetricFormula>;
}

/** Why a formula needs a staged dataset, highest priority first (the first that applies is reported). */
export const STAGED_REASONS = ["cohort", "lag", "window", "all_time", "distinct pair", "total", "to_date", "at period_start", "period bound in filter", "period bound", "period_days"] as const;
export type StagedReason = (typeof STAGED_REASONS)[number];

export type Emission =
  | { kind: "direct"; expression: string; datasets: string[]; snapshots: string[] }
  | { kind: "staged"; reason: StagedReason; reasons: StagedReason[] }
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

/** The breakdown field id of an entry expression: a named breakdown's field, else the entry-level breakdown. */
export function breakdownOf(f: MetricFormula, variant?: string): string | undefined {
  const named = variant && !(f.forms as Record<string, string> | undefined)?.[variant] && !f.variants?.[variant] ? f.breakdowns?.[variant] : undefined;
  return (named ?? f.breakdown)?.replace(/^field\./, "");
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
  if (e.reasons.size) {
    const reasons = STAGED_REASONS.filter((r) => e.reasons.has(r));
    return { kind: "staged", reason: reasons[0], reasons };
  }
  return { kind: "direct", expression, datasets: [...e.datasets].sort(), snapshots: [...e.snapshots].sort() };
}

class Emitter {
  reasons = new Set<StagedReason>();
  datasets = new Set<string>();
  snapshots = new Set<string>();
  constructor(private ctx: EmitContext) {}

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
    switch (n.kind) {
      case "number": return String(n.value);
      case "string": return `'${n.value.replace(/'/g, "''")}'`;
      case "boolean": return n.value ? "TRUE" : "FALSE";
      case "field":
        if (!scope.dataset) throw new Error(`field.${n.id} outside an aggregate`);
        return `${scope.dataset}.${n.id}`;
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
          return ts ? `(DATEDIFF(second, ${r}, ${l}) / 86400.0)` : `DATEDIFF(day, ${r}, ${l})`;
        }
        // Cast the numerator so COUNT / COUNT is not integer division; guard a zero denominator.
        if (n.op === "/") return n.right.kind === "number" ? `(CAST(${l} AS DECIMAL) / ${r})` : `(CAST(${l} AS DECIMAL) / NULLIF(${r}, 0))`;
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
    const filtered = (orElse: string) => (w ? `CASE WHEN ${w} THEN ${arg}${orElse} END` : arg);
    if (n.kind === "percentile") return `PERCENTILE_CONT(${n.p}) WITHIN GROUP (ORDER BY ${filtered("")})`;
    switch (n.fn) {
      case "sum": return `SUM(${filtered(" ELSE 0")})`;
      case "count_distinct": return `COUNT(DISTINCT ${filtered("")})`;
      default: return `${n.fn.toUpperCase()}(${filtered("")})`;
    }
  }
}
