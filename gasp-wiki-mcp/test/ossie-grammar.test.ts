/**
 * The upstream expression grammar over what GASP publishes. Apache Ossie
 * carries an ANTLR 4 grammar for OSSIE_SQL_2026 expressions
 * (ossie-validator/core-spec/grammar/OssieExpression.g4, vendored unchanged
 * with its two fixture files). The validator parses expressions with sqlglot,
 * which accepts far more than the expression language states, so the grammar
 * is the stricter reading: a GASP expression it rejects is one a second
 * implementation may refuse.
 *
 * The parser is generated the way upstream's own tests generate it
 * (test/ossie-grammar.py): the ANTLR tool under Java, the Python runtime under
 * `uv`, nothing generated committed. The tests skip without `uv` or Java; the
 * test workflows install both and keep the jar between runs.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { uvAvailable } from "../src/ossie/validate.js";

const pkg = join(import.meta.dirname, "..");
const vendored = join(pkg, "ossie-validator");
const grammar = join(vendored, "core-spec", "grammar", "OssieExpression.g4");
const published = join(pkg, "..", "standard", "exports", "ossie");
/** Where the ANTLR jar is kept between runs: ignored by git and gone with a clean install. */
const cache = join(pkg, "node_modules", ".cache", "antlr");
const ANTLR_RUNTIME = "antlr4-python3-runtime==4.13.2";

/** `java -version` and not a lookup on PATH: macOS ships a `java` stub that fails when no JDK is installed. */
function javaAvailable(): boolean {
  try {
    return spawnSync("java", ["-version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}
const available = uvAvailable() && javaAvailable();

/** The syntax errors the upstream grammar reports for each expression, empty when it parses. */
function syntaxErrors(expressions: string[]): string[][] {
  const r = spawnSync("uv", ["run", "--no-project", "--with", ANTLR_RUNTIME, "python", join(pkg, "test", "ossie-grammar.py"), grammar, cache], {
    input: JSON.stringify(expressions),
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`the grammar run failed:\n${r.stderr}`);
  return JSON.parse(r.stdout) as string[][];
}

/** One expression per line; blank lines and lines starting with `#` are skipped, as upstream reads its fixtures. */
const fixtureLines = (name: string): string[] =>
  readFileSync(join(vendored, "compliance", "expressions", name), "utf-8").split("\n").filter((l) => l.trim() && !l.startsWith("#"));

/** Every portable expression in a document: a `sql` string, or an `expression` beside a portable `dialect`. The rule upstream's test applies to its examples. */
function portableExpressions(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const n of node) portableExpressions(n, out);
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o.sql === "string") out.push(o.sql);
    if ((o.dialect === "OSSIE_SQL_2026" || o.dialect === "ANSI_SQL") && typeof o.expression === "string") out.push(o.expression);
    for (const v of Object.values(o)) portableExpressions(v, out);
  }
  return out;
}

/** Every reference a mapping makes into its model: the `expression` strings, which carry no dialect. */
function mappingReferences(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const n of node) mappingReferences(n, out);
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o.expression === "string") out.push(o.expression);
    for (const v of Object.values(o)) mappingReferences(v, out);
  }
  return out;
}

const load = (file: string): unknown => parse(readFileSync(file, "utf-8"));
const files = (readdirSync(published, { recursive: true }) as string[]).filter((f) => f.endsWith(".yaml")).map((f) => join(published, f)).sort();
/** The reference model, the example and one model per conformance case. */
const models = files.filter((f) => /semantic_model\.yaml$|model\.ossie\.yaml$/.test(f));
const mappings = files.filter((f) => f.endsWith("mapping.yaml"));

interface Model { datasets: { name: string; source: string }[]; metrics: { name: string; expression: { sql: string } }[] }
const reference = load(join(published, "gasp.semantic_model.yaml")) as Model;
const coverage = JSON.parse(readFileSync(join(published, "coverage.json"), "utf-8")) as {
  counts: { direct: number };
  metrics: Record<string, { kind: string; ossieName?: string }>;
};

/** A statement, a filter without its parentheses and a GASP grammar formula: none is an OSSIE_SQL_2026 expression. */
const stagedSource = reference.datasets.find((d) => d.name.startsWith("gasp_staged_"))!.source;
const cohortSource = reference.datasets.find((d) => d.name === "gasp_account_cohorts")!.source;
const NOT_EXPRESSIONS = [
  stagedSource,
  cohortSource,
  "SUM(subscription.mrr) FILTER WHERE subscription.subscription_status = 'active'",
  "sum(field.mrr where field.subscription_status = 'active')",
];

/**
 * Runs the script's `download` against a local server that gives the listed
 * status codes in order (the last one repeats) and reports what came back.
 */
const DOWNLOAD_PROBE = `
import importlib.util, json, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

spec = importlib.util.spec_from_file_location("ossie_grammar", sys.argv[1])
script = importlib.util.module_from_spec(spec)
spec.loader.exec_module(script)
answers, seen = json.loads(sys.argv[2]), []

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        code = answers[min(len(seen), len(answers) - 1)]
        seen.append(code)
        body = b"jar" if code == 200 else b""
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass

server = HTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    body = script.download(f"http://127.0.0.1:{server.server_port}/antlr.jar", waits=(0, 0))
    print(json.dumps({"body": body.decode(), "seen": seen}))
except Exception as e:
    print(json.dumps({"error": f"{type(e).__name__}: {e}", "seen": seen}))
`;

function probeDownload(answers: number[]): { body?: string; error?: string; seen: number[] } {
  const r = spawnSync("uv", ["run", "--no-project", "python", "-c", DOWNLOAD_PROBE, join(pkg, "test", "ossie-grammar.py"), JSON.stringify(answers)], { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`the download probe failed:\n${r.stderr}`);
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
}

// Maven Central answered 429 to the test workflow's download on 2026-11-22 and the suite failed on it.
describe.skipIf(!uvAvailable())("the ANTLR jar download", () => {
  it("tries again after a 429 and a 5xx and returns the file", () => {
    expect(probeDownload([429, 503, 200])).toEqual({ body: "jar", seen: [429, 503, 200] });
  }, 60_000);

  it("raises the last answer once the waits are used up", () => {
    const r = probeDownload([429]);
    expect(r.error).toMatch(/^HTTPError: HTTP Error 429/);
    expect(r.seen).toEqual([429, 429, 429]);
  }, 60_000);

  it("raises any other refusal at once", () => {
    const r = probeDownload([404, 200]);
    expect(r.error).toMatch(/^HTTPError: HTTP Error 404/);
    expect(r.seen).toEqual([404]);
  }, 60_000);
});

describe("the upstream expression grammar", () => {
  const errors = new Map<string, string[]>();
  const rejected = (list: string[]): Record<string, string[]> =>
    Object.fromEntries([...new Set(list)].filter((e) => errors.get(e)!.length).map((e) => [e, errors.get(e)!.slice(0, 1)]));

  const valid = fixtureLines("valid.txt");
  const invalid = fixtureLines("invalid.txt");
  const byModel = new Map(models.map((f) => [relative(published, f), portableExpressions(load(f))]));
  const references = mappings.flatMap((f) => mappingReferences(load(f)));

  beforeAll(() => {
    if (!available) return;
    const all = [...new Set([...valid, ...invalid, ...[...byModel.values()].flat(), ...references, ...NOT_EXPRESSIONS])];
    const out = syntaxErrors(all);
    all.forEach((e, i) => errors.set(e, out[i]));
  }, 180_000);

  it.skipIf(!available)("reads the upstream fixtures as upstream does: every valid line parses and every invalid line is rejected", () => {
    expect(valid.length).toBeGreaterThan(50);
    expect(invalid.length).toBeGreaterThan(10);
    expect(rejected(valid)).toEqual({});
    expect(invalid.filter((e) => !errors.get(e)!.length)).toEqual([]);
  });

  it.skipIf(!available)("parses every expression in the published models: the reference model, the example and each conformance case", () => {
    expect(byModel.size).toBe(2 + readdirSync(join(published, "conformance", "cases")).length);
    for (const [file, expressions] of byModel) {
      expect(expressions.length, file).toBeGreaterThan(0);
      expect(rejected(expressions), file).toEqual({});
    }
  });

  it.skipIf(!available)("parses the expression of every direct metric in coverage.json", () => {
    const metrics = new Map(reference.metrics.map((m) => [m.name, m.expression.sql]));
    const direct = Object.values(coverage.metrics).filter((m) => m.kind === "direct");
    expect(direct).toHaveLength(coverage.counts.direct);
    for (const m of direct) {
      const sql = metrics.get(m.ossieName!);
      expect(sql, m.ossieName).toBeTypeOf("string");
      expect(errors.get(sql!), m.ossieName).toEqual([]);
    }
  });

  it.skipIf(!available)("rejects what is not an expression: a staged dataset's query, a filter without parentheses and a GASP grammar formula", () => {
    expect(stagedSource).toMatch(/^SELECT /);
    for (const e of NOT_EXPRESSIONS) expect(errors.get(e)!.length, e).toBeGreaterThan(0);
  });

  // `order` is a keyword of the grammar at this pin, so a reference into the
  // dataset of that name does not parse, though the validator reads it and the
  // specification's own example is `SUM(order.sales)`. apache/ossie #719 lists
  // ORDER among the words usable as names. When the pin moves past it this
  // test fails on the empty list: drop the exception then.
  it.skipIf(!available)("parses every reference the published mappings make, but for those into the dataset named order", () => {
    expect(references.length).toBeGreaterThan(500);
    const refused = Object.keys(rejected(references)).sort();
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.filter((e) => !e.startsWith("order."))).toEqual([]);
    expect(refused).toEqual([...new Set(references)].filter((e) => e.startsWith("order.")).sort());
  });
});
