/**
 * The readiness report (src/readiness.ts): the synthetic dataset climbs from
 * level 2 (the fixture adapter alone) through level 3 (the check rows pasted
 * back) to level 4 (the compiled model passed as the semantic model), the
 * interop spec's phase 3 exit criterion; a planted failing check holds it at
 * 2 and a company metric that differs from its canonical definition holds it
 * at 3, each named; the Acme adapter stops at 2 without results; the Acme
 * proposal is at 1 until its questions and candidates are decided; the tool
 * answers in prose and as data.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checksAsOneQuery, compileChecks, type CheckResult } from "../src/checks.js";
import { loadStandard } from "../src/loader.js";
import { formatReadinessReport, readiness, readinessFromText, type ReadinessResult } from "../src/readiness.js";
import type { Adapter } from "../src/tools.js";
import { resolveCompany, type Company } from "../src/ossie/adapt.js";
import { compileModel } from "../src/ossie/company.js";
import { recordDecisions, type Decision } from "../src/ossie/decide.js";
import { closeSyntheticEngine, DRIFT_PERIODS, syntheticEngine, type Engine } from "../src/ossie/drift.js";
import { ossieYaml } from "../src/ossie/index.js";
import { parseStatistics, profileSchema } from "../src/ossie/profile.js";
import { proposeMapping } from "../src/ossie/propose.js";
import { portable, type OssieSemanticModel } from "../src/ossie/types.js";
import { columnName, END } from "../src/synthetic.js";
import { adapter as fixtureAdapter, fixtureDb } from "./fixture-db.js";
import { acmeAdapterText, acmeDdl, parsedSchema } from "./ossie-helpers.js";

const data = loadStandard();
const acmeText = acmeAdapterText;
const FRESH = { asOf: END, window: 30 };

const company = (text: string, model?: string): Company => {
  const c = resolveCompany(text, model, data);
  if ("error" in c) throw new Error(c.error);
  return c;
};
const ready = async (c: Company, model: OssieSemanticModel | undefined, opts: Parameters<typeof readiness>[3] = {}): Promise<ReadinessResult> => {
  const r = await readiness(c, model, data, { ...FRESH, ...opts });
  if ("error" in r) throw new Error(r.error);
  return r;
};
const blockers = (r: ReadinessResult, level: number): string[] => r.levels.find((l) => l.level === level)!.blockers;

let db: PGlite;
let engine: Engine;
let results: CheckResult[];
let compiled: OssieSemanticModel;
beforeAll(async () => {
  db = await fixtureDb();
  await db.exec("CREATE SCHEMA IF NOT EXISTS gasp; CREATE TABLE gasp.period_spine (period_start DATE, period_end DATE)");
  await db.exec(`INSERT INTO gasp.period_spine VALUES ${DRIFT_PERIODS.map((p) => `('${p.start}', '${p.end}')`).join(", ")}`);
  results = (await db.query<CheckResult>(checksAsOneQuery(compileChecks(fixtureAdapter, data, "postgres", FRESH)))).rows;
  const e = await syntheticEngine(data);
  if (!e) throw new Error("PGlite is not installed");
  engine = e;
  const m = compileModel(company(JSON.stringify(fixtureAdapter)), data);
  if ("error" in m) throw new Error(m.error);
  compiled = m.model;
}, 180_000);
afterAll(async () => { await db?.close(); await closeSyntheticEngine(); });

describe("Readiness: the synthetic dataset reaches level 4", () => {
  const fixture = () => company(JSON.stringify(fixtureAdapter));

  it("is at level 2 from the adapter alone, with level 3 waiting on the check results", async () => {
    const r = await ready(fixture(), undefined);
    expect(r.level).toBe(2);
    expect(r.levels.map((l) => l.status)).toEqual(["reached", "reached", "blocked", "blocked"]);
    expect(r.profile.source).toBe("synthesised from the adapter");
    expect(r.mapping.partial).toBe(0);
    expect(r.mapping.core.uncovered).toEqual([]);
    expect(r.checks.celMapped).toBe(true);
    expect(blockers(r, 3)).toEqual([expect.stringContaining("no check results: run the")]);
    expect(blockers(r, 3)[0]).toContain("generate_checks");
    expect(r.checks.core.waiting.length).toBe(r.mapping.core.covered.length);
    expect(r.next).toContain("Level 3 (Clean core): no check results");
  });

  it("reaches level 3 with the check rows pasted back, with level 4 waiting on compile_model", async () => {
    const r = await ready(fixture(), undefined, { results });
    expect(r.level).toBe(3);
    expect(r.checks).toMatchObject({ given: true, fail: 0, notRun: 0 });
    expect(r.checks.runnable).toBeGreaterThan(20);
    expect(r.checks.core.failing).toEqual([]);
    expect(r.checks.core.waiting).toEqual([]);
    expect(new Set(r.checks.core.clean)).toEqual(new Set(r.mapping.core.covered));
    expect(blockers(r, 4)).toEqual([expect.stringContaining("the model carries no compiled GASP metrics: run compile_model (it would write")]);
    expect(r.publish.wouldCompile.direct).toBeGreaterThan(100);
    expect(r.publish.wouldCompile.unmapped).toBe(0);
  });

  it("reaches level 4 with the compiled model as the semantic model", async () => {
    const r = await ready(fixture(), compiled, { results, engine });
    expect(r.level).toBe(4);
    expect(r.levels.every((l) => l.status === "reached")).toBe(true);
    expect(r.publish.compiled).toMatchObject({ dialect: "POSTGRES" });
    expect(r.publish.compiled!.metrics).toBe(r.publish.wouldCompile.direct + r.publish.wouldCompile.staged);
    expect(r.publish.own).toBe(0);
    expect(r.next).toContain("Level 4 reached");
    const report = formatReadinessReport(r);
    expect(report).toContain("**Level:** 4 of 4 (LLM-ready)");
    expect(report).toContain("| L4 LLM-ready | reached |  |");
    expect(report).toContain("no metrics of your own in the model to score for drift");
  }, 120_000);

  it("holds at level 3 when a metric of the company's own differs from its canonical definition, naming it", async () => {
    const customer = columnName("customer", "customer_id");
    const model: OssieSemanticModel = {
      ...compiled,
      metrics: [
        ...(compiled.metrics ?? []),
        { name: "total_customers", description: "every customer ever on the books", expression: portable(`COUNT(DISTINCT customer.${customer})`) },
      ],
    };
    const r = await ready(fixture(), model, { results, engine });
    expect(r.level).toBe(3);
    expect(r.publish.own).toBe(1);
    expect(r.publish.drift).toMatchObject({ engine: "pglite", differs: 1, agrees: 0 });
    expect(blockers(r, 4)).toEqual(["1 metric of your own differs from the canonical definition: total_customers (Total Customers) (score_drift explains each; rename, pass matches, or record the difference as a decision)"]);
  }, 120_000);

  it("holds at level 2 when a check protecting a Core metric fails, naming the metrics and the check", async () => {
    const planted = results.map((row) => (row.check_id === "revenue_event_identity" ? { ...row, violations: 3 } : row));
    const r = await ready(fixture(), compiled, { results: planted, engine });
    expect(r.level).toBe(2);
    expect(r.checks.fail).toBe(1);
    expect(r.checks.core.failing.length).toBeGreaterThan(3);
    expect(r.checks.core.failing.every((f) => f.failing.includes("revenue_event_identity"))).toBe(true);
    expect(blockers(r, 3)[0]).toMatch(/^\d+ Core metrics with a failing check: ARR \(Annual Recurring Revenue\) \(revenue_event_identity\), .*\(plan_fixes ranks the fixes\)$/);
    expect(formatReadinessReport(r)).toContain("- New MRR: failing `revenue_event_identity`");
  }, 120_000);

  it("holds at level 2 when a result is missing for a check that protects a Core metric", async () => {
    const partial = results.filter((row) => row.check_id !== "expansion_tag:revenue_event");
    const r = await ready(fixture(), undefined, { results: partial });
    expect(r.level).toBe(2);
    expect(r.checks.notRun).toBe(1);
    expect(blockers(r, 3)[0]).toMatch(/^\d+ Core metrics waiting on a check without a result: /);
  });
});

describe("Readiness: Acme", () => {
  it("is at level 2 from the adapter with nothing else, and says what level 3 needs", async () => {
    const r = await ready(company(acmeText), undefined);
    expect(r.level).toBe(2);
    expect(r.format).toBe("v1");
    expect(r.mapping.fully).toBeGreaterThan(0);
    expect(r.mapping.core.uncovered.length).toBeGreaterThan(0);
    expect(r.checks.celMapped).toBe(true);
    expect(blockers(r, 3)).toEqual([expect.stringContaining("no check results")]);
    expect(r.levels[1].notes.join(" ")).toContain("without an owner");
    const report = formatReadinessReport(r);
    expect(report).toContain("# GASP readiness: Acme SaaS");
    expect(report).toContain("- Core metrics not fully covered: ");
  });

  it("is at level 1 from the proposal until its questions and candidates are decided", async () => {
    const flex = parseStatistics(JSON.stringify([{ table: "billing.mrr_movements", column: "movement_type", rows: 1200, nulls: 0, distinct: 4, values: ["new", "upgrade", "cancel", "flex"] }]));
    if ("error" in flex) throw new Error(flex.error);
    const proposal = proposeMapping(profileSchema(parsedSchema(acmeDdl), flex.stats, data, { organization: "Acme SaaS" }).model, data, { organization: "Acme SaaS" });
    const open = await ready(company(ossieYaml(proposal.mapping), ossieYaml(proposal.model)), proposal.model, { mapping: proposal.mapping });
    expect(open.level).toBe(1);
    expect(open.profile.source).toBe("profiled");
    expect(open.profile.questions.length).toBeGreaterThan(0);
    expect(open.mapping.candidates.length).toBeGreaterThan(0);
    expect(blockers(open, 2)).toEqual([expect.stringContaining("open question"), expect.stringContaining("open candidate")]);
    expect(open.next).toContain("record_decision");

    const decisions: Decision[] = [
      { about: "key", dataset: "analytics.usage_daily", answer: ["account_id", "workspace_id", "day"], owner: "Data platform" },
      { about: "type", dataset: "plan_prices", column: "price_tiers", answer: "String", owner: "Billing" },
      { about: "table", dataset: "plan_prices", to: "plan", owner: "Billing" },
      { about: "table", dataset: "usage_daily", to: "lifecycle_event", accept: false, owner: "Product analytics" },
      { about: "field", dataset: "mrr_movements", column: "movement_type", to: "event_type", transform: "CASE WHEN {{value}} = 'upgrade' THEN 'expansion' WHEN {{value}} = 'flex' THEN 'expansion' WHEN {{value}} = 'cancel' THEN 'churn' ELSE {{value}} END", owner: "Finance" },
      { about: "field", dataset: "subscriptions", column: "plan_code", to: "plan_id", accept: false, owner: "Billing" },
    ];
    const decided = recordDecisions(proposal.model, proposal.mapping, decisions, data);
    expect(decided.level2).toBe(true);
    const after = await ready(company(ossieYaml(decided.mapping), ossieYaml(decided.model)), decided.model, { mapping: decided.mapping });
    expect(after.level).toBe(2);
    expect(after.mapping.decisions).toBe(decisions.length);
    expect(blockers(after, 2)).toEqual([]);
  });
});

describe("Readiness: the tool", () => {
  it("answers in prose and as data, and names the input it lacks", async () => {
    expect(await readinessFromText(undefined, undefined, data)).toContain("Pass adapter");
    expect(await readinessFromText(acmeText, undefined, data, { asOf: "soon" })).toContain("as_of must be a date");
    expect(await readinessFromText(acmeText, undefined, data, { results: "[1]" })).toContain("Cannot read a result row");
    expect(await readinessFromText(acmeText, "hello: 1", data)).toContain("Invalid semantic model");
    expect(await readinessFromText("{\"hello\": 1}", undefined, data)).toContain("must be a GASP adapter");
    const text = await readinessFromText(JSON.stringify(fixtureAdapter), ossieYaml(compiled), data, { ...FRESH, results: JSON.stringify(results), output: "json", engine });
    const json = JSON.parse(text) as ReadinessResult;
    expect(json.level).toBe(4);
    expect(json.levels.map((l) => l.level)).toEqual([1, 2, 3, 4]);
    const report = await readinessFromText(JSON.stringify(fixtureAdapter), undefined, data, { ...FRESH, results: JSON.stringify(results) });
    expect(report).toContain("**Level:** 3 of 4 (Clean core)");
    expect(report).toContain("## Next");
  }, 120_000);
});
