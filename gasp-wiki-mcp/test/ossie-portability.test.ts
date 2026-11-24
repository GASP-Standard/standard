/**
 * The portability profile: every direct metric is tagged with the upstream
 * ladder rung its construct needs, the upstream fixtures classify to their own
 * rungs, and the committed coverage.json carries the summary.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadStandard } from "../src/loader.js";
import { exportModel } from "../src/ossie/model.js";
import { modelMetrics } from "../src/ossie/scope.js";
import { aggregateSpans, CONSTRUCTS, profileExpression, RUNGS, summarisePortability } from "../src/ossie/portability.js";

const data = loadStandard();
const { model, coverage } = exportModel(data);
const expressionOf = new Map(modelMetrics(model).map((m) => [m.name, m.expression.sql!]));

describe("Portability profile: the upstream fixtures", () => {
  it("classifies each compliance/portability rung to itself", () => {
    // The expressions are the fixtures' own, at the vendored validator's pin (ossie-validator/README.md).
    // M0: one dataset, one field, one bare SUM
    expect(profileExpression("SUM(sales.amount)")).toEqual({ rung: "M0", constructs: [] });
    expect(profileExpression("COALESCE(SUM(sales.amount), 0)")).toEqual({ rung: "M2", constructs: ["null guard"] }); // the form every GASP sum takes
    expect(profileExpression("COALESCE(SUM(sales.amount) FILTER (WHERE sales.status = 'completed'), 0)")).toEqual({ rung: "M3", constructs: ["filtered aggregate", "null guard"] });
    // M2: the core aggregate set
    expect(profileExpression("COUNT(sales.id)")).toEqual({ rung: "M2", constructs: [] });
    expect(profileExpression("COUNT(DISTINCT sales.customer_id)")).toEqual({ rung: "M2", constructs: ["count distinct"] });
    expect(profileExpression("AVG(sales.amount)").rung).toBe("M2");
    expect(profileExpression("MAX(sales.amount)").rung).toBe("M2");
    // M3: a filtered aggregate, in the two forms the rung carries (CASE with no ELSE, and the FILTER clause) and with an ELSE
    expect(profileExpression("SUM(CASE WHEN sales.status = 'completed' THEN sales.amount END)")).toEqual({ rung: "M3", constructs: ["filtered aggregate"] });
    expect(profileExpression("SUM(sales.amount) FILTER (WHERE sales.status = 'completed')")).toEqual({ rung: "M3", constructs: ["filtered aggregate"] });
    expect(profileExpression("SUM(CASE WHEN sales.status = 'completed' THEN sales.amount ELSE 0 END)")).toEqual({ rung: "M3", constructs: ["filtered aggregate"] });
    // M4: a cross-dataset metric. The fixture divides, so it reads as M5 on the ladder with the M4 construct named
    expect(profileExpression("COUNT(DISTINCT customers.customer_id) FILTER (WHERE sales.amount > 0)")).toEqual({ rung: "M4", constructs: ["filtered aggregate", "count distinct", "cross-dataset"] });
    expect(profileExpression("SUM(sales.amount) / COUNT(DISTINCT customers.customer_id)")).toEqual({ rung: "M5", constructs: ["count distinct", "arithmetic over aggregates", "cross-dataset"] });
    // M5: metric composition, carried with the two expressions inlined
    expect(profileExpression("SUM(sales.amount) / NULLIF(COUNT(sales.order_id), 0)")).toEqual({ rung: "M5", constructs: ["arithmetic over aggregates"] });
    // M6: date and time scalars, the metric and the two fields of the fixture
    expect(profileExpression("AVG(DATEDIFF(day, sales.order_date, sales.ship_date))")).toEqual({ rung: "M6", constructs: ["date scalar"] });
    expect(profileExpression("YEAR(order_date)").rung).toBe("M6");
    expect(profileExpression("DATE_TRUNC('month', order_date)").rung).toBe("M6");
    // M7: window functions with an ORDER BY
    expect(profileExpression("LAG(amount) OVER (ORDER BY order_date)").rung).toBe("M7");
    expect(profileExpression("SUM(amount) OVER (ORDER BY order_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)").rung).toBe("M7");
    expect(profileExpression("RANK() OVER (ORDER BY amount DESC)").rung).toBe("M7");
    // M8: ratio to total, over the whole set and over a partition
    expect(profileExpression("amount / SUM(amount) OVER ()").rung).toBe("M8");
    expect(profileExpression("amount / SUM(amount) OVER (PARTITION BY region)").rung).toBe("M8");
  });

  it("spans each aggregate call with its WITHIN GROUP and FILTER clauses", () => {
    const span = (e: string) => aggregateSpans(e).map((s) => e.slice(s.start, s.end));
    expect(span("(SUM(a.x) FILTER (WHERE a.y = 'z') * 12)")).toEqual(["SUM(a.x) FILTER (WHERE a.y = 'z')"]);
    expect(span("PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.ms)")).toEqual(["PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.ms)"]);
    expect(span("(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.h) FILTER (WHERE t.k = 1) / NULLIF(COUNT(t.id), 0))")).toEqual(["PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.h) FILTER (WHERE t.k = 1)", "COUNT(t.id)"]);
  });

  it("names every construct an expression uses, the ones no rung states included", () => {
    expect(profileExpression("(CAST((COUNT(a.x)) AS DECIMAL) / NULLIF((COUNT(b.y)), 0))")).toEqual({ rung: "M5", constructs: ["arithmetic over aggregates", "cross-dataset"] });
    expect(profileExpression("((SUM(s.mrr) FILTER (WHERE s.status = 'active')) * 12)")).toEqual({ rung: "M5", constructs: ["filtered aggregate", "arithmetic over aggregates"] });
    expect(profileExpression("AVG(DATEDIFF(day, e.hire_date, e.ramped_date))")).toEqual({ rung: "M6", constructs: ["date scalar"] });
    // arithmetic inside the aggregate is not arithmetic over aggregates
    expect(profileExpression("MEDIAN((DATEDIFF(second, t.created_at, t.first_response_at) / 86400.0))")).toEqual({ rung: "M6", constructs: ["date scalar", "percentile"] });
    expect(profileExpression("(MEDIAN(t.hours) * 1440)")).toEqual({ rung: "M5", constructs: ["arithmetic over aggregates", "percentile"] });
    // a percentile alone is outside the ladder and stays on the aggregate rung
    expect(profileExpression("MEDIAN(t.hours)")).toEqual({ rung: "M2", constructs: ["percentile"] });
    // A numeric literal inside the aggregate is not arithmetic over aggregates
    expect(profileExpression("SUM(s.amount * 1.1)").constructs).toEqual([]);
  });
});

describe("Portability profile: the GASP export", () => {
  const direct = Object.entries(coverage).filter(([, c]) => c.kind === "direct") as Array<[string, Extract<(typeof coverage)[string], { kind: "direct" }>]>;

  it("tags every direct entry with a rung and known constructs, from its emitted expression", () => {
    expect(direct.length).toBeGreaterThan(0);
    for (const [key, c] of direct) {
      expect(RUNGS, key).toContain(c.rung);
      for (const k of c.constructs) expect(CONSTRUCTS, key).toContain(k);
      expect(profileExpression(expressionOf.get(c.ossieName)!), key).toEqual({ rung: c.rung, constructs: c.constructs });
    }
  });

  it("places the known metrics where the ladder puts them", () => {
    expect(coverage.mrr).toMatchObject({ rung: "M3", constructs: ["filtered aggregate", "null guard"] }); // COALESCE(SUM FILTER (WHERE status = 'active'), 0)
    expect(coverage.arr).toMatchObject({ rung: "M5", constructs: ["filtered aggregate", "arithmetic over aggregates", "null guard"] }); // MRR * 12
    expect(coverage.arpa).toMatchObject({ rung: "M5", constructs: ["filtered aggregate", "count distinct", "arithmetic over aggregates", "cross-dataset", "null guard"] }); // MRR on subscription over customers on customer
    expect(coverage.total_customers).toMatchObject({ rung: "M3", constructs: ["filtered aggregate", "count distinct"] }); // a count is never guarded
  });

  it("writes the summary into coverage.json", () => {
    const file = JSON.parse(readFileSync(join(process.cwd(), "..", "standard", "exports", "ossie", "coverage.json"), "utf-8"));
    const summary = summarisePortability(coverage);
    expect(file.portability).toEqual(summary);
    expect(Object.values(summary.rungs).reduce((a, b) => a + b, 0)).toBe(direct.length);
    expect(Object.keys(summary.rungs)).toEqual(["M0", "M2", "M3", "M4", "M5", "M6", "M7", "M8"]);
    expect(summary.rungs.M5).toBeGreaterThan(summary.rungs.M3); // most direct entries are a ratio or a scale of aggregates
    expect(summary.rungs.M0).toBe(0); // every sum is guarded, so no entry is a bare SUM
    expect(summary.rungs.M7 + summary.rungs.M8).toBe(0); // a formula that needs a window is staged
    expect(summary.rungs.M4).toBe(0); // one dataset per aggregate, so a cross-dataset entry combines two and is M5 or above
    // the rungs restate the constructs: nothing on M6 or above lacks a date scalar, and every date scalar is there
    expect(summary.rungs.M6).toBe(summary.constructs["date scalar"]);
    expect(summary.constructs["null guard"]).toBeGreaterThan(0);
  });
});
