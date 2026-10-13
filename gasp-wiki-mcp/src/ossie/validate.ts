/**
 * Runs the vendored upstream Ossie validator (ossie-validator/validation/validate.py)
 * with `uv run`. The script declares its own dependencies (PEP 723).
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/ossie and build/ossie both sit two levels below the package root.
const VALIDATOR_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "ossie-validator");

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
  file: string,
  kind: "model" | "ontology" | "mapping"
): Promise<{ ok: boolean; output: string; skipped?: string }> {
  if (!uvAvailable()) {
    return {
      ok: true,
      output: "",
      skipped: "uv is not on PATH, so the upstream Ossie validator was not run. Install uv (https://docs.astral.sh/uv/) to enable it.",
    };
  }
  const args = ["run", "validation/validate.py", ...SCHEMA_ARG[kind], "--", resolve(file)];
  return new Promise((done) => {
    let output = "";
    const child = spawn("uv", args, { cwd: VALIDATOR_DIR, shell: false });
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", (e) => done({ ok: false, output: output + String(e) }));
    child.on("close", (code) => done({ ok: code === 0, output: output.trim() }));
  });
}
