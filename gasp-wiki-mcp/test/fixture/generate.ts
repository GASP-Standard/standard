/**
 * The synthetic dataset lives in src/synthetic.ts so the published package can
 * build it (score_drift runs on it). This module re-exports it for the tests
 * and regenerates adapter.json:
 *
 *   npx tsx test/fixture/generate.ts --adapter
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAdapter } from "../../src/synthetic.js";

export * from "../../src/synthetic.js";

if (process.argv[1] && process.argv[1].endsWith("generate.ts") && process.argv.includes("--adapter")) {
  const here = new URL(".", import.meta.url).pathname;
  writeFileSync(join(here, "adapter.json"), JSON.stringify(buildAdapter(), null, 2) + "\n");
  console.log("wrote", join(here, "adapter.json"));
}
