/**
 * Mapping proposals (src/ossie/propose.ts): the synthetic dataset's own
 * schema, profiled from names alone, is proposed to every GASP dataset the
 * fixture adapter maps and to every field pair but the one the names only
 * nearly say (a candidate); the Acme DDL fixture reproduces the Acme adapter
 * including its two transforms, the cents division from the name and the
 * event recode from the listed values; the proposal validates as a mapping;
 * the tool answers in prose and in each output shape.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadStandard } from "../src/loader.js";
import { checkMapping, ossieSchemaErrors } from "../src/ossie/adapt.js";
import { ossieYaml } from "../src/ossie/index.js";
import { parseStatistics, profileSchema } from "../src/ossie/profile.js";
import { formatProposalReport, proposeMapping, proposeMappingFromText, type ProposalResult } from "../src/ossie/propose.js";
import { uvAvailable, validateUpstream } from "../src/ossie/validate.js";
import { TABLES, buildAdapter } from "../src/synthetic.js";
import { fixtureDb } from "./fixture-db.js";
import { acmeAdapter, acmeDdl, informationSchema, missing, pairs as pairsOf, parsedSchema as parsed } from "./ossie-helpers.js";

const data = loadStandard();
const movementValues = JSON.stringify([{ table: "billing.mrr_movements", column: "movement_type", rows: 1200, nulls: 0, distinct: 5, values: ["new", "upgrade", "downgrade", "cancel", "reactivation"] }]);


describe("Propose: the synthetic dataset's own schema", () => {
  let db: PGlite;
  let r: ProposalResult;
  beforeAll(async () => {
    db = await fixtureDb();
    const profile = profileSchema(parsed(await informationSchema(db)), [], data, { organization: "Fixture" });
    r = proposeMapping(profile.model, data, { organization: "Fixture" });
  }, 300_000);
  afterAll(async () => { await db?.close(); });

  it("proposes every table to the GASP dataset the fixture adapter maps it to, at high confidence", () => {
    expect(r.proposed.length).toBe(Object.keys(TABLES).length);
    expect(r.proposed.filter((p) => TABLES[p.dataset] !== p.source)).toEqual([]);
    expect(r.proposed.every((p) => p.confidence === "high")).toBe(true);
    expect(r.unmatchedTables).toEqual([]);
    expect(r.candidates.filter((c) => !c.column)).toEqual([]);
  });

  it("proposes every field pair of the fixture adapter but the one the names only nearly say, which is a candidate", () => {
    const want = pairsOf(buildAdapter(), data);
    const got = pairsOf(r.adapter, data);
    expect(missing(want, got)).toEqual(["project.close_date=deal_closed_on"]); // "deal closed on" is near "close date" and no more: medium
    expect(missing(got, want)).toEqual([]);
    expect(r.candidates).toEqual([expect.objectContaining({ source: "gasp_projects", column: "deal_closed_on", dataset: "project", field: "close_date" })]);
  });

  it("reads the renamed columns through the structural rules, the aliases and the synonyms", () => {
    const f = (table: string, column: string) => r.proposed.find((p) => p.source === table)!.fields.find((x) => x.column === column)!;
    expect(f("gasp_customers", "as_of_date")).toMatchObject({ field: "snapshot_date", evidence: expect.stringContaining("the table's time field") });
    expect(f("gasp_revenue_events", "account_ref")).toMatchObject({ field: "customer_id", evidence: "`account_ref` reads as customer_id" });
    expect(f("gasp_licenses", "sub_ref")).toMatchObject({ field: "subscription_id" });
    expect(f("gasp_licenses", "assigned_seats")).toMatchObject({ field: "seats_assigned", evidence: expect.stringContaining("synonym") });
    expect(f("gasp_customers", "lifecycle_status")).toMatchObject({ field: "customer_status", evidence: expect.stringContaining("the dataset's one status field") });
    expect(f("gasp_partners", "state")).toMatchObject({ field: "partner_status" });
    expect(f("gasp_employees", "started_on")).toMatchObject({ field: "hire_date", evidence: expect.stringContaining("synonym") });
    expect(f("gasp_deal_registrations", "closed_on")).toMatchObject({ field: "close_date" });
  });

  it("gives a mapping that validates with no gaps and covers the metrics the fixture adapter covers but those reading the missed field", () => {
    expect(r.problems).toEqual([]);
    expect(r.gaps).toEqual([]);
    expect(ossieSchemaErrors(r.mapping, "mapping", data)).toEqual([]);
    const v = checkMapping({ document: r.mapping, model: r.model }, data);
    expect("error" in v).toBe(false);
    if ("error" in v) return;
    expect(v.crossProblems).toEqual([]);
    expect(v.conversionProblems).toEqual([]);
    const fixture = checkMapping({ document: buildAdapter(), model: undefined }, data);
    if ("error" in fixture) throw new Error(fixture.error);
    const lost = fixture.coverage.fully.filter((m) => !v.coverage.fully.some((x) => x.metric === m.metric)).map((m) => m.metric);
    expect(lost.length).toBeLessThanOrEqual(2);
    expect(r.coverage.fully).toBe(v.coverage.fully.length);
  });
});

describe("Propose: the Acme DDL against the Acme adapter", () => {
  const propose = (statistics?: string) => {
    const stats = parseStatistics(statistics);
    if ("error" in stats) throw new Error(stats.error);
    const profile = profileSchema(parsed(acmeDdl), stats.stats, data, { organization: "Acme SaaS" });
    return proposeMapping(profile.model, data, { organization: "Acme SaaS" });
  };

  it("proposes the four adapter tables and leaves the reference and usage tables out", () => {
    const r = propose();
    expect(r.proposed.map((p) => `${p.source} -> ${p.dataset}`)).toEqual(["billing.customers -> customer", "billing.invoices -> invoice", "billing.mrr_movements -> revenue_event", "billing.subscriptions -> subscription"]);
    expect(r.adapter.datasets).toEqual({ customer: "billing.customers", invoice: "billing.invoices", revenue_event: "billing.mrr_movements", subscription: "billing.subscriptions" });
    expect(r.candidates.map((c) => `${c.source}${c.column ? `.${c.column}` : ""} -> ${c.dataset}`)).toEqual(["billing.plan_prices -> plan"]);
    expect(r.candidates[0].settle).toContain("despite its kind");
    expect(r.unmatchedTables).toEqual([{ table: "usage_daily", source: "analytics.usage_daily", best: { dataset: "lifecycle_event", score: expect.any(Number) } }]);
  });

  it("proposes every pair of the adapter and one more, with the cents division from the name; the recode waits for the values", () => {
    const r = propose();
    const want = pairsOf(acmeAdapter(), data);
    const got = pairsOf(r.adapter, data);
    expect(missing(want, got)).toEqual(["revenue_event.event_type|CASE WHEN movement_type = 'upgrade' THEN 'expansion' WHEN movement_type = 'downgrade' THEN 'contraction' WHEN movement_type = 'cancel' THEN 'churn' ELSE movement_type END"]);
    expect(missing(got, want)).toEqual(["revenue_event.event_type=movement_type", "subscription.plan_id=plan_code"]);
    const mrr = r.proposed.find((p) => p.dataset === "subscription")!.fields.find((f) => f.field === "mrr")!;
    expect(mrr).toMatchObject({ column: "mrr_cents", transform: "{{value}} / 100", modelField: "mrr", evidence: "the name less its unit suffix" });
    const et = r.proposed.find((p) => p.dataset === "revenue_event")!.fields.find((f) => f.field === "event_type")!;
    expect(et.transform).toBeUndefined();
    expect(et.evidence).toContain("values not listed; the standard's are new, expansion, contraction, churn, reactivation, renewal");
    expect(r.elsewhere).toEqual({});
  });

  it("recodes the listed movement values into the adapter's CASE transform", () => {
    const r = propose(movementValues);
    expect(missing(pairsOf(acmeAdapter(), data), pairsOf(r.adapter, data))).toEqual([]);
    const et = r.proposed.find((p) => p.dataset === "revenue_event")!.fields.find((f) => f.field === "event_type")!;
    expect(et.transform).toBe("CASE WHEN {{value}} = 'upgrade' THEN 'expansion' WHEN {{value}} = 'downgrade' THEN 'contraction' WHEN {{value}} = 'cancel' THEN 'churn' ELSE {{value}} END");
    expect(et.evidence).toContain("values recoded: upgrade to expansion, downgrade to contraction, cancel to churn");
    const calc = r.model.datasets.find((d) => d.name === "mrr_movements")!.fields!.find((f) => f.name === "event_type")!;
    expect(calc.expression).toEqual({ sql: "CASE WHEN movement_type = 'upgrade' THEN 'expansion' WHEN movement_type = 'downgrade' THEN 'contraction' WHEN movement_type = 'cancel' THEN 'churn' ELSE movement_type END" });
    expect(calc.datatype).toBe("String");
  });

  it("holds a value it cannot recode as a candidate with the values named", () => {
    const r = propose(JSON.stringify([{ table: "billing.mrr_movements", column: "movement_type", rows: 1200, nulls: 0, distinct: 3, values: ["new", "upgrade", "flex"] }]));
    expect(r.proposed.find((p) => p.dataset === "revenue_event")!.fields.some((f) => f.field === "event_type")).toBe(false);
    const c = r.candidates.find((x) => x.column === "movement_type")!;
    expect(c).toMatchObject({ dataset: "revenue_event", field: "event_type", settle: expect.stringContaining("CASE transform") });
    expect(c.evidence).toContain("values flex are not among the standard's");
  });

  it("validates as a mapping over the model and covers the metrics the adapter covers", async () => {
    const r = propose(movementValues);
    expect(r.problems).toEqual([]);
    expect(r.gaps).toEqual([]);
    const v = checkMapping({ document: r.mapping, model: r.model }, data);
    if ("error" in v) throw new Error(v.error);
    expect(v.ossieSchemaErrors).toEqual([]);
    expect(v.crossProblems).toEqual([]);
    expect(v.conversionProblems).toEqual([]);
    const acme = checkMapping({ document: acmeAdapter(), model: undefined }, data);
    if ("error" in acme) throw new Error(acme.error);
    expect(v.coverage.fully.map((m) => m.metric).sort()).toEqual(acme.coverage.fully.map((m) => m.metric).sort());
    if (!uvAvailable()) return;
    const dir = mkdtempSync(join(tmpdir(), "gasp-propose-"));
    try {
      const model = join(dir, "acme_saas.semantic_model.yaml");
      writeFileSync(model, ossieYaml(r.model));
      const mapping = join(dir, "acme_saas.mapping.yaml");
      writeFileSync(mapping, ossieYaml(r.mapping));
      for (const [file, kind] of [[model, "model"], [mapping, "mapping"]] as const) {
        const u = await validateUpstream(file, kind);
        expect(u.ok, u.output).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("writes the report with the evidence per pair, the candidates and what settles them", () => {
    const r = propose(movementValues);
    const report = formatProposalReport(r);
    expect(report).toContain("# Mapping proposal: Acme SaaS");
    expect(report).toContain("**Proposed:** 4 of 6 tables to GASP datasets and 47 of 57 columns to GASP fields (2 with a transform); 1 candidate to review; 2 columns of the proposed tables unmatched.");
    expect(report).toContain("### billing.subscriptions (subscriptions) → subscription (high confidence: 16 of 17 columns name GASP fields of subscription, kind snapshot matches, its key is the dataset's key subscription_id, its time field is the dataset's snapshot_date, the name matches)");
    expect(report).toContain("- mrr_cents → mrr (the name less its unit suffix); transform `{{value}} / 100`");
    expect(report).toContain("- movement_type → event_type (a synonym of event_type; values recoded: upgrade to expansion, downgrade to contraction, cancel to churn); transform `CASE WHEN");
    expect(report).toContain("- unmatched: updated_at");
    expect(report).toContain("## Candidates (1)");
    expect(report).toContain("- billing.plan_prices → plan (medium confidence:");
    expect(report).toContain("## Tables without a GASP dataset (1)");
    expect(report).toContain("- analytics.usage_daily (nearest: lifecycle_event, too few of its columns match)");
    expect(report).toContain("record their answers with record_decision");
  });
});

describe("Propose: a bare status column", () => {
  it("maps it to the field named for the dataset when several fields end in status, and to the one such field otherwise", () => {
    const ddl = `CREATE TABLE partners (partner_id VARCHAR, snapshot_date DATE, partner_tier VARCHAR, status VARCHAR, training_completed BOOLEAN, partner_recruited_date DATE);
CREATE TABLE customers (customer_id VARCHAR, snapshot_date DATE, status VARCHAR, segment VARCHAR, acquisition_date DATE);`;
    const r = proposeMapping(profileSchema(parsed(ddl), [], data).model, data);
    const field = (table: string) => r.proposed.find((p) => p.source === table)!.fields.find((f) => f.column === "status");
    expect(field("partners")).toMatchObject({ field: "partner_status", evidence: expect.stringContaining("the dataset's own status field") }); // certification_status comes first in the ontology
    expect(field("customers")).toMatchObject({ field: "customer_status", evidence: expect.stringContaining("the dataset's own status field") });
  });
});

describe("Propose: the tool", () => {
  it("takes the profiled model or the schema, and answers in each output shape", () => {
    expect(proposeMappingFromText(undefined, undefined, undefined, data)).toContain("Pass semantic_model");
    expect(proposeMappingFromText("{nope", undefined, undefined, data)).toContain("Invalid semantic model");
    expect(proposeMappingFromText("{\"name\": \"x\"}", undefined, undefined, data)).toContain("must be an Ossie semantic model");
    expect(proposeMappingFromText(undefined, "hello world", undefined, data)).toContain("not in a shape the profiler reads");
    const fromSchema = proposeMappingFromText(undefined, acmeDdl, movementValues, data, { organization: "Acme SaaS" });
    expect(fromSchema).toContain("# Mapping proposal: Acme SaaS");
    expect(fromSchema).toContain("## Mapping\n\nThe proposed pairs as an Ossie mapping over the model below (it gained a calculated field per transform)");
    expect(fromSchema).toContain("## Semantic model");
    const stats = parseStatistics(movementValues);
    if ("error" in stats) throw new Error(stats.error);
    const profile = profileSchema(parsed(acmeDdl), stats.stats, data, { organization: "Acme SaaS" });
    const fromModel = proposeMappingFromText(ossieYaml(profile.model), undefined, undefined, data);
    expect(fromModel.split("\n## Mapping")[0]).toBe(fromSchema.split("\n## Mapping")[0]); // the model carries the profile and the values, so the organization and the proposal are the same
    const mapping = proposeMappingFromText(ossieYaml(profile.model), undefined, undefined, data, { output: "mapping" });
    expect(mapping.startsWith("# ") || mapping.startsWith("version:")).toBe(true);
    expect(mapping).toContain("name: gasp_mapping_acme_saas");
    const adapter = JSON.parse(proposeMappingFromText(ossieYaml(profile.model), undefined, undefined, data, { output: "adapter" })) as Adapter;
    expect(adapter.datasets).toEqual({ customer: "billing.customers", invoice: "billing.invoices", revenue_event: "billing.mrr_movements", subscription: "billing.subscriptions" });
    const json = JSON.parse(proposeMappingFromText(ossieYaml(profile.model), undefined, undefined, data, { output: "json" })) as { proposed: unknown[]; candidates: unknown[]; mapping: { concept_mappings: unknown[] } };
    expect(json.proposed.length).toBe(4);
    expect(json.candidates.length).toBe(1);
    expect(json.mapping.concept_mappings.length).toBe(4);
    expect(proposeMappingFromText(ossieYaml(profile.model), undefined, undefined, data, { output: "model" })).toContain("name: event_type");
  });
});
