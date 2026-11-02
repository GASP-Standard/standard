import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildExampleDemo, EXAMPLE_DEMO_DIR, readExampleDemo } from "../scripts/ossie-conformance.js";
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

// The demo (standard/exports/ossie/example/demo) runs every Core metric as a
// standalone query. scripts/ossie-conformance.ts writes it with the expected
// values from the compiled SQL on the full fixture; this checks it is current
// and that DuckDB, the engine the upstream query compliance suite uses, returns
// those values.
describe("Ossie example demo", () => {
  it("is current (npm run conformance)", async () => {
    const files = await buildExampleDemo();
    const current = readExampleDemo();
    expect(Object.keys(current).sort()).toEqual(Object.keys(files).sort());
    for (const k of Object.keys(files)) expect(current[k], k).toBe(files[k]);
  }, 180_000);

  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const onDuckDb = uvAvailable() ? it : it.skip;
  onDuckDb("returns the expected values on DuckDB", () => {
    const py = [
      "import duckdb, json, sys",
      "c = duckdb.connect()",
      "c.execute(open(sys.argv[1]).read())",
      "rows = c.execute(open(sys.argv[2]).read()).fetchall()",
      "print(json.dumps([[m, None if v is None else float(v)] for m, v in rows]))",
    ].join("\n");
    const r = spawnSync("uv", ["run", "--quiet", "--with", "duckdb", "python", "-c", py, join(EXAMPLE_DEMO_DIR, "data.sql"), join(EXAMPLE_DEMO_DIR, "metrics.sql")], { encoding: "utf-8" });
    expect(r.status, r.stderr).toBe(0);
    const got = JSON.parse(r.stdout.trim().split("\n").pop()!) as Array<[string, number | null]>;
    const expected = [...readFileSync(join(EXAMPLE_DEMO_DIR, "expected.sql"), "utf-8").matchAll(/\('([a-z0-9_]+)', (CAST\(NULL AS DECIMAL\)|[-0-9.E+]+)\)/g)]
      .map((m) => [m[1], m[2].startsWith("CAST") ? null : Number(m[2])] as [string, number | null]);
    expect(expected.length).toBeGreaterThan(30);
    expect(got.map((g) => g[0])).toEqual(expected.map((e) => e[0]));
    const off = expected.filter((e, i) => (e[1] === null ? got[i][1] !== null : got[i][1] === null || !close(got[i][1]!, e[1])));
    expect(off.map((e) => e[0]), "metrics whose DuckDB value differs from expected.sql").toEqual([]);
  }, 300_000);
});
