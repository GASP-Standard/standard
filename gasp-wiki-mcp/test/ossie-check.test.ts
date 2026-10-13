import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { checkExport } from "../src/ossie/check.js";
import { validateUpstream, uvAvailable } from "../src/ossie/validate.js";
import type { OssieMapping, OssieOntology, OssieSemanticModel } from "../src/ossie/types.js";

const SPIKE = resolve(import.meta.dirname, "fixture/ossie-spike");
const FILES = {
  ontology: join(SPIKE, "gasp.ontology.yaml"),
  model: join(SPIKE, "gasp.semantic_model.yaml"),
  mapping: join(SPIKE, "gasp.mapping.yaml"),
};

type Docs = { ontology: OssieOntology; model: OssieSemanticModel; mapping: OssieMapping };
const load = (): Docs => ({
  ontology: parse(readFileSync(FILES.ontology, "utf8")),
  model: parse(readFileSync(FILES.model, "utf8")),
  mapping: parse(readFileSync(FILES.mapping, "utf8")),
});
const concept = (d: Docs, n: string) => d.ontology.ontology.find((c) => c.concept === n)!;
const rel = (d: Docs, c: string, r: string) => concept(d, c).relationships!.find((x) => x.name === r)!;
const metric = (d: Docs, n: string) => d.model.metrics!.find((m) => m.name === n)!;
const expr = (m: { expression: { dialects: Array<{ expression: string }> } }) => m.expression.dialects[0];

describe("checkExport", () => {
  it("passes the spike documents", () => {
    expect(checkExport(load())).toEqual([]);
  });

  const cases: Array<[string, (d: Docs) => void, RegExp]> = [
    ["probe: role played by an undeclared concept", (d) => { rel(d, "Customer", "status_on").roles![1].concept = "Nope"; }, /unknown concept "Nope"/],
    ["probe: identify_by naming an unknown relationship", (d) => { concept(d, "Customer").identify_by = ["missing"]; }, /identify_by names unknown relationship "missing"/],
    ["probe: metric referencing a dataset that does not exist", (d) => { expr(metric(d, d.model.metrics![0].name)).expression = "SUM(ghost.mrr_change)"; }, /dataset "ghost" does not exist/],
    ["probe: metric as a scalar subquery", (d) => { expr(d.model.metrics![0]).expression = "(SELECT SUM(revenue_event.mrr_change) FROM revenue_event)"; }, /contains SELECT/],
    ["probe: relationship from_columns naming a missing field", (d) => { d.model.relationships![0].from_columns = ["nope"]; }, /from_columns names "nope"/],
    ["probe: mapping concept not in the ontology", (d) => { d.mapping.concept_mappings[0].concept = "Ghost"; }, /concept "Ghost", which is not in the ontology/],
    ["probe: mapping relationship not declared on the concept", (d) => { d.mapping.concept_mappings[1].link_mappings![0].children![0].relationship = "bogus"; }, /relationship "bogus", which is not declared on concept "Subscription"/],
    ["metric names a missing field", (d) => { expr(d.model.metrics![0]).expression = "SUM(revenue_event.nope)"; }, /dataset "revenue_event" has no field "nope"/],
    ["metric has a FROM clause", (d) => { expr(d.model.metrics![0]).expression = "SUM(revenue_event.mrr_change) FROM revenue_event"; }, /FROM clause/],
    ["metric has a WHERE clause", (d) => { expr(d.model.metrics![0]).expression = "SUM(revenue_event.mrr_change) WHERE 1 = 1"; }, /WHERE clause/],
    ["metric has a placeholder", (d) => { expr(d.model.metrics![0]).expression = "SUM({{mrr}})"; }, /"\{\{" placeholder/],
    ["metric lacks the portable dialect", (d) => { expr(d.model.metrics![0]).dialect = "SNOWFLAKE" as never; (expr(d.model.metrics![0]) as { dialect: string }).dialect = "SNOWFLAKE"; }, /has no OSSIE_SQL_2026 expression/],
    ["duplicate dataset", (d) => { d.model.datasets.push({ ...d.model.datasets[0] }); }, /dataset name "customer" is declared more than once/],
    ["duplicate field", (d) => { d.model.datasets[0].fields!.push({ ...d.model.datasets[0].fields![0] }); }, /field "customer_id" is declared more than once in dataset "customer"/],
    ["duplicate metric", (d) => { d.model.metrics!.push({ ...d.model.metrics![0] }); }, /metric name ".+" is declared more than once/],
    ["relationship arity mismatch", (d) => { d.model.relationships![0].to_columns = []; }, /from_columns but 0 to_columns/],
    ["relationship names unknown dataset", (d) => { d.model.relationships![0].to = "ghost"; }, /to names unknown dataset "ghost"/],
    ["extension data is not JSON", (d) => { d.model.datasets[3].custom_extensions![0].data = "{not json"; }, /not valid JSON/],
    ["duplicate concept", (d) => { d.ontology.ontology.push({ ...concept(d, "Mrr") }); }, /concept name "Mrr" is declared more than once/],
    ["unknown extends", (d) => { concept(d, "Mrr").extends = ["Nowhere"]; }, /extends unknown concept "Nowhere"/],
    ["value type not ending in a built-in", (d) => { concept(d, "Mrr").extends = ["MrrChange"]; concept(d, "MrrChange").extends = ["Mrr"]; }, /value type "Mrr" does not extend/],
    ["entity type extends a value type", (d) => { concept(d, "Customer").extends = ["Mrr"]; }, /entity type "Customer" extends "Mrr"/],
    ["verbalization omits a role", (d) => { rel(d, "Customer", "status_on").verbalizes = ["{Customer} has {CustomerStatus}"]; }, /does not mention \{Date\}/],
    ["repeated concept without a role name", (d) => { rel(d, "Subscription", "customer").roles!.push({ concept: "Customer" }); rel(d, "Subscription", "customer").verbalizes = ["{Subscription} {Customer} {Customer}"]; }, /more than one role but the extra role has no name/],
    ["named role needs {Concept:role}", (d) => { rel(d, "Subscription", "customer").roles = [{ concept: "Customer", name: "payer" }]; }, /does not mention \{Customer:payer\}/],
    ["ontology_ref name differs", (d) => { d.mapping.ontology_ref.name = "Other"; }, /ontology_ref\.name "Other"/],
    ["semantic_model_ref name differs", (d) => { d.mapping.semantic_model_ref.name = "Other"; }, /semantic_model_ref\.name "Other"/],
    ["mapping expression names a missing field", (d) => { d.mapping.concept_mappings[0].object_mappings![0].referent_mappings![0].expression = "customer.nope"; }, /dataset "customer" has no field "nope"/],
    ["mapping expression names a missing dataset", (d) => { d.mapping.concept_mappings[0].link_mappings![0].children![0].object_mapping.expression = "ghost.x"; }, /dataset "ghost" does not exist/],
    ["referent relationship not on concept", (d) => { d.mapping.concept_mappings[0].object_mappings![0].referent_mappings![0].relationship = "bogus"; }, /referent mapping names relationship "bogus"/],
    ["link mapping level does not match arity", (d) => { d.mapping.concept_mappings[1].link_mappings![0].children![0].relationship = "mrr_on"; }, /at level 2 names relationship "Subscription.mrr_on" of arity 3/],
  ];
  for (const [name, mutate, re] of cases) {
    it(`flags: ${name}`, () => {
      const d = load();
      mutate(d);
      const problems = checkExport(d);
      expect(problems.some((p) => re.test(p)), problems.join("\n")).toBe(true);
    });
  }
});

describe("validateUpstream", () => {
  it("passes the spike files, or skips cleanly without uv", async () => {
    for (const kind of ["model", "ontology", "mapping"] as const) {
      const r = await validateUpstream(FILES[kind], kind);
      if (!uvAvailable()) {
        expect(r.skipped).toBeTruthy();
      } else {
        expect(r.skipped).toBeUndefined();
        expect(r.output).toContain("PASSED");
        expect(r.ok).toBe(true);
      }
    }
  }, 120_000);

  it("fails a document with broken SQL in a metric", async () => {
    if (!uvAvailable()) return;
    const d = load();
    expr(d.model.metrics![0]).expression = "SUM(revenue_event.mrr_change";
    const f = join(mkdtempSync(join(tmpdir(), "ossie-")), "bad.yaml");
    writeFileSync(f, stringify(d.model));
    const r = await validateUpstream(f, "model");
    expect(r.ok).toBe(false);
  }, 120_000);
});
