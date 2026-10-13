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
 * `ctx.dialect` picks another spelling for the warehouse-specific constructs
 * (date shifts and differences, the double cast, percentiles): src/dialect.ts.
 *
 * A multi-argument count_distinct counts distinct tuples through a derived
 * table: (SELECT COUNT(*) FROM (SELECT DISTINCT a, b FROM t WHERE ...) _pairs).
 *
 * A formula entry with `breakdown` compiles to one row per value of the field
 * (and so does a named breakdown in `breakdowns`, compiled as a variant):
 *   SELECT _d.<field> AS <field>, <expr> AS <id>
 *   FROM (<domain>) _d
 * Every aggregate not under total() gains `AND {{<field>@<ds>}} = _d.<field>`.
 * The domain is the field's declared enum values as a UNION ALL of literals
 * (no VALUES clause, which BigQuery lacks), else the distinct non-null values
 * on the dataset keyed by the field, else on the first dataset the formula
 * reads that carries it.
 *
 * A breakdown field may live only on a dataset D keyed by K (plan_name on plan,
 * keyed by plan_id): an aggregate whose dataset carries K but not the field
 * correlates on `{{K@ds}} = _d.<K>`, the domain is D's (K, field) rows (at
 * period end when D is a snapshot) and the result carries both columns:
 *   SELECT _d.<K> AS <K>, _d.<field> AS <field>, <expr> AS <id> FROM (<domain>) _d
 *
 * A bucketed breakdown ({ expression, buckets }) groups by a per-row expression
 * instead of a field: the domain is the bucket labels, the column is the
 * breakdown name (or `bucket`), and each grouped aggregate gains
 *   AND CASE WHEN <expr> BETWEEN lo AND hi THEN '<label>' ... END = _d.<column>
 * (an open top bucket is `>= lo`). The expression's fields must all live on
 * the dataset of every grouped aggregate.
 */
import { parseFormula, hasAggregate, hasMetric, type Formula, type Form, type Node, type Point, type LagUnit } from "./formula.js";
import { DIALECT, type Dialect, type DialectName } from "./dialect.js";
import type { BreakdownSpec, MetricFormula, OntologyDataset, OntologyField } from "./types.js";

export interface CompileContext {
  fields: Record<string, OntologyField>;
  datasets: Record<string, OntologyDataset>;
  formulas: Record<string, MetricFormula>;
  /** SQL dialect of the output (src/dialect.ts); postgres when omitted */
  dialect?: DialectName;
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
  /**
   * Set when the entry declares a breakdown: the SQL returns one row per value of
   * `field`, the output column. For a bucketed breakdown `field` is the column
   * name (the breakdown name, or `bucket`) and `buckets` lists the labels.
   */
  breakdown?: { field: string; total?: boolean; expression?: string; buckets?: Record<string, [number, number | null]>; via?: { dataset: string; key: string } };
}

/** A checked breakdown: a field, or a bucketed per-row expression, and the total mode. */
export interface ResolvedBreakdown {
  /** The output column: the field id, or the bucket column name */
  column: string;
  field?: string;
  expression?: { src: string; node: Node; fields: string[] };
  buckets?: Array<{ label: string; lo: number; hi: number | null }>;
  total: boolean;
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
  /** The breakdown: aggregates are grouped by it unless under total() (or, in total mode, unless their dataset lacks it) */
  breakdown?: ResolvedBreakdown;
  /** Under total(): aggregates read the whole population */
  total?: boolean;
}

const TEMPORAL = new Set(["date", "timestamp"]);

/** An interval literal in units Postgres, Redshift and Snowflake accept. */
export function interval(n: number, unit: LagUnit): string {
  return unit === "quarter" ? `INTERVAL '${n * 3} month'` : `INTERVAL '${n} ${unit}'`;
}

export function compileMetric(id: string, ctx: CompileContext, variant?: string): Compiled {
  const f = ctx.formulas[id];
  if (!f) throw new CompileError(`No formula for '${id}'`);
  // A named breakdown (f.breakdowns) compiles the main formula grouped by its field.
  const named = variant !== undefined && !(f.forms as any)?.[variant] && !f.variants?.[variant] ? f.breakdowns?.[variant] : undefined;
  const src = named !== undefined ? f.formula : variant ? (f.forms as any)?.[variant] ?? f.variants?.[variant] : f.formula;
  if (!src) throw new CompileError(f.notComputable ? `'${id}' is not computable: ${f.notComputable}` : `'${id}' has no ${variant ?? "formula"}`);
  const ref = named ?? f.breakdown;
  const spec = ref === undefined ? undefined : resolveBreakdown(ref, ctx, named !== undefined ? `${id}:${variant}` : id, named !== undefined ? variant : undefined);
  const c = new Compiler(ctx);
  const body = c.formula(parseFormula(src), { toDate: false, shift: [], path: [id], breakdown: spec });
  const alias = id.replace(/[^a-z0-9_]/gi, "_");
  const domain = spec ? c.domain(spec) : "";
  const cols = c.via ? `_d.${c.via.key} AS ${c.via.key}, ` : "";
  const sql = spec
    ? `SELECT ${cols}_d.${spec.column} AS ${spec.column}, ${body} AS ${alias}\nFROM (${domain}) _d`
    : `SELECT ${body} AS ${alias}`;
  return {
    sql,
    fields: [...c.fields].sort(),
    placeholders: [...c.placeholders].sort(),
    datasets: [...c.datasets].sort(),
    metricRefs: [...c.metricRefs].sort(),
    staged: c.staged,
    ...(spec ? { breakdown: {
      field: spec.column,
      ...(spec.total ? { total: true } : {}),
      ...(spec.expression ? { expression: spec.expression.src, buckets: Object.fromEntries(spec.buckets!.map((b) => [b.label, [b.lo, b.hi] as [number, number | null]])) } : {}),
      ...(c.via ? { via: c.via } : {}),
    } } : {}),
  };
}

const bareFields = (n: Node, out = new Set<string>()): Set<string> => {
  switch (n.kind) {
    case "field": out.add(n.id); break;
    case "binary": case "logic": case "compare": bareFields(n.left, out); bareFields(n.right, out); break;
    case "scalar": n.args.forEach((a) => bareFields(a, out)); break;
    case "neg": case "not": case "isnull": bareFields(n.arg, out); break;
    case "in": bareFields(n.arg, out); n.values.forEach((v) => bareFields(v, out)); break;
  }
  return out;
};

/**
 * A breakdown spec checked against the ontology: "field.<id>", { field, total },
 * or { expression, buckets, total }. `name` is the named breakdown's name, which
 * becomes a bucketed breakdown's column (else `bucket`).
 */
export function resolveBreakdown(ref: BreakdownSpec, ctx: Pick<CompileContext, "fields" | "datasets">, id = "formula", name?: string): ResolvedBreakdown {
  if (ref && typeof ref === "object" && "expression" in ref) {
    const extra = Object.keys(ref).filter((k) => !["expression", "buckets", "total"].includes(k));
    if (extra.length || typeof ref.expression !== "string" || (ref.total !== undefined && typeof ref.total !== "boolean"))
      throw new CompileError(`'${id}' bucketed breakdown takes only a string "expression", "buckets" and a boolean "total"`);
    let node: Node;
    try { node = parseFormula(ref.expression).expr; } catch (e) { throw new CompileError(`'${id}' breakdown expression: ${(e as Error).message}`); }
    if (hasAggregate(node) || hasMetric(node)) throw new CompileError(`'${id}' breakdown expression must be a per-row expression over fields, with no aggregate or metric`);
    const fields = [...bareFields(node)];
    if (!fields.length) throw new CompileError(`'${id}' breakdown expression reads no field`);
    for (const fid of fields) if (!ctx.fields[fid]) throw new CompileError(`'${id}' breakdown expression names unknown field 'field.${fid}'`);
    const shared = fields.map((fid) => ctx.fields[fid].datasets ?? []).reduce((a, b) => a.filter((x) => b.includes(x)));
    if (!shared.length) throw new CompileError(`'${id}' breakdown expression mixes fields from different datasets: ${fields.join(", ")}`);
    if (!ref.buckets || typeof ref.buckets !== "object" || !Object.keys(ref.buckets).length) throw new CompileError(`'${id}' bucketed breakdown needs at least one bucket`);
    const buckets = Object.entries(ref.buckets).map(([label, range]) => {
      if (!/^[A-Za-z0-9_]+$/.test(label)) throw new CompileError(`'${id}' bucket label '${label}' must be letters, digits and underscores`);
      if (!Array.isArray(range) || range.length !== 2 || typeof range[0] !== "number" || !(range[1] === null || typeof range[1] === "number"))
        throw new CompileError(`'${id}' bucket '${label}' must be [lo, hi] with a number lo and a number or null hi`);
      if (range[1] !== null && range[1] < range[0]) throw new CompileError(`'${id}' bucket '${label}' has hi below lo`);
      return { label, lo: range[0], hi: range[1] as number | null };
    });
    if (new Set(buckets.map((b) => b.label.toLowerCase())).size !== buckets.length) throw new CompileError(`'${id}' bucket labels must be unique`);
    const sorted = [...buckets].sort((a, b) => a.lo - b.lo);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      if (prev.hi === null || sorted[i].lo <= prev.hi) throw new CompileError(`'${id}' buckets '${prev.label}' and '${sorted[i].label}' overlap (bounds are inclusive)`);
    }
    const column = name ?? "bucket";
    if (!/^[a-z_][a-z0-9_]*$/i.test(column)) throw new CompileError(`'${id}' bucket column '${column}' is not an identifier`);
    return { column, expression: { src: ref.expression, node, fields }, buckets, total: ref.total === true };
  }
  const s = breakdownSpec(ref as Exclude<BreakdownSpec, { expression: string }>, ctx, id);
  return { column: s.field, field: s.field, total: s.total };
}

/** A breakdown spec (string or { field, total }) as a checked field id and total mode. */
export function breakdownSpec(ref: Exclude<BreakdownSpec, { expression: string }>, ctx: Pick<CompileContext, "fields">, id = "formula"): { field: string; total: boolean } {
  if (typeof ref === "string") return { field: breakdownField(ref, ctx, id), total: false };
  if (!ref || typeof ref !== "object" || typeof ref.field !== "string") throw new CompileError(`'${id}' breakdown must be "field.<id>" or { "field": "field.<id>", "total": true }`);
  const extra = Object.keys(ref).filter((k) => k !== "field" && k !== "total");
  if (extra.length || (ref.total !== undefined && typeof ref.total !== "boolean")) throw new CompileError(`'${id}' breakdown object takes only "field" and a boolean "total"`);
  return { field: breakdownField(ref.field, ctx, id), total: ref.total === true };
}

/** The field id of an entry's `breakdown` ("field.<id>"), checked against the ontology. */
export function breakdownField(ref: string, ctx: Pick<CompileContext, "fields">, id = "formula"): string {
  if (!ref.startsWith("field.")) throw new CompileError(`'${id}' breakdown must be a field reference (field.<id>), got '${ref}'`);
  const field = ref.slice(6);
  if (!ctx.fields[field]) throw new CompileError(`'${id}' breakdown names unknown field 'field.${field}'`);
  return field;
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
  /** Set when a grouped aggregate reaches the breakdown field through a key: the dataset D carrying it and D's key */
  via?: { dataset: string; key: string };
  private d: Dialect;
  constructor(private ctx: CompileContext) {
    this.d = DIALECT[ctx.dialect ?? "postgres"];
    if (!this.d) throw new CompileError(`Unknown SQL dialect '${ctx.dialect}' (use ${Object.keys(DIALECT).join(", ")})`);
  }

  formula(f: Formula, scope: Scope): string {
    const s: Scope = f.cohort ? { ...scope, cohort: scope.cohort ?? f.cohort } : scope;
    if (f.cohort) { this.staged = true; this.fields.add(f.cohort.key); }
    return this.expr(f.expr, s);
  }

  private bound(point: Point, scope: Scope): string {
    let b = `{{_period_${point === "period_start" ? "start" : "end"}}}`;
    for (const sh of scope.shift) b = this.d.minus(b, sh.n, sh.unit);
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
      case "period_days": return this.d.periodDays(this.bound("period_end", scope), this.bound("period_start", scope));
      case "metric": return this.metric(n.id, scope, n.form);
      case "neg": return `(-${this.expr(n.arg, scope)})`;
      case "binary": {
        const l = this.expr(n.left, scope);
        const r = this.expr(n.right, scope);
        if (n.op === "-" && this.isTemporal(n.left) && this.isTemporal(n.right)) {
          const ts = [n.left, n.right].some((x) => x.kind === "field" && this.type(x.id) === "timestamp");
          // A period bound against a timestamp is cast where the dialect needs it (BigQuery).
          const asTs = (x: Node, sql: string) => (x.kind === "period_bound" ? this.d.toTimestamp(sql) : sql);
          return ts ? `(${this.d.secondsBetween(asTs(n.left, l), asTs(n.right, r))} / 86400.0)` : this.d.daysBetween(l, r);
        }
        // Cast the numerator so COUNT / COUNT is not integer division (Postgres, Redshift, SQL Server).
        if (n.op === "/") return n.right.kind === "number" ? `(${this.d.toDouble(l)} / ${r})` : `(${this.d.toDouble(l)} / NULLIF(${r}, 0))`;
        return `(${l} ${n.op} ${r})`;
      }
      case "scalar": {
        const fn = { min: "LEAST", max: "GREATEST", abs: "ABS", coalesce: "COALESCE" }[n.fn];
        return `${fn}(${n.args.map((a) => this.expr(a, scope)).join(", ")})`;
      }
      case "compare": {
        // A timestamp compared with a period bound (a date): the bound's whole day counts, so `<= end` is `< end + 1 day`.
        const tsField = (x: Node) => x.kind === "field" && this.type(x.id) === "timestamp";
        if ((tsField(n.left) && n.right.kind === "period_bound") || (tsField(n.right) && n.left.kind === "period_bound")) {
          const flip = n.left.kind === "period_bound";
          const col = this.expr(flip ? n.right : n.left, scope);
          const b = this.expr(flip ? n.left : n.right, scope);
          const op = flip ? ({ "<": ">", "<=": ">=", ">": "<", ">=": "<=", "=": "=", "!=": "!=" } as const)[n.op] : n.op;
          const next = this.d.toTimestamp(this.d.plus(b, 1, "day"));
          switch (op) {
            case "<=": return `${col} < ${next}`;
            case ">": return `${col} >= ${next}`;
            case "<": case ">=": return `${col} ${op} ${this.d.toTimestamp(b)}`;
            case "=": return `(${col} >= ${this.d.toTimestamp(b)} AND ${col} < ${next})`;
            case "!=": return `NOT (${col} >= ${this.d.toTimestamp(b)} AND ${col} < ${next})`;
          }
        }
        return `${this.expr(n.left, scope)} ${n.op === "!=" ? "<>" : n.op} ${this.expr(n.right, scope)}`;
      }
      case "in": return `${this.expr(n.arg, scope)} ${n.negated ? "NOT IN" : "IN"} (${n.values.map((v) => this.expr(v, scope)).join(", ")})`;
      case "isnull": return `${this.expr(n.arg, scope)} IS ${n.negated ? "NOT " : ""}NULL`;
      case "logic": return `(${this.expr(n.left, scope)} ${n.op.toUpperCase()} ${this.expr(n.right, scope)})`;
      case "not": return `NOT (${this.expr(n.arg, scope)})`;
      case "at": return this.expr(n.arg, { ...scope, point: scope.point ?? n.point }); // outer at wins
      case "to_date": return this.expr(n.arg, { ...scope, toDate: true });
      case "lag": this.staged = true; return this.expr(n.arg, { ...scope, shift: [...scope.shift, { n: n.n, unit: n.unit }] });
      case "window": return this.expr(n.arg, { ...scope, window: scope.window ?? { n: n.n, unit: n.unit } }); // outer window wins
      case "all_time": return this.expr(n.arg, { ...scope, allTime: true });
      case "total":
        if (!scope.breakdown) throw new CompileError(`total() outside a breakdown (in ${scope.path.join(" -> ")})`);
        return this.expr(n.arg, { ...scope, total: true });
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
    if (inner.via) this.useVia(inner.via);
    this.staged ||= inner.staged;
    return `(${body})`;
  }

  private fieldsIn(n: Node, out = new Set<string>()): Set<string> {
    switch (n.kind) {
      case "field": out.add(n.id); break;
      case "binary": case "logic": case "compare": this.fieldsIn(n.left, out); this.fieldsIn(n.right, out); break;
      case "in": this.fieldsIn(n.arg, out); n.values.forEach((v) => this.fieldsIn(v, out)); break;
      case "scalar": n.args.forEach((a) => this.fieldsIn(a, out)); break;
      case "neg": case "lag": case "window": case "all_time": case "total": case "at": case "to_date": case "not": case "isnull": this.fieldsIn(n.arg, out); break;
      case "agg": case "percentile":
        this.fieldsIn(n.arg, out);
        if (n.kind === "agg") n.more?.forEach((m) => this.fieldsIn(m, out));
        if (n.where) this.fieldsIn(n.where, out);
        break;
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
    const bd = scope.breakdown;
    const needs = bd ? (bd.field ? [bd.field] : bd.expression!.fields) : [];
    const missing = needs.filter((x) => !(this.ctx.fields[x]?.datasets ?? []).includes(ds));
    // A field breakdown can reach a dataset without the field through the key of a dataset that has it.
    // Only a foreign key counts (an `*_id` that is not this dataset's own key or date), as in the Ossie relationships:
    // shared keys such as event_id are each dataset's own and never a join.
    const keyedCarriers = (field: string) => (this.ctx.fields[field]?.datasets ?? [])
      .filter((d) => { const k = this.ctx.datasets[d]?.key; return !!k && k !== field && k.endsWith("_id") && k !== meta.key && k !== meta.date; });
    const viaCandidates = bd?.field && missing.length && !scope.total
      ? keyedCarriers(bd.field).filter((d) => (this.ctx.fields[this.ctx.datasets[d].key]?.datasets ?? []).includes(ds))
      : [];
    const fn = n.kind === "agg" ? n.fn : "percentile";
    if (viaCandidates.length > 1) {
      throw new CompileError(`Breakdown by field.${bd!.field}: ${fn}() reads dataset '${ds}', which reaches the field through several keyed datasets (${viaCandidates.join(", ")}); add the field to '${ds}' or narrow the breakdown`);
    }
    const via = viaCandidates.length === 1 ? { dataset: viaCandidates[0], key: this.ctx.datasets[viaCandidates[0]].key } : undefined;
    // In total mode the author declared that aggregates without the dimension stay whole.
    const grouped = !!bd && !scope.total && (missing.length === 0 || !!via || !bd.total);
    if (grouped && missing.length && !via) {
      const what = bd!.field ? `field.${bd!.field}` : `${bd!.column} (${bd!.expression!.src})`;
      const keys = bd!.field ? keyedCarriers(bd!.field).map((d) => `${this.ctx.datasets[d].key} (the key of ${d})`) : [];
      throw new CompileError(
        `Breakdown by ${what}: ${fn}() over ${ids.map((x) => `field.${x}`).join(", ")} reads dataset '${ds}', which has no ${missing.join(", ")} field` +
        (keys.length ? ` and no key to reach it: '${ds}' is missing ${keys.join(" or ")}` : "") +
        `. Wrap the aggregate in total() or add the field to '${ds}'`,
      );
    }
    if (grouped && via) this.useVia(via);
    const inner = this.expr(n.arg, s);
    const tuple = n.kind === "agg" && n.more?.length ? [inner, ...n.more.map((m) => this.expr(m, s))] : undefined;
    const agg =
      n.kind === "percentile" ? this.d.percentile(n.p, inner)
      : n.fn === "count_distinct" ? `COUNT(DISTINCT ${inner})`
      : n.fn === "median" ? this.d.percentile(0.5, inner)
      : `${n.fn.toUpperCase()}(${inner})`;

    const where: string[] = [];
    const date = this.ph(meta.date, ds);
    const ts = this.type(meta.date) === "timestamp";
    if (meta.kind === "snapshot") {
      if (scope.window || scope.allTime) throw new CompileError(`${scope.window ? "window" : "all_time"}() does not apply to the snapshot dataset '${ds}'`);
      where.push(this.onDay(date, this.bound(scope.point ?? "period_end", scope), ts));
    } else if (scope.allTime) {
      // The where clause bounds the rows itself (for example relative to another date field).
    } else if (scope.window) {
      const end = this.bound(scope.point ?? "period_end", scope);
      // Dates: (end - n, end]. Timestamps: [end + 1 day - n, end + 1 day), so the whole first and last days count.
      where.push(ts
        ? `${date} >= ${this.d.toTimestamp(this.d.minus(this.d.plus(end, 1, "day"), scope.window.n, scope.window.unit))}`
        : `${date} > ${this.d.minus(end, scope.window.n, scope.window.unit)}`, this.upTo(date, end, ts));
    } else if (scope.toDate) {
      where.push(this.upTo(date, this.bound(scope.point ?? "period_end", scope), ts));
    } else if (scope.point) {
      // A point on an event or fact dataset reads as everything up to that point.
      where.push(this.upTo(date, this.bound(scope.point, scope), ts));
    } else {
      where.push(`${date} >= ${ts ? this.d.toTimestamp(this.bound("period_start", scope)) : this.bound("period_start", scope)}`, this.upTo(date, this.bound("period_end", scope), ts));
    }
    if (n.where) where.push(this.expr(n.where, s));
    if (grouped && bd!.field) where.push(via ? `${this.ph(via.key, ds)} = _d.${via.key}` : `${this.ph(bd!.field, ds)} = _d.${bd!.column}`);
    if (grouped && bd!.expression) {
      const e = this.expr(bd!.expression.node, { ...s, breakdown: undefined });
      const whens = bd!.buckets!.map((b) => `WHEN ${e} ${b.hi === null ? `>= ${b.lo}` : `BETWEEN ${b.lo} AND ${b.hi}`} THEN '${b.label}'`);
      where.push(`CASE ${whens.join(" ")} END = _d.${bd!.column}`);
    }
    if (scope.cohort && (this.ctx.fields[scope.cohort.key]?.datasets ?? []).includes(ds)) {
      const key = scope.cohort.key;
      const keyDs = Object.entries(this.ctx.datasets).find(([, d]) => d.key === key)?.[0];
      if (!keyDs) throw new CompileError(`Cohort key '${key}' is not the key of any dataset`);
      this.datasets.add(keyDs);
      const kmeta = this.ctx.datasets[keyDs];
      const ks: Scope = { ...scope, dataset: keyDs };
      const active = kmeta.activeWhen ? ` AND ${this.expr(parseFormula(kmeta.activeWhen).expr, ks)}` : "";
      where.push(`${this.ph(key, ds)} IN (SELECT ${this.ph(key, keyDs)} FROM {{_table:${keyDs}}} WHERE ${this.onDay(this.ph(kmeta.date, keyDs), this.bound(scope.cohort.point, { ...scope, shift: [] }), this.type(kmeta.date) === "timestamp")}${active})`);
    }
    if (tuple) {
      // Distinct tuples: COUNT(DISTINCT a) ignores nulls, so a tuple with a null part is not counted either.
      where.push(...tuple.map((t) => `${t} IS NOT NULL`));
      return `(SELECT COUNT(*) FROM (SELECT DISTINCT ${tuple.join(", ")} FROM {{_table:${ds}}} WHERE ${where.join(" AND ")}) _pairs)`;
    }
    return `(SELECT ${agg} FROM {{_table:${ds}}}${where.length ? ` WHERE ${where.join(" AND ")}` : ""})`;
  }

  /** The rows a breakdown iterates: bucket labels or enum values as literals, else the field's distinct values on one dataset. */
  /** `col` on or before the date `b`: `<= b` for a date column, `< b + 1 day` for a timestamp (the whole last day counts). */
  private upTo(col: string, b: string, ts: boolean): string {
    return ts ? `${col} < ${this.d.toTimestamp(this.d.plus(b, 1, "day"))}` : `${col} <= ${b}`;
  }

  /** `col` on the date `b`: equality for a date column, the day's half-open range for a timestamp. */
  private onDay(col: string, b: string, ts: boolean): string {
    return ts ? `${col} >= ${this.d.toTimestamp(b)} AND ${col} < ${this.d.toTimestamp(this.d.plus(b, 1, "day"))}` : `${col} = ${b}`;
  }

  /** Record the keyed dataset a grouped aggregate reached the field through; every such aggregate must use the same one. */
  useVia(via: { dataset: string; key: string }): void {
    if (this.via && this.via.dataset !== via.dataset) throw new CompileError(`Breakdown reaches its field through two datasets (${this.via.dataset} and ${via.dataset}); add the field to one dataset`);
    this.via = via;
  }

  domain(bd: ResolvedBreakdown): string {
    if (this.via) {
      // (key, label) rows of the dataset carrying the field, as of the period end when it is a snapshot.
      const { dataset: d, key } = this.via;
      this.datasets.add(d);
      const meta = this.ctx.datasets[d];
      const at = meta.kind === "snapshot" ? ` WHERE ${this.ph(meta.date, d)} = {{_period_end}}` : "";
      return `SELECT DISTINCT ${this.ph(key, d)} AS ${key}, ${this.ph(bd.field!, d)} AS ${bd.field} FROM {{_table:${d}}}${at}`;
    }
    if (bd.buckets) return bd.buckets.map((b) => `SELECT '${b.label}' AS ${bd.column}`).join(" UNION ALL ");
    const field = bd.field!;
    const f = this.ctx.fields[field];
    if (f.values?.length) return f.values.map((v) => `SELECT '${v.replace(/'/g, "''")}' AS ${field}`).join(" UNION ALL ");
    const carriers = f.datasets ?? [];
    const keyed = carriers.find((d) => this.ctx.datasets[d]?.key === field);
    const ds = keyed ?? [...this.datasets].find((d) => carriers.includes(d));
    if (!ds) throw new CompileError(`Breakdown by field.${field}: no dataset the formula reads carries it`);
    this.datasets.add(ds);
    const col = this.ph(field, ds);
    return `SELECT DISTINCT ${col} AS ${field} FROM {{_table:${ds}}} WHERE ${col} IS NOT NULL`;
  }
}
