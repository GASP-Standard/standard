import { describe, it, expect, beforeAll } from "vitest";
import { loadStandard, findMetric, search, getRelationships } from "../src/loader.js";
import type { StandardData } from "../src/types.js";

let data: StandardData;

beforeAll(() => {
  data = loadStandard();
});

// ── findMetric ──────────────────────────────────────────────────────

describe("findMetric", () => {
  it("finds by exact name", () => {
    const m = findMetric(data, "MRR (Monthly Recurring Revenue)");
    expect(m).toBeDefined();
    expect(m!.name).toContain("MRR");
  });

  it("finds by alias / abbreviation", () => {
    const m = findMetric(data, "NRR");
    expect(m).toBeDefined();
    expect(m!.name).toContain("Net Revenue Retention");
  });

  it("finds by slug", () => {
    const m = findMetric(data, "mrr-monthly-recurring-revenue");
    expect(m).toBeDefined();
  });

  it("finds by partial name match", () => {
    const m = findMetric(data, "Rule of 40");
    expect(m).toBeDefined();
    expect(m!.name).toContain("Rule of 40");
  });

  it("returns undefined for unknown metric", () => {
    expect(findMetric(data, "xyzzy_nonexistent_metric")).toBeUndefined();
  });

  it("is case-insensitive", () => {
    const m = findMetric(data, "cac");
    expect(m).toBeDefined();
    expect(m!.name).toContain("CAC");
  });
});

// ── search ──────────────────────────────────────────────────────────

describe("search", () => {
  it("returns ranked results", () => {
    const results = search(data, "churn");
    expect(results.length).toBeGreaterThan(0);
  });

  it("respects limit parameter", () => {
    const results = search(data, "revenue", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("returns both metrics and definitions", () => {
    const results = search(data, "retention", 20);
    const types = new Set(results.map((r) => r.type));
    expect(types.has("metric")).toBe(true);
    expect(types.has("definition")).toBe(true);
  });
});

// ── getRelationships ────────────────────────────────────────────────

describe("getRelationships", () => {
  it("finds node by id", () => {
    const rel = getRelationships(data, "arr");
    expect(rel.node).toBeDefined();
    expect(rel.node!.id).toBe("arr");
  });

  it("finds node by label", () => {
    const rel = getRelationships(data, "ARR");
    expect(rel.node).toBeDefined();
  });

  it("returns upstream relationships", () => {
    const rel = getRelationships(data, "arr");
    expect(rel.upstream.length).toBeGreaterThan(0);
  });

  it("returns downstream relationships", () => {
    // pipeline_value drives new_mrr, so it has downstream edges
    const rel = getRelationships(data, "pipeline_value");
    expect(rel.downstream.length).toBeGreaterThan(0);
  });

  it("returns empty for unknown metric", () => {
    const rel = getRelationships(data, "xyzzy_nonexistent");
    expect(rel.node).toBeUndefined();
    expect(rel.upstream).toHaveLength(0);
    expect(rel.downstream).toHaveLength(0);
  });
});
