/**
 * Runs the vendored upstream Ossie validator (ossie-validator/validation/validate.py)
 * with `uv run`. The script declares its own dependencies (PEP 723). With
 * `vendor: true` the run adds GASP's vendor validator (gasp-ossie-validator/,
 * installed from its directory with `--with`) and `--vendor GASP`, so every GASP
 * payload in the file is checked against the GASP extension schema by its site.
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GASP_VENDOR } from "./types.js";

// src/ossie and build/ossie both sit two levels below the package root.
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VALIDATOR_DIR = resolve(PACKAGE_DIR, "ossie-validator");
/** GASP's vendor validator for the upstream `--vendor` hook: a Python package, outside the npm tarball. */
export const VENDOR_VALIDATOR_DIR = resolve(PACKAGE_DIR, "gasp-ossie-validator");

export type OssieKind = "model" | "ontology" | "mapping";

const SCHEMA_ARG: Record<OssieKind, string[]> = {
  model: [],
  ontology: ["--schema", "ontology/ontology.json"],
  mapping: ["--schema", "ontology/mapping.json"],
};

export function uvAvailable(): boolean {
  try {
    return spawnSync("uv", ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

export async function validateUpstream(
  file: string | string[],
  kind: OssieKind,
  opts: { vendor?: boolean } = {}
): Promise<{ ok: boolean; output: string; skipped?: string }> {
  if (!uvAvailable()) {
    return {
      ok: true,
      output: "",
      skipped: "uv is not on PATH, so the upstream Ossie validator was not run. Install uv (https://docs.astral.sh/uv/) to enable it.",
    };
  }
  const files = (Array.isArray(file) ? file : [file]).map((f) => resolve(f));
  const vendor = opts.vendor ? { run: ["--with", VENDOR_VALIDATOR_DIR], script: ["--vendor", GASP_VENDOR] } : { run: [], script: [] };
  const args = ["run", ...vendor.run, "validation/validate.py", ...SCHEMA_ARG[kind], ...vendor.script, "--", ...files];
  return new Promise((done) => {
    let output = "";
    const child = spawn("uv", args, { cwd: VALIDATOR_DIR, shell: false });
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", (e) => done({ ok: false, output: output + String(e) }));
    child.on("close", (code) => done({ ok: code === 0, output: output.trim() }));
  });
}
