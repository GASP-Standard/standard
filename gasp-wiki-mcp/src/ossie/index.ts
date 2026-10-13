/**
 * Apache Ossie (incubating) export of the GASP Standard: the ontology, the
 * reference semantic model with every canonical metric, and the mapping
 * between them. Written by `npm run derive` to
 * standard/exports/ossie/ and checked current by the tests.
 */
import { stringify } from "yaml";
import { exportOntology } from "./ontology.js";
import { exportModel } from "./model.js";
import { exportMapping } from "./mapping.js";
import { checkExport } from "./check.js";
import type { StandardData } from "../types.js";
import type { OssieExport } from "./types.js";

export function exportOssie(data: StandardData): OssieExport {
  const ontology = exportOntology(data);
  const { model, coverage } = exportModel(data);
  const mapping = exportMapping(data);
  const problems = checkExport({ ontology, model, mapping });
  if (problems.length) throw new Error(`Ossie export failed GASP's cross-reference checks:\n- ${problems.join("\n- ")}`);
  return { ontology, model, mapping, coverage };
}

const HEADER = "# Generated from the GASP Standard (https://gaspwiki.com) by `npm run derive` in gasp-wiki-mcp. Do not edit; edit /standard/ and re-run.\n";

/** YAML text for one document, with the generated-file header. */
export function ossieYaml(doc: unknown): string {
  return HEADER + stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false });
}

export { exportOntology, exportModel, exportMapping, checkExport };
