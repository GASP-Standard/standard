#!/usr/bin/env node

/**
 * Export all parsed GASP Standard data as a single JSON file.
 * Output: gasp-wiki-mcp/build/standard-data.json + standard-version.json,
 * bundled with the npm package. The website build copies them to
 * /api/standard.json and /api/standard-version.json.
 *
 * Usage: npm run build && npm run export-data
 */

import { loadStandard } from "./loader.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const data = loadStandard();
const json = JSON.stringify(data);

const version = {
  metricCount: data.metrics.length,
  definitionCount: data.definitions.length,
  nodeCount: data.nodes.length,
  edgeCount: data.edges.length,
  dataRequirementCount: data.dataRequirements.length,
  // sha256 of the exported data; index.ts compares it with the hash of its own loaded data
  contentHash: createHash("sha256").update(json).digest("hex"),
  buildDate: new Date().toISOString().slice(0, 10),
};
const versionJson = JSON.stringify(version);

// Write to gasp-wiki-mcp/build/ → bundled with npm package as offline fallback
const buildDir = new URL(".", import.meta.url).pathname;
writeFileSync(join(buildDir, "standard-data.json"), json);
writeFileSync(join(buildDir, "standard-version.json"), versionJson);

console.log(
  `Exported ${data.metrics.length} metrics, ${data.definitions.length} definitions, ${data.nodes.length} nodes, ${data.edges.length} edges, ${data.dataRequirements.length} data requirements (${version.buildDate})`
);
console.log(`  → gasp-wiki-mcp/build/standard-data.json + standard-version.json`);
