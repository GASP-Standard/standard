/**
 * Naming rules shared by the Ossie exporters, so the ontology, the semantic
 * model and the mapping agree on every identifier.
 *
 *   dataset id        snapshot/event/fact table   semantic model dataset name: the id as is (`revenue_event`)
 *                                                 ontology concept: PascalCase of the label-free id (`RevenueEvent`)
 *   field id          canonical field             semantic model field name: the id as is
 *                                                 ontology relationship name on the dataset concept: the id as is
 *                                                 ontology value type: PascalCase (`MrrChange`), except date and
 *                                                 timestamp fields, which play the built-in Date / DateTime
 *   metric formula id                             Ossie metric: `gasp_` + id, plus `_o` / `_m` for a form or
 *                                                 `_<variant>` for a variant
 *   physical source   reference model only        `gasp.<dataset id>`; a customer's mapping replaces it
 */
import type { OssieDataType } from "./types.js";
import type { OntologyField } from "../types.js";

export const pascal = (id: string): string => id.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");

export const conceptName = (datasetId: string): string => pascal(datasetId);

/** Built-in Ossie concept a GASP field type extends, or plays directly for dates. */
export const builtInFor = (type: OntologyField["type"]): string =>
  ({ string: "String", enum: "String", decimal: "Decimal", integer: "Integer", boolean: "Boolean", date: "Date", timestamp: "DateTime" } as Record<string, string>)[type] ?? "String";

/** Date and timestamp fields play the built-in concept rather than getting a value type of their own. */
export const isBuiltInRole = (type: OntologyField["type"]): boolean => type === "date" || type === "timestamp";

export const valueTypeName = (field: Pick<OntologyField, "id" | "type">): string => (isBuiltInRole(field.type) ? builtInFor(field.type) : pascal(field.id));

export const ossieDataType = (type: OntologyField["type"]): OssieDataType =>
  ({ string: "String", enum: "String", decimal: "Decimal", integer: "Integer", boolean: "Boolean", date: "Date", timestamp: "DateTime" } as Record<string, OssieDataType>)[type] ?? "String";

export const physicalSource = (datasetId: string): string => `gasp.${datasetId}`;

export const metricName = (formulaId: string, suffix?: string): string => `gasp_${formulaId}${suffix ? `_${suffix.toLowerCase()}` : ""}`;

/** Enum constraint in the ontology expression style the upstream flights example uses. */
export const enumRequires = (concept: string, values: string[]): string => values.map((v) => `${concept} == '${v.replace(/'/g, "''")}'`).join(" OR ");
