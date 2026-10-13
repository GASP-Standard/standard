import { describe, it, expect } from "vitest";
import { parseFormula, analyzeFormula, validateFormula, FormulaError } from "../src/formula.js";
import { compileMetric } from "../src/compile.js";
import { DIALECT, DIALECTS, dialectOfWarehouse, type DialectName } from "../src/dialect.js";
import type { MetricFormula } from "../src/types.js";

const ctx = {
  fields: new Set(["mrr", "status", "account_id", "mrr_change", "change_type", "mrr_start", "mrr_end", "nps_score"]),
  metrics: new Set(["mrr", "arr", "churned_mrr", "contraction_mrr", "expansion_mrr"]),
  forms: { arr: ["O", "M"] } as Record<string, string[]>,
};
const errorsOf = (src: string) => validateFormula(parseFormula(src), ctx);

describe("parseFormula", () => {
  it("parses arithmetic with standard precedence", () => {
    const f = parseFormula("metric.mrr + metric.arr * 12");
    expect(f.expr).toMatchObject({ kind: "binary", op: "+", right: { kind: "binary", op: "*" } });
  });

  it("parses aggregates with where-clauses", () => {
    const f = parseFormula("sum(field.mrr_change where field.change_type in ('new', 'expansion'))");
    expect(f.expr).toMatchObject({
      kind: "agg", fn: "sum", arg: { kind: "field", id: "mrr_change" },
      where: { kind: "in", values: [{ value: "new" }, { value: "expansion" }], negated: false },
    });
  });

  it("binds `at` to the nearest operand", () => {
    const f = parseFormula("metric.churned_mrr / metric.mrr at period_start");
    expect(f.expr).toMatchObject({ kind: "binary", op: "/", right: { kind: "at", point: "period_start" } });
  });

  it("treats two-argument min/max as scalar and one-argument as aggregate", () => {
    expect(parseFormula("sum(min(field.mrr_end, field.mrr_start))").expr)
      .toMatchObject({ kind: "agg", fn: "sum", arg: { kind: "scalar", fn: "min" } });
    expect(parseFormula("min(field.mrr)").expr).toMatchObject({ kind: "agg", fn: "min" });
  });

  it("parses lag and cohort clauses", () => {
    const f = parseFormula("(metric.arr - lag(metric.arr, 1 year)) / lag(metric.arr, 1 year) over cohort(field.account_id, period_start)");
    expect(f.cohort).toEqual({ key: "account_id", point: "period_start" });
    expect(analyzeFormula(f).staged).toBe(true);
  });

  it("parses boolean literals in filters", () => {
    expect(parseFormula("count(field.account_id where field.status = true)").expr)
      .toMatchObject({ where: { kind: "compare", right: { kind: "boolean", value: true } } });
    expect(errorsOf("count(field.account_id where field.status = false)")).toEqual([]);
  });

  it("parses percentile and period_days", () => {
    expect(parseFormula("percentile(field.mrr, 0.95 where field.status = 'active')").expr)
      .toMatchObject({ kind: "percentile", p: 0.95, where: { kind: "compare" } });
    expect(errorsOf("1 - sum(field.mrr) / (period_days * 1440)")).toEqual([]);
    expect(() => parseFormula("percentile(field.mrr, 95)")).toThrow("between 0 and 1");
    expect(errorsOf("percentile(metric.mrr, 0.5)")).toContain("metric.mrr cannot appear inside an aggregate");
  });

  it("expands in_period() to two bound comparisons", () => {
    const f = parseFormula("count(field.account_id where in_period(field.mrr))");
    expect(f.expr).toMatchObject({ where: { kind: "logic", op: "and", left: { op: ">=" }, right: { op: "<=" } } });
    expect(() => parseFormula("in_period(metric.mrr)")).toThrow("takes a field");
  });

  it("parses window and all_time around an aggregate", () => {
    expect(parseFormula("window(count_distinct(field.account_id), 7 day)").expr).toMatchObject({ kind: "window", n: 7, unit: "day", arg: { kind: "agg" } });
    expect(parseFormula("all_time(sum(field.mrr))").expr).toMatchObject({ kind: "all_time", arg: { kind: "agg", fn: "sum" } });
    expect(errorsOf("window(count_distinct(field.account_id), 30 day) / count(field.account_id)")).toEqual([]);
    expect(errorsOf("window(metric.mrr, 1 month)")).toContain("window() must wrap an aggregate");
    expect(errorsOf("sum(all_time(field.mrr))")).toContain("all_time() cannot appear inside an aggregate");
    expect(() => parseFormula("window(sum(field.mrr), 0 day)")).toThrow("positive number");
    expect(() => parseFormula("window(sum(field.mrr), 1 fortnight)")).toThrow("unit must be one of");
    expect(analyzeFormula(parseFormula("window(sum(field.mrr), 1 quarter)")).staged).toBe(false);
  });

  it("parses to_date and period bounds as values", () => {
    expect(parseFormula("sum(field.mrr) to_date - sum(field.mrr) to_date").expr).toMatchObject({ kind: "binary", left: { kind: "to_date" } });
    expect(errorsOf("count(field.account_id where field.mrr >= period_start and field.mrr <= period_end)")).toEqual([]);
  });

  it("parses not in, is null and boolean logic", () => {
    const f = parseFormula("count(field.account_id where field.status not in ('trial') and not field.mrr is null)");
    expect(f.expr).toMatchObject({ where: { kind: "logic", op: "and", left: { kind: "in", negated: true }, right: { kind: "not" } } });
  });

  it.each([
    ["metric.mrr +", "Unexpected 'end'"],
    ["sum(field.mrr", "Expected ')'"],
    ["foo(field.mrr)", "Unknown function 'foo'"],
    ["table.mrr", "Unknown reference"],
    ["lag(metric.mrr, 1 decade)", "unit must be one of"],
    ["metric.mrr at today", "period_start or period_end"],
    ["sum(field.mrr) 12", "Unexpected '12'"],
    ["'unterminated", "Unterminated string"],
  ])("rejects %s", (src, message) => {
    expect(() => parseFormula(src)).toThrow(FormulaError);
    expect(() => parseFormula(src)).toThrow(message);
  });
});

describe("validateFormula", () => {
  it("accepts a well-formed formula", () => {
    expect(errorsOf("(metric.mrr at period_start - metric.churned_mrr) / metric.mrr at period_start over cohort(field.account_id, period_start)")).toEqual([]);
  });

  it("rejects unknown references", () => {
    expect(errorsOf("metric.nope + sum(field.nope)")).toEqual(["Unknown metric 'metric.nope'", "Unknown field 'field.nope'"]);
  });

  it("requires fields inside aggregates and metrics outside them", () => {
    expect(errorsOf("field.mrr * 12")).toContain("field.mrr must appear inside an aggregate");
    expect(errorsOf("sum(metric.mrr)")).toContain("metric.mrr cannot appear inside an aggregate");
  });

  it("rejects nested aggregates and non-boolean filters", () => {
    expect(errorsOf("sum(sum(field.mrr))")).toContain("Nested aggregate sum()");
    expect(errorsOf("sum(field.mrr where field.status)")).toContain("sum() where-clause must be a condition");
  });

  it("rejects a formula that yields a condition", () => {
    expect(errorsOf("sum(field.mrr) > 0")).toContain("Formula must produce a number, not a condition");
  });
});

describe("analyzeFormula", () => {
  it("derives polarity: subtracted and denominator refs are negative", () => {
    const a = analyzeFormula(parseFormula("(metric.mrr + metric.expansion_mrr - metric.churned_mrr) / metric.arr"));
    expect(a.metricPolarity).toEqual({
      mrr: ["positive"], expansion_mrr: ["positive"], churned_mrr: ["negative"], arr: ["negative"],
    });
  });

  it("flips twice for a subtracted term in a denominator", () => {
    const a = analyzeFormula(parseFormula("metric.mrr / (metric.arr - metric.churned_mrr)"));
    expect(a.metricPolarity.churned_mrr).toEqual(["positive"]);
  });

  it("collects field refs, including the cohort key, and ignores filters for polarity", () => {
    const a = analyzeFormula(parseFormula("sum(field.mrr where field.status = 'active') over cohort(field.account_id, period_start)"));
    expect(a.fieldRefs).toEqual(["account_id", "mrr", "status"]);
    expect(a.metricRefs).toEqual([]);
  });

  it("flags a ref read only at period_start or under lag as a baseline input", () => {
    const nrr = analyzeFormula(parseFormula("(metric.mrr at period_start + metric.expansion_mrr - metric.churned_mrr) / metric.mrr at period_start over cohort(field.account_id, period_start)"));
    expect(nrr.metricBaseline).toEqual({ mrr: true, expansion_mrr: false, churned_mrr: false });
    expect(analyzeFormula(parseFormula("metric.mrr / metric.arr")).metricBaseline).toEqual({ mrr: false, arr: false });
    expect(analyzeFormula(parseFormula("metric.arr - lag(metric.arr, 1 year)")).metricBaseline).toEqual({ arr: false });
    expect(analyzeFormula(parseFormula("metric.mrr / lag(metric.arr, 1 year)")).metricBaseline).toEqual({ mrr: false, arr: true });
    // The outermost at wins, as in the compiler.
    expect(analyzeFormula(parseFormula("(metric.mrr at period_end) at period_start")).metricBaseline).toEqual({ mrr: true });
    expect(analyzeFormula(parseFormula("(metric.mrr at period_start) at period_end")).metricBaseline).toEqual({ mrr: false });
  });

  it("marks plain aggregates as not staged", () => {
    expect(analyzeFormula(parseFormula("sum(field.mrr) at period_end")).staged).toBe(false);
  });
});

describe("form references", () => {
  it("parses metric.<id>.O and .M into a metric node with a form", () => {
    expect(parseFormula("metric.arr.O").expr).toEqual({ kind: "metric", id: "arr", form: "O" });
    expect(parseFormula("metric.arr.M * 2").expr).toMatchObject({ kind: "binary", left: { kind: "metric", id: "arr", form: "M" } });
    expect(parseFormula("metric.arr").expr).toEqual({ kind: "metric", id: "arr" });
  });

  it("validates a form the metric declares", () => {
    expect(errorsOf("metric.arr.O - metric.arr.M")).toEqual([]);
  });

  it("rejects a form the metric does not declare", () => {
    expect(errorsOf("metric.mrr.O")).toEqual(["metric.mrr declares no O form"]);
  });

  it("rejects any suffix other than .O or .M, and a second dot on fields", () => {
    expect(() => parseFormula("metric.arr.X")).toThrow(FormulaError);
    expect(() => parseFormula("metric.arr.O.M")).toThrow(FormulaError);
    expect(() => parseFormula("field.mrr.O")).toThrow(FormulaError);
  });

  it("reports the bare metric id to analysis, so graph edges are unchanged", () => {
    const a = analyzeFormula(parseFormula("metric.mrr * metric.arr.O / metric.churned_mrr"));
    expect(a.metricRefs).toEqual(["arr", "churned_mrr", "mrr"]);
  });
});

describe("distinct pairs, total() and breakdowns", () => {
  const fields: Record<string, any> = {
    ticket_id: { id: "ticket_id", type: "string", datasets: ["ticket"] },
    created_at: { id: "created_at", type: "timestamp", datasets: ["ticket"] },
    ticket_type: { id: "ticket_type", type: "enum", datasets: ["ticket"], values: ["bug", "how_to"] },
    agent_id: { id: "agent_id", type: "string", datasets: ["ticket"] },
    customer_id: { id: "customer_id", type: "string", datasets: ["ticket", "customer"] },
    snapshot_date: { id: "snapshot_date", type: "date", datasets: ["customer"] },
    cost: { id: "cost", type: "decimal", datasets: ["cost_event"] },
    event_date: { id: "event_date", type: "date", datasets: ["cost_event"] },
  };
  const datasets: Record<string, any> = {
    ticket: { kind: "event", date: "created_at", key: "ticket_id" },
    customer: { kind: "snapshot", date: "snapshot_date", key: "customer_id" },
    cost_event: { kind: "event", date: "event_date", key: "event_id" },
  };
  const compile = (formula: string, breakdown?: string, extra: Record<string, MetricFormula> = {}) =>
    compileMetric("t", { fields, datasets, formulas: { volume: { formula: "count(field.ticket_id)", unit: "count" }, ...extra, t: { formula, unit: "percent", ...(breakdown ? { breakdown } : {}) } } });

  it("parses count_distinct over several arguments, with or without a where clause", () => {
    expect(parseFormula("count_distinct(field.customer_id, field.ticket_id)").expr).toMatchObject({
      kind: "agg", fn: "count_distinct", arg: { kind: "field", id: "customer_id" }, more: [{ kind: "field", id: "ticket_id" }],
    });
    expect(parseFormula("count_distinct(field.customer_id, field.ticket_id where field.agent_id = 'a1')").expr).toMatchObject({
      more: [{ id: "ticket_id" }], where: { kind: "compare" },
    });
    expect(analyzeFormula(parseFormula("count_distinct(field.customer_id, field.ticket_id)")).fieldRefs).toEqual(["customer_id", "ticket_id"]);
    expect(() => parseFormula("sum(field.mrr, field.mrr_end)")).toThrow("takes one argument");
    expect(() => parseFormula("max(field.mrr, field.mrr_end where field.status = 'active')")).toThrow("does not take a where clause");
  });

  it("compiles distinct pairs to a portable derived table that skips null parts", () => {
    const c = compile("count_distinct(field.customer_id, field.agent_id)");
    expect(c.sql).toBe(
      "SELECT (SELECT COUNT(*) FROM (SELECT DISTINCT {{customer_id@ticket}}, {{agent_id@ticket}} FROM {{_table:ticket}} WHERE {{created_at@ticket}} >= {{_period_start}} AND {{created_at@ticket}} < ({{_period_end}} + INTERVAL '1 day') AND {{customer_id@ticket}} IS NOT NULL AND {{agent_id@ticket}} IS NOT NULL) _pairs) AS t",
    );
    expect(errorsOf("count_distinct(field.mrr, field.status where field.status = 'active')")).toEqual([]);
  });

  it("parses total() and validates its placement", () => {
    expect(parseFormula("count(field.mrr) / total(count(field.mrr))").expr).toMatchObject({ kind: "binary", right: { kind: "total", arg: { kind: "agg" } } });
    expect(errorsOf("sum(field.mrr) / total(metric.mrr)")).toEqual([]);
    expect(errorsOf("sum(total(field.mrr))")).toContain("total() cannot appear inside an aggregate");
    expect(errorsOf("sum(field.mrr) / total(2)")).toContain("total() must wrap an aggregate or a metric");
  });

  it("compiles a breakdown over an enum field: literal domain, grouped aggregates, total() ungrouped through a metric ref", () => {
    const c = compile("count(field.ticket_id) / total(metric.volume)", "field.ticket_type");
    expect(c.breakdown).toEqual({ field: "ticket_type" });
    expect(c.fields).toContain("ticket_type");
    expect(c.placeholders).toContain("ticket_type@ticket");
    expect(c.sql).toBe(
      "SELECT _d.ticket_type AS ticket_type, (CAST((SELECT COUNT({{ticket_id@ticket}}) FROM {{_table:ticket}} WHERE {{created_at@ticket}} >= {{_period_start}} AND {{created_at@ticket}} < ({{_period_end}} + INTERVAL '1 day') AND {{ticket_type@ticket}} = _d.ticket_type) AS DOUBLE PRECISION) / NULLIF(((SELECT COUNT({{ticket_id@ticket}}) FROM {{_table:ticket}} WHERE {{created_at@ticket}} >= {{_period_start}} AND {{created_at@ticket}} < ({{_period_end}} + INTERVAL '1 day'))), 0)) AS t\n" +
      "FROM (SELECT 'bug' AS ticket_type UNION ALL SELECT 'how_to' AS ticket_type) _d",
    );
  });

  it("takes a non-enum domain from the dataset keyed by the field, else the first dataset read that carries it", () => {
    const keyed = compile("count(field.ticket_id)", "field.customer_id");
    expect(keyed.sql).toMatch(/\nFROM \(SELECT DISTINCT \{\{customer_id@customer\}\} AS customer_id FROM \{\{_table:customer\}\} WHERE \{\{customer_id@customer\}\} IS NOT NULL\) _d$/);
    expect(keyed.datasets).toEqual(["customer", "ticket"]);
    const read = compile("count(field.ticket_id)", "field.agent_id");
    expect(read.sql).toMatch(/\nFROM \(SELECT DISTINCT \{\{agent_id@ticket\}\} AS agent_id FROM \{\{_table:ticket\}\} WHERE \{\{agent_id@ticket\}\} IS NOT NULL\) _d$/);
  });

  it("compiles a named breakdown like a variant: main formula, grouped by its field", () => {
    const formulas: Record<string, MetricFormula> = {
      volume: { formula: "count(field.ticket_id)", unit: "count", variants: { escalated: "count(field.ticket_id where field.agent_id = 'a1')" }, breakdowns: { by_type: "field.ticket_type", by_agent: "field.agent_id" } },
    };
    const ctx = { fields, datasets, formulas };
    const plain = compileMetric("volume", ctx);
    expect(plain.breakdown).toBeUndefined();
    expect(plain.sql).toBe("SELECT (SELECT COUNT({{ticket_id@ticket}}) FROM {{_table:ticket}} WHERE {{created_at@ticket}} >= {{_period_start}} AND {{created_at@ticket}} < ({{_period_end}} + INTERVAL '1 day')) AS volume");
    const byType = compileMetric("volume", ctx, "by_type");
    expect(byType.breakdown).toEqual({ field: "ticket_type" });
    expect(byType.sql).toBe(
      "SELECT _d.ticket_type AS ticket_type, (SELECT COUNT({{ticket_id@ticket}}) FROM {{_table:ticket}} WHERE {{created_at@ticket}} >= {{_period_start}} AND {{created_at@ticket}} < ({{_period_end}} + INTERVAL '1 day') AND {{ticket_type@ticket}} = _d.ticket_type) AS volume\n" +
      "FROM (SELECT 'bug' AS ticket_type UNION ALL SELECT 'how_to' AS ticket_type) _d",
    );
    expect(compileMetric("volume", ctx, "by_agent").sql).toMatch(/\nFROM \(SELECT DISTINCT \{\{agent_id@ticket\}\} AS agent_id FROM \{\{_table:ticket\}\} WHERE \{\{agent_id@ticket\}\} IS NOT NULL\) _d$/);
    expect(compileMetric("volume", ctx, "escalated").breakdown).toBeUndefined();
    expect(() => compileMetric("volume", { ...ctx, formulas: { volume: { ...formulas.volume, breakdowns: { by_x: "field.nope" } } } }, "by_x")).toThrow("'volume:by_x' breakdown names unknown field");
    expect(() => compileMetric("volume", { ...ctx, formulas: { volume: { formula: "sum(field.cost)", unit: "currency", breakdowns: { by_type: "field.ticket_type" } } } }, "by_type"))
      .toThrow("reads dataset 'cost_event', which has no ticket_type field");
  });

  it("compiles a breakdown in total mode: grouped where the dataset carries the field, whole elsewhere", () => {
    const withCentre = { ...fields, cost_centre: { id: "cost_centre", type: "enum", datasets: ["cost_event"], values: ["marketing", "sales"] } };
    const formulas: Record<string, MetricFormula> = {
      spend: { formula: "sum(field.cost) / count(field.ticket_id)", unit: "currency", breakdowns: { by_centre: { field: "field.cost_centre", total: true }, strict: "field.cost_centre" } },
    };
    const ctx = { fields: withCentre, datasets, formulas };
    const c = compileMetric("spend", ctx, "by_centre");
    expect(c.breakdown).toEqual({ field: "cost_centre", total: true });
    expect(c.sql.match(/= _d\.cost_centre/g)).toHaveLength(1);
    expect(c.sql).toBe(
      "SELECT _d.cost_centre AS cost_centre, (CAST((SELECT SUM({{cost@cost_event}}) FROM {{_table:cost_event}} WHERE {{event_date@cost_event}} >= {{_period_start}} AND {{event_date@cost_event}} <= {{_period_end}} AND {{cost_centre@cost_event}} = _d.cost_centre) AS DOUBLE PRECISION) / NULLIF((SELECT COUNT({{ticket_id@ticket}}) FROM {{_table:ticket}} WHERE {{created_at@ticket}} >= {{_period_start}} AND {{created_at@ticket}} < ({{_period_end}} + INTERVAL '1 day')), 0)) AS spend\n" +
      "FROM (SELECT 'marketing' AS cost_centre UNION ALL SELECT 'sales' AS cost_centre) _d",
    );
    // Without total mode the ungrouped aggregate is an error naming it.
    expect(() => compileMetric("spend", ctx, "strict")).toThrow("count() over field.ticket_id reads dataset 'ticket', which has no cost_centre field");
    // The same shape works on the entry-level breakdown, and a malformed object is rejected.
    expect(compileMetric("spend", { ...ctx, formulas: { spend: { ...formulas.spend, breakdown: { field: "field.cost_centre", total: true } } } }).breakdown).toEqual({ field: "cost_centre", total: true });
    expect(() => compileMetric("spend", { ...ctx, formulas: { spend: { ...formulas.spend, breakdowns: { bad: { field: "field.cost_centre", total: "yes" } as any } } } }, "bad")).toThrow("boolean");
  });

  it("compiles a bucketed breakdown over a per-row expression, with literal labels and a CASE on grouped aggregates only", () => {
    const withAge = { ...fields, closed_at: { id: "closed_at", type: "date", datasets: ["ticket"] }, opened_on: { id: "opened_on", type: "date", datasets: ["ticket"] } };
    const buckets = { fast: [0, 2], slow: [3, null] } as Record<string, [number, number | null]>;
    const formulas: Record<string, MetricFormula> = {
      share: { formula: "count(field.ticket_id) / total(count(field.ticket_id))", unit: "percent", breakdown: { expression: "field.closed_at - field.opened_on", buckets } },
      spend: { formula: "count(field.ticket_id) / sum(field.cost)", unit: "ratio", breakdowns: { by_age: { expression: "field.closed_at - field.opened_on", buckets, total: true }, strict: { expression: "field.closed_at - field.opened_on", buckets } } },
    };
    const ctx = { fields: withAge, datasets, formulas };
    const c = compileMetric("share", ctx);
    expect(c.breakdown).toEqual({ field: "bucket", expression: "field.closed_at - field.opened_on", buckets });
    expect(c.fields).toEqual(expect.arrayContaining(["closed_at", "opened_on"]));
    const window = "{{created_at@ticket}} >= {{_period_start}} AND {{created_at@ticket}} < ({{_period_end}} + INTERVAL '1 day')";
    expect(c.sql).toBe(
      `SELECT _d.bucket AS bucket, (CAST((SELECT COUNT({{ticket_id@ticket}}) FROM {{_table:ticket}} WHERE ${window} AND CASE WHEN ({{closed_at@ticket}} - {{opened_on@ticket}}) BETWEEN 0 AND 2 THEN 'fast' WHEN ({{closed_at@ticket}} - {{opened_on@ticket}}) >= 3 THEN 'slow' END = _d.bucket) AS DOUBLE PRECISION) / NULLIF((SELECT COUNT({{ticket_id@ticket}}) FROM {{_table:ticket}} WHERE ${window}), 0)) AS share\n` +
      "FROM (SELECT 'fast' AS bucket UNION ALL SELECT 'slow' AS bucket) _d",
    );
    // A named bucketed breakdown takes its name as the column; total mode keeps the cost aggregate whole.
    const named = compileMetric("spend", ctx, "by_age");
    expect(named.breakdown?.field).toBe("by_age");
    expect(named.sql.match(/END = _d\.by_age/g)).toHaveLength(1);
    expect(() => compileMetric("spend", ctx, "strict")).toThrow("sum() over field.cost reads dataset 'cost_event', which has no closed_at, opened_on field");
    const bad = (b: any) => () => compileMetric("share", { ...ctx, formulas: { share: { ...formulas.share, breakdown: b } } });
    expect(bad({ expression: "field.closed_at - field.opened_on", buckets: { a: [0, 5], b: [5, null] } })).toThrow("overlap");
    expect(bad({ expression: "field.closed_at - field.opened_on", buckets: { a: [0, null], b: [5, 9] } })).toThrow("overlap");
    expect(bad({ expression: "field.closed_at - field.opened_on", buckets: { a: [0, 5], A: [6, 9] } })).toThrow("unique");
    expect(bad({ expression: "field.closed_at - field.cost", buckets: { a: [0, 5] } })).toThrow("different datasets");
    expect(bad({ expression: "sum(field.cost)", buckets: { a: [0, 5] } })).toThrow("per-row expression");
    expect(bad({ expression: "field.closed_at - field.opened_on", buckets: { a: [5, 1] } })).toThrow("hi below lo");
  });

  it("reaches a breakdown field through the key of the dataset that carries it (plan_name via plan_id)", () => {
    const keyed = {
      ...fields,
      plan_id: { id: "plan_id", type: "string", datasets: ["customer", "plan"] },
      plan_name: { id: "plan_name", type: "string", datasets: ["plan"] },
      mrr: { id: "mrr", type: "decimal", datasets: ["customer"] },
    };
    const ds = { ...datasets, plan: { kind: "snapshot", date: "snapshot_date", key: "plan_id" } };
    const withPlanDate = { ...keyed, snapshot_date: { ...keyed.snapshot_date, datasets: ["customer", "plan"] } };
    const formulas: Record<string, MetricFormula> = { mrr: { formula: "sum(field.mrr)", unit: "currency", breakdowns: { by_plan: "field.plan_name" } } };
    const c = compileMetric("mrr", { fields: withPlanDate, datasets: ds, formulas }, "by_plan");
    expect(c.breakdown).toEqual({ field: "plan_name", via: { dataset: "plan", key: "plan_id" } });
    expect(c.sql).toBe(
      "SELECT _d.plan_id AS plan_id, _d.plan_name AS plan_name, (SELECT SUM({{mrr@customer}}) FROM {{_table:customer}} WHERE {{snapshot_date@customer}} = {{_period_end}} AND {{plan_id@customer}} = _d.plan_id) AS mrr\n" +
      "FROM (SELECT DISTINCT {{plan_id@plan}} AS plan_id, {{plan_name@plan}} AS plan_name FROM {{_table:plan}} WHERE {{snapshot_date@plan}} = {{_period_end}}) _d",
    );
    expect(c.datasets).toEqual(["customer", "plan"]);
    // An aggregate on a dataset without the key: the error names the missing key.
    const missing = { mrr: { formula: "count(field.ticket_id)", unit: "count" as const, breakdowns: { by_plan: "field.plan_name" } } };
    expect(() => compileMetric("mrr", { fields: withPlanDate, datasets: ds, formulas: missing }, "by_plan"))
      .toThrow("reads dataset 'ticket', which has no plan_name field and no key to reach it: 'ticket' is missing plan_id (the key of plan)");
  });

  it("rejects total() outside a breakdown, also through a metric reference", () => {
    expect(() => compile("count(field.ticket_id) / total(count(field.ticket_id))")).toThrow("total() outside a breakdown");
    expect(() => compile("metric.share * 2", undefined, { share: { formula: "count(field.ticket_id) / total(metric.volume)", unit: "percent", breakdown: "field.ticket_type" } }))
      .toThrow("total() outside a breakdown");
  });

  it("rejects a grouped aggregate whose dataset lacks the field, naming the aggregate and dataset", () => {
    expect(() => compile("count(field.ticket_id) / sum(field.cost)", "field.ticket_type"))
      .toThrow("sum() over field.cost reads dataset 'cost_event', which has no ticket_type field and no key to reach it: 'cost_event' is missing ticket_id (the key of ticket). Wrap the aggregate in total() or add the field to 'cost_event'");
    expect(() => compile("count(field.ticket_id) / total(sum(field.cost))", "field.ticket_type")).not.toThrow();
    // Through a metric reference too.
    expect(() => compile("metric.spend", "field.ticket_type", { spend: { formula: "sum(field.cost)", unit: "currency" } })).toThrow("reads dataset 'cost_event'");
    expect(() => compile("count(field.ticket_id)", "field.nope")).toThrow("unknown field 'field.nope'");
    expect(() => compile("count(field.ticket_id)", "ticket_type")).toThrow("must be a field reference");
  });
});

describe("SQL dialects", () => {
  const fields: Record<string, any> = {
    ticket_id: { id: "ticket_id", type: "string", datasets: ["ticket"] },
    created_at: { id: "created_at", type: "timestamp", datasets: ["ticket"] },
    resolved_at: { id: "resolved_at", type: "timestamp", datasets: ["ticket"] },
    due_on: { id: "due_on", type: "date", datasets: ["ticket"] },
    opened_on: { id: "opened_on", type: "date", datasets: ["ticket"] },
    minutes: { id: "minutes", type: "decimal", datasets: ["ticket"] },
  };
  // Dated by a date column here; the timestamp-dated bounds have their own test below.
  const datasets: Record<string, any> = { ticket: { kind: "event", date: "opened_on", key: "ticket_id" } };
  const tsDatasets: Record<string, any> = { ticket: { kind: "event", date: "created_at", key: "ticket_id" } };
  const compileTs = (formula: string, dialect: DialectName) =>
    compileMetric("t", { fields, datasets: tsDatasets, formulas: { t: { formula, unit: "ratio" } }, dialect }).sql;
  const compile = (formula: string, dialect: DialectName) =>
    compileMetric("t", { fields, datasets, formulas: { t: { formula, unit: "ratio" } }, dialect }).sql;
  const constructs = {
    cast: "count(field.ticket_id) / count(field.ticket_id)",
    shift: "lag(count(field.ticket_id), 1 quarter)",
    window: "window(count(field.ticket_id), 7 day)",
    dateDiff: "avg(field.due_on - field.opened_on)",
    tsDiff: "avg(field.resolved_at - field.created_at)",
    percentile: "percentile(field.minutes, 0.9)",
    median: "median(field.minutes)",
    periodDays: "count(field.ticket_id) / period_days",
  };
  const expected: Record<DialectName, Record<keyof typeof constructs, string>> = {
    postgres: {
      cast: "CAST((SELECT COUNT", shift: "({{_period_end}} - INTERVAL '3 month')", window: "> ({{_period_end}} - INTERVAL '7 day')",
      dateDiff: "AVG(({{due_on@ticket}} - {{opened_on@ticket}}))", tsDiff: "AVG((EXTRACT(EPOCH FROM ({{resolved_at@ticket}} - {{created_at@ticket}})) / 86400.0))",
      percentile: "PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY {{minutes@ticket}})", median: "PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY {{minutes@ticket}})",
      periodDays: "({{_period_end}} - {{_period_start}} + 1)",
    },
    snowflake: {
      cast: "AS DOUBLE)", shift: "DATEADD(quarter, -1, {{_period_end}})", window: "> DATEADD(day, -7, {{_period_end}})",
      dateDiff: "AVG(DATEDIFF(day, {{opened_on@ticket}}, {{due_on@ticket}}))", tsDiff: "AVG((DATEDIFF(second, {{created_at@ticket}}, {{resolved_at@ticket}}) / 86400.0))",
      percentile: "PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY {{minutes@ticket}})", median: "PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY {{minutes@ticket}})",
      periodDays: "(DATEDIFF(day, {{_period_start}}, {{_period_end}}) + 1)",
    },
    bigquery: {
      cast: "AS FLOAT64)", shift: "DATE_SUB({{_period_end}}, INTERVAL 1 QUARTER)", window: "> DATE_SUB({{_period_end}}, INTERVAL 7 DAY)",
      dateDiff: "AVG(DATE_DIFF({{due_on@ticket}}, {{opened_on@ticket}}, DAY))", tsDiff: "AVG((TIMESTAMP_DIFF({{resolved_at@ticket}}, {{created_at@ticket}}, SECOND) / 86400.0))",
      percentile: "APPROX_QUANTILES({{minutes@ticket}}, 1000)[OFFSET(900)]", median: "APPROX_QUANTILES({{minutes@ticket}}, 1000)[OFFSET(500)]",
      periodDays: "(DATE_DIFF({{_period_end}}, {{_period_start}}, DAY) + 1)",
    },
    databricks: {
      cast: "AS DOUBLE)", shift: "DATEADD(QUARTER, -1, {{_period_end}})", window: "> DATEADD(DAY, -7, {{_period_end}})",
      dateDiff: "AVG(DATEDIFF({{due_on@ticket}}, {{opened_on@ticket}}))", tsDiff: "AVG((TIMESTAMPDIFF(SECOND, {{created_at@ticket}}, {{resolved_at@ticket}}) / 86400.0))",
      percentile: "PERCENTILE({{minutes@ticket}}, 0.9)", median: "PERCENTILE({{minutes@ticket}}, 0.5)",
      periodDays: "(DATEDIFF({{_period_end}}, {{_period_start}}) + 1)",
    },
  };

  it.each(DIALECTS)("%s spells each warehouse-specific construct", (dialect) => {
    for (const [name, formula] of Object.entries(constructs) as Array<[keyof typeof constructs, string]>) {
      const sql = compile(formula, dialect);
      expect(sql, `${dialect} ${name}`).toContain(expected[dialect][name]);
      for (const token of DIALECT[dialect].forbidden) expect(sql, `${dialect} ${name}: ${token}`).not.toContain(token);
    }
  });

  // A timestamp-dated dataset: the lower bound stays >= start, the upper is < end + 1 day so the whole last day counts.
  const tsBounds: Record<DialectName, { period: string; window: string; toDate: string; inPeriod: string }> = {
    postgres: {
      period: "{{created_at@ticket}} >= {{_period_start}} AND {{created_at@ticket}} < ({{_period_end}} + INTERVAL '1 day')",
      window: "{{created_at@ticket}} >= (({{_period_end}} + INTERVAL '1 day') - INTERVAL '7 day') AND {{created_at@ticket}} < ({{_period_end}} + INTERVAL '1 day')",
      toDate: "WHERE {{created_at@ticket}} < ({{_period_end}} + INTERVAL '1 day'))",
      inPeriod: "({{resolved_at@ticket}} >= {{_period_start}} AND {{resolved_at@ticket}} < ({{_period_end}} + INTERVAL '1 day'))",
    },
    snowflake: {
      period: "{{created_at@ticket}} >= {{_period_start}} AND {{created_at@ticket}} < DATEADD(day, 1, {{_period_end}})",
      window: "{{created_at@ticket}} >= DATEADD(day, -7, DATEADD(day, 1, {{_period_end}})) AND {{created_at@ticket}} < DATEADD(day, 1, {{_period_end}})",
      toDate: "WHERE {{created_at@ticket}} < DATEADD(day, 1, {{_period_end}}))",
      inPeriod: "({{resolved_at@ticket}} >= {{_period_start}} AND {{resolved_at@ticket}} < DATEADD(day, 1, {{_period_end}}))",
    },
    bigquery: {
      period: "{{created_at@ticket}} >= TIMESTAMP({{_period_start}}) AND {{created_at@ticket}} < TIMESTAMP(DATE_ADD({{_period_end}}, INTERVAL 1 DAY))",
      window: "{{created_at@ticket}} >= TIMESTAMP(DATE_SUB(DATE_ADD({{_period_end}}, INTERVAL 1 DAY), INTERVAL 7 DAY)) AND {{created_at@ticket}} < TIMESTAMP(DATE_ADD({{_period_end}}, INTERVAL 1 DAY))",
      toDate: "WHERE {{created_at@ticket}} < TIMESTAMP(DATE_ADD({{_period_end}}, INTERVAL 1 DAY)))",
      inPeriod: "({{resolved_at@ticket}} >= TIMESTAMP({{_period_start}}) AND {{resolved_at@ticket}} < TIMESTAMP(DATE_ADD({{_period_end}}, INTERVAL 1 DAY)))",
    },
    databricks: {
      period: "{{created_at@ticket}} >= {{_period_start}} AND {{created_at@ticket}} < DATEADD(DAY, 1, {{_period_end}})",
      window: "{{created_at@ticket}} >= DATEADD(DAY, -7, DATEADD(DAY, 1, {{_period_end}})) AND {{created_at@ticket}} < DATEADD(DAY, 1, {{_period_end}})",
      toDate: "WHERE {{created_at@ticket}} < DATEADD(DAY, 1, {{_period_end}}))",
      inPeriod: "({{resolved_at@ticket}} >= {{_period_start}} AND {{resolved_at@ticket}} < DATEADD(DAY, 1, {{_period_end}}))",
    },
  };

  it.each(DIALECTS)("%s bounds a timestamp-dated dataset by whole days", (dialect) => {
    const e = tsBounds[dialect];
    expect(compileTs("count(field.ticket_id)", dialect)).toContain(e.period);
    expect(compileTs("window(count(field.ticket_id), 7 day)", dialect)).toContain(e.window);
    expect(compileTs("count(field.ticket_id) to_date", dialect)).toContain(e.toDate);
    expect(compileTs("count(field.ticket_id) at period_end", dialect)).toContain(e.toDate);
    expect(compileTs("all_time(count(field.ticket_id where in_period(field.resolved_at)))", dialect)).toContain(e.inPeriod);
    expect(compileTs("count(field.ticket_id)", dialect)).not.toContain("<= {{_period_end}}");
  });

  it("postgres is the default, and an unknown dialect is an error", () => {
    expect(compileMetric("t", { fields, datasets, formulas: { t: { formula: constructs.tsDiff, unit: "days" } } }).sql).toBe(compile(constructs.tsDiff, "postgres"));
    expect(() => compile(constructs.cast, "oracle" as DialectName)).toThrow("Unknown SQL dialect 'oracle'");
  });

  it("maps a warehouse name to a dialect; redshift and postgresql read as postgres", () => {
    expect(dialectOfWarehouse("Snowflake")).toBe("snowflake");
    expect(dialectOfWarehouse("redshift")).toBe("postgres");
    expect(dialectOfWarehouse("postgresql")).toBe("postgres");
    expect(dialectOfWarehouse("oracle")).toBeUndefined();
  });
});
