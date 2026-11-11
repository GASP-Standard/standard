/**
 * Apache Ossie (incubating) export of the GASP Standard: the ontology, the
 * reference semantic model with every canonical metric, and the mapping
 * between them. Written by `npm run derive` to
 * standard/exports/ossie/ and checked current by the tests.
 */
import { Document, visit } from "yaml";
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
  const problems = checkExport({ ontology, model, mapping }, { extensionSchema: data.extensionSchema });
  if (problems.length) throw new Error(`Ossie export failed GASP's cross-reference checks:\n- ${problems.join("\n- ")}`);
  return { ontology, model, mapping, coverage };
}

const HEADER = "# Generated from the GASP Standard (https://koinedata.com) by `npm run derive` in gasp-wiki-mcp. Do not edit; edit /standard/ and re-run.\n";

/**
 * YAML text for one document, with the generated-file header. The upstream
 * validator loads YAML 1.1 (PyYAML), where an unquoted `yes`, `1_000`, `1:30`
 * or `2024-01-01` is a boolean, a number or a date, and a date under an
 * extension's `data` is a schema error since apache/ossie #522. So every
 * string a 1.1 loader would read as something else is quoted (`compat`), as
 * is a lone `=`, the 1.1 value tag PyYAML's safe loader cannot construct. The
 * text reads the same under 1.1 and 1.2.
 */
export function ossieYaml(doc: unknown): string {
  const yaml = new Document(doc, { aliasDuplicateObjects: false, compat: "yaml-1.1" });
  visit(yaml, { Scalar(_key, node) { if (node.value === "=") node.type = "QUOTE_DOUBLE"; } });
  return HEADER + yaml.toString({ lineWidth: 0 });
}

export { exportOntology, exportModel, exportMapping, checkExport };
