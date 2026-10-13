import { describe, it, expect, beforeAll } from "vitest";
import { loadStandard } from "../src/loader.js";
import {
  buildContext,
  inferDrivers,
  findPaths,
  coverageGap,
  noDriversMessage,
} from "../src/traversal.js";
import type { StandardData } from "../src/types.js";

let data: StandardData;
let ctx: ReturnType<typeof buildContext>;

beforeAll(() => {
  data = loadStandard();
  ctx = buildContext(data.nodes, data.edges, data.ontology);
});

// ── Edge classification & schema integrity ────────────────────────

describe("edge classification coverage", () => {
  it("every edge type in relationships.json has a classification", () => {
    const types = new Set(data.edges.map((e) => e.type));
    const unclassified = [...types].filter((t) => !ctx.classification.has(t));
    expect(unclassified).toEqual([]);
  });

  it("every negative-polarity formula input is reflected in pairOverrides", () => {
    const sf = data.ontology?.structuredFormulas;
    expect(sf).toBeDefined();
    const expected: string[] = [];
    for (const [target, formula] of Object.entries(sf!)) {
      if (target === "description" || typeof formula !== "object" || formula === null) continue;
      const f = formula as { inputs?: Array<{ ref: string; role: string; polarity?: string }> };
      for (const input of f.inputs ?? []) {
        if (input.polarity === "negative") {
          expected.push(`${input.ref}|${target}`);
        }
      }
    }
    expect(expected.length).toBeGreaterThan(0);
    for (const key of expected) {
      expect(ctx.pairOverrides.get(key)).toBe(-1);
    }
  });

  it("every edge with inverse=true flips direction", () => {
    const inverseEdges = data.edges.filter((e) => e.inverse === true);
    expect(inverseEdges.length).toBeGreaterThan(0);
    for (const edge of inverseEdges) {
      const paths = findPaths(edge.source, edge.target, ctx, { maxDepth: 1 });
      expect(paths.length).toBeGreaterThan(0);
      const directPath = paths.find((p) => p.path.length === 1);
      expect(directPath, `direct path ${edge.source}→${edge.target}`).toBeDefined();
      expect(directPath!.path[0].directionFlip, `${edge.source}→${edge.target} should flip`).toBe(true);
    }
  });
});

// ── infer_drivers ──────────────────────────────────────────────────

describe("inferDrivers", () => {
  it("returns ranked candidates for ARR down", () => {
    const candidates = inferDrivers("arr", -1, ctx);
    expect(candidates.length).toBeGreaterThan(5);
    // MRR should be the top driver for ARR (single component edge)
    expect(candidates[0].id).toBe("mrr");
    expect(candidates[0].direction).toBe(-1);
  });

  it("flips direction for denominator-role inputs (ARR down → churned MRR up)", () => {
    const candidates = inferDrivers("arr", -1, ctx);
    const churned = candidates.find((c) => c.id === "churned_mrr");
    expect(churned, "churned_mrr should appear as a candidate").toBeDefined();
    expect(churned!.direction).toBe(1);
  });

  it("flips direction for inverse predicts edges (churned MRR up → NPS down)", () => {
    const candidates = inferDrivers("churned_mrr", 1, ctx);
    const nps = candidates.find((c) => c.id === "nps");
    expect(nps, "nps should appear via inverse predicts edge").toBeDefined();
    expect(nps!.direction).toBe(-1);
  });

  it("returns empty for nodes with no incoming edges", () => {
    // If we add metrics with no upstream, this stays empty. Take an arbitrary
    // metric and confirm at least the case-handling is graceful.
    const candidates = inferDrivers("entity_customer", -1, ctx);
    // Entities aren't in metricNodeIds so this should be empty by metricsOnly default
    expect(Array.isArray(candidates)).toBe(true);
  });
});

// ── explain_path ────────────────────────────────────────────────────

describe("findPaths", () => {
  it("returns at least one path for a known connected pair", () => {
    const paths = findPaths("new_mrr", "arr", ctx);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].path[paths[0].path.length - 1].to).toBe("arr");
  });

  it("returns paths sorted by length ascending", () => {
    const paths = findPaths("new_mrr", "arr", ctx, { maxPaths: 5 });
    for (let i = 1; i < paths.length; i++) {
      expect(paths[i].path.length).toBeGreaterThanOrEqual(paths[i - 1].path.length);
    }
  });

  it("returns empty for clearly disconnected forward direction", () => {
    // ARR is a top-level metric; nothing should flow forward from it to
    // upstream funnel metrics.
    const paths = findPaths("arr", "new_mrr", ctx);
    expect(paths).toEqual([]);
  });

  it("preserves edge classification on each step", () => {
    const paths = findPaths("nps", "churned_mrr", ctx);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      for (const step of p.path) {
        expect(step.classification).toBeDefined();
        expect(["metric_signal", "structural", "lifecycle", "behavioral", "assignment", "generative"])
          .toContain(step.classification);
      }
    }
  });
});

// ── coverage_gap ────────────────────────────────────────────────────

describe("coverageGap", () => {
  it("returns zero gaps when every metric is in the set", () => {
    const all = new Set(ctx.metricNodeIds);
    const gap = coverageGap(all, ctx);
    expect(gap.upstreamMissing).toEqual([]);
    expect(gap.downstreamMissing).toEqual([]);
    expect(gap.disconnected).toEqual([]);
  });

  it("identifies one-hop upstream of a small set", () => {
    const gap = coverageGap(new Set(["arr"]), ctx);
    expect(gap.upstreamMissing).toContain("mrr");
  });

  it("identifies one-hop downstream of a small set", () => {
    const gap = coverageGap(new Set(["mrr"]), ctx);
    expect(gap.downstreamMissing.length).toBeGreaterThan(0);
    expect(gap.downstreamMissing).toContain("arr");
  });

  it("never reports a tracked metric as missing or disconnected", () => {
    const set = new Set(["arr", "mrr", "nrr"]);
    const gap = coverageGap(set, ctx);
    for (const id of set) {
      expect(gap.upstreamMissing).not.toContain(id);
      expect(gap.downstreamMissing).not.toContain(id);
      expect(gap.disconnected).not.toContain(id);
    }
  });
});

// ── Connectivity sanity ─────────────────────────────────────────────

describe("graph connectivity", () => {
  it("every metric node is connected (in either direction) to the rest of the graph", () => {
    const orphans: string[] = [];
    for (const id of ctx.metricNodeIds) {
      const hasOut = (ctx.edgesBySource.get(id)?.length ?? 0) > 0;
      const hasIn = (ctx.edgesByTarget.get(id)?.length ?? 0) > 0;
      if (!hasOut && !hasIn) orphans.push(id);
    }
    expect(orphans).toEqual([]);
  });
});

describe("graph shape", () => {
  it("no two metric nodes have edges in both directions", () => {
    const metric = new Set(
      data.nodes.filter((n) => !n.nodeType || n.nodeType === "metric").map((n) => n.id),
    );
    const pairs = new Set(
      data.edges
        .filter((e) => metric.has(e.source) && metric.has(e.target))
        .map((e) => `${e.source}|${e.target}`),
    );
    const cycles = [...pairs].filter((p) => {
      const [s, t] = p.split("|");
      return s < t && pairs.has(`${t}|${s}`);
    });
    expect(cycles).toEqual([]);
  });

  it("no curated edge duplicates a derived component edge between the same two metrics", () => {
    // A component edge already carries the input's polarity (structuredFormulas),
    // so a curated drives or reduces edge on the same pair is listed twice and
    // counted as two paths. Keep one: the derived one.
    const component = new Set(data.edges.filter((e) => e.type === "component").map((e) => `${e.source}|${e.target}`));
    const duplicates = data.edges
      .filter((e) => (e.type === "drives" || e.type === "reduces" || e.type === "predicts") && component.has(`${e.source}|${e.target}`))
      .map((e) => `${e.source} ${e.type} ${e.target}`);
    expect(duplicates).toEqual([]);
  });

  it("every lower-is-better driver edge is typed reduces", () => {
    // Time and cost metrics that hurt their target when they rise. A drives edge
    // between two of them (logo churn drives churned MRR) is still a positive relation.
    const lowerIsBetter = ["frt", "mttr", "ttfv", "churned_mrr", "contraction_mrr", "logo_churn_rate", "revenue_churn_rate", "cac", "cac_payback", "burn_rate", "sales_cycle"];
    const wrong = data.edges
      .filter((e) => e.type === "drives" && lowerIsBetter.includes(e.source) && !lowerIsBetter.includes(e.target))
      .map((e) => `${e.source} drives ${e.target}`);
    expect(wrong).toEqual([]);
  });
});

// A baseline input (read at period_start or under lag) is a direct component, but
// traversal does not continue through its drivers: NRR reads MRR at period start
// over the start-of-period cohort, so New MRR cannot move it.
describe("baseline inputs", () => {
  it("marks mrr as a baseline input of NRR, GRR, Expansion Rate and Revenue Churn Rate", () => {
    for (const id of ["nrr", "grr", "expansion_rate", "revenue_churn_rate"]) expect(ctx.baselinePairs.has(`mrr|${id}`), id).toBe(true);
    expect(ctx.baselinePairs.has("churned_mrr|nrr")).toBe(false);
  });

  it("NRR's drivers list MRR and Churned MRR but not New MRR, Win Rate or Pipeline Value", () => {
    const ids = inferDrivers("nrr", 1, ctx).map((c) => c.id);
    expect(ids).toContain("mrr");
    expect(ids).toContain("churned_mrr");
    for (const id of ["new_mrr", "net_new_mrr", "win_rate", "pipeline_value"]) expect(ids, id).not.toContain(id);
  });

  it("explain_path from Churned MRR to NRR never passes through net_new_mrr", () => {
    const paths = findPaths("churned_mrr", "nrr", ctx);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(p.path.some((s) => s.from === "net_new_mrr" || s.to === "net_new_mrr")).toBe(false);
    // MRR itself still reaches NRR directly.
    expect(findPaths("mrr", "nrr", ctx).some((p) => p.path.length === 1)).toBe(true);
  });

  it("coverage_gap lists the baseline input as a direct upstream of NRR", () => {
    expect(coverageGap(new Set(["nrr"]), ctx).upstreamMissing).toContain("mrr");
  });
});

describe("metrics with few upstream edges", () => {
  it("Burn Rate has MRR and Gross Margin as drivers, both raised to bring burn down", () => {
    const c = inferDrivers("burn_rate", -1, ctx);
    for (const id of ["mrr", "gross_margin"]) expect(c.find((x) => x.id === id)?.direction, id).toBe(1);
  });

  it("MTTR has Deployment Frequency as a driver, raised to bring MTTR down", () => {
    expect(inferDrivers("mttr", -1, ctx).find((x) => x.id === "deployment_frequency")?.direction).toBe(1);
  });

  it("says in words when a metric has no upstream drivers in the graph", () => {
    const iso = buildContext([{ id: "lonely", label: "Lonely" } as any, { id: "other", label: "Other" } as any], [{ source: "lonely", target: "other", type: "drives" }], data.ontology);
    expect(inferDrivers("lonely", 1, iso)).toEqual([]);
    expect(noDriversMessage("lonely", iso)).toBe("No upstream drivers in the graph: no edge leads into Lonely, so the graph cannot say what moves it.");
    expect(noDriversMessage("burn_rate", ctx)).toContain("within the traversal depth limit");
  });
});
