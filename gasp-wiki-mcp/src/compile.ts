/**
 * Compiles GASP formulas (src/formula.ts) to parameterised ANSI SQL.
 *
 * Every aggregate becomes a scalar subquery over one dataset, so metrics that
 * combine several datasets need no joins: each aggregate is a number per
 * period. Placeholders:
 *   {{<field>@<dataset>}}  a canonical field on the logical table it is read
 *                          from; the adapter maps the pair to a column. The tag
 *                          is what lets a filler resolve a field that lives on
 *                          several datasets (snapshot_date, customer_id) without
 *                          parsing the SQL; exampleSql() strips it for display
 *   {{_table:<dataset>}}   the warehouse table behind a dataset
 *   {{_period_start}}, {{_period_end}}   reporting period bounds (dates)
 *
 * Period semantics by dataset kind: event and fact rows are filtered to the
 * period by the dataset's date field; snapshot rows are taken as of the period
 * end, or the point named by `at`. `to_date` widens an event or fact filter to
 * everything up to the period end. `window` replaces it with the n units ending
 * at the period end. `all_time` drops it. `lag` shifts both bounds. `over cohort`
 * restricts every aggregate to keys present in the key's dataset at the point.
 * Intervals are emitted in units Postgres accepts (a quarter is 3 months).
 */
import { parseFormula, type Formula, type Form, type Node, type Point, type LagUnit } from "./formula.js";
import type { MetricFormula, OntologyDataset, OntologyField } from "./types.js";

export interface CompileContext {
  fields: Record<string, OntologyField>;
  datasets: Record<string, OntologyDataset>;
  formulas: Record<string, MetricFormula>;
}

export interface Compiled {
  /** Scalar SELECT with placeholders */
  sql: string;
  /** Every field the SQL reads, including through metric refs */
  fields: string[];
  /** Every (field, dataset) pair the SQL reads, as "field@dataset" */
  placeholders: string[];
  datasets: string[];
  metricRefs: string[];
  /** Uses cohort or lag, so it cannot run as one Ossie aggregate */
  staged: boolean;
}

export class CompileError extends Error {}

interface Scope {
  point?: Point;
  toDate: boolean;
  /** Trailing window replacing the period filter (window()) */
  window?: { n: number; unit: LagUnit };
  /** No period filter at all (all_time()) */
  allTime?: boolean;
  shift: Array<{ n: number; unit: LagUnit }>;
  cohort?: { key: string; point: Point };
  /** The dataset of the enclosing aggregate; tags every field placeholder */
  dataset?: string;
  /** metric ids on the current path, to catch cycles */
  path: string[];
}

const TEMPORAL = new Set(["date", "timestamp"]);

/** An interval literal in units Postgres, Redshift and Snowflake accept. */
export function interval(n: number, unit: LagUnit): string {
  return unit === "quarter" ? `INTERVAL '${n * 3} month'` : `INTERVAL '${n} ${unit}'`;
}

export function compileMetric(id: string, ctx: CompileContext, variant?: string): Compiled {
  const f = ctx.formulas[id];
  if (!f) throw new CompileError(`No formula for '${id}'`);
  const src = variant ? (f.forms as any)?.[variant] ?? f.variants?.[variant] : f.formula;
  if (!src) throw new CompileError(f.notComputable ? `'${id}' is not computable: ${f.notComputable}` : `'${id}' has no ${variant ?? "formula"}`);
  const c = new Compiler(ctx);
  const body = c.formula(parseFormula(src), { toDate: false, shift: [], path: [id] });
  return {
    sql: `SELECT ${body} AS ${id.replace(/[^a-z0-9_]/gi, "_")}`,
    fields: [...c.fields].sort(),
    placeholders: [...c.placeholders].sort(),
    datasets: [...c.datasets].sort(),
    metricRefs: [...c.metricRefs].sort(),
    staged: c.staged,
  };
}

/** Replace placeholders with plain names, for documentation examples. */
export function exampleSql(sql: string): string {
  return sql
    .replace(/\{\{_table:(\w+)\}\}/g, "$1")
    .replace(/\{\{_period_start\}\}/g, ":period_start")
    .replace(/\{\{_period_end\}\}/g, ":period_end")
    .replace(/\{\{(\w+)@\w+\}\}/g, "$1");
}

/** Strip the dataset tag from a field placeholder: "{{mrr@subscription}}" -> "{{mrr}}". */
export function untagged(sql: string): string {
  return sql.replace(/\{\{(\w+)@\w+\}\}/g, "{{$1}}");
}

class Compiler {
  fields = new Set<string>();
  placeholders = new Set<string>();
  datasets = new Set<string>();
  metricRefs = new Set<string>();
  staged = false;
  constructor(private ctx: CompileContext) {}

  formula(f: Formula, scope: Scope): string {
    const s: Scope = f.cohort ? { ...scope, cohort: scope.cohort ?? f.cohort } : scope;
    if (f.cohort) { this.staged = true; this.fields.add(f.cohort.key); }
    return this.expr(f.expr, s);
  }

  private bound(point: Point, scope: Scope): string {
    let b = `{{_period_${point === "period_start" ? "start" : "end"}}}`;
    for (const sh of scope.shift) b = `(${b} - ${interval(sh.n, sh.unit)})`;
    return b;
  }

  /** A tagged field placeholder on the given dataset. */
  private ph(field: string, ds: string): string {
    this.fields.add(field);
    this.placeholders.add(`${field}@${ds}`);
    return `{{${field}@${ds}}}`;
  }

  private type(id: string): string | undefined {
    return this.ctx.fields[id]?.type;
  }

  private isTemporal(n: Node): boolean {
    if (n.kind === "field") return TEMPORAL.has(this.type(n.id) ?? "");
    if (n.kind === "period_bound") return true;
    return false;
  }

  private expr(n: Node, scope: Scope): string {
    switch (n.kind) {
      case "number": return String(n.value);
      case "string": return `'${n.value.replace(/'/g, "''")}'`;
      case "boolean": return n.value ? "TRUE" : "FALSE";
      case "field":
        if (!scope.dataset) throw new CompileError(`field.${n.id} outside an aggregate`);
        return this.ph(n.id, scope.dataset);
      case "period_bound": return this.bound(n.point, scope);
      case "period_days": return `(${this.bound("period_end", scope)} - ${this.bound("period_start", scope)} + 1)`;
      case "metric": return this.metric(n.id, scope, n.form);
      case "neg": return `(-${this.expr(n.arg, scope)})`;
      case "binary": {
        const l = this.expr(n.left, scope);
        const r = this.expr(n.right, scope);
        if (n.op === "-" && this.isTemporal(n.left) && this.isTemporal(n.right)) {
          const ts = [n.left, n.right].some((x) => x.kind === "field" && this.type(x.id) === "timestamp");
          return ts ? `(EXTRACT(EPOCH FROM (${l} - ${r})) / 86400.0)` : `(${l} - ${r})`;
        }
        // Cast the numerator so COUNT / COUNT is not integer division (Postgres, Redshift, SQL Server).
        if (n.op === "/") return n.right.kind === "number" ? `(CAST(${l} AS DOUBLE PRECISION) / ${r})` : `(CAST(${l} AS DOUBLE PRECISION) / NULLIF(${r}, 0))`;
        return `(${l} ${n.op} ${r})`;
      }
      case "scalar": {
        const fn = { min: "LEAST", max: "GREATEST", abs: "ABS", coalesce: "COALESCE" }[n.fn];
        return `${fn}(${n.args.map((a) => this.expr(a, scope)).join(", ")})`;
      }
      case "compare": return `${this.expr(n.left, scope)} ${n.op === "!=" ? "<>" : n.op} ${this.expr(n.right, scope)}`;
      case "in": return `${this.expr(n.arg, scope)} ${n.negated ? "NOT IN" : "IN"} (${n.values.map((v) => this.expr(v, scope)).join(", ")})`;
      case "isnull": return `${this.expr(n.arg, scope)} IS ${n.negated ? "NOT " : ""}NULL`;
      case "logic": return `(${this.expr(n.left, scope)} ${n.op.toUpperCase()} ${this.expr(n.right, scope)})`;
      case "not": return `NOT (${this.expr(n.arg, scope)})`;
      case "at": return this.expr(n.arg, { ...scope, point: scope.point ?? n.point }); // outer at wins
      case "to_date": return this.expr(n.arg, { ...scope, toDate: true });
      case "lag": this.staged = true; return this.expr(n.arg, { ...scope, shift: [...scope.shift, { n: n.n, unit: n.unit }] });
      case "window": return this.expr(n.arg, { ...scope, window: scope.window ?? { n: n.n, unit: n.unit } }); // outer window wins
      case "all_time": return this.expr(n.arg, { ...scope, allTime: true });
      case "agg": case "percentile": return this.aggregate(n, scope);
    }
  }

  /** A metric ref compiles its main formula, or the named form (metric.<id>.O). Cycles key on the id. */
  private metric(id: string, scope: Scope, form?: Form): string {
    if (scope.path.includes(id)) throw new CompileError(`Cycle: ${[...scope.path, id].join(" -> ")}`);
    const f = this.ctx.formulas[id];
    if (!f?.formula) throw new CompileError(`metric.${id} has no formula`);
    const src = form ? f.forms?.[form] : f.formula;
    if (!src) throw new CompileError(`metric.${id} declares no ${form} form`);
    this.metricRefs.add(id);
    const inner = new Compiler(this.ctx);
    const body = inner.formula(parseFormula(src), { ...scope, path: [...scope.path, id] });
    inner.fields.forEach((x) => this.fields.add(x));
    inner.placeholders.forEach((x) => this.placeholders.add(x));
    inner.datasets.forEach((x) => this.datasets.add(x));
    inner.metricRefs.forEach((x) => this.metricRefs.add(x));
    this.staged ||= inner.staged;
    return `(${body})`;
  }

  private fieldsIn(n: Node, out = new Set<string>()): Set<string> {
    switch (n.kind) {
      case "field": out.add(n.id); break;
      case "binary": case "logic": case "compare": this.fieldsIn(n.left, out); this.fieldsIn(n.right, out); break;
      case "in": this.fieldsIn(n.arg, out); n.values.forEach((v) => this.fieldsIn(v, out)); break;
      case "scalar": n.args.forEach((a) => this.fieldsIn(a, out)); break;
      case "neg": case "lag": case "window": case "all_time": case "at": case "to_date": case "not": case "isnull": this.fieldsIn(n.arg, out); break;
      case "agg": case "percentile": this.fieldsIn(n.arg, out); if (n.where) this.fieldsIn(n.where, out); break;
    }
    return out;
  }

  private datasetFor(fieldIds: string[]): string {
    const sets = fieldIds.map((id) => {
      const f = this.ctx.fields[id];
      if (!f) throw new CompileError(`Unknown field '${id}'`);
      return f.datasets ?? [];
    });
    const shared = sets.reduce((a, b) => a.filter((x) => b.includes(x)));
    if (shared.length === 0) throw new CompileError(`Fields share no dataset: ${fieldIds.join(", ")}`);
    // Prefer the dataset keyed by one of the fields, then the first declared.
    return shared.find((d) => fieldIds.includes(this.ctx.datasets[d]?.key)) ?? shared[0];
  }

  private aggregate(n: Extract<Node, { kind: "agg" | "percentile" }>, scope: Scope): string {
    const ids = [...this.fieldsIn(n)];
    const ds = this.datasetFor(ids);
    const meta = this.ctx.datasets[ds];
    if (!meta) throw new CompileError(`Unknown dataset '${ds}'`);
    this.datasets.add(ds);
    const s: Scope = { ...scope, dataset: ds };
    const inner = this.expr(n.arg, s);
    const agg =
      n.kind === "percentile" ? `PERCENTILE_CONT(${n.p}) WITHIN GROUP (ORDER BY ${inner})`
      : n.fn === "count_distinct" ? `COUNT(DISTINCT ${inner})`
      : n.fn === "median" ? `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${inner})`
      : `${n.fn.toUpperCase()}(${inner})`;

    const where: string[] = [];
    const date = this.ph(meta.date, ds);
    if (meta.kind === "snapshot") {
      if (scope.window || scope.allTime) throw new CompileError(`${scope.window ? "window" : "all_time"}() does not apply to the snapshot dataset '${ds}'`);
      where.push(`${date} = ${this.bound(scope.point ?? "period_end", scope)}`);
    } else if (scope.allTime) {
      // The where clause bounds the rows itself (for example relative to another date field).
    } else if (scope.window) {
      const end = this.bound(scope.point ?? "period_end", scope);
      where.push(`${date} > (${end} - ${interval(scope.window.n, scope.window.unit)})`, `${date} <= ${end}`);
    } else if (scope.toDate) {
      where.push(`${date} <= ${this.bound(scope.point ?? "period_end", scope)}`);
    } else if (scope.point) {
      // A point on an event or fact dataset reads as everything up to that point.
      where.push(`${date} <= ${this.bound(scope.point, scope)}`);
    } else {
      where.push(`${date} >= ${this.bound("period_start", scope)}`, `${date} <= ${this.bound("period_end", scope)}`);
    }
    if (n.where) where.push(this.expr(n.where, s));
    if (scope.cohort && (this.ctx.fields[scope.cohort.key]?.datasets ?? []).includes(ds)) {
      const key = scope.cohort.key;
      const keyDs = Object.entries(this.ctx.datasets).find(([, d]) => d.key === key)?.[0];
      if (!keyDs) throw new CompileError(`Cohort key '${key}' is not the key of any dataset`);
      this.datasets.add(keyDs);
      const kmeta = this.ctx.datasets[keyDs];
      const ks: Scope = { ...scope, dataset: keyDs };
      const active = kmeta.activeWhen ? ` AND ${this.expr(parseFormula(kmeta.activeWhen).expr, ks)}` : "";
      where.push(`${this.ph(key, ds)} IN (SELECT ${this.ph(key, keyDs)} FROM {{_table:${keyDs}}} WHERE ${this.ph(kmeta.date, keyDs)} = ${this.bound(scope.cohort.point, { ...scope, shift: [] })}${active})`);
    }
    return `(SELECT ${agg} FROM {{_table:${ds}}}${where.length ? ` WHERE ${where.join(" AND ")}` : ""})`;
  }
}
