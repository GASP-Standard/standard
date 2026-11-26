/**
 * Runs `ost`, the Apache Ossie SQL test runner vendored under
 * ossie-validator/ost (with the `apache-ossie` package it depends on beside it
 * in ossie-validator/python), with `uv run` from its lock file. The runner
 * executes each script on DuckDB and writes the regenerated script, the
 * commands with the output they produced, under the output directory. Used by
 * `npm run conformance` and the conformance tests; outside the npm tarball.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/ossie and build/ossie both sit two levels below the package root.
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OST_DIR = resolve(PACKAGE_DIR, "ossie-validator", "ost");

/** The apache/ossie commit the vendored runner was copied at, from the line in ossie-validator/README.md that names it. */
export function ostCommit(): string {
  const pin = readFileSync(resolve(PACKAGE_DIR, "ossie-validator", "README.md"), "utf-8").match(/apache\/ossie at commit `([0-9a-f]+)`/);
  if (!pin) throw new Error("ossie-validator/README.md no longer names the upstream commit as \"apache/ossie at commit `<hash>`\"");
  return pin[1];
}

/**
 * Runs the scripts (paths relative to `dir`, the directory a script may read
 * files under) and writes each regenerated script at the same relative path
 * under `outputDir`. `passed` is true when every script's output is the output
 * written in it.
 */
export function runOst(dir: string, scripts: string[], outputDir: string): Promise<{ passed: boolean; output: string }> {
  const args = ["run", "--quiet", "--frozen", "--no-dev", "--project", OST_DIR, "ost", "-v", "-d", dir, "--output-dir", outputDir, ...scripts];
  return new Promise((done) => {
    let output = "";
    const child = spawn("uv", args, { cwd: dir, shell: false });
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", (e) => done({ passed: false, output: output + String(e) }));
    child.on("close", (code) => done({ passed: code === 0, output: output.trim() }));
  });
}
