/**
 * GASP formula grammar: a small, warehouse-agnostic expression language for
 * canonical metric definitions (standard/formulas.json).
 *
 *   formula   := expr ("over" "cohort" "(" field "," point ")")?
 *   expr      := or
 *   or        := and ("or" and)*
 *   and       := not ("and" not)*
 *   not       := "not" not | compare
 *   compare   := additive (cmpop additive | "not"? "in" "(" literal ("," literal)* ")" | "is" "not"? "null")?
 *   additive  := term (("+" | "-") term)*
 *   term      := unary (("*" | "/") unary)*
 *   unary     := "-" unary | postfix
 *   postfix   := primary ("at" point | "to_date")?
 *   primary   := number | string | true | false | period_days | point | "metric." id form? | "field." id | call | "(" expr ")"
 *   form      := ".O" | ".M"                  the metric's Operating or Market form (forms.O / forms.M)
 *   call      := agg "(" expr ("where" expr)? ")"
 *              | "count_distinct" "(" expr ("," expr)+ ("where" expr)? ")"   distinct tuples (distinct pairs)
 *              | "percentile" "(" expr "," number ("where" expr)? ")"     p in (0, 1)
 *              | ("min" | "max") "(" expr "," expr ("," expr)* ")"     scalar least/greatest
 *              | ("abs" | "coalesce") "(" expr ("," expr)* ")"
 *              | "in_period" "(" field ")"      sugar for field >= period_start and field <= period_end
 *              | "lag" "(" expr "," number unit ")"
 *              | "window" "(" expr "," number unit ")"   the n units ending at the period end (or the `at` point)
 *              | "all_time" "(" expr ")"                 no period filter; the where clause bounds the rows itself
 *              | "total" "(" expr ")"                    inside a breakdown: the whole population, not grouped
 *   agg       := sum | count | count_distinct | avg | min | max | median
 *   point     := period_start | period_end
 *   unit      := day | week | month | quarter | year
 *
 * Semantics: ratios are unscaled (units live beside the formula, not in it).
 * Subtracting two date or timestamp fields gives elapsed days (fractional for
 * timestamps); formulas reported in hours, minutes or months convert explicitly.
 * `period_days` is the length of the reporting period in days. `to_date` makes an
 * aggregate cumulative from the start of history to period_end (balances).
 * A bare `period_start` / `period_end` is the period boundary as a date value.
 * `field.period_start` is a different thing: the date column of fact datasets
 * (the start of the period a fact row covers), always written with its prefix.
 * `at` takes a snapshot at a period boundary; an outer `at` overrides an inner one.
 * `window` replaces the period filter of an event or fact aggregate with a
 * trailing window (DAU is the 1 day, WAU the 7 days, MAU the 30 days ending at
 * period_end). `all_time` drops the period filter so the where clause can bound
 * the rows relative to another field (day-30 retention of the period's signup
 * cohort). Neither applies to a snapshot aggregate.
 * `metric.<id>.O` / `metric.<id>.M` reads the named form of a metric instead of
 * its main formula (LTV-O reads `metric.gross_margin.O`); the metric must
 * declare that form. Graph analysis reports the bare metric id, so a form
 * reference adds the same edge as a plain one.
 * `count_distinct(a, b)` counts distinct (a, b) tuples whose parts are all
 * non-null; every field in it shares one dataset like any aggregate.
 * A formulas.json entry with `"breakdown": "field.<id>"` is compiled once per
 * value of that field: every aggregate is grouped by it (filtered to the value)
 * except those under `total(...)`, which read the whole population, so
 * `count(x) / total(count(x))` is a share of total. Each grouped aggregate,
 * including those reached through metric references, must read a dataset that
 * carries the field. `total()` outside a breakdown is a compile error.
 * `over cohort(key, point)` restricts every aggregate, including those inside
 * referenced metrics, to entities present at that point. `lag` and `cohort`
 * mark metrics that need a staged dataset to run as a single Ossie aggregate.
 */

export type Point = "period_start" | "period_end";
export type Form = "O" | "M";
export const FORMS: Form[] = ["O", "M"];
export type LagUnit = "day" | "week" | "month" | "quarter" | "year";
export const AGGREGATES = ["sum", "count", "count_distinct", "avg", "min", "max", "median"] as const;
export type Aggregate = (typeof AGGREGATES)[number];

export type Node =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "metric"; id: string; form?: Form }
  | { kind: "field"; id: string }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: Node; right: Node }
  | { kind: "neg"; arg: Node }
  /** `more` holds the further arguments of a multi-argument count_distinct (distinct tuples) */
  | { kind: "agg"; fn: Aggregate; arg: Node; more?: Node[]; where?: Node }
  | { kind: "percentile"; arg: Node; p: number; where?: Node }
  | { kind: "period_days" }
  | { kind: "period_bound"; point: Point }
  | { kind: "to_date"; arg: Node }
  | { kind: "scalar"; fn: "min" | "max" | "abs" | "coalesce"; args: Node[] }
  | { kind: "lag"; arg: Node; n: number; unit: LagUnit }
  | { kind: "window"; arg: Node; n: number; unit: LagUnit }
  | { kind: "all_time"; arg: Node }
  | { kind: "total"; arg: Node }
  | { kind: "at"; arg: Node; point: Point }
  | { kind: "compare"; op: "=" | "!=" | "<" | "<=" | ">" | ">="; left: Node; right: Node }
  | { kind: "in"; arg: Node; values: Node[]; negated: boolean }
  | { kind: "isnull"; arg: Node; negated: boolean }
  | { kind: "logic"; op: "and" | "or"; left: Node; right: Node }
  | { kind: "not"; arg: Node };

export interface Formula {
  expr: Node;
  cohort?: { key: string; point: Point };
}

export class FormulaError extends Error {
  constructor(message: string, public pos: number) {
    super(`${message} at position ${pos}`);
  }
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

type Tok = { t: "num" | "str" | "id" | "op" | "eof"; v: string; pos: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i))!;
      out.push({ t: "num", v: m[0], pos: i }); i += m[0].length; continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) throw new FormulaError("Unterminated string", i);
      out.push({ t: "str", v: src.slice(i + 1, end), pos: i }); i = end + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)?/.exec(src.slice(i))!;
      let v = m[0];
      // A metric ref may name a form: metric.<id>.O or metric.<id>.M. Nothing else takes a second dot.
      if (v.startsWith("metric.") && src[i + v.length] === ".") {
        const suffix = /^\.[A-Za-z0-9_]*/.exec(src.slice(i + v.length))![0];
        if (!FORMS.includes(suffix.slice(1) as Form)) throw new FormulaError(`Unknown form '${suffix}' on ${v} (use .O or .M)`, i + v.length);
        v += suffix;
      }
      out.push({ t: "id", v, pos: i }); i += v.length; continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "!="].includes(two)) { out.push({ t: "op", v: two, pos: i }); i += 2; continue; }
    if ("+-*/(),=<>".includes(c)) { out.push({ t: "op", v: c, pos: i }); i++; continue; }
    throw new FormulaError(`Unexpected character '${c}'`, i);
  }
  out.push({ t: "eof", v: "", pos: src.length });
  return out;
}

// ── Parser ───────────────────────────────────────────────────────────────────

const POINTS: Point[] = ["period_start", "period_end"];
const LAG_UNITS: LagUnit[] = ["day", "week", "month", "quarter", "year"];
const KEYWORDS = new Set(["over", "cohort", "period_days", "to_date", "and", "or", "not", "in", "is", "null", "at", "where", ...POINTS]);

export function parseFormula(src: string): Formula {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek().t === "op" && peek().v === v;
  const isKw = (v: string) => peek().t === "id" && peek().v === v;
  const next = () => toks[p++];
  const expectOp = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`Expected '${v}' but found '${peek().v || "end"}'`, peek().pos);
    return next();
  };
  const expectKw = (v: string) => {
    if (!isKw(v)) throw new FormulaError(`Expected '${v}' but found '${peek().v || "end"}'`, peek().pos);
    return next();
  };
  const point = (): Point => {
    const tok = next();
    if (!POINTS.includes(tok.v as Point)) throw new FormulaError(`Expected period_start or period_end`, tok.pos);
    return tok.v as Point;
  };

  const expr = (): Node => or();
  const or = (): Node => {
    let left = and();
    while (isKw("or")) { next(); left = { kind: "logic", op: "or", left, right: and() }; }
    return left;
  };
  const and = (): Node => {
    let left = not();
    while (isKw("and")) { next(); left = { kind: "logic", op: "and", left, right: not() }; }
    return left;
  };
  const not = (): Node => {
    if (isKw("not")) { next(); return { kind: "not", arg: not() }; }
    return compare();
  };
  const compare = (): Node => {
    const left = additive();
    const tok = peek();
    if (tok.t === "op" && ["=", "!=", "<", "<=", ">", ">="].includes(tok.v)) {
      next();
      return { kind: "compare", op: tok.v as any, left, right: additive() };
    }
    const negatedIn = isKw("not") && toks[p + 1]?.v === "in";
    if (isKw("in") || negatedIn) {
      if (negatedIn) next();
      next();
      expectOp("(");
      const values = [primary()];
      while (isOp(",")) { next(); values.push(primary()); }
      expectOp(")");
      return { kind: "in", arg: left, values, negated: negatedIn };
    }
    if (isKw("is")) {
      next();
      const negated = isKw("not");
      if (negated) next();
      expectKw("null");
      return { kind: "isnull", arg: left, negated };
    }
    return left;
  };
  const additive = (): Node => {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = next().v as "+" | "-";
      left = { kind: "binary", op, left, right: term() };
    }
    return left;
  };
  const term = (): Node => {
    let left = unary();
    while (isOp("*") || isOp("/")) {
      const op = next().v as "*" | "/";
      left = { kind: "binary", op, left, right: unary() };
    }
    return left;
  };
  const unary = (): Node => {
    if (isOp("-")) { next(); return { kind: "neg", arg: unary() }; }
    return postfix();
  };
  const postfix = (): Node => {
    const node = primary();
    if (isKw("at")) { next(); return { kind: "at", arg: node, point: point() }; }
    if (isKw("to_date")) { next(); return { kind: "to_date", arg: node }; }
    return node;
  };
  const primary = (): Node => {
    const tok = next();
    if (tok.t === "num") return { kind: "number", value: Number(tok.v) };
    if (tok.t === "str") return { kind: "string", value: tok.v };
    if (tok.t === "op" && tok.v === "(") { const e = expr(); expectOp(")"); return e; }
    if (tok.t === "id") {
      if (tok.v === "true" || tok.v === "false") return { kind: "boolean", value: tok.v === "true" };
      if (tok.v === "period_days") return { kind: "period_days" };
      if (POINTS.includes(tok.v as Point)) return { kind: "period_bound", point: tok.v as Point };
      if (tok.v.startsWith("metric.")) {
        const [id, form] = tok.v.slice(7).split(".");
        return form ? { kind: "metric", id, form: form as Form } : { kind: "metric", id };
      }
      if (tok.v.startsWith("field.")) return { kind: "field", id: tok.v.slice(6) };
      if (tok.v.includes(".")) throw new FormulaError(`Unknown reference '${tok.v}' (use metric. or field.)`, tok.pos);
      if (isOp("(")) return call(tok);
      if (KEYWORDS.has(tok.v)) throw new FormulaError(`Unexpected keyword '${tok.v}'`, tok.pos);
      throw new FormulaError(`Unknown identifier '${tok.v}'`, tok.pos);
    }
    throw new FormulaError(`Unexpected '${tok.v || "end"}'`, tok.pos);
  };
  const call = (name: Tok): Node => {
    expectOp("(");
    const fn = name.v;
    if (fn === "lag" || fn === "window") {
      const arg = expr();
      expectOp(",");
      const n = next();
      if (n.t !== "num" || !(Number(n.v) > 0)) throw new FormulaError(`${fn}() expects a positive number of ${fn === "lag" ? "periods" : "units"}`, n.pos);
      const unit = next();
      if (!LAG_UNITS.includes(unit.v as LagUnit)) throw new FormulaError(`${fn}() unit must be one of ${LAG_UNITS.join(", ")}`, unit.pos);
      expectOp(")");
      return { kind: fn, arg, n: Number(n.v), unit: unit.v as LagUnit };
    }
    if (fn === "all_time" || fn === "total") {
      const arg = expr();
      expectOp(")");
      return { kind: fn, arg };
    }
    if (fn === "in_period") {
      const arg = primary();
      if (arg.kind !== "field") throw new FormulaError("in_period() takes a field", name.pos);
      expectOp(")");
      return { kind: "logic", op: "and",
        left: { kind: "compare", op: ">=", left: arg, right: { kind: "period_bound", point: "period_start" } },
        right: { kind: "compare", op: "<=", left: { kind: "field", id: arg.id }, right: { kind: "period_bound", point: "period_end" } } };
    }
    if (fn === "percentile") {
      const arg = expr();
      expectOp(",");
      const pt = next();
      const p = Number(pt.v);
      if (pt.t !== "num" || !(p > 0 && p < 1)) throw new FormulaError("percentile() expects p between 0 and 1", pt.pos);
      let where: Node | undefined;
      if (isKw("where")) { next(); where = expr(); }
      expectOp(")");
      return { kind: "percentile", arg, p, where };
    }
    const args = [expr()];
    let where: Node | undefined;
    if (isKw("where")) { next(); where = expr(); }
    while (!where && isOp(",")) { next(); args.push(expr()); }
    if (!where && args.length > 1 && isKw("where")) { next(); where = expr(); }
    expectOp(")");
    if ((fn === "min" || fn === "max") && args.length > 1) {
      if (where) throw new FormulaError(`${fn}() with several arguments does not take a where clause`, name.pos);
      return { kind: "scalar", fn, args };
    }
    if (fn === "abs" || fn === "coalesce") {
      if (where) throw new FormulaError(`${fn}() does not take a where clause`, name.pos);
      return { kind: "scalar", fn, args };
    }
    if ((AGGREGATES as readonly string[]).includes(fn)) {
      if (args.length > 1 && fn !== "count_distinct") throw new FormulaError(`${fn}() takes one argument`, name.pos);
      return args.length > 1
        ? { kind: "agg", fn: fn as Aggregate, arg: args[0], more: args.slice(1), where }
        : { kind: "agg", fn: fn as Aggregate, arg: args[0], where };
    }
    throw new FormulaError(`Unknown function '${fn}'`, name.pos);
  };

  const body = expr();
  let cohort: Formula["cohort"];
  if (isKw("over")) {
    next();
    expectKw("cohort");
    expectOp("(");
    const key = next();
    if (!key.v.startsWith("field.")) throw new FormulaError("cohort() key must be a field", key.pos);
    expectOp(",");
    const pt = point();
    expectOp(")");
    cohort = { key: key.v.slice(6), point: pt };
  }
  if (peek().t !== "eof") throw new FormulaError(`Unexpected '${peek().v}'`, peek().pos);
  return { expr: body, cohort };
}

// ── Analysis ─────────────────────────────────────────────────────────────────

export type Polarity = "positive" | "negative";

export type InputRole = "numerator" | "denominator" | "addend" | "subtrahend" | "base" | "component";

export interface FormulaAnalysis {
  metricRefs: string[];
  fieldRefs: string[];
  /** Per metric ref: its arithmetic role in the formula (first occurrence wins) */
  metricRoles: Record<string, InputRole>;
  /** Per metric ref: the polarities it appears with (negative = subtracted or in a denominator). */
  metricPolarity: Record<string, Polarity[]>;
  /** True when the formula uses cohort or lag, so it compiles to a staged dataset. */
  staged: boolean;
  /**
   * Per metric ref: true when every occurrence is a baseline read, under an
   * effective `at period_start` (the outermost `at` wins) or inside `lag(...)`.
   * A ref read both as a baseline and live counts as live (false).
   */
  metricBaseline: Record<string, boolean>;
}

/** Maps the hand-maintained structuredFormulas roles onto polarity. */
export function rolePolarity(role: string): Polarity {
  return role === "denominator" || role === "subtrahend" ? "negative" : "positive";
}

export function analyzeFormula(f: Formula): FormulaAnalysis {
  const metrics = new Set<string>();
  const fields = new Set<string>();
  const polarity: Record<string, Set<Polarity>> = {};
  const roles: Record<string, InputRole> = {};
  const baseline: Record<string, boolean> = {};
  let staged = !!f.cohort;
  if (f.cohort) fields.add(f.cohort.key);

  // role: the first division decides (numerator or denominator); otherwise the
  // position under + and - (addend, subtrahend), under * (component) or alone (base).
  // point: the effective `at` (outermost wins); lagged: under a lag().
  let point: Point | undefined;
  let lagged = false;
  const walk = (n: Node, neg: boolean, role: InputRole, div: "numerator" | "denominator" | null): void => {
    const effective = div ?? role;
    switch (n.kind) {
      case "metric":
        baseline[n.id] = (baseline[n.id] ?? true) && (lagged || point === "period_start");
        metrics.add(n.id);
        (polarity[n.id] ??= new Set()).add(neg ? "negative" : "positive");
        roles[n.id] ??= effective;
        return;
      case "field": fields.add(n.id); return;
      case "binary": {
        if (n.op === "/") {
          walk(n.left, neg, "numerator", div ?? "numerator");
          walk(n.right, !neg, "denominator", div ?? "denominator");
        } else if (n.op === "-") {
          walk(n.left, neg, "addend", div);
          walk(n.right, !neg, "subtrahend", div);
        } else if (n.op === "+") {
          walk(n.left, neg, "addend", div);
          walk(n.right, neg, "addend", div);
        } else {
          walk(n.left, neg, "component", div);
          walk(n.right, neg, "component", div);
        }
        return;
      }
      case "neg": walk(n.arg, !neg, "subtrahend", div); return;
      case "agg": case "percentile":
        walk(n.arg, neg, role, div);
        if (n.kind === "agg") n.more?.forEach((m) => walk(m, neg, role, div));
        if (n.where) walk(n.where, false, role, div);
        return;
      case "scalar": n.args.forEach((a) => walk(a, neg, role, div)); return;
      case "lag": {
        staged = true;
        const outer = lagged;
        lagged = true;
        walk(n.arg, neg, role, div);
        lagged = outer;
        return;
      }
      case "at": {
        const outer = point;
        point = point ?? n.point;
        walk(n.arg, neg, role, div);
        point = outer;
        return;
      }
      case "to_date": case "window": case "all_time": case "total": walk(n.arg, neg, role, div); return;
      case "compare": walk(n.left, false, role, div); walk(n.right, false, role, div); return;
      case "in": walk(n.arg, false, role, div); n.values.forEach((v) => walk(v, false, role, div)); return;
      case "isnull": case "not": walk(n.arg, false, role, div); return;
      case "logic": walk(n.left, false, role, div); walk(n.right, false, role, div); return;
      default: return;
    }
  };
  walk(f.expr, false, "base", null);

  return {
    metricRefs: [...metrics].sort(),
    fieldRefs: [...fields].sort(),
    metricRoles: roles,
    metricPolarity: Object.fromEntries(Object.entries(polarity).map(([k, v]) => [k, [...v].sort()])),
    staged,
    metricBaseline: baseline,
  };
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface ValidationContext {
  fields: Set<string>;
  metrics: Set<string>;
  /** Forms each metric declares (formulas.json `forms` keys); a form reference must name one of them */
  forms?: Record<string, string[]>;
  /** Declared values per enum field; literals compared to the field must be one of them */
  enums?: Record<string, string[]>;
  /** Datasets per field; every field inside one aggregate must share a dataset */
  datasets?: Record<string, string[]>;
}

/**
 * Semantic checks beyond syntax: references resolve, fields only appear inside
 * aggregates, aggregates do not nest, metric refs stay outside aggregates,
 * where-clauses and comparisons are boolean, and the result is numeric.
 */
/** True when an aggregate sits somewhere under the node. */
export function hasAggregate(n: Node): boolean {
  switch (n.kind) {
    case "agg": case "percentile": return true;
    case "binary": case "logic": case "compare": return hasAggregate(n.left) || hasAggregate(n.right);
    case "in": return hasAggregate(n.arg) || n.values.some(hasAggregate);
    case "scalar": return n.args.some(hasAggregate);
    case "neg": case "lag": case "window": case "all_time": case "total": case "at": case "to_date": case "not": case "isnull": return hasAggregate(n.arg);
    default: return false;
  }
}

/** True when a metric reference sits somewhere under the node. */
export function hasMetric(n: Node): boolean {
  switch (n.kind) {
    case "metric": return true;
    case "binary": case "logic": case "compare": return hasMetric(n.left) || hasMetric(n.right);
    case "in": return hasMetric(n.arg) || n.values.some(hasMetric);
    case "scalar": return n.args.some(hasMetric);
    case "neg": case "lag": case "window": case "all_time": case "total": case "at": case "to_date": case "not": case "isnull": return hasMetric(n.arg);
    default: return false;
  }
}

export function validateFormula(f: Formula, ctx: ValidationContext): string[] {
  const errors: string[] = [];
  const isBool = (n: Node) => ["compare", "in", "isnull", "logic", "not"].includes(n.kind);

  const walk = (n: Node, inAgg: boolean): void => {
    switch (n.kind) {
      case "metric":
        if (!ctx.metrics.has(n.id)) errors.push(`Unknown metric 'metric.${n.id}'`);
        else if (n.form && !(ctx.forms?.[n.id] ?? []).includes(n.form)) errors.push(`metric.${n.id} declares no ${n.form} form`);
        if (inAgg) errors.push(`metric.${n.id} cannot appear inside an aggregate`);
        return;
      case "field":
        if (!ctx.fields.has(n.id)) errors.push(`Unknown field 'field.${n.id}'`);
        if (!inAgg) errors.push(`field.${n.id} must appear inside an aggregate`);
        return;
      case "agg": case "percentile": {
        const fn = n.kind === "agg" ? n.fn : "percentile";
        if (inAgg) errors.push(`Nested aggregate ${fn}()`);
        const args = n.kind === "agg" ? [n.arg, ...(n.more ?? [])] : [n.arg];
        for (const a of args) {
          if (isBool(a)) errors.push(`${fn}() argument must be numeric or a field`);
          walk(a, true);
        }
        if (n.where) {
          if (!isBool(n.where)) errors.push(`${fn}() where-clause must be a condition`);
          walk(n.where, true);
        }
        return;
      }
      case "binary": case "compare":
        if (n.kind === "binary" && (isBool(n.left) || isBool(n.right))) errors.push(`Arithmetic on a condition`);
        walk(n.left, inAgg); walk(n.right, inAgg); return;
      case "logic":
        if (!isBool(n.left) || !isBool(n.right)) errors.push(`'${n.op}' needs conditions on both sides`);
        walk(n.left, inAgg); walk(n.right, inAgg); return;
      case "not":
        if (!isBool(n.arg)) errors.push(`'not' needs a condition`);
        walk(n.arg, inAgg); return;
      case "window": case "all_time":
        if (inAgg) errors.push(`${n.kind}() cannot appear inside an aggregate`);
        else if (!hasAggregate(n.arg)) errors.push(`${n.kind}() must wrap an aggregate`);
        walk(n.arg, inAgg); return;
      case "total":
        if (inAgg) errors.push("total() cannot appear inside an aggregate");
        else if (!hasAggregate(n.arg) && !hasMetric(n.arg)) errors.push("total() must wrap an aggregate or a metric");
        walk(n.arg, inAgg); return;
      case "neg": case "lag": case "at": case "to_date": case "isnull": walk(n.arg, inAgg); return;
      case "in": walk(n.arg, inAgg); n.values.forEach((v) => walk(v, inAgg)); return;
      case "scalar": n.args.forEach((a) => walk(a, inAgg)); return;
      default: return;
    }
  };

  if (isBool(f.expr)) errors.push("Formula must produce a number, not a condition");
  walk(f.expr, false);
  if (ctx.enums) {
    const checkLit = (fieldNode: Node, lit: Node) => {
      if (fieldNode.kind !== "field" || lit.kind !== "string") return;
      const allowed = ctx.enums![fieldNode.id];
      if (allowed && !allowed.includes(lit.value)) errors.push(`'${lit.value}' is not a declared value of field.${fieldNode.id} (${allowed.join(", ")})`);
    };
    const scan = (n: Node): void => {
      switch (n.kind) {
        case "compare": checkLit(n.left, n.right); checkLit(n.right, n.left); scan(n.left); scan(n.right); return;
        case "in": n.values.forEach((v) => checkLit(n.arg, v)); scan(n.arg); return;
        case "binary": case "logic": scan(n.left); scan(n.right); return;
        case "agg": case "percentile": scan(n.arg); if (n.kind === "agg") n.more?.forEach(scan); if (n.where) scan(n.where); return;
        case "scalar": n.args.forEach(scan); return;
        case "neg": case "lag": case "window": case "all_time": case "total": case "at": case "to_date": case "not": case "isnull": scan(n.arg); return;
        default: return;
      }
    };
    scan(f.expr);
  }
  if (ctx.datasets) {
    const fieldsOf = (n: Node, out: string[] = []): string[] => {
      switch (n.kind) {
        case "field": out.push(n.id); return out;
        case "binary": case "logic": case "compare": fieldsOf(n.left, out); fieldsOf(n.right, out); return out;
        case "in": fieldsOf(n.arg, out); n.values.forEach((v) => fieldsOf(v, out)); return out;
        case "scalar": n.args.forEach((a) => fieldsOf(a, out)); return out;
        case "neg": case "lag": case "window": case "all_time": case "total": case "at": case "to_date": case "not": case "isnull": return fieldsOf(n.arg, out);
        case "agg": case "percentile": fieldsOf(n.arg, out); if (n.kind === "agg") n.more?.forEach((m) => fieldsOf(m, out)); if (n.where) fieldsOf(n.where, out); return out;
        default: return out;
      }
    };
    const scanAgg = (n: Node): void => {
      if (n.kind === "agg" || n.kind === "percentile") {
        const ids = [...new Set(fieldsOf(n))].filter((id) => ctx.datasets![id]);
        if (ids.length > 1) {
          const shared = ids.map((id) => new Set(ctx.datasets![id])).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
          if (shared.size === 0) errors.push(`Aggregate mixes fields from different datasets: ${ids.join(", ")}`);
        }
        return;
      }
      switch (n.kind) {
        case "binary": case "logic": case "compare": scanAgg(n.left); scanAgg(n.right); return;
        case "scalar": n.args.forEach(scanAgg); return;
        case "neg": case "lag": case "window": case "all_time": case "total": case "at": case "to_date": case "not": case "isnull": scanAgg(n.arg); return;
        default: return;
      }
    };
    scanAgg(f.expr);
    if (f.cohort && ctx.datasets[f.cohort.key] === undefined) errors.push(`Cohort key field.${f.cohort.key} has no dataset`);
  }
  if (f.cohort && !ctx.fields.has(f.cohort.key)) errors.push(`Unknown cohort key 'field.${f.cohort.key}'`);
  return [...new Set(errors)];
}
