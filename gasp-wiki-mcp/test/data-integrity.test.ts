import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { loadStandard } from "../src/loader.js";
import type { StandardData } from "../src/types.js";

let data: StandardData;

beforeAll(() => {
  data = loadStandard();
});

describe("data integrity", () => {
  it("loads 300 metrics", () => {
    expect(data.metrics).toHaveLength(300);
  });

  it("loads 92 definitions (80 SaaS domain + 12 GASP framework)", () => {
    expect(data.definitions).toHaveLength(92);
  });

  it("loads 82 relationship nodes (60 metrics + 15 entities + 7 concepts)", () => {
    expect(data.nodes).toHaveLength(82);
  });

  it("loads every edge in relationships.json", () => {
    const rel = JSON.parse(readFileSync(join(new URL(".", import.meta.url).pathname, "..", "..", "standard", "relationships.json"), "utf-8"));
    expect(data.edges).toHaveLength(rel.edges.length);
  });

  it("every metric has name, department, and category", () => {
    for (const m of data.metrics) {
      expect(m.name, `metric missing name`).toBeTruthy();
      expect(m.department, `${m.name} missing department`).toBeTruthy();
      expect(m.category, `${m.name} missing category`).toBeTruthy();
    }
  });

  it("key metrics exist", () => {
    const names = data.metrics.map((m) => m.name);
    const expected = [
      "MRR (Monthly Recurring Revenue)",
      "ARR (Annual Recurring Revenue)",
      "Net Revenue Retention (NRR)",
      "Gross Revenue Retention (GRR)",
      "CAC (Customer Acquisition Cost)",
    ];
    for (const name of expected) {
      expect(names, `missing key metric: ${name}`).toContain(name);
    }
  });

  it("has no duplicate metric slugs within the same department", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const m of data.metrics) {
      const key = `${m.department}::${m.slug}`;
      if (seen.has(key)) dupes.push(`${m.department}/${m.slug}`);
      seen.add(key);
    }
    expect(dupes, `duplicate slugs: ${dupes.join(", ")}`).toHaveLength(0);
  });

  it("covers 13 departments", () => {
    const depts = new Set(data.metrics.map((m) => m.department));
    expect(depts.size).toBe(13);
  });

  it("all graph edges reference valid nodes", () => {
    const nodeIds = new Set(data.nodes.map((n) => n.id));
    for (const edge of data.edges) {
      expect(
        nodeIds.has(edge.source),
        `edge source "${edge.source}" not in nodes`
      ).toBe(true);
      expect(
        nodeIds.has(edge.target),
        `edge target "${edge.target}" not in nodes`
      ).toBe(true);
    }
  });

  it("every definition has a term and slug", () => {
    for (const d of data.definitions) {
      expect(d.term, "definition missing term").toBeTruthy();
      expect(d.slug, `${d.term} missing slug`).toBeTruthy();
    }
  });

  it("every relationship node has required fields", () => {
    for (const n of data.nodes) {
      expect(n.id, "node missing id").toBeTruthy();
      expect(n.label, `${n.id} missing label`).toBeTruthy();
      expect(n.category, `${n.id} missing category`).toBeTruthy();
    }
  });
});

describe("dual-lens integrity", () => {
  it("exactly 6 metrics have dualLens", () => {
    const withDualLens = data.metrics.filter((m) => m.dualLens !== null);
    expect(withDualLens.length).toBe(6);
  });

  it("exactly 2 metrics have dualLensNote", () => {
    const withDualLensNote = data.metrics.filter((m) => m.dualLensNote !== null);
    expect(withDualLensNote.length).toBe(2);
  });

  it("no metric has both dualLens and dualLensNote", () => {
    const both = data.metrics.filter((m) => m.dualLens !== null && m.dualLensNote !== null);
    expect(both.length).toBe(0);
  });

  it("expected metrics have dualLens by name", () => {
    const dlNames = data.metrics.filter((m) => m.dualLens !== null).map((m) => m.name).sort();
    const expected = [
      "ARR (Annual Recurring Revenue)",
      "CAC (Customer Acquisition Cost)",
      "Gross Margin",
      "LTV (Customer Lifetime Value)",
      "Net Revenue Retention (NRR)",
      "Revenue Churn Rate",
    ].sort();
    expect(dlNames).toEqual(expected);
  });

  it("expected metrics have dualLensNote by name", () => {
    const noteNames = data.metrics.filter((m) => m.dualLensNote !== null).map((m) => m.name).sort();
    const expected = [
      "Gross Revenue Retention (GRR)",
      "Rule of 40",
    ].sort();
    expect(noteNames).toEqual(expected);
  });

  it("all dualLens metrics have complete operating/market forms", () => {
    const errors: string[] = [];
    for (const m of data.metrics.filter((m) => m.dualLens !== null)) {
      const dl = m.dualLens!;
      for (const [formName, form] of [["operating", dl.operating], ["market", dl.market]] as const) {
        if (!form.label) errors.push(`${m.name}: ${formName} missing label`);
        if (!form.description) errors.push(`${m.name}: ${formName} missing description`);
        if (!form.celSource) errors.push(`${m.name}: ${formName} missing celSource`);
        if (!form.insight) errors.push(`${m.name}: ${formName} missing insight`);
      }
    }
    if (errors.length > 0) {
      expect.fail(`Incomplete dual-lens forms:\n  ${errors.join("\n  ")}`);
    }
  });

  it("all bridges have diagnostic text", () => {
    const errors: string[] = [];
    for (const m of data.metrics.filter((m) => m.dualLens !== null)) {
      if (!m.dualLens!.bridge.diagnostic) {
        errors.push(`${m.name}: bridge missing diagnostic`);
      }
    }
    if (errors.length > 0) {
      expect.fail(`Missing bridge diagnostics:\n  ${errors.join("\n  ")}`);
    }
  });

  it("standard O/M metrics have reconciliation formula; churn does not", () => {
    for (const m of data.metrics.filter((m) => m.dualLens !== null)) {
      if (m.name === "Revenue Churn Rate") {
        expect(m.dualLens!.bridge.reconciliation, `${m.name} should have null reconciliation`).toBeNull();
      } else {
        expect(m.dualLens!.bridge.reconciliation, `${m.name} should have reconciliation`).not.toBeNull();
      }
    }
  });

  it("only Core department has dual-lens content", () => {
    const nonCore = data.metrics.filter(
      (m) => (m.dualLens !== null || m.dualLensNote !== null) && m.department !== "Core"
    );
    if (nonCore.length > 0) {
      expect.fail(
        `Non-Core dual-lens metrics: ${nonCore.map((m) => `${m.name} (${m.department})`).join(", ")}`
      );
    }
  });
});

describe("taxonomy integrity", () => {
  const VALID_TYPES = new Set(["outcome", "leading", "efficiency", "operational"]);

  it("every metric has a valid signalType", () => {
    for (const m of data.metrics) {
      expect(
        VALID_TYPES.has(m.signalType),
        `${m.name} has invalid signalType "${m.signalType}"`
      ).toBe(true);
    }
  });

  it("dual-tagged metrics have different primary and secondary", () => {
    for (const m of data.metrics) {
      if (m.signalTypeSecondary) {
        expect(
          VALID_TYPES.has(m.signalTypeSecondary),
          `${m.name} has invalid secondary signalType "${m.signalTypeSecondary}"`
        ).toBe(true);
        expect(
          m.signalType !== m.signalTypeSecondary,
          `${m.name} has same primary and secondary: ${m.signalType}`
        ).toBe(true);
      }
    }
  });

  it("signal type distribution is within expected ranges", () => {
    const counts: Record<string, number> = { outcome: 0, leading: 0, efficiency: 0, operational: 0 };
    for (const m of data.metrics) {
      counts[m.signalType]++;
    }
    const total = data.metrics.length;

    // Expected: ~40% operational, ~27% outcome, ~20% efficiency, ~13% leading
    // Allow generous ranges
    expect(counts.operational / total).toBeGreaterThan(0.30);
    expect(counts.operational / total).toBeLessThan(0.55);
    expect(counts.outcome / total).toBeGreaterThan(0.15);
    expect(counts.outcome / total).toBeLessThan(0.35);
    expect(counts.efficiency / total).toBeGreaterThan(0.10);
    expect(counts.efficiency / total).toBeLessThan(0.30);
    expect(counts.leading / total).toBeGreaterThan(0.05);
    expect(counts.leading / total).toBeLessThan(0.20);
  });

  it("dual-tagged count is between 5 and 15", () => {
    const dualTagged = data.metrics.filter((m) => m.signalTypeSecondary);
    expect(dualTagged.length).toBeGreaterThanOrEqual(5);
    expect(dualTagged.length).toBeLessThanOrEqual(15);
  });
});
