import { describe, it, expect, beforeAll } from "vitest";
import { loadStandard, findMetric, metricNodeId } from "../src/loader.js";
import type { StandardData } from "../src/types.js";

// Regression: lookup_metric matched ontology keys by slug prefix
// ("net_revenue_retention_nrr" vs key "nrr"), so 21 of 60 access-control
// classifications (NRR, GRR, CSAT, Burn Rate...) were never shown.
// Metric → graph node id now comes from the slug on each metric node in standard/relationships.json.

let data: StandardData;

beforeAll(() => {
  data = loadStandard();
});

const metricNodes = () => data.nodes.filter((n) => !n.nodeType || n.nodeType === "metric");

describe("metricNodeId", () => {
  it("maps every graph metric node to a metric record", () => {
    const reached = new Set(data.metrics.map((m) => metricNodeId(data, m)).filter(Boolean));
    const missing = metricNodes().map((n) => n.id).filter((id) => !reached.has(id));
    expect(missing).toEqual([]);
  });

  it("resolves the metrics the slug-prefix heuristic missed", () => {
    const cases: Array<[string, string]> = [
      ["NRR", "nrr"],
      ["GRR", "grr"],
      ["LTV:CAC Ratio", "ltv_cac_ratio"],
      ["CAC Payback Period", "cac_payback"],
      ["Burn Rate", "burn_rate"],
    ];
    for (const [name, id] of cases) {
      const m = findMetric(data, name);
      expect(m, name).toBeDefined();
      expect(metricNodeId(data, m!), name).toBe(id);
    }
  });

  it("resolves cross-reference stubs to the canonical node", () => {
    const stub = data.metrics.find((m) => m.department === "Customer Success" && m.name.includes("NRR"));
    expect(stub).toBeDefined();
    expect(metricNodeId(data, stub!)).toBe("nrr");
  });

  it("resolves stubs with their own slug through their See link", () => {
    const stub = data.metrics.find((m) => m.slug === "customer-acquisition-cost-cac");
    expect(stub).toBeDefined();
    expect(metricNodeId(data, stub!)).toBe("cac");
    // Every stub pointing at a mapped canonical metric inherits its node
    for (const m of data.metrics) {
      const anchor = m.rawMarkdown.match(/See \[[^\]]+\]\([^)#]*#([^)]+)\)/)?.[1];
      const target = anchor && data.metricNodeIds?.[anchor];
      if (target) expect(metricNodeId(data, m), m.slug).toBe(target);
    }
  });

  it("does not map lookalike metrics onto a node", () => {
    const arrPerCsm = data.metrics.find((m) => m.slug === "arr-per-csm");
    if (arrPerCsm) expect(metricNodeId(data, arrPerCsm)).not.toBe("arr");
    const carry = data.metrics.find((m) => m.slug === "carry-mrr");
    if (carry) expect(metricNodeId(data, carry)).not.toBe("mrr");
  });
});

describe("ontology coverage through metricNodeId", () => {
  it("reaches every access-control classification", () => {
    const ac = data.ontology?.accessControl?.classifications ?? {};
    const reached = new Set(data.metrics.map((m) => metricNodeId(data, m)).filter((id) => id && ac[id]));
    const unreached = Object.keys(ac).filter((k) => !reached.has(k));
    expect(unreached).toEqual([]);
  });

  it("reaches every structured formula", () => {
    const sf = data.ontology?.structuredFormulas ?? {};
    const keys = Object.keys(sf).filter((k) => k !== "description");
    const reached = new Set(data.metrics.map((m) => metricNodeId(data, m)));
    expect(keys.filter((k) => !reached.has(k))).toEqual([]);
  });
});

describe("graph node descriptions", () => {
  it("come from the metric the node maps to", () => {
    const bySlug = new Map(data.metrics.filter((m) => m.definition).map((m) => [m.slug, m.definition]));
    const wrong = metricNodes().filter((n) => {
      const slug = Object.entries(data.metricNodeIds ?? {}).find(([, id]) => id === n.id)?.[0];
      return !slug || n.description !== bySlug.get(slug);
    });
    expect(wrong.map((n) => `${n.id}: ${n.description?.slice(0, 50)}`)).toEqual([]);
  });

  it("no longer borrow a neighbour's definition", () => {
    const desc = (id: string) => data.nodes.find((n) => n.id === id)?.description ?? "";
    expect(desc("csat")).not.toMatch(/at-risk/);
    expect(desc("burn_rate")).not.toMatch(/at-risk/);
    expect(desc("enps")).not.toBe(desc("nps"));
  });
});
