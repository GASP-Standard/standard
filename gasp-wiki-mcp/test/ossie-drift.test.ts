/**
 * Drift scoring (src/ossie/drift.ts): the fixture adapter's own compiled
 * metrics, scored as a company's, agree with the canonical ones in every
 * period; the Acme metrics are matched by name, synonym and explicit pair, the
 * planted differences come back with their causes, the unmatched one goes to
 * review and the one reading an unmapped field is reported as not runnable;
 * the report and the JSON output carry it all; both input formats score alike.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadStandard } from "../src/loader.js";
import type { Adapter } from "../src/tools.js";
import { adapterToOssie, resolveCompany, type Company } from "../src/ossie/adapt.js";
import { compileModel } from "../src/ossie/company.js";
import { companyMetrics, DRIFT_PERIODS, formatDriftReport, matchMetrics, parseMatches, scoreDrift, scoreDriftFromText, syntheticEngine, type DriftResult, type Engine } from "../src/ossie/drift.js";
import { ossieYaml } from "../src/ossie/index.js";
import { GASP_VENDOR, type OssieMetric } from "../src/ossie/types.js";
import { adapter as fixtureAdapter } from "./fixture-db.js";

const data = loadStandard();
const fixtureDir = join(process.cwd(), "test", "fixture");
const acmeText = readFileSync(join(fixtureDir, "acme-adapter.json"), "utf-8");
const acme = JSON.parse(acmeText) as Adapter;
const acmeMetricsText = readFileSync(join(fixtureDir, "acme-metrics.yaml"), "utf-8");
const acmeMetrics = companyMetrics(acmeMetricsText).metrics!;

const company = (a: Adapter): Company => {
  const c = resolveCompany(JSON.stringify(a), undefined, data);
  if ("error" in c) throw new Error(c.error);
  return c;
};
const scored = async (c: Company, metrics: OssieMetric[], opts: Parameters<typeof scoreDrift>[3] = {}): Promise<DriftResult> => {
  const r = await scoreDrift(c, metrics, data, opts);
  if ("error" in r) throw new Error(r.error);
  return r;
};

let engine: Engine;
beforeAll(async () => {
  const e = await syntheticEngine(data);
  if (!e) throw new Error("PGlite is not installed");
  engine = e;
}, 120_000);
afterAll(async () => { await (engine as unknown as { close?: () => Promise<void> }).close?.(); });

describe("Drift: matching", () => {
  it("matches by exact name, by ai_context synonyms and by explicit pairs, and reviews the rest without scoring", () => {
    const { matched, review, errors } = matchMetrics(acmeMetrics, data, parseMatches("acme_nrr=NRR"));
    expect(errors).toEqual([]);
    const how = Object.fromEntries(matched.map((m) => [m.metric.name, `${m.how}:${m.key}`]));
    expect(how).toEqual({ new_mrr: "name:new_mrr", acme_mrr: "synonym:mrr", customer_count: "synonym:total_customers", lost_mrr: "synonym:churned_mrr", acme_nrr: "matches:nrr", arr_from_contracts: "synonym:arr" });
    expect(review.map((r) => r.name)).toEqual(["logo_churn"]);
    expect(review[0].suggestions[0].name).toContain("Logo Churn Rate");
  });

  it("takes a form or variant on the GASP side of a pair, and refuses one the metric lacks", () => {
    expect(matchMetrics(acmeMetrics, data, parseMatches("acme_nrr=NRR:O")).matched.find((m) => m.metric.name === "acme_nrr")!.key).toBe("nrr:O");
    expect(matchMetrics(acmeMetrics, data, parseMatches("acme_nrr=NRR:quarterly")).errors.join("\n")).toContain("has no form or variant `quarterly`");
    expect(matchMetrics(acmeMetrics, data, parseMatches("acme_nrr=Nope")).errors.join("\n")).toContain("not a metric name");
  });

  it("reads metrics from a model document and refuses one without them", () => {
    expect(companyMetrics(undefined).error).toContain("Pass semantic_model");
    expect(companyMetrics("version: 1\nname: x\n").error).toContain("no metrics list");
    expect(companyMetrics("metrics:\n  - name: a\n").error).toContain("metrics[0]");
    expect(companyMetrics(acmeMetricsText).metrics!.length).toBe(7);
  });
});

describe("Drift: the fixture adapter's own compiled metrics agree with the canonical ones", () => {
  it("scores every direct main-formula metric as agreeing in January and June, over the fixture's own column names", async () => {
    const c = company(fixtureAdapter as Adapter);
    const compiled = compileModel(c, data);
    if ("error" in compiled) throw new Error(compiled.error);
    // The compiled gasp_ metrics as if they were the company's own: named by formula id, without the GASP extension.
    const mine: OssieMetric[] = compiled.model.metrics!
      .filter((m) => { const key = Object.entries(compiled.coverage).find(([, v]) => "ossieName" in v && v.ossieName === m.name)?.[0]; return key && !key.includes(":") && compiled.coverage[key].kind === "direct"; })
      .map((m) => ({ name: m.name.replace(/^gasp_/, ""), expression: m.expression, custom_extensions: m.custom_extensions?.filter((e) => e.vendor_name !== GASP_VENDOR) }));
    expect(mine.length).toBeGreaterThan(100);
    const r = await scored(c, mine, { engine, periods: [DRIFT_PERIODS[0], DRIFT_PERIODS[5]] });
    expect(r.review).toEqual([]);
    expect(r.counts.matched).toBe(mine.length);
    // `user` is a reserved word in Postgres, so a metric qualifying columns by that dataset name cannot run (the company test has the same limit).
    const reserved = r.scores.filter((s) => /\buser\./.test(s.yours));
    expect(reserved.every((s) => s.status === "not runnable")).toBe(true);
    const rest = r.scores.filter((s) => !/\buser\./.test(s.yours));
    expect(rest.filter((s) => s.status !== "agrees").map((s) => `${s.name}: ${s.status} ${s.error ?? s.causes.join("; ")}`)).toEqual([]);
    expect(rest.every((s) => s.periods.length === 2)).toBe(true);
  }, 300_000);
});

describe("Drift: the Acme metrics", () => {
  let r: DriftResult;
  beforeAll(async () => { r = await scored(company(acme), acmeMetrics, { engine, matches: parseMatches("acme_nrr=NRR") }); }, 120_000);
  const score = (name: string) => r.scores.find((s) => s.name === name)!;

  it("counts the matches, the agreements, the differences, the one that cannot run and the one to review", () => {
    expect(r.engine).toBe("pglite");
    expect(r.counts).toEqual({ metrics: 7, matched: 6, agrees: 2, differs: 3, notRunnable: 1, notCompiled: 0, review: 1 });
    expect(r.problems).toEqual([]);
  });

  it("agrees where the company's expression is the canonical one", () => {
    expect(score("new_mrr")).toMatchObject({ status: "agrees", how: "name", gasp: "New MRR", differing: 0 });
    expect(score("acme_mrr")).toMatchObject({ status: "agrees", how: "synonym", canonicalKind: "direct" });
    expect(score("acme_mrr").periods.map((p) => p.canonical)).toEqual(score("acme_mrr").periods.map((p) => p.yours));
    expect(score("acme_mrr").periods[5].yours).toBe(24200);
  });

  it("names a filter the canonical metric applies and the company's does not", () => {
    const s = score("customer_count");
    expect(s).toMatchObject({ status: "differs", gasp: "Total Customers", differing: 6, canonicalKind: "direct" });
    expect(s.periods[5]).toMatchObject({ yours: 21, canonical: 18 });
    expect(s.worst!.relative).toBeGreaterThan(0.2); // April: 19 against 15
    expect(s.causes[0]).toBe("canonical keeps customer_status in ('active'); yours applies no filter on it");
  });

  it("names a filter whose values differ, and the canonical nulls where no event of a type falls in the period", () => {
    const s = score("lost_mrr");
    expect(s.status).toBe("differs");
    expect(s.worst).toMatchObject({ yours: 900, canonical: 600 });
    expect(s.causes).toContain("canonical keeps event_type in ('churn'); yours keeps revenue_event.event_type in ('churn', 'contraction')");
    expect(s.causes.find((c) => c.startsWith("canonical is null in"))).toContain("a sum over no matching rows is NULL in the compiled SQL");
    expect(s.causes.find((c) => c.startsWith("canonical aggregate"))).toContain("has no equal among yours");
  });

  it("names the cohort behind a staged canonical metric the company wrote as one expression", () => {
    const s = score("acme_nrr");
    expect(s).toMatchObject({ status: "differs", how: "matches", canonicalKind: "staged", stagedReason: "cohort" });
    expect(s.causes.some((c) => c.includes("cohort metric"))).toBe(true);
    expect(s.canonical).toContain("FROM gasp.period_spine p");
  });

  it("reports a metric reading an unmapped field as not runnable, naming the field", () => {
    const s = score("arr_from_contracts");
    expect(s.status).toBe("not runnable");
    expect(s.error).toContain("`subscription.contract_value`");
    expect(s.periods).toEqual([]);
  });

  it("writes the report with every section", () => {
    const report = formatDriftReport(r);
    for (const h of ["# GASP drift: Acme SaaS", "**Matched:** 6 of 7 metrics (1 by name, 4 by synonym, 1 by your matches); 1 to review.", "**Drift:** 3 differ, 2 agree, 1 could not run.", "## Differs (3)", "### customer_count → Total Customers", "| Jun 2026 | 21 | 18 ≠ |", "Canonical: staged (cohort)", "## Agrees (2)", "## Not scored (1)", "## Review (1)", "logo_churn: closest Logo Churn Rate"]) expect(report).toContain(h);
  });

  it("scores a named subset, and says when none of the names is in the document", async () => {
    const sub = await scored(company(acme), acmeMetrics, { engine, only: new Set(["new_mrr", "customer_count"]) });
    expect(sub.counts).toMatchObject({ metrics: 2, matched: 2, agrees: 1, differs: 1 });
    const none = await scoreDrift(company(acme), acmeMetrics, data, { engine, only: new Set(["nope"]) });
    expect("error" in none && none.error).toContain("None of the named metrics");
  });

  it("scores the same from the Ossie mapping with the metrics in its model", async () => {
    const form = adapterToOssie(acme, data);
    const model = { ...form.model, metrics: acmeMetrics };
    const text = await scoreDriftFromText(ossieYaml(form.mapping), ossieYaml(model), data, { matches: "acme_nrr=NRR", output: "json", engine });
    const json = JSON.parse(text) as { format: string; counts: DriftResult["counts"]; matched: Array<{ metric: string; how: string }>; scores: Array<{ name: string; status: string }> };
    expect(json.format).toBe("ossie");
    expect(json.counts).toEqual(r.counts);
    expect(json.matched.find((m) => m.metric === "acme_nrr")!.how).toBe("matches");
    expect(json.scores.map((s) => `${s.name}:${s.status}`).sort()).toEqual(r.scores.map((s) => `${s.name}:${s.status}`).sort());
  }, 120_000);

  it("skips the gasp_ metrics an earlier compile wrote, and refuses a document with none of its own", async () => {
    const compiled = compileModel(company(acme), data, { only: new Set(["mrr"]) });
    if ("error" in compiled) throw new Error(compiled.error);
    const none = await scoreDrift(company(acme), compiled.model.metrics!, data, { engine });
    expect("error" in none && none.error).toContain("no metrics of your own");
  });

  it("answers the tool's error cases in prose", async () => {
    expect(await scoreDriftFromText(acmeText, undefined, data, { engine })).toContain("Pass semantic_model");
    expect(await scoreDriftFromText(acmeText, acmeMetricsText, data, { engine, matches: "acme_nrr=Nope" })).toContain("not a metric name");
    expect(await scoreDriftFromText("{\"hello\": 1}", acmeMetricsText, data, { engine })).toContain("must be a GASP adapter");
  });

  it("says so when no engine is available", () => {
    const report = formatDriftReport({ ...r, engine: "none", scores: [], counts: { ...r.counts, agrees: 0, differs: 0, notRunnable: 0, notCompiled: 0 } });
    expect(report).toContain("PGlite is not installed");
    expect(report).not.toContain("## Differs");
  });
});
