/**
 * The Ossie YAML writer (`ossieYaml`). The upstream validator loads YAML 1.1
 * (PyYAML), where an unquoted `yes`, `1_000`, `1:30` or `2024-01-01` is a
 * boolean, a number or a date, and since apache/ossie #522 a date under an
 * extension's `data` is a schema error. So every document GASP writes must
 * read the same under YAML 1.1 and YAML 1.2: the strings a 1.1 loader would
 * misread come out quoted, the committed export files parse alike under both
 * and, when `uv` is on PATH, PyYAML reads each file as the same JSON.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ossieYaml } from "../src/ossie/index.js";
import { uvAvailable } from "../src/ossie/validate.js";
import { gaspExtension } from "../src/ossie/types.js";

/** Strings a YAML 1.1 loader reads as a date, a timestamp, a boolean, a number, null or a special tag when unquoted. */
const RISKY = [
  "2024-01-01", "2024-01-01T00:00:00Z", "2001-12-14 21:59:43.10 -5",
  "yes", "No", "ON", "off", "y", "n", "true", "False", "~", "null", "",
  "1_000", "012", "0o14", "0x1F", "0b101", "1:30", "190:20:30", "1e3", "1.5", "+.5", ".inf", "-.INF", ".nan",
  "=", "<<",
];
/** Strings that stay strings under both versions and need no quotes. */
const PLAIN = ["event", "Revenue_Event", "12 month", "1,000", "2024-13", "yes please", "v1"];

const EXPORTS = join(process.cwd(), "..", "standard", "exports", "ossie");
const exported = (): string[] => {
  const cases = join(EXPORTS, "conformance", "cases");
  return [
    ...["gasp.ontology.yaml", "gasp.semantic_model.yaml", "gasp.mapping.yaml"].map((f) => join(EXPORTS, f)),
    ...["gasp_saas.ontology.yaml", "gasp_saas.semantic_model.yaml", "gasp_saas.mapping.yaml"].map((f) => join(EXPORTS, "example", f)),
    ...readdirSync(cases).map((c) => join(cases, c, "model.ossie.yaml")),
  ];
};

describe("ossieYaml", () => {
  const doc = {
    version: "0.3.0.dev0",
    name: "yes",
    datasets: [{
      name: "n",
      description: "2024-01-01",
      nonportable_extensions: [gaspExtension({ as_of: "2024-01-01", values: [...RISKY, ...PLAIN], flags: Object.fromEntries(RISKY.filter(Boolean).map((s) => [s, s])), count: 3, ratio: 0.5, on: true, none: null })],
    }],
  };
  const text = ossieYaml(doc);

  it("writes a document that reads back the same under YAML 1.1 and YAML 1.2", () => {
    expect(parse(text)).toEqual(doc);
    expect(parse(text, { version: "1.1" })).toEqual(doc);
  });

  it("quotes every string a 1.1 loader would read as something else and leaves the rest plain", () => {
    for (const s of RISKY) expect(text, s).toContain(`- "${s}"\n`);
    for (const s of PLAIN) expect(text, s).toContain(`- ${s}\n`);
    expect(text).toContain("as_of: \"2024-01-01\"");
    expect(text).toContain("count: 3");
    expect(text).toContain('"on": true'); // a real boolean stays one; its key is quoted so a 1.1 loader reads the string
  });

  it("the unquoted forms are what YAML 1.1 misreads, so the quoting is doing the work", () => {
    expect(parse("a: 2024-01-01", { version: "1.1" }).a).toBeInstanceOf(Date);
    expect(parse("a: yes", { version: "1.1" }).a).toBe(true);
    expect(parse("a: 1_000", { version: "1.1" }).a).toBe(1000);
    expect(parse("a: 1:30", { version: "1.1" }).a).toBe(90);
    expect(parse("a: 2024-01-01").a).toBe("2024-01-01");
  });

  it("every committed export file reads the same under YAML 1.1 and YAML 1.2", () => {
    const files = exported();
    expect(files.length).toBeGreaterThan(6);
    for (const f of files) {
      const t = readFileSync(f, "utf-8");
      expect(parse(t, { version: "1.1" }), f).toEqual(parse(t));
    }
  });

  it("PyYAML, the loader the upstream validator uses, reads every export file and the risky document as the same JSON (skips without uv)", () => {
    if (!uvAvailable()) return;
    const py = [
      "import json, sys, yaml",
      "docs = [yaml.safe_load(sys.stdin.read())] + [yaml.safe_load(open(p, encoding='utf-8')) for p in sys.argv[1:]]",
      "print(json.dumps(docs, allow_nan=False))", // a date or a non-finite float is not JSON and raises here
    ].join("\n");
    const files = exported();
    const r = spawnSync("uv", ["run", "--quiet", "--with", "pyyaml", "python", "-c", py, ...files], { input: text, encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 });
    expect(r.status, r.stderr).toBe(0);
    const docs = JSON.parse(r.stdout) as unknown[];
    expect(docs[0]).toEqual(doc);
    files.forEach((f, i) => expect(docs[i + 1], f).toEqual(parse(readFileSync(f, "utf-8"))));
  }, 120_000);
});
