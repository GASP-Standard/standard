/**
 * The vendor worked examples (test/fixture/stripe, test/fixture/salesforce),
 * written from public API documentation and never standard content
 * (DECISIONS.md 2026-11-03). Stripe, on Redshift: the mapping validates,
 * derive_cel over the sample ledger gives the events stated beside it, the
 * classification step fills the ATL tag, the billing credits ledger gives the
 * consumption, balance and breakage metrics, the checks pass, the readiness
 * report climbs from level 2 to 4 and the drift report names the planted
 * difference, the interop spec's "drift report on a public vendor example".
 * Salesforce, on BigQuery: the mapping validates, Win Rate and Pipeline Value
 * compile in BigQuery, the checks compile, the DDL profiles, and the readiness
 * report stops at level 2 naming the revenue events a CRM cannot supply.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deriveCelFromText, revenueEventDerivation } from "../src/cel.js";
import { checkReport, checksAsOneQuery, compileChecks, generateChecksFromText, type CheckResult } from "../src/checks.js";
import { DIALECT } from "../src/dialect.js";
import { loadStandard } from "../src/loader.js";
import { readiness, type ReadinessResult } from "../src/readiness.js";
import { breakdownTemplate, checkAdapter, fillTemplate, type Adapter } from "../src/tools.js";
import { bind } from "./fixture-db.js";
import { resolveCompany, validateMapping, type Company } from "../src/ossie/adapt.js";
import { compileModel } from "../src/ossie/company.js";
import { closeSyntheticEngine, companyMetrics, formatDriftReport, scoreDrift, syntheticEngine, type Engine } from "../src/ossie/drift.js";
import { parseSchema, profileSchema } from "../src/ossie/profile.js";
import { proposeMapping } from "../src/ossie/propose.js";
import type { OssieSemanticModel } from "../src/ossie/types.js";

const data = loadStandard();
const fixture = (vendor: string, file: string) => readFileSync(join(process.cwd(), "test", "fixture", vendor, file), "utf-8");
const company = (text: string): Company => {
  const c = resolveCompany(text, undefined, data);
  if ("error" in c) throw new Error(c.error);
  return c;
};
const blockers = (r: ReadinessResult, level: number): string[] => r.levels.find((l) => l.level === level)!.blockers;
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
const core = (names: string[]) => names.filter((m) => data.dataRequirements.find((d) => d.metric === m)?.department === "Core");

describe("Stripe on Redshift: a subscription ledger to readiness level 4", () => {
  const text = fixture("stripe", "adapter.json");
  const adapter = JSON.parse(text) as Adapter;
  const expected = JSON.parse(fixture("stripe", "events.json")) as Array<Record<string, unknown>>;
  // The last event is on 2026-03-25 and five customers do not move every day, so the event freshness window is a week.
  const FRESH = { asOf: "2026-03-31", window: 7, spine: "gasp.period_spine" };
  let db: PGlite;
  let engine: Engine;
  let before: CheckResult[];
  let after: CheckResult[];

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    db = new PGlite();
    await db.exec(fixture("stripe", "data.sql"));
    const e = await syntheticEngine(data);
    if (!e) throw new Error("PGlite is not installed");
    engine = e;
  }, 120_000);
  afterAll(async () => { await db?.close(); await closeSyntheticEngine(); });

  it("validates as a mapping and covers the Core revenue metrics from six datasets", () => {
    const r = checkAdapter(adapter, data);
    expect(r.schemaErrors).toEqual([]);
    expect(r.problems).toEqual([]);
    expect(r.conflicts).toEqual([]);
    expect(r.tableCount).toBe(6);
    expect(r.fully.length).toBe(31); // 24 from the revenue datasets and the seven credit ledger metrics
    const fully = r.fully.map((f) => f.metric);
    expect(core(fully).length).toBe(18);
    for (const m of ["MRR (Monthly Recurring Revenue)", "Net Revenue Retention (NRR)", "Net New MRR", "Logo Churn Rate (Customer Churn)"]) expect(fully).toContain(m);
    for (const m of ["Consumption Revenue", "Usage Run-Rate", "Prepaid Credit Balance", "ARR Including Usage Run-Rate", "Credit Breakage", "Consumption Revenue Growth Rate", "Consumption Net Revenue Retention"]) expect(fully).toContain(m);
    // The enum columns without a transform already hold GASP values: the derived events and the status the nightly job writes.
    expect(r.enumNoTransform.map((e) => e.field)).toEqual(["change_nature", "customer_status", "event_type", "expansion_classification", "lifecycle_attribution"]);
    const report = validateMapping(text, undefined, data);
    expect(report).toContain("Stripe example");
    expect(report).not.toContain("Invalid document");
  });

  it("derives the revenue events stated in events.json from the item snapshots and the usage records, with the ledger starting with the business", async () => {
    const template = revenueEventDerivation({ dialect: "postgres", currency: "USD", firstSnapshot: "steps", usage: true });
    const filled = fillTemplate(template, adapter, data);
    expect(filled.missingFields).toEqual([]);
    expect(filled.missingTables).toEqual([]);
    expect(filled.sql).toContain("unit_amount * quantity / 100.0"); // the MRR transform inlined
    expect(filled.sql).toContain("(usage_amount / 100.0) - (committed_amount / 100.0)"); // the cents transforms on the usage records
    const rows = (await db.query<Record<string, unknown>>(filled.sql)).rows;
    const seen = rows.map((r) => ({ event_id: r.event_id, event_date: day(r.event_date), customer_id: r.customer_id, subscription_id: r.subscription_id, event_type: r.event_type, mrr_change: Number(r.mrr_change), prior_mrr: Number(r.prior_mrr), new_mrr: Number(r.new_mrr), lifecycle_attribution: r.lifecycle_attribution, expansion_classification: r.expansion_classification, segment: r.segment, change_nature: r.change_nature }));
    // The ledger's events arrive untagged; the usage pairs arrive tagged usage_realisation.
    expect(seen).toEqual(expected.map((e) => ({ ...e, expansion_classification: e.change_nature === "permanent" ? null : e.expansion_classification })));
    expect(rows.every((r) => r.currency === "USD")).toBe(true);
    // The metered item carries no MRR of its own (no unit_amount), so it adds no ledger step; its usage adds the four tagged events.
    expect(seen.filter((e) => e.subscription_id === "si_B3").map((e) => e.change_nature)).toEqual(["temporary", "scheduled_reversal", "temporary", "scheduled_reversal"]);
    expect(seen.filter((e) => e.change_nature === "permanent").reduce((s, e) => s + e.mrr_change, 0)).toBe(1349);
    await db.exec(`INSERT INTO gasp.revenue_events ${filled.sql}`);
  });

  it("the derive_cel tool compiles it in the postgres dialect Redshift reads, with every field mapped and the usage records read unasked", () => {
    const report = deriveCelFromText(text, undefined, data, { currency: "usd", firstSnapshot: "steps" });
    expect(report).toContain("**Dialect:** postgres (from the adapter's warehouse `redshift`)");
    expect(report).toContain("the `subscription` dataset, 6 / 6 fields mapped; the `usage_record` dataset, 6 / 6 fields mapped (read because the mapping covers it");
    expect(report).not.toContain("Unmapped fields");
  });

  it("derives from the invoices too, at subscription grain, and shows what an invoice ledger cannot say", async () => {
    const sql = deriveCelFromText(text, undefined, data, { currency: "USD", source: "invoice", usage: false, firstSnapshot: "steps", output: "sql" });
    expect(sql).toContain("(licensed_amount / 100.0)");
    expect(sql).not.toContain("subscription_items");
    const rows = (await db.query<Record<string, unknown>>(sql)).rows.map((r) => [day(r.event_date), r.subscription_id, r.event_type, Number(r.mrr_change), Number(r.new_mrr)].join(" "));
    expect(rows).toEqual([
      "2026-01-01 sub_A new 100 100",
      "2026-01-01 sub_B new 400 400", // 4,800 for the year over twelve months
      "2026-01-15 sub_C new 98 98",
      "2026-02-01 sub_E new 60 60",
      "2026-02-03 sub_D new 800 800",
      "2026-03-01 sub_A expansion 100 200", // the seats added on 02-10 show on the March invoice together with the price rise
      "2026-03-05 sub_B expansion 100 500",
      "2026-03-15 sub_C churn -98 0", // the last paid period ends on 03-14; the item ledger churned it on 02-20
      "2026-03-25 sub_C2 reactivation 49 49",
    ]);
    // Not here: cus_D's seat reduction on 03-15 (nothing is invoiced until the annual renewal) and cus_E's churn (its March invoice stands, unpaid,
    // and the horizon is 03-25, so 04-01 is not read). The usage-only invoices of cus_B have no licensed line and add nothing.
    const report = deriveCelFromText(text, undefined, data, { currency: "USD", source: "invoice" });
    expect(report).toContain("the `invoice` dataset, 7 / 7 fields mapped");
    expect(report).toContain("Where a subscription ledger exists it is the better source");
  });

  it("reads Stripe's billing credits ledger: consumption, balance and breakage from typed transactions with no running balance", async () => {
    const run = async (id: string, start: string, end: string) => {
      const filled = fillTemplate(data.queryTemplates[id], adapter, data);
      expect([...filled.missingFields, ...filled.missingTables], id).toEqual([]);
      const sql = bind(filled.sql, start, end);
      const v = Object.values((await db.query<Record<string, unknown>>(sql)).rows[0])[0];
      return v === null ? null : Number(v);
    };
    // cus_B's $100 paid grant on 02-01, $60 applied to the February usage invoice on 03-01, $40 expired on 03-31;
    // cus_A's $20 promotional grant is an adjustment, voided unused, so it nets to nothing.
    expect(await run("consumption_revenue", "2026-02-01", "2026-02-28")).toBe(0);
    expect(await run("consumption_revenue", "2026-03-01", "2026-03-31")).toBe(60);
    expect(await run("prepaid_credit_balance", "2026-01-01", "2026-01-31")).toBe(20);
    expect(await run("prepaid_credit_balance", "2026-02-01", "2026-02-28")).toBe(100);
    expect(await run("prepaid_credit_balance", "2026-03-01", "2026-03-31")).toBe(0);
    expect(await run("credit_breakage", "2026-03-01", "2026-03-31")).toBe(40);
    // Stripe carries no running balance, so the identity check names the two balances it needs instead of passing vacuously.
    const identity = compileChecks(adapter, data, "postgres", FRESH).find((c) => c.check.id === "credit_balance_identity")!;
    expect(identity.sql).toBeFalsy();
  });

  it("fails only the expansion tag check before classify.sql and passes every check after it", async () => {
    const compiled = compileChecks(adapter, data, "postgres", FRESH);
    expect(compiled.length).toBe(36);
    expect(compiled.filter((c) => c.sql).length).toBe(18); // the rest need datasets the mapping lacks (costs, contracts, amendments), mrr_start or the credit balances Stripe does not carry
    before = (await db.query<CheckResult>(checksAsOneQuery(compiled))).rows;
    const failing = (rows: CheckResult[]) => rows.filter((r) => Number(r.violations) > 0).map((r) => `${r.check_id}:${r.violations}`);
    expect(failing(before)).toEqual(["expansion_tag:revenue_event:5"]);
    const report = checkReport(compiled, "postgres", before, FRESH.spine);
    expect(report.metrics.filter((m) => m.status === "fail").map((m) => m.metric)).toContain("Net Revenue Retention (NRR)");

    await db.exec(fixture("stripe", "classify.sql"));
    const tags = (await db.query<{ event_id: string; expansion_classification: string | null }>("SELECT event_id, expansion_classification FROM gasp.revenue_events ORDER BY event_date, event_id")).rows;
    expect(Object.fromEntries(tags.map((t) => [t.event_id, t.expansion_classification]))).toEqual(Object.fromEntries(expected.map((e) => [e.event_id, e.expansion_classification])));
    after = (await db.query<CheckResult>(checksAsOneQuery(compiled))).rows;
    expect(failing(after)).toEqual([]);
    expect(generateChecksFromText(text, undefined, data, { ...FRESH, results: JSON.stringify(after) })).toContain("18 runnable over this mapping, 18 need fields the mapping lacks; 18 pass, 0 fail.");
  });

  it("climbs from readiness level 2 to 4: the adapter, the check rows, the classification, the compiled model", async () => {
    const c = company(text);
    const alone = await readiness(c, undefined, data, FRESH);
    if ("error" in alone) throw new Error(alone.error);
    expect(alone.level).toBe(2);
    expect(alone.checks.celMapped).toBe(true);
    expect(blockers(alone, 3)).toEqual([expect.stringContaining("no check results")]);

    const tagged = await readiness(c, undefined, data, { ...FRESH, results: before });
    if ("error" in tagged) throw new Error(tagged.error);
    expect(tagged.level).toBe(2);
    expect(blockers(tagged, 3)[0]).toMatch(/^\d+ Core metrics with a failing check: .*\(expansion_tag:revenue_event\)/);

    const clean = await readiness(c, undefined, data, { ...FRESH, results: after });
    if ("error" in clean) throw new Error(clean.error);
    expect(clean.level).toBe(3);
    expect(clean.checks).toMatchObject({ given: true, fail: 0, notRun: 0, runnable: 18 });
    expect(new Set(clean.checks.core.clean)).toEqual(new Set(clean.mapping.core.covered));
    expect(blockers(clean, 4)[0]).toContain("run compile_model");

    const model = compileModel(c, data, { spine: FRESH.spine });
    if ("error" in model) throw new Error(model.error);
    expect(model.dialect).toBe("postgres");
    const ready = await readiness(c, model.model, data, { ...FRESH, results: after, engine });
    if ("error" in ready) throw new Error(ready.error);
    expect(ready.level).toBe(4);
    expect(ready.publish.compiled?.metrics).toBe(ready.publish.wouldCompile.direct + ready.publish.wouldCompile.staged);
    expect(ready.next).toContain("Level 4 reached");
  }, 180_000);

  it("scores the company's own metrics for drift: two agree, Net New MRR without reactivation differs, one goes to review", async () => {
    const own = companyMetrics(fixture("stripe", "metrics.yaml")).metrics!;
    const r = await scoreDrift(company(text), own, data, { engine });
    if ("error" in r) throw new Error(r.error);
    expect(r.counts).toMatchObject({ metrics: 4, matched: 3, agrees: 2, differs: 1, notRunnable: 0, review: 1 });
    expect(r.scores.find((s) => s.name === "mrr")).toMatchObject({ how: "name", status: "agrees" });
    expect(r.scores.find((s) => s.name === "churned_mrr")).toMatchObject({ how: "name", status: "agrees" });
    const nn = r.scores.find((s) => s.name === "net_new_mrr")!;
    expect(nn).toMatchObject({ how: "name", status: "differs", gasp: "Net New MRR" });
    expect(nn.causes.join("\n")).toContain("reactivation");
    expect(r.review.map((m) => m.name)).toEqual(["paying_customers"]);
    const report = formatDriftReport(r);
    expect(report).toContain("# GASP drift: Stripe example");
    expect(report).toContain("### net_new_mrr → Net New MRR");
  }, 120_000);
});

describe("Salesforce on BigQuery: a CRM mapping that stops at readiness level 2", () => {
  const text = fixture("salesforce", "adapter.json");
  const adapter = JSON.parse(text) as Adapter;
  const ddl = fixture("salesforce", "schema.sql");

  it("validates as a mapping and covers the pipeline and funnel metrics", () => {
    const r = checkAdapter(adapter, data);
    expect(r.schemaErrors).toEqual([]);
    expect(r.problems).toEqual([]);
    expect(r.conflicts).toEqual([]);
    expect(r.tableCount).toBe(4);
    expect(r.fully.length).toBe(19);
    const fully = r.fully.map((f) => f.metric);
    for (const m of ["Win Rate", "Pipeline Value", "Average Deal Size", "Lead-to-Opportunity Rate", "Sales Cycle Length"]) expect(fully).toContain(m);
    expect(r.enumNoTransform).toEqual([]);
    expect(validateMapping(text, undefined, data)).toContain("Salesforce example");
  });

  it("compiles Win Rate and Pipeline Value in BigQuery with every field mapped and no Postgres-only construct", () => {
    for (const id of ["win_rate", "pipeline_value", "average_deal_size"]) {
      const t = breakdownTemplate(data, id, undefined, "bigquery");
      if ("error" in t) throw new Error(t.error);
      const r = fillTemplate(t.template, adapter, data);
      expect(r.missingFields).toEqual([]);
      expect(r.missingTables).toEqual([]);
      for (const token of DIALECT.bigquery.forbidden) expect(r.sql).not.toContain(token);
      expect(r.sql).toContain("FROM salesforce_snapshots.opportunity");
    }
    const win = fillTemplate(breakdownTemplate(data, "win_rate", undefined, "bigquery").template!, adapter, data).sql;
    expect(win).toContain("AS FLOAT64");
    expect(win).toContain("WHEN 'Closed Won' THEN 'closed_won'");
  });

  it("compiles the checks in BigQuery; none reads a revenue event", () => {
    const compiled = compileChecks(adapter, data, "bigquery", { asOf: "2026-03-31" });
    const runnable = compiled.filter((c) => c.sql);
    expect(runnable.length).toBeGreaterThan(0);
    expect(runnable.every((c) => !c.check.datasets.includes("revenue_event"))).toBe(true);
    expect(compiled.filter((c) => !c.sql).map((c) => c.check.id)).toContain("revenue_event_identity");
    const fresh = compiled.find((c) => c.check.id === "freshness:opportunity")!;
    expect(fresh.sql).toContain("DATE_DIFF(DATE '2026-03-31'");
    for (const c of runnable) for (const token of DIALECT.bigquery.forbidden) expect(c.sql).not.toContain(token);
    expect(generateChecksFromText(text, undefined, data, { asOf: "2026-03-31" })).toContain("bigquery (from the adapter's warehouse `bigquery`)");
  });

  it("profiles the DDL to nine tables and lists the opportunity and lead snapshots as candidates for the Decide step", () => {
    const parsed = parseSchema(ddl);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.problems).toEqual([]);
    const profile = profileSchema(parsed, [], data, { organization: "Salesforce example" });
    expect(profile.model.datasets.length).toBe(9);
    expect(profile.problems).toEqual([]);
    const proposal = proposeMapping(profile.model, data, { organization: "Salesforce example" });
    // Snake-cased Salesforce columns share few names with the GASP fields (stage_name, is_won, amount), so the tables come back at medium confidence, for a person to accept.
    const candidates = proposal.candidates.filter((c) => !c.column).map((c) => `${c.source} -> ${c.dataset}`);
    expect(candidates).toContain("salesforce_snapshots.opportunity -> opportunity");
    expect(candidates).toContain("salesforce_snapshots.lead -> lead");
    expect(candidates).toContain("salesforce.contract -> contract_event");
  });

  it("is at readiness level 2, and the first thing level 3 needs is the revenue events a CRM cannot supply", async () => {
    const r = await readiness(company(text), undefined, data, { asOf: "2026-03-31" });
    if ("error" in r) throw new Error(r.error);
    expect(r.level).toBe(2);
    expect(r.checks.celMapped).toBe(false);
    expect(blockers(r, 3)[0]).toContain("the revenue_event dataset is not mapped");
    expect(r.mapping.core.covered).toEqual(["Total Customers"]);
    expect(r.next).toContain("derive_cel");
  });
});
