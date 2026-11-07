/**
 * The GASP Ossie extension schema (standard/gasp-ossie-extension-v1.json):
 * it compiles, travels in the bundle under its served URL, and every GASP
 * custom_extensions payload each writer emits matches its placement's
 * definition: the reference export, the Acme adapter converted, the fixture
 * and Acme adapters compiled, the Acme DDL profiled, proposed and decided,
 * and that decided pair compiled. checkExport names the placement and the key
 * of a planted bad payload and leaves other vendors' payloads alone. A document
 * carrying every payload as an object (apache/ossie #522), under the key
 * `nonportable_extensions` the same proposal renames to, or both, reads the
 * same as the pinned form through validate_mapping, compile_model and the checks.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { loadStandard } from "../src/loader.js";
import { adapterToOssie, resolveCompany, type Company } from "../src/ossie/adapt.js";
import { checkCompiledMetrics, checkExport } from "../src/ossie/check.js";
import { compileModel, type CompiledModel } from "../src/ossie/company.js";
import { recordDecisions, type Decision } from "../src/ossie/decide.js";
import { exportOssie, ossieYaml } from "../src/ossie/index.js";
import { exportOntology } from "../src/ossie/ontology.js";
import { parseStatistics, profileSchema } from "../src/ossie/profile.js";
import { proposeMapping } from "../src/ossie/propose.js";
import { GASP_VENDOR, RENAMED_EXTENSIONS_KEY, extensionData, normaliseExtensions, type OssieExtension, type OssieMapping, type OssieSemanticModel } from "../src/ossie/types.js";
import { compileModelFromText } from "../src/ossie/company.js";
import { validateMapping } from "../src/ossie/adapt.js";
import { parse as parseYaml } from "yaml";
import type { Adapter } from "../src/tools.js";
import { acmeAdapterText, acmeDdl, parsedSchema } from "./ossie-helpers.js";

const data = loadStandard();
const schemaPath = join(process.cwd(), "..", "standard", "gasp-ossie-extension-v1.json");
const fileSchema = JSON.parse(readFileSync(schemaPath, "utf-8")) as Record<string, unknown>;
const opts = { extensionSchema: data.extensionSchema };
const ontology = exportOntology(data);

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(fileSchema);
const ID = "https://gaspwiki.com/schemas/gasp-ossie-extension-v1.json";
type Placement = "Model" | "Dataset" | "Metric" | "Mapping";
const validator = (p: Placement) => ajv.getSchema(`${ID}#/$defs/${p}Extension`)!;

/** Every GASP payload in a model and its mapping, validated by placement; one line per failure. */
function payloadErrors(model: OssieSemanticModel, mapping?: OssieMapping): { count: number; errors: string[] } {
  let count = 0;
  const errors: string[] = [];
  const check = (exts: OssieExtension[] | undefined, p: Placement, who: string) => {
    for (const e of exts ?? []) {
      if (e.vendor_name !== GASP_VENDOR) continue;
      count++;
      const v = validator(p);
      if (!v(JSON.parse(e.data))) errors.push(`${who}: ${JSON.stringify(v.errors)}`);
    }
  };
  check(model.custom_extensions, "Model", "model");
  for (const d of model.datasets) {
    check(d.custom_extensions, "Dataset", `dataset ${d.name}`);
    for (const f of d.fields ?? []) expect(f.custom_extensions?.some((e) => e.vendor_name === GASP_VENDOR) ?? false).toBe(false);
  }
  for (const r of model.relationships ?? []) expect(r.custom_extensions?.some((e) => e.vendor_name === GASP_VENDOR) ?? false).toBe(false);
  for (const m of model.metrics ?? []) check(m.custom_extensions, "Metric", `metric ${m.name}`);
  if (mapping) check(mapping.custom_extensions, "Mapping", "mapping");
  return { count, errors };
}

const company = (adapterText: string, modelText?: string): Company => {
  const c = resolveCompany(adapterText, modelText, data);
  if ("error" in c) throw new Error(c.error);
  return c;
};
const compiled = (c: Company, o = {}): CompiledModel => {
  const r = compileModel(c, data, o);
  if ("error" in r) throw new Error(r.error);
  return r;
};
const extOf = (x: { custom_extensions?: OssieExtension[] }) => JSON.parse(x.custom_extensions!.find((e) => e.vendor_name === GASP_VENDOR)!.data) as Record<string, unknown>;

const acmeProposal = () => {
  const stats = parseStatistics(JSON.stringify([{ table: "billing.mrr_movements", column: "movement_type", rows: 1200, nulls: 0, distinct: 4, values: ["new", "upgrade", "cancel", "flex"] }]));
  if ("error" in stats) throw new Error(stats.error);
  const profiled = profileSchema(parsedSchema(acmeDdl), stats.stats, data, { organization: "Acme SaaS" });
  return { profiled, proposal: proposeMapping(profiled.model, data, { organization: "Acme SaaS" }) };
};
const recode = "CASE WHEN {{value}} = 'upgrade' THEN 'expansion' WHEN {{value}} = 'flex' THEN 'expansion' WHEN {{value}} = 'cancel' THEN 'churn' ELSE {{value}} END";
const decisions: Decision[] = [
  { about: "key", dataset: "analytics.usage_daily", answer: ["account_id", "workspace_id", "day"], owner: "Data platform", note: "one row per workspace per day" },
  { about: "type", dataset: "plan_prices", column: "price_tiers", answer: "String", owner: "Billing" },
  { about: "kind", dataset: "plan_prices", answer: "reference", owner: "Billing" },
  { about: "table", dataset: "plan_prices", to: "plan", owner: "Billing", note: "the price list is the plan catalogue" },
  { about: "table", dataset: "usage_daily", to: "lifecycle_event", accept: false, owner: "Product analytics" },
  { about: "field", dataset: "mrr_movements", column: "movement_type", to: "event_type", transform: recode, owner: "Finance", note: "flex is an expansion" },
  { about: "field", dataset: "subscriptions", column: "plan_code", to: "plan_id", accept: false, owner: "Billing", note: "plan_code is the SKU, not the plan" },
  { about: "owner", metric: "nrr", owner: "Finance", contact: "fpa@acme.example" },
  { about: "owner", metric: "All Core metrics", owner: "Finance" },
  { about: "topic", topic: "reporting currency", answer: "USD", owner: "Finance", note: "EUR invoices convert at the month-end rate" },
  { about: "topic", topic: "churn date", answer: "the subscription end date, not the cancellation request", owner: "Finance", date: "2026-10-30" },
];

describe("GASP Ossie extension schema", () => {
  it("compiles under Ajv 2020 and travels in the bundle under its served URL", () => {
    expect(() => new Ajv2020({ strict: false }).compile(fileSchema)).not.toThrow();
    expect(fileSchema.$id).toBe(ID);
    expect(data.extensionSchema).toEqual(fileSchema);
    for (const p of ["Model", "Dataset", "Metric", "Mapping"] as const) expect(validator(p)).toBeTypeOf("function");
  });

  it("describes every GASP payload of the reference export", () => {
    const exp = exportOssie(data); // throws on any checkExport problem, which now includes the schema
    expect(checkExport(exp, opts)).toEqual([]);
    const r = payloadErrors(exp.model, exp.mapping);
    expect(r.errors).toEqual([]);
    expect(r.count).toBeGreaterThan(exp.model.datasets.length);
    expect(exp.model.datasets.some((d) => extOf(d).staged === true)).toBe(true);
  });

  it("describes the Acme adapter converted to Ossie", () => {
    const form = adapterToOssie(JSON.parse(acmeAdapterText) as Adapter, data);
    expect(checkExport({ ontology, model: form.model, mapping: form.mapping }, opts)).toEqual([]);
    const r = payloadErrors(form.model, form.mapping);
    expect(r.errors).toEqual([]);
    expect(Object.keys(extOf(form.mapping))).toEqual(expect.arrayContaining(["organization", "metricOwners"]));
  });

  it("describes the fixture and Acme adapters compiled into their models", () => {
    const fixture = readFileSync(join(process.cwd(), "test", "fixture", "adapter.json"), "utf-8");
    for (const [text, o] of [[fixture, {}], [acmeAdapterText, { dialect: "snowflake" }]] as const) {
      const c = company(text);
      const r = compiled(c, o);
      expect(r.problems).toEqual([]);
      const form = adapterToOssie(c.adapter, data);
      expect(checkExport({ ontology, model: r.model, mapping: form.mapping }, opts)).toEqual([]);
      const p = payloadErrors(r.model, form.mapping);
      expect(p.errors).toEqual([]);
      expect(extOf(r.model).compiled).toBeDefined();
      expect(r.model.datasets.some((d) => d.custom_extensions && extOf(d).period_spine === true)).toBe(true);
    }
  });

  it("describes the Acme DDL profiled, proposed, decided and compiled", () => {
    const { profiled, proposal } = acmeProposal();
    const pm = payloadErrors(profiled.model);
    expect(pm.errors).toEqual([]);
    expect(extOf(profiled.model).profiled).toBeDefined();
    expect(proposal.problems).toEqual([]);
    expect(payloadErrors(proposal.model, proposal.mapping).errors).toEqual([]);
    expect(checkExport({ ontology, model: proposal.model, mapping: proposal.mapping }, opts)).toEqual([]);

    const decided = recordDecisions(proposal.model, proposal.mapping, decisions, data);
    expect(decided.problems).toEqual([]);
    expect(payloadErrors(decided.model, decided.mapping).errors).toEqual([]);
    const ext = extOf(decided.mapping);
    expect((ext.decisions as unknown[]).length).toBe(decisions.length);
    expect(ext.metricOwners).toBeDefined();

    const r = compiled(company(ossieYaml(decided.mapping), ossieYaml(decided.model)), { dialect: "snowflake" });
    expect(r.problems).toEqual([]);
    expect(payloadErrors(r.model, decided.mapping).errors).toEqual([]);
    expect(checkCompiledMetrics(r.model, new Set((r.model.metrics ?? []).map((m) => m.name)), opts)).toEqual([]);
  });

  it("names the placement and the key of a bad payload and leaves other vendors alone", () => {
    const exp = exportOssie(data);
    const model: OssieSemanticModel = structuredClone(exp.model);
    const ds = model.datasets[0];
    ds.custom_extensions = [{ vendor_name: GASP_VENDOR, data: JSON.stringify({ ...extOf(ds), colour: "blue" }) }];
    const m = model.metrics![0];
    m.custom_extensions = [{ vendor_name: GASP_VENDOR, data: JSON.stringify({ ...extOf(m), gasp_version: 1 }) }];
    model.datasets[1].custom_extensions = [...(model.datasets[1].custom_extensions ?? []), { vendor_name: "Acme", data: JSON.stringify({ anything: [1, 2], goes: true }) }];
    const mapping: OssieMapping = { ...exp.mapping, custom_extensions: [{ vendor_name: GASP_VENDOR, data: JSON.stringify({ organization: 7 }) }] };

    const problems = checkExport({ ontology: exp.ontology, model, mapping }, opts);
    expect(problems).toContain(`Model: custom_extensions of dataset "${ds.name}" (GASP): \`/\` must NOT have additional properties: \`colour\``);
    expect(problems.some((p) => p.startsWith(`Model: custom_extensions of metric "${m.name}" (GASP): \`/gasp_version\``))).toBe(true);
    expect(problems).toContain("Mapping: custom_extensions of mapping (GASP): `/organization` must be string");
    expect(problems.filter((p) => p.includes(model.datasets[1].name))).toEqual([]);
    expect(problems).toHaveLength(3);
    // without the schema only the JSON check runs
    expect(checkExport({ ontology: exp.ontology, model, mapping })).toEqual([]);
    expect(checkCompiledMetrics(model, new Set([m.name]), opts)).toEqual([expect.stringContaining(`metric "${m.name}" (GASP): \`/gasp_version\``)]);
  });
});

describe("custom_extensions data in the object form (apache/ossie #522)", () => {
  /** The document with every extension payload as an object instead of the pinned JSON string. */
  const objectForm = <T>(doc: T): T => {
    const copy = structuredClone(doc);
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (typeof v !== "object" || v === null) return;
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (k === "custom_extensions" && Array.isArray(x)) {
          for (const e of x as Array<{ data: unknown }>) if (typeof e.data === "string") e.data = JSON.parse(e.data);
        } else walk(x);
      }
    };
    walk(copy);
    return copy;
  };
  const countObjects = (doc: unknown): number => normaliseExtensions(structuredClone(doc));
  /** The document with every `custom_extensions` key renamed to `nonportable_extensions`, the other half of the #522 migration. */
  const renamedForm = <T>(doc: T): T => {
    const copy = structuredClone(doc);
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (typeof v !== "object" || v === null) return;
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.custom_extensions)) { o[RENAMED_EXTENSIONS_KEY] = o.custom_extensions; delete o.custom_extensions; }
      Object.values(o).forEach(walk);
    };
    walk(copy);
    return copy;
  };
  const countKeys = (doc: unknown): number => JSON.stringify(doc).split(`"${RENAMED_EXTENSIONS_KEY}"`).length - 1;

  const form = adapterToOssie(JSON.parse(acmeAdapterText) as Adapter, data);
  const text = { mapping: ossieYaml(form.mapping), model: ossieYaml(form.model) };
  const objectText = { mapping: ossieYaml(objectForm(form.mapping)), model: ossieYaml(objectForm(form.model)) };
  const renamedText = { mapping: ossieYaml(renamedForm(objectForm(form.mapping))), model: ossieYaml(renamedForm(objectForm(form.model))) };

  it("the object form is a different document with the payloads as YAML maps", () => {
    expect(objectText.mapping).not.toEqual(text.mapping);
    expect(countObjects(parseYaml(text.mapping))).toBe(0);
    expect(countObjects(parseYaml(objectText.mapping))).toBeGreaterThan(0);
    expect(countObjects(parseYaml(objectText.model)) + countObjects(parseYaml(objectText.mapping))).toBe(countObjects(objectForm(form.model)) + countObjects(objectForm(form.mapping)));
  });

  it("extensionData reads a JSON string or an object and nothing else", () => {
    expect(extensionData({ data: '{"a": 1}' })).toEqual({ a: 1 });
    expect(extensionData({ data: { a: 1 } })).toEqual({ a: 1 });
    expect(extensionData({ data: "{not json" })).toBeUndefined();
    expect(extensionData({ data: [1] })).toBeUndefined();
    expect(extensionData({ data: 7 })).toBeUndefined();
    expect(extensionData(undefined)).toBeUndefined();
  });

  it("normaliseExtensions rewrites the objects to the pinned string form in place and counts them", () => {
    const doc = objectForm(form.mapping);
    const before = JSON.stringify(doc);
    const n = normaliseExtensions(doc);
    expect(n).toBeGreaterThan(0);
    expect(JSON.stringify(doc)).not.toEqual(before);
    expect(doc).toEqual(form.mapping);
    expect(normaliseExtensions(doc)).toBe(0);
  });

  it("normaliseExtensions folds nonportable_extensions back to the pinned key, after any pinned entries", () => {
    const doc = renamedForm(objectForm(form.mapping));
    const keys = countKeys(doc);
    expect(keys).toBeGreaterThan(0);
    expect(countKeys(form.mapping)).toBe(0);
    expect(normaliseExtensions(doc)).toBe(keys + countObjects(objectForm(form.mapping)));
    expect(countKeys(doc)).toBe(0);
    expect(doc).toEqual(form.mapping);
    expect(normaliseExtensions(doc)).toBe(0);
    const both = { custom_extensions: [{ vendor_name: "ACME", data: "{}" }], [RENAMED_EXTENSIONS_KEY]: [{ vendor_name: GASP_VENDOR, data: { a: 1 } }] } as Record<string, unknown>;
    expect(normaliseExtensions(both)).toBe(2);
    expect(both).toEqual({ custom_extensions: [{ vendor_name: "ACME", data: "{}" }, { vendor_name: GASP_VENDOR, data: '{"a":1}' }] });
  });

  it("validate_mapping and compile_model read the renamed key with object payloads as the pinned form", () => {
    expect(renamedText.mapping).toContain(`${RENAMED_EXTENSIONS_KEY}:`);
    expect(renamedText.mapping).not.toContain("custom_extensions:");
    expect(validateMapping(renamedText.mapping, renamedText.model, data)).toEqual(validateMapping(text.mapping, text.model, data));
    expect(compileModelFromText(renamedText.mapping, renamedText.model, data, { document: true })).toEqual(compileModelFromText(text.mapping, text.model, data, { document: true }));
    const c = company(renamedText.mapping, renamedText.model);
    expect(countKeys(c.model)).toBe(0);
    expect(countObjects(c.model)).toBe(0);
  });

  it("validate_mapping gives the same report for both forms", () => {
    const a = validateMapping(text.mapping, text.model, data);
    const b = validateMapping(objectText.mapping, objectText.model, data);
    expect(a).toContain("Valid against apache/ossie ontology/mapping.json.");
    expect(b).toEqual(a);
  });

  it("compile_model gives the same model for both forms", () => {
    const a = compileModelFromText(text.mapping, text.model, data, { document: true });
    const b = compileModelFromText(objectText.mapping, objectText.model, data, { document: true });
    expect(a).toContain("gasp_");
    expect(b).toEqual(a);
    const c = company(objectText.mapping, objectText.model);
    expect(countObjects(c.model)).toBe(0); // the parsed document carries the pinned form
    expect(compiled(c).model).toEqual(compiled(company(text.mapping, text.model)).model);
  });

  it("the checks read both forms in memory and name a bad object payload by placement", () => {
    const exp = exportOssie(data);
    const docs = { ontology: exp.ontology, model: objectForm(exp.model), mapping: objectForm(exp.mapping) };
    expect(countObjects(docs.model)).toBeGreaterThan(exp.model.datasets.length);
    expect(checkExport(docs, opts)).toEqual([]);
    const ds = docs.model.datasets[0];
    (ds.custom_extensions![0] as { data: unknown }).data = { ...(extensionData(ds.custom_extensions![0]) as Record<string, unknown>), colour: "blue" };
    expect(checkExport(docs, opts)).toEqual([`Model: custom_extensions of dataset "${ds.name}" (GASP): \`/\` must NOT have additional properties: \`colour\``]);
    (ds.custom_extensions![0] as { data: unknown }).data = 7;
    expect(checkExport(docs, opts)).toEqual([`Model: custom_extensions data of dataset "${ds.name}" (vendor GASP) is not valid JSON`]);
  });
});
