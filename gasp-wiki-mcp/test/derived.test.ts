import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { loadStandard } from "../src/loader.js";
import { computeDerived, readCurrent, SCHEMA_SOURCE } from "../src/derive.js";

// structuredFormulas, entity mappings, graph component/measures edges, the
// Cypher export and the adapter template all derive from formulas.json.
// This fails when someone edits a derived file by hand or forgets `npm run derive`.

describe("derived artefacts", () => {
  const current = readCurrent();
  const data = loadStandard();
  const out = computeDerived(data, current);

  it.each(Object.keys(out) as Array<keyof typeof out>)("%s is current (run npm run derive)", (k) => {
    expect(out[k]).toBe(current[k]);
  });

  it("adapter template validates against the canonical adapter schema", () => {
    const schema = JSON.parse(readFileSync(SCHEMA_SOURCE, "utf-8"));
    const template = JSON.parse(out.template);
    expect(template.$schema).toBe("https://gaspwiki.com/schemas/gasp-adapter-v1.json");
    const ajv = new Ajv2020({ strict: false });
    const ok = ajv.validate(schema, template);
    expect(ajv.errors ?? [], JSON.stringify(ajv.errors)).toEqual([]);
    expect(ok).toBe(true);
  });

  it("field usage counts the fields the compiled SQL reads", () => {
    const fields = JSON.parse(out.ontology).fields as Array<{ id: string; metricCount: number }>;
    const count = (id: string) => fields.find((f) => f.id === id)!.metricCount;
    // snapshot_date is read by every snapshot aggregate, not only by formulas that name it.
    expect(count("snapshot_date")).toBeGreaterThan(100);
    // event_date is the date field of the event datasets, so every event aggregate reads it.
    expect(count("event_date")).toBeGreaterThan(20);
  });

  it("every component edge is backed by a formula input and every graph metric with inputs has its edges", () => {
    const rel = JSON.parse(out.relationships);
    const comp = rel.edges.filter((e: any) => e.type === "component");
    const sf = JSON.parse(out.ontology).structuredFormulas;
    const expected = new Set<string>();
    for (const [id, s] of Object.entries<any>(sf)) if (id !== "description") for (const i of s.inputs) if (sf[i.ref]) expected.add(`${i.ref}>${id}`);
    expect(new Set(comp.map((e: any) => `${e.source}>${e.target}`))).toEqual(expected);
  });
});
