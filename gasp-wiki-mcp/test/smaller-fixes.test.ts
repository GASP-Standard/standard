import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadStandard, metricFormulaId, validateRemote } from "../src/loader.js";

const data = loadStandard();
const root = join(new URL(".", import.meta.url).pathname, "..", "..");

describe("identifiers", () => {
  it("no formula id, alias or entity mapping id starts with a digit", () => {
    const ids = [
      ...data.metrics.map((m) => metricFormulaId(data, m)),
      ...data.metrics.flatMap((m) => m.aliases),
      ...Object.keys(data.formulas ?? {}),
      ...Object.values(data.ontology?.entityMappings ?? {}).flat(),
    ];
    expect(ids.filter((i) => /^\d/.test(i))).toEqual([]);
  });

  it("digit-led slugs move the number after day_", () => {
    const m = data.metrics.find((x) => x.slug === "90-day-turnover")!;
    expect(metricFormulaId(data, m)).toBe("day_90_turnover");
  });
});

describe("Cypher export", () => {
  it("carries the inverse flag on inverse edges", () => {
    const cypher = readFileSync(join(root, "standard/exports/gasp-knowledge-graph.cypher"), "utf-8");
    const inverse = data.edges.filter((e) => e.inverse).length;
    expect(inverse).toBeGreaterThan(0);
    expect(cypher.split("{inverse: true}").length - 1).toBe(inverse);
  });
});

describe("validationRules", () => {
  it("are loaded into the ontology", () => {
    expect(Object.keys(data.ontology?.validationRules ?? {}).length).toBeGreaterThan(0);
  });
});

describe("loadRemote validation", () => {
  it("accepts the local data", () => {
    expect(() => validateRemote(JSON.parse(JSON.stringify(data)))).not.toThrow();
  });
  it("rejects malformed payloads with a clear message", () => {
    expect(() => validateRemote(null)).toThrow(/malformed/);
    expect(() => validateRemote({ ...data, metrics: "nope" })).toThrow(/"metrics"/);
    expect(() => validateRemote({ ...data, edges: [] })).toThrow(/"edges"/);
    expect(() => validateRemote({ ...data, ontology: { entities: [] } })).toThrow(/ontology.fields/);
    expect(() => validateRemote({ ...data, formulas: undefined })).toThrow(/"formulas"/);
  });
});

describe("standard-version.json", () => {
  const p = join(root, "gasp-wiki-mcp/build/standard-version.json");
  it.skipIf(!existsSync(p))("has a content hash matching the bundled data", () => {
    const v = JSON.parse(readFileSync(p, "utf-8"));
    const bundled = readFileSync(join(root, "gasp-wiki-mcp/build/standard-data.json"), "utf-8");
    expect(v.contentHash).toBe(createHash("sha256").update(bundled).digest("hex"));
  });
});
