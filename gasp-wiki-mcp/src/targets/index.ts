/**
 * Compile targets: a company's compiled GASP metrics written as the artefacts
 * of a semantic-layer engine, behind the compile_target tool
 * (docs/compile-targets-spike.md, option B).
 *
 * The input is compile_model's (a GASP adapter, or an Ossie mapping with its
 * semantic model). The metrics compile into the company's model exactly as
 * compile_model compiles them, in the target's dialect; common.ts restates that
 * model neutrally and each writer turns it into its engine's files:
 *
 *   snowflake   semantic_model.yaml (Cortex Analyst) and staged_views.sql
 *   cube        model/cubes/<table>.yml per table and model/views/<model>.yml
 *   dbt         models/gasp/: a model per table (a surrogate key on a composite
 *               key), the sources, the semantic models and the metrics (MetricFlow)
 *
 * Only direct and staged metrics are written; the unmapped and the not
 * computable are listed in the report as compile_model lists them.
 */
import { chooseDialect } from "../tools.js";
import { isMetricStub, metricFormulaId } from "../loader.js";
import type { StandardData } from "../types.js";
import { resolveCompany, type Company } from "../ossie/adapt.js";
import { compileModel, selectFormulas, SPINE_DATASET } from "../ossie/company.js";
import { PERIOD_SPINE } from "../ossie/model.js";
import { targetModel, type TargetModel } from "./common.js";
import { writeSnowflake } from "./snowflake.js";
import { writeCube } from "./cube.js";
import { writeDbt } from "./dbt.js";

export const TARGETS = ["snowflake", "cube", "dbt"] as const;
export type TargetName = (typeof TARGETS)[number];

const TARGET_LABEL: Record<TargetName, string> = { snowflake: "Snowflake (Cortex Analyst semantic model)", cube: "Cube (data model)", dbt: "dbt (MetricFlow semantic layer)" };

export interface TargetOptions {
  target: TargetName;
  /** SQL dialect of the metrics and staged sources: snowflake for the snowflake target; the adapter's warehouse, else postgres, for cube and dbt */
  dialect?: string;
  only?: Set<string>;
  spine?: string;
  /** Snowflake: prepended to two-part sources */
  database?: string;
  /** Snowflake: schema of the staged views */
  stagedSchema?: string;
}

export interface TargetResult {
  files: Record<string, string>;
  report: string;
  notes: string[];
  counts: { direct: number; staged: number; unmapped: number; notComputable: number; tables: number };
  model: TargetModel;
}

const TABLE_NAME = /^[A-Za-z_][\w$]*(\.[A-Za-z_][\w$]*)*$/;
const prefixTwoPart = (source: string, database: string): string => {
  const s = source.trim();
  return TABLE_NAME.test(s) && s.split(".").length === 2 ? `${database}.${s}` : source;
};

/**
 * The company with the database prepended to every two-part table source, and
 * the spine to read: the default spine in that database, a two-part one
 * prefixed, a three-part (or one-part) one as given.
 */
export function withDatabase(company: Company, database: string, spine?: string): { company: Company; spine: string } {
  const given = spine?.trim();
  const qualifiedSpine = given ? prefixTwoPart(given, database) : `${database}.${PERIOD_SPINE.toUpperCase()}`;
  const model = { ...company.model, datasets: company.model.datasets.map((d) => ({ ...d, source: prefixTwoPart(d.source, database) })) };
  return { company: { ...company, model }, spine: qualifiedSpine };
}

/** Compile the company's covered metrics and write them as the target's files. */
export function compileTarget(company: Company, data: StandardData, opts: TargetOptions): TargetResult | { error: string } {
  if (!(TARGETS as readonly string[]).includes(opts.target)) return { error: `Unknown target \`${opts.target}\`. Use one of ${TARGETS.join(", ")}.` };
  const chosen = opts.target === "snowflake" && !opts.dialect
    ? { dialect: "snowflake" as const, note: "snowflake (the target's)" }
    : chooseDialect(opts.dialect, company.adapter.warehouse);
  if ("error" in chosen) return { error: chosen.error };
  if (opts.target === "snowflake" && chosen.dialect !== "snowflake") return { error: `The snowflake target writes Snowflake SQL; dialect \`${opts.dialect}\` does not apply. Omit it.` };
  // Snowflake with a database: the staged views are created as database.schema.name, so their bodies read
  // three-part tables too, compiled that way rather than rewritten afterwards.
  const qualified = opts.target === "snowflake" && opts.database?.trim() ? withDatabase(company, opts.database.trim(), opts.spine) : { company, spine: opts.spine };
  const r = compileModel(qualified.company, data, { dialect: chosen.dialect, only: opts.only, spine: qualified.spine });
  if ("error" in r) return { error: r.error };
  const tm = targetModel(r, data);
  const written = opts.target === "snowflake"
    ? writeSnowflake(tm, { database: opts.database, stagedSchema: opts.stagedSchema })
    : opts.target === "cube" ? writeCube(tm, { database: opts.database })
    : writeDbt(tm);
  const counts = {
    direct: tm.metrics.filter((m) => !m.staged).length,
    staged: tm.metrics.filter((m) => m.staged).length,
    unmapped: r.counts.unmapped,
    notComputable: r.counts.notComputable,
    tables: tm.tables.length,
  };

  const label = new Map<string, string>();
  for (const m of data.metrics) if (!isMetricStub(m)) { const id = metricFormulaId(data, m); if (!label.has(id)) label.set(id, m.name); }
  const nameOf = (key: string): string => { const [id, v] = key.split(":"); return `${label.get(id) ?? id}${v ? ` (${v})` : ""}`; };
  const org = company.adapter.organization || company.model.name;
  const p: string[] = [`# GASP metrics for ${TARGET_LABEL[opts.target]}: ${org}`, ""];
  p.push(`**Dialect:** ${chosen.note}. Every metric expression and staged source is written in it.`);
  p.push(`**Period spine:** \`${r.spine}\`, declared as \`${SPINE_DATASET}\`; the staged tables read it.`);
  const n = counts.direct + counts.staged;
  p.push(`**Written:** ${n} metric${n === 1 ? "" : "s"} (${counts.direct} direct, ${counts.staged} staged) over ${counts.tables} table${counts.tables === 1 ? "" : "s"}, ${tm.relationships.length} join${tm.relationships.length === 1 ? "" : "s"}. Left out: ${counts.unmapped} unmapped, ${counts.notComputable} not computable.`);
  if (r.problems.length || company.problems.length) {
    p.push("**Checks:**");
    for (const x of r.problems) p.push(`- ${x}`);
    for (const x of company.problems) p.push(`- Mapping: ${x}`);
  }
  p.push("", "## Notes", ...written.notes.map((x) => `- ${x}`), "");
  const left = Object.entries(r.coverage).filter(([, v]) => v.kind === "unmapped");
  if (left.length) {
    p.push(`## Left out: unmapped (${left.length})`, "Each reads a field and dataset pair the mapping lacks; validate_mapping ranks the pairs by how many metrics they unlock.");
    const shown = left.slice(0, 40);
    for (const [key, v] of shown) if (v.kind === "unmapped") p.push(`- ${nameOf(key)}: needs \`${v.missing.join("`, `")}\``);
    if (left.length > shown.length) p.push(`- and ${left.length - shown.length} more`);
    p.push("");
  }
  const nc = Object.entries(r.coverage).filter(([, v]) => v.kind === "notComputable");
  if (nc.length) p.push(`## Left out: not computable (${nc.length})`, nc.slice(0, 20).map(([k]) => nameOf(k)).join(", ") + (nc.length > 20 ? `, and ${nc.length - 20} more` : "") + ".", "");
  return { files: written.files, report: p.join("\n").trimEnd(), notes: written.notes, counts, model: tm };
}

const fence = (path: string): string => (path.endsWith(".sql") ? "sql" : "yaml");

/** The compile_target tool: the report and the files, the files alone, or the report alone, for a mapping given as text. */
export function compileTargetFromText(
  adapterText: string,
  modelText: string | undefined,
  data: StandardData,
  opts: Omit<TargetOptions, "only"> & { metrics?: string; department?: string; output?: "full" | "files" | "report" },
): string {
  const company = resolveCompany(adapterText, modelText, data);
  if ("error" in company) return company.error;
  const sel = selectFormulas(data, opts.metrics, opts.department);
  if (sel.error) return sel.error;
  const r = compileTarget(company, data, { ...opts, only: sel.only });
  if ("error" in r) return r.error;
  const paths = Object.keys(r.files);
  if (opts.output === "files") return paths.map((path) => `### ${path}\n\n${r.files[path].trimEnd()}`).join("\n\n");
  if (opts.output === "report") return r.report;
  return [r.report, "", "## Files", ...paths.map((path) => `### ${path}\n\n\`\`\`${fence(path)}\n${r.files[path].trimEnd()}\n\`\`\``)].join("\n\n");
}
