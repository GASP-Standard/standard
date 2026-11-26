/**
 * The account cohort table: one row per customer per reporting period.
 *
 * A retention metric follows the customers live on the first day of a period
 * through that period. Staged one metric at a time, each of them is a
 * per-period dataset holding a single value, which a query layer can read and
 * do nothing else with. This table holds the cohort itself: a row for every
 * customer live at period start, with the amounts the retention formulas sum.
 * A metric the table serves is then an ordinary Ossie expression over it,
 * `SUM(gasp_account_cohorts.<column>)` terms combined as the formula combines
 * them, and a consumer can slice the same rows by customer.
 *
 * The table also carries each dimension a served breakdown groups the members
 * by (the customer's segment on the cohort's day), read from the key's dataset
 * beside the key, so NRR by segment is NRR's expression grouped by that column.
 *
 * Each column is a fragment of the GASP grammar. A formula over the same
 * cohort is served when every aggregate in it sits inside a fragment that
 * equals a column (metrics.ts matches the parsed fragments); a formula that
 * reads anything else keeps its own staged dataset. A column must be additive
 * across customers, sums and their negations only, so that the sum of the
 * column over a period's rows is the aggregate over that period's cohort.
 *
 * The compiled SQL of each column comes from compile.ts (compileCohortTable),
 * so a column and the metric it serves read the same rows by the same rules.
 */
import { parseFormula, type Node, type Point } from "../formula.js";
import type { MetricFormula } from "../types.js";

export interface CohortColumn {
  name: string;
  /** The grammar fragment the column holds for one customer and period */
  formula: string;
  description: string;
}

export interface CohortTableSpec {
  /** The dataset's name in the model */
  name: string;
  cohort: { key: string; point: Point };
  columns: CohortColumn[];
}

export const ACCOUNT_COHORTS: CohortTableSpec = {
  name: "gasp_account_cohorts",
  cohort: { key: "customer_id", point: "period_start" },
  columns: [
    { name: "opening_mrr", formula: "metric.mrr at period_start", description: "The customer's MRR on the first day of the period" },
    { name: "expansion_mrr", formula: "metric.expansion_mrr", description: "Expansion MRR from the customer in the period" },
    {
      name: "expansion_mrr_o",
      formula: "sum(field.mrr_change where field.event_type = 'expansion' and field.expansion_classification in ('same_product', 'usage_realisation'))",
      description: "Expansion MRR in the period that the Operating form of Net Revenue Retention counts: same product and usage realisation",
    },
    {
      name: "expansion_mrr_m",
      formula: "sum(field.mrr_change where field.event_type in ('expansion', 'reactivation') and field.expansion_classification in ('same_product', 'new_module', 'new_buying_centre', 'pricing_adjustment', 'recontracting', 'usage_realisation'))",
      description: "Expansion and reactivation MRR in the period that the Market form of Net Revenue Retention counts",
    },
    { name: "contraction_mrr", formula: "metric.contraction_mrr", description: "Contraction MRR from the customer in the period, as a positive amount" },
    {
      name: "usage_reversal",
      formula: "sum(field.mrr_change where field.event_type = 'contraction' and field.expansion_classification = 'usage_realisation')",
      description: "The contraction that reverses the customer's realised usage in the period, a negative amount or zero. Gross Revenue Retention and Revenue Churn Rate add it to Contraction MRR, which leaves usage above a commitment out of both",
    },
    { name: "churned_mrr", formula: "metric.churned_mrr", description: "Churned MRR from the customer in the period, as a positive amount" },
    { name: "mrr_start", formula: "sum(field.mrr_start)", description: "The customer's MRR at period start as its subscription rows carry it on the last day of the period (mrr_start)" },
    {
      name: "temporary_opening",
      formula: "sum(field.mrr_change where ((field.change_nature = 'temporary' and field.event_type in ('new', 'expansion', 'reactivation')) or (field.change_nature = 'scheduled_reversal' and field.event_type in ('contraction', 'churn'))) and (field.expansion_classification is null or field.expansion_classification != 'usage_realisation')) at period_start",
      description: "The customer's temporary revenue still running on the first day of the period: the increases tagged temporary less their scheduled reversals, realised usage apart. Adjusted Net and Gross Revenue Retention take it off opening MRR",
    },
    { name: "retained_mrr", formula: "sum(min(field.mrr_end, field.mrr_start))", description: "The lesser of opening and closing MRR on each of the customer's subscription rows, summed: what was kept, expansion left out" },
    {
      name: "permanent_change",
      formula: "sum(field.mrr_change where field.event_type in ('expansion', 'contraction', 'churn') and field.change_nature = 'permanent')",
      description: "The net of the customer's permanent expansion, contraction and churn in the period (Adjusted Net Revenue Retention)",
    },
    {
      name: "permanent_loss",
      formula: "sum(field.mrr_change where field.event_type in ('contraction', 'churn') and field.change_nature = 'permanent')",
      description: "The customer's permanent contraction and churn in the period, a negative amount or zero (Adjusted Gross Revenue Retention)",
    },
  ],
};

const parsed = new Map<CohortTableSpec, Array<{ name: string; shape: string }>>();
const shapes = (t: CohortTableSpec) => {
  let s = parsed.get(t);
  if (!s) {
    s = t.columns.map((c) => ({ name: c.name, shape: JSON.stringify(parseFormula(c.formula).expr) }));
    parsed.set(t, s);
  }
  return s;
};

/** The column of `t` that holds exactly this fragment, if one does. */
export function cohortColumn(t: CohortTableSpec, n: Node): string | undefined {
  // Only these can open a column's fragment; the rest of a formula is arithmetic over them.
  if (n.kind !== "metric" && n.kind !== "agg" && n.kind !== "at" && n.kind !== "neg") return undefined;
  const shape = JSON.stringify(n);
  return shapes(t).find((c) => c.shape === shape)?.name;
}

/** True when a formula's cohort is the table's: the same key at the same point, with no condition of its own. */
export function sameCohort(t: CohortTableSpec, cohort: { key: string; point: Point; where?: Node } | undefined): boolean {
  return !!cohort && cohort.key === t.cohort.key && cohort.point === t.cohort.point && !cohort.where;
}

/**
 * What is wrong with a table's declaration, if anything: a column that does not
 * parse, declares a cohort, repeats another or is not additive across the key
 * (anything but sums, their negations, sums and differences of those and
 * references to metrics made of them).
 */
export function cohortTableProblems(t: CohortTableSpec, formulas: Record<string, MetricFormula>): string[] {
  const problems: string[] = [];
  const additive = (n: Node, path: string[]): boolean => {
    switch (n.kind) {
      case "agg": return n.fn === "sum" && !n.more?.length;
      case "neg": case "at": return additive(n.arg, path);
      case "binary": return (n.op === "+" || n.op === "-") && additive(n.left, path) && additive(n.right, path);
      case "metric": {
        if (path.includes(n.id)) return false;
        const src = n.form ? formulas[n.id]?.forms?.[n.form] : formulas[n.id]?.formula;
        if (!src) return false;
        const f = parseFormula(src);
        return !f.cohort && additive(f.expr, [...path, n.id]);
      }
      default: return false;
    }
  };
  const seen = new Map<string, string>();
  for (const c of t.columns) {
    let f;
    try { f = parseFormula(c.formula); } catch (e) { problems.push(`${t.name}.${c.name}: ${(e as Error).message}`); continue; }
    if (f.cohort) problems.push(`${t.name}.${c.name} declares a cohort of its own`);
    if (!additive(f.expr, [])) problems.push(`${t.name}.${c.name} is not additive across ${t.cohort.key}: only sums, their negations and sums of those can be summed again`);
    const shape = JSON.stringify(f.expr);
    if (seen.has(shape)) problems.push(`${t.name}.${c.name} repeats ${seen.get(shape)}`);
    seen.set(shape, c.name);
  }
  return problems;
}
