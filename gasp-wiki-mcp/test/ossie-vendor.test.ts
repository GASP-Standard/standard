/**
 * GASP's vendor validator for the upstream `--vendor` hook (apache/ossie #697):
 * the Python package in gasp-ossie-validator/ carries a current copy of the
 * extension schema and registers `GASP` under `ossie.vendor_validators`; run
 * through the vendored validator with `--vendor GASP`, every Ossie file GASP
 * publishes passes and planted bad payloads are reported at the sites and
 * with the findings `checkExport` reports for the same documents. The
 * validator runs need `uv` on PATH.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { DERIVED_FILES, EXTENSION_SCHEMA_SOURCE } from "../src/derive.js";
import { loadStandard } from "../src/loader.js";
import { checkExport } from "../src/ossie/check.js";
import { exportOssie, ossieYaml } from "../src/ossie/index.js";
import { GASP_VENDOR, gaspExtension, type OssieExtension, type OssieMapping, type OssieSemanticModel } from "../src/ossie/types.js";
import { VENDOR_VALIDATOR_DIR, uvAvailable, validateUpstream } from "../src/ossie/validate.js";

const data = loadStandard();
const extOf = (x: { nonportable_extensions?: OssieExtension[] }) => x.nonportable_extensions!.find((e) => e.vendor_name === GASP_VENDOR)!.data;
const vendorLines = (output: string) => output.split("\n").map((l) => l.trim()).filter((l) => l.includes(`[Vendor ${GASP_VENDOR}]`));

/** The reference export with a bad GASP payload at every kind of site, and another vendor's payload that is nobody's to check. */
function planted() {
  const exp = exportOssie(data);
  const model: OssieSemanticModel = structuredClone(exp.model);
  const ds = model.datasets[0];
  ds.nonportable_extensions = [gaspExtension({ ...extOf(ds), colour: "blue" })];
  const field = ds.fields![0];
  field.nonportable_extensions = [gaspExtension({ note: "GASP writes nothing here" })];
  const other = model.datasets[1];
  other.nonportable_extensions = [...(other.nonportable_extensions ?? []), { vendor_name: "Acme", data: { anything: [1, 2], goes: true } }];
  const metric = model.metrics![0];
  metric.nonportable_extensions = [gaspExtension({ ...extOf(metric), gasp_version: 1 })];
  const rel = model.relationships![0];
  rel.nonportable_extensions = [gaspExtension({ note: "nor here" })];
  const mapping: OssieMapping = { ...exp.mapping, nonportable_extensions: [gaspExtension({ organization: 7 })] };
  const inModel = ` in model '${model.name}'`;
  const sites = {
    dataset: [`dataset "${ds.name}"`, `Dataset '${ds.name}'${inModel}`],
    field: [`field "${ds.name}.${field.name}"`, `Field '${ds.name}.${field.name}'${inModel}`],
    metric: [`metric "${metric.name}"`, `Metric '${metric.name}'${inModel}`],
    relationship: [`relationship "${rel.name}"`, `Relationship '${rel.name}'${inModel}`],
    mapping: ["mapping", `Mapping '${mapping.name}'`],
  };
  return { exp, model, mapping, other, sites };
}

describe("GASP's Ossie vendor validator", () => {
  it("ships a current copy of the extension schema and registers GASP under the upstream entry point group", () => {
    expect(readFileSync(DERIVED_FILES.vendorSchema, "utf-8")).toBe(readFileSync(EXTENSION_SCHEMA_SOURCE, "utf-8"));
    const pyproject = readFileSync(join(VENDOR_VALIDATOR_DIR, "pyproject.toml"), "utf-8");
    expect(pyproject).toContain(`[project.entry-points."ossie.vendor_validators"]\n${GASP_VENDOR} = "gasp_ossie_validator:check"`);
    // the vendored validator is at a commit that has the hook
    const script = readFileSync(join(VENDOR_VALIDATOR_DIR, "..", "ossie-validator", "validation", "validate.py"), "utf-8");
    expect(script).toContain('VENDOR_VALIDATOR_GROUP = "ossie.vendor_validators"');
  });

  it("checkExport reports a GASP payload on a field or a relationship, where the schema defines none", () => {
    const { exp, model, mapping, other, sites } = planted();
    const problems = checkExport({ ontology: exp.ontology, model, mapping }, { extensionSchema: data.extensionSchema });
    for (const kind of ["field", "relationship"] as const) {
      expect(problems).toContain(`Model: nonportable_extensions of ${sites[kind][0]} (GASP): GASP defines no extension on a ${kind}; its payloads sit on the semantic model, a dataset, a metric or the mapping`);
    }
    expect(problems.filter((p) => p.includes(`"${other.name}"`))).toEqual([]);
    expect(problems).toHaveLength(5);
    // without the schema only the object check runs, as before
    expect(checkExport({ ontology: exp.ontology, model, mapping })).toEqual([]);
  });

  it.skipIf(!uvAvailable())("writes one line per finding, a pointer into the payload and what is wrong there", () => {
    const payloads = [
      ["dataset", { staged: true, reason: "nope", x: 1 }],
      ["model", { profiled: { input: "ddl", statistics: "yes" } }],
      ["mapping", { decisions: [{ about: "key" }], organization: "Acme" }],
      ["metric", {}],
      ["relationship", {}],
    ];
    const script = [
      "import json, sys",
      "from types import SimpleNamespace",
      "from gasp_ossie_validator import check",
      "print(json.dumps([check(p, SimpleNamespace(kind=k, name='x', dataset=None)) for k, p in json.loads(sys.argv[1])]))",
    ].join("\n");
    const r = spawnSync("uv", ["run", "--no-project", "--with", VENDOR_VALIDATOR_DIR, "python", "-c", script, JSON.stringify(payloads)], { encoding: "utf-8" });
    expect(r.status, r.stderr).toBe(0);
    const [dataset, model, mapping, metric, relationship] = JSON.parse(r.stdout) as string[][];
    expect(dataset).toEqual([
      "`/` must have properties for, source_dialect when property staged is present",
      "`/` must NOT have additional properties: `x`",
      expect.stringMatching(/^`\/reason` must be equal to one of the allowed values: "cohort", /),
    ]);
    expect(model).toEqual(["`/profiled` must have required property 'questions'", "`/profiled/statistics` must be boolean"]);
    expect(mapping).toEqual(["owner", "date", "effect"].map((k) => `\`/decisions/0\` must have required property '${k}'`));
    expect(metric).toEqual(["gasp_id", "gasp_version", "unit", "formula"].map((k) => `\`/\` must have required property '${k}'`));
    expect(relationship).toEqual(["GASP defines no extension on a relationship; its payloads sit on the semantic model, a dataset, a metric or the mapping"]);
  }, 120_000);

  it.skipIf(!uvAvailable())("passes every Ossie file GASP publishes", async () => {
    const cases = join(DERIVED_FILES.ossieModel, "..", "conformance", "cases");
    const caseModels = readdirSync(cases).map((c) => join(cases, c, "model.ossie.yaml")).filter((f) => existsSync(f));
    expect(caseModels.length).toBeGreaterThan(5);
    const models = await validateUpstream([DERIVED_FILES.ossieModel, DERIVED_FILES.exampleModel, ...caseModels], "model", { vendor: true });
    expect(models.ok, models.output).toBe(true);
    expect(vendorLines(models.output)).toEqual([]);
    const mappings = await validateUpstream([DERIVED_FILES.ossieMapping, DERIVED_FILES.exampleMapping], "mapping", { vendor: true });
    expect(mappings.ok, mappings.output).toBe(true);
    expect(vendorLines(mappings.output)).toEqual([]);
  }, 180_000);

  it.skipIf(!uvAvailable())("names planted bad payloads at the sites and with the findings checkExport reports", async () => {
    const { exp, model, mapping, other, sites } = planted();
    const problems = checkExport({ ontology: exp.ontology, model, mapping }, { extensionSchema: data.extensionSchema });
    const dir = mkdtempSync(join(tmpdir(), "gasp-vendor-"));
    try {
      const file = (source: string) => join(dir, basename(source));
      writeFileSync(file(DERIVED_FILES.ossieOntology), ossieYaml(exp.ontology));
      writeFileSync(file(DERIVED_FILES.ossieModel), ossieYaml(model));
      writeFileSync(file(DERIVED_FILES.ossieMapping), ossieYaml(mapping));

      // without --vendor the payloads are the vendor's own business and both files pass
      const plain = await validateUpstream(file(DERIVED_FILES.ossieModel), "model");
      expect(plain.ok, plain.output).toBe(true);

      const m = await validateUpstream(file(DERIVED_FILES.ossieModel), "model", { vendor: true });
      const p = await validateUpstream(file(DERIVED_FILES.ossieMapping), "mapping", { vendor: true });
      expect(m.ok).toBe(false);
      expect(p.ok).toBe(false);
      const lines = [...vendorLines(m.output), ...vendorLines(p.output)];

      // every checkExport finding, at its site, with its text
      for (const [who, label] of Object.values(sites)) {
        const mine = problems.filter((x) => x.includes(`nonportable_extensions of ${who} (GASP): `));
        expect(mine.length, who).toBeGreaterThan(0);
        for (const x of mine) {
          const finding = x.slice(x.indexOf("(GASP): ") + "(GASP): ".length);
          expect(lines.some((l) => l.includes(`[Vendor GASP] ${label}: ${finding}`)), `${label}: ${finding}\n${lines.join("\n")}`).toBe(true);
        }
      }
      expect(lines).toHaveLength(problems.length);
      expect(lines).toContainEqual(expect.stringContaining(`[Vendor GASP] ${sites.dataset[1]}: \`/\` must NOT have additional properties: \`colour\``));
      expect(lines).toContainEqual(expect.stringContaining(`[Vendor GASP] ${sites.mapping[1]}: \`/organization\` must be string`));
      expect(lines.filter((l) => l.includes(`'${other.name}'`))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
