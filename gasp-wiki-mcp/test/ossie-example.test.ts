import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { loadStandard, metricFormulaId, isMetricStub } from "../src/loader.js";
import { exportOssie } from "../src/ossie/index.js";
import { exportExample, EXAMPLE_DEPARTMENT, EXAMPLE_BASENAME } from "../src/ossie/example.js";
import { DERIVED_FILES } from "../src/derive.js";
import { validateUpstream, uvAvailable } from "../src/ossie/validate.js";

// The compact example (standard/exports/ossie/example) is the Core department cut
// from the full export. derived.test.ts checks the files are current; this checks
// what they hold and that upstream accepts them.

describe("Ossie example (GASP SaaS core)", () => {
  const data = loadStandard();
  const exp = exportOssie(data);
  const ex = exportExample(data, exp);

  it("keeps the main entry and the O and M forms of every Core formula, nothing else", () => {
    const core = new Set(data.metrics.filter((m) => m.department === EXAMPLE_DEPARTMENT && !isMetricStub(m)).map((m) => metricFormulaId(data, m)));
    expect(core.size).toBeGreaterThan(20);
    for (const key of ex.entries) {
      const [id, variant] = key.split(":");
      expect(core.has(id), key).toBe(true);
      if (variant) expect(["O", "M"], key).toContain(variant);
    }
    for (const id of core) expect(ex.entries, id).toContain(id);
  });

  it("every metric and staged source reads only datasets the example has", () => {
    const names = new Set(ex.model.datasets.map((d) => d.name));
    for (const m of ex.model.metrics ?? []) {
      for (const ref of m.expression.dialects[0].expression.matchAll(/\b([a-z_][a-z0-9_]*)\.[a-z_]/g)) expect(names.has(ref[1]), `${m.name} reads ${ref[1]}`).toBe(true);
    }
    for (const d of ex.model.datasets) {
      for (const ref of d.source.matchAll(/\bgasp\.([a-z_][a-z0-9_]*)/g)) if (ref[1] !== "period_spine") expect(names.has(ref[1]), `${d.name} reads ${ref[1]}`).toBe(true);
    }
    for (const r of ex.model.relationships ?? []) { expect(names.has(r.from), r.name).toBe(true); expect(names.has(r.to), r.name).toBe(true); }
  });

  it("the ontology has one entity type per dataset read and the mapping covers each", () => {
    const entities = ex.ontology.ontology.filter((c) => c.type === "EntityType").map((c) => c.concept).sort();
    expect(entities).toHaveLength(ex.datasets.length);
    expect(ex.mapping.concept_mappings.map((c) => c.concept).sort()).toEqual(entities);
    expect(ex.mapping.ontology_ref).toEqual({ name: ex.ontology.name, iri: `./${EXAMPLE_BASENAME}.ontology.yaml` });
    expect(ex.mapping.semantic_model_ref).toEqual({ name: ex.model.name, iri: `./${EXAMPLE_BASENAME}.semantic_model.yaml` });
  });

  const hasUv = uvAvailable();
  it.skipIf(!hasUv)("the three example files pass the upstream validator", async () => {
    for (const [kind, file] of [["model", DERIVED_FILES.exampleModel], ["ontology", DERIVED_FILES.exampleOntology], ["mapping", DERIVED_FILES.exampleMapping]] as const) {
      const r = await validateUpstream(file, kind);
      expect(r.ok, `${join("example", kind)}\n${r.output}`).toBe(true);
    }
  }, 180_000);
});
