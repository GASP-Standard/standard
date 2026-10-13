/**
 * Enum filters a formula applies: every `field = 'x'`, `field != 'x'`,
 * `field in (...)` and `field not in (...)` comparison on an enum field,
 * collected through metric and form references. get_formula prints them per
 * form, so forms that read the same fields (LTV-O and LTV-M) show where they
 * differ.
 */
import { parseFormula, type Node, type Form } from "./formula.js";
import type { MetricFormula, OntologyField } from "./types.js";

export interface FilterContext {
  fields: Record<string, Pick<OntologyField, "type">>;
  formulas: Record<string, MetricFormula>;
}

export interface EnumFilter {
  field: string;
  /** Values compared with = or in */
  include: string[];
  /** Values compared with != or not in */
  exclude: string[];
}

/** The enum filters of a formula source, merged per field, fields and values sorted. */
export function enumFilters(src: string, ctx: FilterContext): EnumFilter[] {
  const acc = new Map<string, { include: Set<string>; exclude: Set<string> }>();
  const seen = new Set<string>();
  const add = (field: string, values: string[], negated: boolean) => {
    const e = acc.get(field) ?? { include: new Set<string>(), exclude: new Set<string>() };
    acc.set(field, e);
    for (const v of values) (negated ? e.exclude : e.include).add(v);
  };
  const isEnum = (n: Node): n is Extract<Node, { kind: "field" }> => n.kind === "field" && ctx.fields[n.id]?.type === "enum";
  const metric = (id: string, form?: Form) => {
    const key = form ? `${id}.${form}` : id;
    if (seen.has(key)) return;
    seen.add(key);
    const f = ctx.formulas[id];
    const s = form ? f?.forms?.[form] : f?.formula;
    if (s) visit(parseFormula(s).expr);
  };
  const visit = (n: Node): void => {
    switch (n.kind) {
      case "metric": metric(n.id, n.form); return;
      case "compare":
        if ((n.op === "=" || n.op === "!=") && isEnum(n.left) && n.right.kind === "string") add(n.left.id, [n.right.value], n.op === "!=");
        else if ((n.op === "=" || n.op === "!=") && isEnum(n.right) && n.left.kind === "string") add(n.right.id, [n.left.value], n.op === "!=");
        visit(n.left); visit(n.right); return;
      case "in":
        if (isEnum(n.arg)) add(n.arg.id, n.values.flatMap((v) => (v.kind === "string" ? [v.value] : [])), n.negated);
        visit(n.arg); n.values.forEach(visit); return;
      case "binary": case "logic": visit(n.left); visit(n.right); return;
      case "scalar": n.args.forEach(visit); return;
      case "agg": visit(n.arg); n.more?.forEach(visit); if (n.where) visit(n.where); return;
      case "percentile": visit(n.arg); if (n.where) visit(n.where); return;
      case "neg": case "lag": case "window": case "all_time": case "total": case "at": case "to_date": case "not": case "isnull": visit(n.arg); return;
      default: return;
    }
  };
  visit(parseFormula(src).expr);
  return [...acc.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([field, e]) => ({ field, include: [...e.include].sort(), exclude: [...e.exclude].sort() }));
}

/** "cost_function in (gtm, implementation, onboarding); event_type = new" */
export function formatFilters(filters: EnumFilter[]): string {
  const part = (field: string, values: string[], negated: boolean) =>
    values.length === 1 ? `${field} ${negated ? "!=" : "="} ${values[0]}` : `${field} ${negated ? "not in" : "in"} (${values.join(", ")})`;
  return filters
    .flatMap((f) => [...(f.include.length ? [part(f.field, f.include, false)] : []), ...(f.exclude.length ? [part(f.field, f.exclude, true)] : [])])
    .join("; ");
}
