import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parse } from "yaml";
import { buildConformance, readConformance, CONFORMANCE_DIR } from "../scripts/ossie-conformance.js";
import { CONFORMANCE_CASES } from "../src/ossie/conformance.js";
import { STAGED_REASONS } from "../src/ossie/metrics.js";
import { validateUpstream, uvAvailable } from "../src/ossie/validate.js";

// The conformance set (standard/exports/ossie/conformance) is derived from the
// formulas, the export and the fixture. Building it runs every case on PGlite
// and verifies the data slices, so "current" also means "every expected value
// still comes out of the staged sources".

describe("Ossie conformance set", async () => {
  const files = await buildConformance();
  const current = readConformance();

  it("covers every staged reason the export uses, once each", () => {
    // "period bound" (a bound outside a filter) is never the first reason reported, so no entry is staged for it.
    expect([...CONFORMANCE_CASES.map((c) => c.reason)].sort()).toEqual([...STAGED_REASONS].filter((r) => r !== "period bound").sort());
  });

  it("is current on disk (run npm run conformance)", () => {
    expect(Object.keys(current).sort()).toEqual(Object.keys(files).sort());
    for (const k of Object.keys(files)) expect(current[k], k).toBe(files[k]);
  });

  it("every case names its datasets, columns and at least one expected row", () => {
    const m = JSON.parse(files["manifest.json"]);
    expect(m.cases).toHaveLength(CONFORMANCE_CASES.length);
    for (const c of m.cases) {
      expect(c.datasets.length, c.id).toBeGreaterThan(0);
      for (const ds of c.datasets) expect(files[`data/${ds}.sql`], `${c.id} reads ${ds}`).toBeTruthy();
      expect(c.expected.length, c.id).toBeGreaterThan(0);
      for (const row of c.expected) expect(Object.keys(row), c.id).toEqual(c.columns);
      const model = parse(files[`cases/${c.id}/model.ossie.yaml`]);
      expect(model.datasets.map((d: { name: string }) => d.name), c.id).toEqual([...c.datasets, model.datasets.at(-1).name]);
      expect(model.metrics.map((x: { name: string }) => x.name), c.id).toEqual([c.metric]);
      expect(files[`cases/${c.id}/expected.sql`], c.id).toContain(`AS expected (${c.columns.join(", ")})`);
    }
  });

  const hasUv = uvAvailable();
  it.skipIf(!hasUv)("every case model passes the upstream validator", async () => {
    for (const c of CONFORMANCE_CASES) {
      const id = Object.keys(files).find((k) => k.startsWith("cases/") && k.includes(`_${c.entry.replace(":", "_")}/model`))!;
      const r = await validateUpstream(join(CONFORMANCE_DIR, id), "model");
      expect(r.ok, `${id}\n${r.output}`).toBe(true);
    }
  }, 180_000);
});
