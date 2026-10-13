import { describe, it, expect, beforeAll } from "vitest";
import { loadStandard, metricFormulaId, isMetricStub } from "../src/loader.js";
import { parseFormula, analyzeFormula, validateFormula } from "../src/formula.js";
import type { StandardData, MetricFormula, OntologyData } from "../src/types.js";

// standard/formulas.json is the canonical, machine-readable formula layer.
// Every expression must parse, resolve against the ontology, and agree with
// the hand-maintained structuredFormulas the traversal tools read.

let data: StandardData;
let entries: Array<[string, MetricFormula]>;
let metricIds: Set<string>;

const UNITS = ["currency", "percent", "ratio", "count", "days", "months", "hours", "minutes", "milliseconds", "score"];

/** Every expression in an entry: the main formula, O/M forms and variants. */
const expressions = (f: MetricFormula): Array<[string, string]> => [
  ...(f.formula ? [["formula", f.formula] as [string, string]] : []),
  ...Object.entries(f.forms ?? {}).map(([k, v]) => [`forms.${k}`, v!] as [string, string]),
  ...Object.entries(f.variants ?? {}).map(([k, v]) => [`variants.${k}`, v] as [string, string]),
];

beforeAll(() => {
  data = loadStandard();
  entries = Object.entries(data.formulas ?? {});
  metricIds = new Set(data.metrics.map((m) => metricFormulaId(data, m)));
});

describe("formulas.json", () => {
  it("loads", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("keys every entry by a real metric's formula id", () => {
    expect(entries.map(([id]) => id).filter((id) => !metricIds.has(id))).toEqual([]);
  });

  it("gives each entry either a formula with a unit, or a notComputable reason", () => {
    const bad = entries.filter(([, f]) =>
      f.formula ? !UNITS.includes(f.unit ?? "") || !!f.notComputable : !f.notComputable || !!f.forms || !!f.variants,
    );
    expect(bad.map(([id]) => id)).toEqual([]);
  });

  it("parses and validates every expression against ontology fields and metric ids", () => {
    const flds = data.ontology!.fields!;
    const ctx = {
      fields: new Set(flds.map((f) => f.id)),
      metrics: metricIds,
      forms: Object.fromEntries(entries.map(([id, f]) => [id, Object.keys(f.forms ?? {})])),
      enums: Object.fromEntries(flds.filter((f) => f.values).map((f) => [f.id, f.values!])),
      datasets: Object.fromEntries(flds.map((f) => [f.id, f.datasets ?? []])),
    };
    const failures: string[] = [];
    for (const [id, f] of entries) {
      for (const [where, src] of expressions(f)) {
        try {
          for (const e of validateFormula(parseFormula(src), ctx)) failures.push(`${id} ${where}: ${e}`);
        } catch (e) {
          failures.push(`${id} ${where}: ${(e as Error).message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("has no circular metric references", () => {
    const deps = new Map(entries.filter(([, f]) => f.formula).map(([id, f]) => [id, analyzeFormula(parseFormula(f.formula!)).metricRefs]));
    const cycles: string[] = [];
    const visit = (id: string, path: string[]) => {
      if (path.includes(id)) { cycles.push([...path, id].join(" → ")); return; }
      for (const d of deps.get(id) ?? []) visit(d, [...path, id]);
    };
    for (const id of deps.keys()) visit(id, []);
    expect(cycles).toEqual([]);
  });

  it("gives every non-stub metric its own formula id", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const m of data.metrics.filter((m) => !isMetricStub(m))) {
      const id = metricFormulaId(data, m);
      if (seen.has(id)) dupes.push(`${id}: ${seen.get(id)} and ${m.department}`);
      seen.set(id, m.department);
    }
    expect(dupes).toEqual([]);
  });

  it("every field belongs to a declared dataset and every enum field declares values", () => {
    const ds = data.ontology!.datasets!;
    const bad = data.ontology!.fields!.filter((f) => !f.datasets?.length || f.datasets.some((d) => !ds[d]) || (f.type === "enum") !== !!f.values);
    expect(bad.map((f) => f.id)).toEqual([]);
  });

  it("references every field at least once, except keys, dates, CEL ledger fields and dimensions", () => {
    const used = new Set(entries.flatMap(([, f]) => expressions(f).flatMap(([, src]) => analyzeFormula(parseFormula(src)).fieldRefs)));
    const ds = data.ontology!.datasets!;
    const structural = (f: NonNullable<OntologyData["fields"]>[number]) =>
      f.dimension || f.id === "currency" || (f.datasets ?? []).some((d) => ds[d]?.key === f.id || ds[d]?.date === f.id || !!ds[d]?.cel);
    const unused = data.ontology!.fields!.filter((f) => !used.has(f.id) && !structural(f)).map((f) => f.id);
    expect(unused).toEqual([]);
  });

  it("covers every metric with a formula or a notComputable reason", () => {
    const ids = data.metrics.filter((m) => !isMetricStub(m)).map((m) => metricFormulaId(data, m));
    expect(ids.filter((id) => !data.formulas![id])).toEqual([]);
  });

});
