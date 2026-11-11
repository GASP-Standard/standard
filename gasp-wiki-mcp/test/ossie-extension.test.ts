/**
 * The GASP Ossie extension schema (standard/gasp-ossie-extension-v1.json):
 * it compiles, travels in the bundle under its served URL, and every GASP
 * nonportable_extensions payload each writer emits matches its placement's
 * definition: the reference export, the Acme adapter converted, the fixture
 * and Acme adapters compiled, the Acme DDL profiled, proposed and decided,
 * and that decided pair compiled. checkExport names the placement and the key
 * of a planted bad payload and leaves other vendors' payloads alone. A document
 * saved before the move to Ossie 0.3.0.dev0 (the `custom_extensions` key, each
 * payload a JSON string, version 0.2.0.dev0, or any one of the three) reads
 * the same as the current form through validate_mapping, compile_model and the
 * checks, and comes back from a tool in the current form.
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
import { GASP_VENDOR, LEGACY_EXTENSIONS_KEY, LEGACY_OSSIE_VERSION, OSSIE_VERSION, extensionData, gaspExtension, migrateDocument, type OssieExtension, type OssieMapping, type OssieSemanticModel } from "../src/ossie/types.js";
import { compileModelFromText } from "../src/ossie/company.js";
import { validateMapping } from "../src/ossie/adapt.js";
import { parse as parseYaml } from "yaml";
import type { Adapter } from "../src/tools.js";
import { acmeAdapterText, acmeDdl, parsedSchema } from "./ossie-helpers.js";
import { adapter as fixtureAdapter } from "./fixture-db.js";

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
      if (!v(e.data)) errors.push(`${who}: ${JSON.stringify(v.errors)}`);
    }
  };
  check(model.nonportable_extensions, "Model", "model");
  for (const d of model.datasets) {
    check(d.nonportable_extensions, "Dataset", `dataset ${d.name}`);
    for (const f of d.fields ?? []) expect(f.nonportable_extensions?.some((e) => e.vendor_name === GASP_VENDOR) ?? false).toBe(false);
  }
  for (const r of model.relationships ?? []) expect(r.nonportable_extensions?.some((e) => e.vendor_name === GASP_VENDOR) ?? false).toBe(false);
  for (const m of model.metrics ?? []) check(m.nonportable_extensions, "Metric", `metric ${m.name}`);
  if (mapping) check(mapping.nonportable_extensions, "Mapping", "mapping");
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
const extOf = (x: { nonportable_extensions?: OssieExtension[] }) => x.nonportable_extensions!.find((e) => e.vendor_name === GASP_VENDOR)!.data;

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
    const fixture = JSON.stringify(fixtureAdapter);
    for (const [text, o] of [[fixture, {}], [acmeAdapterText, { dialect: "snowflake" }]] as const) {
      const c = company(text);
      const r = compiled(c, o);
      expect(r.problems).toEqual([]);
      const form = adapterToOssie(c.adapter, data);
      expect(checkExport({ ontology, model: r.model, mapping: form.mapping }, opts)).toEqual([]);
      const p = payloadErrors(r.model, form.mapping);
      expect(p.errors).toEqual([]);
      expect(extOf(r.model).compiled).toBeDefined();
      expect(r.model.datasets.some((d) => d.nonportable_extensions && extOf(d).period_spine === true)).toBe(true);
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
    ds.nonportable_extensions = [gaspExtension({ ...extOf(ds), colour: "blue" })];
    const m = model.metrics![0];
    m.nonportable_extensions = [gaspExtension({ ...extOf(m), gasp_version: 1 })];
    model.datasets[1].nonportable_extensions = [...(model.datasets[1].nonportable_extensions ?? []), { vendor_name: "Acme", data: { anything: [1, 2], goes: true } }];
    const mapping: OssieMapping = { ...exp.mapping, nonportable_extensions: [gaspExtension({ organization: 7 })] };

    const problems = checkExport({ ontology: exp.ontology, model, mapping }, opts);
    expect(problems).toContain(`Model: nonportable_extensions of dataset "${ds.name}" (GASP): \`/\` must NOT have additional properties: \`colour\``);
    expect(problems.some((p) => p.startsWith(`Model: nonportable_extensions of metric "${m.name}" (GASP): \`/gasp_version\``))).toBe(true);
    expect(problems).toContain("Mapping: nonportable_extensions of mapping (GASP): `/organization` must be string");
    expect(problems.filter((p) => p.includes(model.datasets[1].name))).toEqual([]);
    expect(problems).toHaveLength(3);
    // without the schema only the object check runs
    expect(checkExport({ ontology: exp.ontology, model, mapping })).toEqual([]);
    expect(checkCompiledMetrics(model, new Set([m.name]), opts)).toEqual([expect.stringContaining(`metric "${m.name}" (GASP): \`/gasp_version\``)]);
  });
});

describe("documents saved before the move to Ossie 0.3.0.dev0", () => {
  type Walk = (o: Record<string, unknown>) => void;
  /** A copy of the document with `each` applied to every object in it, outside the extension payloads. */
  const rewritten = <T>(doc: T, each: Walk): T => {
    const copy = structuredClone(doc);
    const walk = (v: unknown, inData = false): void => {
      if (Array.isArray(v)) { v.forEach((x) => walk(x, inData)); return; }
      if (typeof v !== "object" || v === null || inData) return;
      const o = v as Record<string, unknown>;
      for (const [k, x] of Object.entries(o)) walk(x, k === "data" && typeof o.vendor_name === "string");
      each(o);
    };
    walk(copy);
    return copy;
  };
  /** Every extension payload as the JSON string the earlier schema defined. */
  const stringForm = <T>(doc: T): T => rewritten(doc, (o) => {
    if (typeof o.vendor_name === "string" && typeof o.data === "object") o.data = JSON.stringify(o.data);
  });
  /** Every `nonportable_extensions` key under the name it had before apache/ossie #522. */
  const renamedForm = <T>(doc: T): T => rewritten(doc, (o) => {
    if (Array.isArray(o.nonportable_extensions)) { o[LEGACY_EXTENSIONS_KEY] = o.nonportable_extensions; delete o.nonportable_extensions; }
  });
  /** The document as 1.20 and 1.21 wrote it: the old key, string payloads and the old version. */
  const legacyForm = <T>(doc: T): T => ({ ...renamedForm(stringForm(doc)), version: LEGACY_OSSIE_VERSION });
  const countKeys = (doc: unknown, key: string): number => JSON.stringify(doc).split(`"${key}":`).length - 1;
  const countStrings = (doc: unknown): number => { let n = 0; rewritten(doc, (o) => { if (typeof o.vendor_name === "string" && typeof o.data === "string") n++; }); return n; };

  const form = adapterToOssie(JSON.parse(acmeAdapterText) as Adapter, data);
  const text = { mapping: ossieYaml(form.mapping), model: ossieYaml(form.model) };
  const legacy = { mapping: ossieYaml(legacyForm(form.mapping)), model: ossieYaml(legacyForm(form.model)) };
  const variants: Array<[string, { mapping: string; model: string }]> = [
    ["the old key, string payloads and the old version", legacy],
    ["string payloads alone", { mapping: ossieYaml(stringForm(form.mapping)), model: ossieYaml(stringForm(form.model)) }],
    ["the old key alone", { mapping: ossieYaml(renamedForm(form.mapping)), model: ossieYaml(renamedForm(form.model)) }],
    ["the old version alone", { mapping: ossieYaml({ ...form.mapping, version: LEGACY_OSSIE_VERSION }), model: ossieYaml({ ...form.model, version: LEGACY_OSSIE_VERSION }) }],
  ];

  it("GASP writes the current form: the new key, object payloads and version 0.3.0.dev0", () => {
    expect(OSSIE_VERSION).toBe("0.3.0.dev0");
    const exp = exportOssie(data);
    for (const d of [form.mapping, form.model, exp.ontology, exp.model, exp.mapping]) {
      const t = ossieYaml(d);
      expect(t).not.toContain(`${LEGACY_EXTENSIONS_KEY}:`);
      expect(t).toContain(`version: ${OSSIE_VERSION}`);
      expect(countStrings(d)).toBe(0);
    }
    expect(text.mapping).toContain("nonportable_extensions:"); // the synthesised Acme model carries none
    expect(countKeys(exp.model, "nonportable_extensions")).toBeGreaterThan(exp.model.datasets.length);
  });

  it("the legacy form is a different document", () => {
    expect(legacy.mapping).toContain(`${LEGACY_EXTENSIONS_KEY}:`);
    expect(legacy.mapping).not.toContain("nonportable_extensions:");
    expect(legacy.mapping).toContain(`version: ${LEGACY_OSSIE_VERSION}`);
    const model = exportOssie(data).model;
    expect(countStrings(legacyForm(model))).toBe(countKeys(model, "vendor_name"));
    expect(countKeys(legacyForm(model), LEGACY_EXTENSIONS_KEY)).toBe(countKeys(model, "nonportable_extensions"));
  });

  it("extensionData reads an object or a JSON string holding one and nothing else", () => {
    expect(extensionData({ data: '{"a": 1}' })).toEqual({ a: 1 });
    expect(extensionData({ data: { a: 1 } })).toEqual({ a: 1 });
    expect(extensionData({ data: "{not json" })).toBeUndefined();
    expect(extensionData({ data: "[1]" })).toBeUndefined();
    expect(extensionData({ data: [1] })).toBeUndefined();
    expect(extensionData({ data: 7 })).toBeUndefined();
    expect(extensionData(undefined)).toBeUndefined();
  });

  it("migrateDocument rewrites a legacy document to the current one in place and counts the rewrites", () => {
    const exp = exportOssie(data);
    for (const current of [form.mapping, form.model, exp.model, exp.mapping]) {
      const doc = legacyForm(current);
      const keys = countKeys(doc, LEGACY_EXTENSIONS_KEY);
      const strings = countStrings(doc);
      if (current === form.mapping || current === exp.model) { // the other two carry no extension, only the old version
        expect(keys).toBeGreaterThan(0);
        expect(strings).toBeGreaterThan(0);
      }
      expect(migrateDocument(doc)).toBe(1 + keys + strings);
      expect(doc).toEqual(current);
      expect(migrateDocument(doc)).toBe(0);
      const same = structuredClone(current);
      expect(migrateDocument(same)).toBe(0);
      expect(same).toEqual(current);
    }
  });

  it("migrateDocument keeps current entries first, leaves a vendor's own keys alone and a bad string for the check to name", () => {
    const both = { [LEGACY_EXTENSIONS_KEY]: [{ vendor_name: "ACME", data: "{}" }], nonportable_extensions: [{ vendor_name: GASP_VENDOR, data: { a: 1 } }] } as Record<string, unknown>;
    expect(migrateDocument(both)).toBe(2);
    expect(both).toEqual({ nonportable_extensions: [{ vendor_name: GASP_VENDOR, data: { a: 1 } }, { vendor_name: "ACME", data: {} }] });

    const inner = { version: "0.2.0.dev0", [LEGACY_EXTENSIONS_KEY]: [{ vendor_name: "ACME", data: { version: "0.2.0.dev0", [LEGACY_EXTENSIONS_KEY]: [{ vendor_name: "X", data: "{}" }] } }] };
    expect(migrateDocument(inner)).toBe(2);
    expect(inner).toEqual({ version: OSSIE_VERSION, nonportable_extensions: [{ vendor_name: "ACME", data: { version: "0.2.0.dev0", [LEGACY_EXTENSIONS_KEY]: [{ vendor_name: "X", data: "{}" }] } }] });

    const bad = { datasets: [{ name: "d", nonportable_extensions: [{ vendor_name: GASP_VENDOR, data: "{not json" }, { vendor_name: GASP_VENDOR, data: "[1]" }] }] };
    expect(migrateDocument(bad)).toBe(0);
    expect(bad.datasets[0].nonportable_extensions.map((e) => e.data)).toEqual(["{not json", "[1]"]);

    const other = { version: "1.0.0", name: "x" };
    expect(migrateDocument(other)).toBe(0);
    expect(other.version).toBe("1.0.0");
  });

  for (const [name, t] of variants) {
    it(`validate_mapping and compile_model read ${name} as the current form`, () => {
      const report = validateMapping(text.mapping, text.model, data);
      expect(report).toContain("Valid against apache/ossie ontology/mapping.json.");
      expect(validateMapping(t.mapping, t.model, data)).toEqual(report);
      const document = compileModelFromText(text.mapping, text.model, data, { document: true });
      expect(document).toContain("gasp_");
      expect(compileModelFromText(t.mapping, t.model, data, { document: true })).toEqual(document);
      const c = company(t.mapping, t.model);
      expect(compiled(c).model).toEqual(compiled(company(text.mapping, text.model)).model);
    });
  }

  it("a tool that loads a legacy document hands back a current one", () => {
    const c = company(legacy.mapping, legacy.model);
    expect(c.model.version).toBe(OSSIE_VERSION);
    expect(countKeys(c.model, LEGACY_EXTENSIONS_KEY)).toBe(0);
    expect(countStrings(c.model)).toBe(0);
    const document = compileModelFromText(legacy.mapping, legacy.model, data, { document: true });
    expect(document).toContain(`version: ${OSSIE_VERSION}`);
    expect(document).toContain("nonportable_extensions:");
    expect(document).not.toContain(LEGACY_EXTENSIONS_KEY);
    expect(document).not.toContain(LEGACY_OSSIE_VERSION);
  });

  it("the checks read string payloads in memory and name a payload that is not an object", () => {
    const exp = exportOssie(data);
    const docs = { ontology: exp.ontology, model: stringForm(exp.model), mapping: stringForm(exp.mapping) };
    expect(countStrings(docs.model)).toBeGreaterThan(exp.model.datasets.length);
    expect(checkExport(docs, opts)).toEqual([]);
    const ds = docs.model.datasets[0];
    const entry = ds.nonportable_extensions![0] as { data: unknown };
    entry.data = JSON.stringify({ ...extensionData(entry), colour: "blue" });
    expect(checkExport(docs, opts)).toEqual([`Model: nonportable_extensions of dataset "${ds.name}" (GASP): \`/\` must NOT have additional properties: \`colour\``]);
    entry.data = 7;
    expect(checkExport(docs, opts)).toEqual([`Model: nonportable_extensions data of dataset "${ds.name}" (vendor GASP) is not an object`]);
    entry.data = "{not json";
    expect(checkExport(docs, opts)).toEqual([`Model: nonportable_extensions data of dataset "${ds.name}" (vendor GASP) is not an object`]);
  });
});
