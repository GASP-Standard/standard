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
import { CONSTRUCTS, profileExpression, RUNGS, summarisePortability } from "../src/ossie/portability.js";

const data = loadStandard();
const { model, coverage } = exportModel(data);
const expressionOf = new Map(model.metrics!.map((m) => [m.name, (m.expression as { dialects: Array<{ expression: string }> }).dialects[0].expression]));

describe("Portability profile: the upstream fixtures", () => {
  it("classifies each compliance/portability rung to itself", () => {
    // M0: one dataset, one field, one bare SUM
    expect(profileExpression("SUM(sales.amount)")).toEqual({ rung: "M0", constructs: [] });
    // M2: the core aggregate set
    expect(profileExpression("COUNT(sales.id)")).toEqual({ rung: "M2", constructs: [] });
    expect(profileExpression("COUNT(DISTINCT sales.customer_id)")).toEqual({ rung: "M2", constructs: ["count distinct"] });
    expect(profileExpression("AVG(sales.amount)").rung).toBe("M2");
    expect(profileExpression("MAX(sales.amount)").rung).toBe("M2");
    // M3: a filtered aggregate, in the fixture's CASE form and in the FILTER form the expression language requires
    expect(profileExpression("SUM(CASE WHEN sales.status = 'completed' THEN sales.amount ELSE 0 END)")).toEqual({ rung: "M3", constructs: ["filtered aggregate"] });
    expect(profileExpression("SUM(sales.amount) FILTER (WHERE sales.status = 'completed')")).toEqual({ rung: "M3", constructs: ["filtered aggregate"] });
  });

  it("names the constructs the published rungs do not measure", () => {
    expect(profileExpression("(CAST((COUNT(a.x)) AS DECIMAL) / NULLIF((COUNT(b.y)), 0))")).toEqual({ rung: "M2", constructs: ["arithmetic over aggregates", "cross-dataset"] });
    expect(profileExpression("((SUM(s.mrr) FILTER (WHERE s.status = 'active')) * 12)")).toEqual({ rung: "M3", constructs: ["filtered aggregate", "arithmetic over aggregates"] });
    expect(profileExpression("AVG(DATEDIFF(day, e.hire_date, e.ramped_date))")).toEqual({ rung: "M2", constructs: ["date scalar"] });
    // arithmetic inside the aggregate is not arithmetic over aggregates
    expect(profileExpression("MEDIAN((DATEDIFF(second, t.created_at, t.first_response_at) / 86400.0))")).toEqual({ rung: "M2", constructs: ["date scalar", "percentile"] });
    expect(profileExpression("(MEDIAN(t.hours) * 1440)")).toEqual({ rung: "M2", constructs: ["arithmetic over aggregates", "percentile"] });
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
    expect(coverage.mrr).toMatchObject({ rung: "M3", constructs: ["filtered aggregate"] }); // SUM FILTER (WHERE status = 'active')
    expect(coverage.arr).toMatchObject({ rung: "M3", constructs: ["filtered aggregate", "arithmetic over aggregates"] }); // MRR * 12
    expect(coverage.arpa).toMatchObject({ rung: "M3", constructs: ["filtered aggregate", "count distinct", "arithmetic over aggregates", "cross-dataset"] }); // MRR on subscription over customers on customer
  });

  it("writes the summary into coverage.json", () => {
    const file = JSON.parse(readFileSync(join(process.cwd(), "..", "standard", "exports", "ossie", "coverage.json"), "utf-8"));
    const summary = summarisePortability(coverage);
    expect(file.portability).toEqual(summary);
    expect(Object.values(summary.rungs).reduce((a, b) => a + b, 0)).toBe(direct.length);
    expect(summary.rungs.M3).toBeGreaterThan(summary.rungs.M2);
    expect(summary.rungs.M0).toBeGreaterThan(0);
  });
});
