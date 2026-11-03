/**
 * One mapping format: a v1 adapter converts to an Ossie mapping over a
 * synthesised model and back without losing coverage; an Ossie mapping with
 * its model validates and scores like an adapter; the layered report names
 * each layer; and the bundled Ossie schemas apply offline.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { loadStandard } from "../src/loader.js";
import { checkAdapter, type Adapter } from "../src/tools.js";
import {
  adapterToOssie, checkMapping, formatMappingReport, impliedModel, isOssieMapping, isV1Adapter, loadAdapter, ossieSchemaErrors, ossieToAdapter, parseDocument, validateMapping,
} from "../src/ossie/adapt.js";
import { checkExport } from "../src/ossie/check.js";
import { exportOntology } from "../src/ossie/ontology.js";
import { ossieYaml } from "../src/ossie/index.js";
import { uvAvailable, validateUpstream } from "../src/ossie/validate.js";
import type { OssieMapping, OssieSemanticModel } from "../src/ossie/types.js";

const data = loadStandard();
const acme = JSON.parse(readFileSync(join(process.cwd(), "test", "fixture", "acme-adapter.json"), "utf-8")) as Adapter;
const spikeDir = join(process.cwd(), "test", "fixture", "ossie-spike");
const spikeMapping = parseYaml(readFileSync(join(spikeDir, "gasp.mapping.yaml"), "utf-8")) as OssieMapping;
const spikeModel = parseYaml(readFileSync(join(spikeDir, "gasp.semantic_model.yaml"), "utf-8")) as OssieSemanticModel;

const coverageOf = (a: Adapter) => {
  const c = checkAdapter(a, data);
  return { mapped: c.mappedNeededCount, fully: c.fully.map((f) => f.metric).sort(), partial: c.partial.map((p) => p.metric).sort(), none: [...c.none].sort(), tables: c.tableCount };
};

describe("Mapping format: the bundled Ossie schemas", () => {
  it("travel with the data and validate the reference mapping and model", () => {
    expect(data.ossieSchemas).toBeDefined();
    const mapping = parseYaml(readFileSync(join(process.cwd(), "..", "standard", "exports", "ossie", "gasp.mapping.yaml"), "utf-8"));
    expect(ossieSchemaErrors(mapping, "mapping", data)).toEqual([]);
    expect(ossieSchemaErrors(spikeModel, "model", data)).toEqual([]);
  });

  it("report a shape error with its path", () => {
    const errors = ossieSchemaErrors({ version: "0.2.0.dev0", name: "x", concept_mappings: [{ nope: 1 }] }, "mapping", data)!;
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toMatch(/ontology_ref|semantic_model_ref|concept/);
  });
});

describe("Mapping format: a v1 adapter converts to Ossie documents", () => {
  const form = adapterToOssie(acme, data);

  it("makes a model of the adapter's datasets and columns, named by the warehouse", () => {
    expect(form.model.datasets.map((d) => d.name).sort()).toEqual(Object.keys(acme.datasets!).sort());
    const sub = form.model.datasets.find((d) => d.name === "subscription")!;
    expect(sub.source).toBe("billing.subscriptions");
    expect(sub.primary_key).toBeDefined();
    const mrr = acme.mappings.find((m) => m.gaspField === "mrr" && (!m.dataset || m.dataset === "subscription"))!;
    const col = mrr.warehouseRef.split(".").pop()!;
    const field = sub.fields!.find((f) => f.name === (mrr.transform ? "mrr" : col))!;
    expect(field).toBeDefined();
    expect((field.expression as { dialects: Array<{ expression: string }> }).dialects[0].expression).toBe(mrr.transform ? mrr.transform.replace(/\{\{value\}\}/g, col) : col);
  });

  it("maps the GASP ontology onto it so every document checks out, with no gaps", () => {
    expect(form.gaps).toEqual([]);
    expect(ossieSchemaErrors(form.mapping, "mapping", data)).toEqual([]);
    expect(ossieSchemaErrors(form.model, "model", data)).toEqual([]);
    expect(checkExport({ ontology: exportOntology(data), model: form.model, mapping: form.mapping })).toEqual([]);
    expect(form.mapping.ontology_ref.name).toBe("GASP");
    expect(form.mapping.custom_extensions?.[0].vendor_name).toBe("GASP");
  });

  it("round-trips to an adapter with the same coverage", () => {
    const back = ossieToAdapter(form.mapping, form.model, data);
    expect(back.problems).toEqual([]);
    expect(coverageOf(back.adapter)).toEqual(coverageOf(acme));
    expect(back.adapter.metricOwners).toEqual(acme.metricOwners);
    expect(back.adapter.organization).toBe(acme.organization);
    // A transform survives as the field's expression, emitted verbatim.
    const transformed = acme.mappings.find((m) => m.transform)!;
    const roundTripped = back.adapter.mappings.find((m) => m.gaspField === transformed.gaspField)!;
    expect(roundTripped.transform).toBe(transformed.transform.replace(/\{\{value\}\}/g, transformed.warehouseRef.split(".").pop()!));
  });

  const upstream = uvAvailable() ? it : it.skip;
  upstream("passes the upstream validator beside the GASP ontology", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gasp-adapt-"));
    const mapping = { ...form.mapping, ontology_ref: { name: "GASP", iri: "./gasp.ontology.yaml" } };
    writeFileSync(join(dir, "gasp.ontology.yaml"), ossieYaml(exportOntology(data)));
    writeFileSync(join(dir, "acme_saas.semantic_model.yaml"), ossieYaml(form.model));
    writeFileSync(join(dir, "mapping.yaml"), ossieYaml(mapping));
    const model = await validateUpstream(join(dir, "acme_saas.semantic_model.yaml"), "model");
    expect(model.ok, model.output).toBe(true);
    const result = await validateUpstream(join(dir, "mapping.yaml"), "mapping");
    expect(result.ok, result.output).toBe(true);
  }, 120_000);
});

describe("Mapping format: an Ossie mapping is accepted as the input", () => {
  // The converted Acme documents, as the YAML text a company would pass.
  const form = adapterToOssie(acme, data);
  const mappingYaml = ossieYaml(form.mapping);
  const modelYaml = ossieYaml(form.model);

  it("reads a mapping and its model as an adapter with the tables and columns the model names", () => {
    const parsed = parseDocument(mappingYaml).doc as unknown as OssieMapping;
    const model = parseDocument(modelYaml).doc as unknown as OssieSemanticModel;
    const { adapter, problems } = ossieToAdapter(parsed, model, data);
    expect(problems).toEqual([]);
    expect(adapter.datasets).toEqual(acme.datasets);
    expect(coverageOf(adapter)).toEqual(coverageOf(acme));
    const c = checkAdapter(adapter, data);
    expect(c.problems).toEqual([]);
    expect(c.fully.map((f) => f.metric)).toContain("MRR (Monthly Recurring Revenue)");
  });

  it("implies a model from the expressions when none is given, and says so", () => {
    const implied = impliedModel(form.mapping);
    expect(implied.datasets.map((d) => d.name).sort()).toEqual(form.model.datasets.map((d) => d.name).sort());
    const v = checkMapping({ document: form.mapping }, data);
    if ("error" in v) throw new Error(v.error);
    expect(v.format).toBe("ossie");
    expect(v.modelProvided).toBe(false);
    expect(v.crossProblems).toEqual([]);
    // Without the model a transform cannot be recovered, so a transformed field reads as its bare name; coverage is unchanged.
    expect(coverageOf(v.adapter).fully).toEqual(coverageOf(acme).fully);
    expect(formatMappingReport(v, data)).toContain("without a semantic model");
  });

  it("flags a mapping written against another ontology at the cross-document layer", () => {
    // The spike fixture names relationships as that ontology did (mrr_on, status_on); today's GASP ontology names them by field id.
    const v = checkMapping({ document: spikeMapping, model: spikeModel }, data);
    if ("error" in v) throw new Error(v.error);
    expect(v.crossProblems.length).toBeGreaterThan(0);
    expect(v.crossProblems.join("\n")).toContain("mrr_on");
  });

  it("reports an unknown concept at the cross-document layer and a bad expression at conversion", () => {
    const broken: OssieMapping = {
      ...form.mapping,
      concept_mappings: [
        ...form.mapping.concept_mappings,
        { concept: "Nope", object_mappings: [{ referent_mappings: [{ relationship: "id", expression: "nope.id" }] }] },
        { concept: "Subscription", link_mappings: [{ object_mapping: { referent_mappings: [{ relationship: "subscription_id", expression: "subscription.subscription_id" }] }, children: [{ object_mapping: { concept: "Mrr", expression: "amount * 2 + 1" }, relationship: "mrr" }] }] },
      ],
    };
    const v = checkMapping({ document: broken, model: form.model }, data);
    if ("error" in v) throw new Error(v.error);
    expect(v.crossProblems.join("\n")).toContain('"Nope"');
    expect(v.conversionProblems.join("\n")).toContain("amount * 2 + 1");
  });
});

describe("Mapping format: the validate_mapping report and the document loader", () => {
  it("parses JSON and YAML and refuses the rest", () => {
    expect(isV1Adapter(parseDocument(JSON.stringify(acme)).doc)).toBe(true);
    expect(isOssieMapping(parseDocument(readFileSync(join(spikeDir, "gasp.mapping.yaml"), "utf-8")).doc)).toBe(true);
    expect(parseDocument("- just: [a list").error).toBeDefined();
    expect(parseDocument("42").error).toBeDefined();
  });

  it("layers the report for a v1 adapter", () => {
    const report = validateMapping(JSON.stringify(acme), undefined, data);
    for (const h of ["# GASP Mapping Validation: Acme SaaS", "## Format", "converted on load", "## Ossie schema", "Valid against apache/ossie ontology/mapping.json", "## Cross-document checks", "## Coverage", "## Schema", "## Fully covered"]) expect(report).toContain(h);
  });

  const form = adapterToOssie(acme, data);
  it("layers the report for an Ossie mapping with its model", () => {
    const report = validateMapping(ossieYaml(form.mapping), ossieYaml(form.model), data);
    expect(report).toContain("with its semantic model");
    expect(report).toContain("## Fully covered");
    expect(report).not.toContain("gasp-adapter-v1.json");
  });

  it("refuses a document in neither format, and a bad model", () => {
    expect(validateMapping(JSON.stringify({ hello: 1 }), undefined, data)).toContain("neither a GASP adapter");
    expect(validateMapping(ossieYaml(form.mapping), "{\"nope\": true}", data)).toContain("semantic model must be");
  });

  it("gives generate_query the adapter behind either format", () => {
    expect(loadAdapter(JSON.stringify(acme), undefined, data).format).toBe("v1");
    const o = loadAdapter(ossieYaml(form.mapping), ossieYaml(form.model), data);
    expect(o.format).toBe("ossie");
    expect(o.adapter!.mappings.length).toBe(acme.mappings.filter((m) => m.warehouseRef?.trim()).length);
    expect(loadAdapter("nonsense: [", undefined, data).error).toBeDefined();
  });
});
