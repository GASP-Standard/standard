/**
 * The ontology's value-range rules (ontology.json validationRules, the `min`
 * and `max` entries) in the scale a canonical formula computes, shared by the
 * readiness checks (a range check per metric, counted per period over the
 * company's warehouse) and the drift scorer (a company's own value outside
 * the range on the synthetic dataset).
 *
 * GASP ratios are unscaled and `unit` says how to display them, so NRR is
 * 1.07 where the rule says 107 percent: a `percent` rule on a `percent`
 * formula is divided by 100. Every other rule is taken as written (NPS
 * multiplies by 100 in its formula and its rule carries no unit; ARR, CAC
 * Payback and LTV:CAC are raw).
 */
import { isMetricStub, metricFormulaId } from "./loader.js";
import type { Metric, StandardData } from "./types.js";

export interface RangeRule {
  metric: Metric;
  formulaId: string;
  min?: number;
  max?: number;
  /** The rule's notes, when the ontology gives any */
  notes: string[];
}

/** The scaled bounds for one metric, or undefined when it has no range rule. */
export function rangeRule(data: StandardData, metric: Metric): RangeRule | undefined {
  const rules = data.ontology?.validationRules?.[metric.slug]?.filter((r) => (r.type === "min" || r.type === "max") && typeof r.value === "number") ?? [];
  if (!rules.length) return undefined;
  const formulaId = metricFormulaId(data, metric);
  const unit = data.formulas?.[formulaId]?.unit;
  const scale = (r: { value?: string | number; unit?: string }) => (r.unit === "percent" && unit === "percent" ? Number(r.value) / 100 : Number(r.value));
  const out: RangeRule = { metric, formulaId, notes: rules.map((r) => r.note).filter((n): n is string => Boolean(n)) };
  for (const r of rules) {
    if (r.type === "min") out.min = scale(r);
    else out.max = scale(r);
  }
  return out;
}

/** Every metric with a range rule, stubs left out, in the order the metrics are listed. */
export function rangeRules(data: StandardData): RangeRule[] {
  return data.metrics.filter((m) => !isMetricStub(m)).map((m) => rangeRule(data, m)).filter((r): r is RangeRule => Boolean(r));
}

/** The bound a value breaks, or undefined when it is inside the range (a null value breaks nothing). */
export function outOfRange(value: number | null, rule: RangeRule): { bound: "min" | "max"; limit: number } | undefined {
  if (value === null || !Number.isFinite(value)) return undefined;
  if (rule.min !== undefined && value < rule.min) return { bound: "min", limit: rule.min };
  if (rule.max !== undefined && value > rule.max) return { bound: "max", limit: rule.max };
  return undefined;
}

/** "between 0 and 1", "at least 0" or "at most 1". */
export function describeRange(rule: RangeRule): string {
  if (rule.min !== undefined && rule.max !== undefined) return `between ${rule.min} and ${rule.max}`;
  return rule.min !== undefined ? `at least ${rule.min}` : `at most ${rule.max}`;
}
