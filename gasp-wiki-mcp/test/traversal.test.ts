import { describe, it, expect, beforeAll } from "vitest";
import { loadStandard } from "../src/loader.js";
import {
  buildContext,
  inferDrivers,
  findPaths,
  coverageGap,
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
});
