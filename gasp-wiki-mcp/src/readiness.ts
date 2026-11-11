/**
 * The readiness report (docs/ossie-interop-spec.md, "One pipeline, five
 * readiness levels"), behind the `readiness_report` tool: which level a
 * company has reached and what stands between it and the next, read from the
 * documents the pipeline already produces.
 *
 *   L1 Profiled    a semantic model exists (profiled, the company's own or
 *                  synthesised from a GASP adapter)
 *   L2 Mapped      at least one metric is fully covered, no profiler question
 *                  or proposer candidate is open (the line record_decision
 *                  draws) and, with a schema snapshot, every mapped pair still
 *                  reads columns that exist
 *   L3 Clean core  the CEL revenue events are mapped, the checks have been run
 *                  and every Core metric the mapping covers passes every check
 *                  that protects it
 *   L4 LLM-ready   the canonical metrics are compiled into the model
 *                  (compile_model) and none of the company's own metrics
 *                  differs from its canonical counterpart (score_drift)
 *
 * The levels are cumulative: the level reached is the last one with every
 * lower level reached. Nothing here runs against a warehouse: the checks need
 * the rows generate_checks asked for, pasted back as results, and the drift
 * score runs on the synthetic dataset as score_drift does.
 */
import { checkReport, compileChecks, parseResults, type CheckOptions, type CheckReport, type CheckResult } from "./checks.js";
import { checkAdapter, chooseDialect, resolveAdapter, type AdapterValidation } from "./tools.js";
import { isOssieMapping, isOssieModel, parseDocument, resolveCompany, type Company } from "./ossie/adapt.js";
import { compileModel, isGaspMetric } from "./ossie/company.js";
import { openQuestions, type DecisionRecord } from "./ossie/decide.js";
import { parseMatches, scoreDrift, type DriftResult, type Engine } from "./ossie/drift.js";
import type { Question } from "./ossie/profile.js";
import type { Candidate } from "./ossie/propose.js";
import { expressionText, readGaspExtension, type OssieMapping, type OssieMetric, type OssieSemanticModel } from "./ossie/types.js";
import { formatSchemaDrift, schemaColumns, schemaDrift, type SchemaDriftResult } from "./schema-drift.js";
import type { SchemaColumn } from "./ossie/profile.js";
import type { StandardData } from "./types.js";

export type Level = 0 | 1 | 2 | 3 | 4;
export const LEVEL_NAMES: Record<Level, string> = { 0: "Unknown", 1: "Profiled", 2: "Mapped", 3: "Clean core", 4: "LLM-ready" };

export interface LevelStatus {
  level: 1 | 2 | 3 | 4;
  name: string;
  status: "reached" | "blocked";
  /** What stands in the way, each naming the tool that clears it */
  blockers: string[];
  /** What was found that does not block */
  notes: string[];
}

export interface ReadinessResult {
  organization: string;
  format: "v1" | "ossie";
  level: Level;
  levels: LevelStatus[];
  profile: { source: "profiled" | "the company's own model" | "synthesised from the adapter"; datasets: number; questions: Question[] };
  mapping: { fully: number; partial: number; none: number; unowned: number; candidates: Candidate[]; decisions: number; core: { covered: string[]; uncovered: string[] } };
  checks: {
    given: boolean;
    celMapped: boolean;
    runnable: number;
    pass: number;
    fail: number;
    notRun: number;
    /** Every covered Core metric by what its checks say */
    core: { clean: string[]; failing: Array<{ metric: string; failing: string[] }>; waiting: string[] };
  };
  publish: {
    /** The compiled GASP metrics the given model carries */
    compiled?: { metrics: number; staged: number; dialect: string };
    /** What compile_model would write for this mapping */
    wouldCompile: { direct: number; staged: number; unmapped: number };
    /** The company's own metrics in the given model */
    own: number;
    drift?: { engine: DriftResult["engine"]; agrees: number; differs: number; notRunnable: number; notCompiled: number; review: number; differing: Array<{ name: string; gasp: string }> };
  };
  /** With a schema snapshot: what the warehouse's current schema does to the mapping */
  schema?: SchemaDriftResult;
  next: string;
  problems: string[];
}

export interface ReadinessOptions extends CheckOptions {
  dialect?: string;
  /** The rows the generate_checks statement returned */
  results?: CheckResult[];
  /** Explicit company to GASP pairs for the drift score */
  matches?: Record<string, string>;
  /** The engine score_drift uses; the shared PGlite when omitted */
  engine?: Engine;
  /** The Ossie mapping document, for the candidates and decisions in its GASP extension */
  mapping?: OssieMapping;
  /** The warehouse's current columns (a schema snapshot), compared with the mapping */
  schema?: SchemaColumn[];
  /** The previous snapshot, for the columns added, dropped and retyped since */
  previousSchema?: SchemaColumn[];
}

const n = (k: number, word: string): string => `${k} ${word}${k === 1 ? "" : "s"}`;
const names = (xs: string[], limit = 6): string => xs.slice(0, limit).join(", ") + (xs.length > limit ? ` and ${xs.length - limit} more` : "");

/** The company's own metrics in a model: those an earlier compile did not write, with a readable expression. */
function ownMetrics(model: OssieSemanticModel | undefined): OssieMetric[] {
  return (model?.metrics ?? []).filter((m) => m && typeof m.name === "string" && !isGaspMetric(m) && Boolean(expressionText(m)));
}

/** The readiness of a company: its mapping, the model it gave (for the open questions, the compiled metrics and its own metrics) and the check results. */
export async function readiness(company: Company, model: OssieSemanticModel | undefined, data: StandardData, opts: ReadinessOptions = {}): Promise<ReadinessResult | { error: string }> {
  const chosen = chooseDialect(opts.dialect, company.adapter.warehouse);
  if ("error" in chosen) return { error: chosen.error };
  const problems = [...company.problems];
  const given = model ?? company.model;
  const ext = readGaspExtension<{ profiled?: unknown; compiled?: { metrics?: number; staged?: number; dialect?: string } }>(given.nonportable_extensions) ?? {};
  const mappingExt = readGaspExtension<{ proposed?: { candidates?: Candidate[] }; decisions?: DecisionRecord[] }>(opts.mapping?.nonportable_extensions) ?? {};
  const decisions: DecisionRecord[] = Array.isArray(mappingExt.decisions) ? mappingExt.decisions : [];
  const candidates: Candidate[] = Array.isArray(mappingExt.proposed?.candidates) ? mappingExt.proposed.candidates : [];
  const questions = openQuestions(given, decisions);
  const source: ReadinessResult["profile"]["source"] = company.format === "v1" ? "synthesised from the adapter" : ext.profiled ? "profiled" : "the company's own model";

  // L2: coverage and the open items.
  const coverage: AdapterValidation = checkAdapter(company.adapter, data);
  const coreAll = data.dataRequirements.filter((dr) => dr.department === "Core").map((dr) => dr.metric);
  const fullySet = new Set(coverage.fully.map((f) => f.metric));
  const coreCovered = coreAll.filter((m) => fullySet.has(m));

  // L3: the checks over the mapping, with the results when given.
  const compiledChecks = compileChecks(company.adapter, data, chosen.dialect, { window: opts.window, asOf: opts.asOf, spine: opts.spine });
  const report: CheckReport = checkReport(compiledChecks, chosen.note, opts.results, opts.spine);
  const runnable = report.checks.filter((c) => c.status !== "cannot run");
  const resolved = resolveAdapter(company.adapter, data);
  const celMapped = Boolean(resolved.tables.revenue_event) || Object.keys(resolved.columns.revenue_event ?? {}).length > 0;
  // Every covered Core metric by what its checks say. report.metrics lists the metrics a runnable check protects; a
  // covered Core metric no runnable check protects is clean once results exist. Without results every one waits.
  const coreStatus = report.metrics.filter((m) => m.department === "Core" && fullySet.has(m.metric));
  const checkedCore = new Set(coreStatus.map((m) => m.metric));
  const core = opts.results
    ? {
      clean: [...coreStatus.filter((m) => m.status === "pass").map((m) => m.metric), ...coreCovered.filter((m) => !checkedCore.has(m))],
      failing: coreStatus.filter((m) => m.status === "fail").map((m) => ({ metric: m.metric, failing: m.failing })),
      waiting: coreStatus.filter((m) => m.status === "not run").map((m) => m.metric),
    }
    : { clean: [] as string[], failing: [] as Array<{ metric: string; failing: string[] }>, waiting: [...coreCovered] };

  // L4: the compiled metrics in the given model, what compile_model would write, and the drift of the company's own metrics.
  const compiledIn = given.metrics?.filter(isGaspMetric) ?? [];
  const compiled = compiledIn.length ? { metrics: compiledIn.length, staged: given.datasets.filter((d) => d.name.startsWith("gasp_staged_")).length, dialect: ext.compiled?.dialect ?? "unknown" } : undefined;
  const would = compileModel(company, data, { dialect: chosen.dialect, spine: opts.spine });
  const wouldCompile = "error" in would ? { direct: 0, staged: 0, unmapped: 0 } : { direct: would.counts.direct, staged: would.counts.staged, unmapped: would.counts.unmapped };
  if ("error" in would) problems.push(would.error);
  const own = ownMetrics(model);
  let drift: ReadinessResult["publish"]["drift"];
  if (own.length) {
    const r = await scoreDrift(company, own, data, { matches: opts.matches, engine: opts.engine });
    if ("error" in r) problems.push(r.error);
    else drift = { engine: r.engine, ...r.counts, differing: r.scores.filter((s) => s.status === "differs").map((s) => ({ name: s.name, gasp: s.gasp })) };
  }

  // The levels.
  const levels: LevelStatus[] = [];
  const add = (level: 1 | 2 | 3 | 4, blockers: string[], notes: string[]) => levels.push({ level, name: LEVEL_NAMES[level], status: blockers.length ? "blocked" : "reached", blockers, notes });

  add(1, given.datasets.length ? [] : ["the semantic model has no datasets: profile the warehouse with profile_schema, or pass the model the mapping reads"], [`model ${source}, ${n(given.datasets.length, "dataset")}`]);

  const l2: string[] = [];
  if (!coverage.fully.length) l2.push(`no metric is fully covered: map the pairs validate_mapping ranks${coverage.nextToMap.length ? ` (first: ${coverage.nextToMap.slice(0, 3).map((p) => `\`${p.pair}\``).join(", ")})` : ""}`);
  if (questions.length) l2.push(`${n(questions.length, "open question")} from the profile: ${names(questions.map((q) => `${q.dataset} ${q.about}`), 4)} (answer with record_decision)`);
  if (candidates.length) l2.push(`${n(candidates.length, "open candidate")} from the proposal: ${names(candidates.map((c) => `${c.source}${c.column ? `.${c.column}` : ""} → ${c.dataset}${c.field ? `.${c.field}` : ""}`), 3)} (accept or reject with record_decision)`);
  const drifted = opts.schema ? schemaDrift(company.adapter, opts.schema, data, opts.previousSchema) : undefined;
  if (drifted?.broken.length) {
    const lostCore = drifted.metricsLost.filter((m) => m.department === "Core").map((m) => m.metric);
    l2.push(`the schema changed under the mapping: ${n(drifted.broken.length, "mapped pair")} read${drifted.broken.length === 1 ? "s" : ""} a table or column the warehouse no longer has (${names(drifted.broken.map((b) => `\`${b.field}@${b.dataset}\``), 4)}), so ${n(drifted.metricsLost.length, "metric")} lose${drifted.metricsLost.length === 1 ? "s" : ""} coverage${lostCore.length ? `, Core among them: ${names(lostCore, 4)}` : ""} (remap with propose_mapping and record_decision, then recompile)`);
  }
  const l2notes = [`${coverage.fully.length} fully covered, ${coverage.partial.length} partly, ${coverage.none.length} not covered of ${coverage.requirementCount} metrics with a formula; ${coreCovered.length} of ${coreAll.length} Core`];
  if (coverage.unowned.length) l2notes.push(`${n(coverage.unowned.length, "covered metric")} without an owner (record_decision about: owner)`);
  if (decisions.length) l2notes.push(`${n(decisions.length, "decision")} on file`);
  if (drifted) {
    const retyped = drifted.changes.filter((c) => c.change === "retyped" && c.readBy.length);
    if (!drifted.broken.length) l2notes.push(`schema snapshot: every mapped pair reads columns that exist${drifted.hasPrevious ? `, ${n(drifted.changes.length, "column change")} since the previous snapshot` : ""}`);
    if (retyped.length) l2notes.push(`${n(retyped.length, "mapped column")} changed type since the previous snapshot: ${names(retyped.map((c) => `${c.table}.${c.column} ${c.from} → ${c.to}`), 4)} (re-run the checks; a range check catches a scale change)`);
  }
  add(2, l2, l2notes);

  const l3: string[] = [];
  if (!celMapped) l3.push("the revenue_event dataset is not mapped: derive the CEL revenue events from your subscription or invoice ledger with derive_cel, build the table and map it");
  if (!coreCovered.length) l3.push("no Core metric is fully covered");
  if (!opts.results) l3.push(`no check results: run the ${n(runnable.length, "check")} generate_checks writes for this mapping and pass the rows back as results`);
  else {
    if (core.failing.length) l3.push(`${n(core.failing.length, "Core metric")} with a failing check: ${names(core.failing.map((f) => `${f.metric} (${f.failing.join(", ")})`), 4)} (plan_fixes ranks the fixes)`);
    if (core.waiting.length) l3.push(`${n(core.waiting.length, "Core metric")} waiting on a check without a result: ${names(core.waiting, 4)}`);
  }
  const l3notes: string[] = [];
  if (opts.results) {
    const ran = runnable.filter((c) => c.status !== "not run");
    l3notes.push(`${n(runnable.length, "runnable check")}, ${ran.filter((c) => c.status === "pass").length} pass, ${ran.filter((c) => c.status === "fail").length} fail, ${runnable.length - ran.length} without a result; ${n(core.clean.length, "Core metric")} clean`);
    const other = report.metrics.filter((m) => m.department !== "Core" && m.status === "fail");
    if (other.length) l3notes.push(`${n(other.length, "metric")} outside Core with a failing check`);
    if (report.unknownResults.length) l3notes.push(`results for unknown checks ignored: ${report.unknownResults.join(", ")}`);
  } else l3notes.push(`${n(runnable.length, "check")} runnable over this mapping, ${report.checks.length - runnable.length} need fields it lacks`);
  add(3, l3, l3notes);

  const l4: string[] = [];
  const l4notes: string[] = [];
  if (!compiled) l4.push(`the model carries no compiled GASP metrics: run compile_model (it would write ${wouldCompile.direct} direct and ${wouldCompile.staged} staged metrics for this mapping), publish the model it returns and pass it as semantic_model`);
  else {
    l4notes.push(`${n(compiled.metrics, "compiled GASP metric")} in the model (${compiled.staged} staged, ${compiled.dialect})`);
    const expected = wouldCompile.direct + wouldCompile.staged;
    if (compiled.metrics < expected) l4notes.push(`compile_model would now write ${expected}: recompile to pick up the mapping's new pairs`);
  }
  if (!own.length) l4notes.push("no metrics of your own in the model to score for drift");
  else if (!drift) l4.push("your own metrics could not be scored for drift (see the problems)");
  else if (drift.engine === "none") l4.push(`${n(own.length, "metric")} of your own could not be scored: PGlite is not installed beside the server`);
  else {
    l4notes.push(`drift: ${drift.agrees} of your metrics agree with the canonical definition, ${drift.differs} differ, ${drift.notRunnable + drift.notCompiled} not scored, ${drift.review} to review`);
    if (drift.differs) l4.push(`${n(drift.differs, "metric")} of your own differ${drift.differs === 1 ? "s" : ""} from the canonical definition: ${names(drift.differing.map((d) => `${d.name} (${d.gasp})`), 4)} (score_drift explains each; rename, pass matches, or record the difference as a decision)`);
  }
  add(4, l4, l4notes);

  let level: Level = 0;
  for (const l of levels) { if (l.status !== "reached") break; level = l.level; }
  const blocked = levels.find((l) => l.status === "blocked");
  const next = blocked
    ? `Level ${blocked.level} (${blocked.name}): ${blocked.blockers[0]}.`
    : "Level 4 reached. Keep the model published; schedule the generate_checks bundle (output: bundle) after each load, pass its check rows and schema snapshot back here with the previous snapshot. Recompile after a mapping change.";

  return {
    organization: company.adapter.organization || "unnamed",
    format: company.format,
    level,
    levels,
    profile: { source, datasets: given.datasets.length, questions },
    mapping: { fully: coverage.fully.length, partial: coverage.partial.length, none: coverage.none.length, unowned: coverage.unowned.length, candidates, decisions: decisions.length, core: { covered: coreCovered, uncovered: coreAll.filter((m) => !fullySet.has(m)) } },
    checks: { given: Boolean(opts.results), celMapped, runnable: runnable.length, pass: runnable.filter((c) => c.status === "pass").length, fail: runnable.filter((c) => c.status === "fail").length, notRun: runnable.filter((c) => c.status === "not run").length, core },
    publish: { ...(compiled ? { compiled } : {}), wouldCompile, own: own.length, ...(drift ? { drift } : {}) },
    ...(drifted ? { schema: drifted } : {}),
    next,
    problems,
  };
}

// ── the report ───────────────────────────────────────────────────────────────

export function formatReadinessReport(r: ReadinessResult): string {
  const p: string[] = [`# GASP readiness: ${r.organization}`, ""];
  p.push(`**Level:** ${r.level} of 4${r.level ? ` (${LEVEL_NAMES[r.level]})` : ""}. ${r.next}`);
  p.push(`**Mapping:** ${r.format === "v1" ? "GASP adapter, converted on load" : "Ossie mapping"}; model ${r.profile.source} (${n(r.profile.datasets, "dataset")}); ${r.mapping.fully} metrics fully covered, ${r.mapping.core.covered.length} of ${r.mapping.core.covered.length + r.mapping.core.uncovered.length} Core.`);
  for (const x of r.problems) p.push(`- Problem: ${x}`);
  p.push("", "| Level | Status | What stands in the way |", "| --- | --- | --- |");
  for (const l of r.levels) p.push(`| L${l.level} ${l.name} | ${l.status} | ${l.blockers.join("; ") || ""} |`);
  for (const l of r.levels) {
    p.push("", `## L${l.level} ${l.name}: ${l.status}`, "");
    for (const b of l.blockers) p.push(`- Blocked: ${b}`);
    for (const x of l.notes) p.push(`- ${x}`);
    if (l.level === 2 && r.mapping.core.uncovered.length) p.push(`- Core metrics not fully covered: ${names(r.mapping.core.uncovered, 8)}`);
    if (l.level === 3 && r.checks.given && r.checks.core.failing.length) for (const f of r.checks.core.failing) p.push(`- ${f.metric}: failing ${f.failing.map((c) => `\`${c}\``).join(", ")}`);
  }
  if (r.schema) p.push("", formatSchemaDrift(r.schema));
  p.push("", "## Next", "", r.next);
  return p.join("\n");
}

export interface ReadinessTextOptions {
  dialect?: string;
  window?: number;
  asOf?: string;
  spine?: string;
  results?: string;
  matches?: string;
  /** The warehouse's current columns, as profile_schema reads them */
  schema?: string;
  /** The previous snapshot, in the same shapes */
  previousSchema?: string;
  output?: "report" | "json";
  engine?: Engine;
}

/** The readiness_report tool: the mapping (either format), the model when there is one, the check results and the drift matches, as text. */
export async function readinessFromText(documentText: string | undefined, modelText: string | undefined, data: StandardData, opts: ReadinessTextOptions = {}): Promise<string> {
  if (!documentText?.trim()) return "Pass adapter: your mapping as text, a GASP adapter (JSON) or an Ossie mapping document (YAML or JSON) with its semantic_model.";
  if (opts.asOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(opts.asOf)) return `as_of must be a date as YYYY-MM-DD, got ${JSON.stringify(opts.asOf)}.`;
  const company = resolveCompany(documentText, modelText, data);
  if ("error" in company) return company.error;
  const doc = parseDocument(documentText).doc;
  const mapping = doc && isOssieMapping(doc) ? doc : undefined;
  let model: OssieSemanticModel | undefined;
  if (modelText?.trim()) {
    const m = parseDocument(modelText);
    if (!m.doc || !isOssieModel(m.doc)) return `Invalid semantic model. ${m.error ?? "It must be an Ossie semantic model document (an object with a \"datasets\" array)."}`;
    model = m.doc;
  }
  let results: CheckResult[] | undefined;
  if (opts.results !== undefined) {
    const parsed = parseResults(opts.results);
    if (parsed.error) return parsed.error;
    results = parsed.results;
  }
  let schema: SchemaColumn[] | undefined;
  let previousSchema: SchemaColumn[] | undefined;
  for (const [label, text] of [["schema", opts.schema], ["previous_schema", opts.previousSchema]] as const) {
    if (text === undefined || !text.trim()) continue;
    const cols = schemaColumns(text);
    if ("error" in cols) return `${label}: ${cols.error}`;
    if (label === "schema") schema = cols; else previousSchema = cols;
  }
  if (previousSchema && !schema) return "previous_schema needs schema: the current snapshot to compare it with.";
  const r = await readiness(company, model, data, { dialect: opts.dialect, window: opts.window, asOf: opts.asOf, spine: opts.spine, results, matches: parseMatches(opts.matches), engine: opts.engine, mapping, schema, previousSchema });
  if ("error" in r) return r.error;
  return opts.output === "json" ? JSON.stringify(r, null, 2) : formatReadinessReport(r);
}
