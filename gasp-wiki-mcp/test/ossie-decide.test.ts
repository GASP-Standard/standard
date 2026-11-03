/**
 * The Decide step (src/ossie/decide.ts): on the Acme proposal the open
 * questions, candidates and unowned metrics are listed from the documents
 * alone; the planted questions answered land in the model, an accepted table
 * and an accepted column with a transform land in the mapping, a rejected
 * pair and the judgement calls are recorded, owners land where
 * validate_mapping reads them, a bad decision is refused with the rest kept,
 * a repeat is idempotent and a later decision on a subject replaces the
 * earlier one; the result validates and passes the upstream validator; on the
 * fixture's own schema the five questions and the one candidate decided reach
 * level 2 with every field pair of the fixture adapter; the tool answers in
 * prose and in each output shape.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadStandard } from "../src/loader.js";
import { checkMapping } from "../src/ossie/adapt.js";
import { formatDecisionReport, openQuestions, recordDecisionFromText, recordDecisions, subjectOf, type DecideResult, type Decision } from "../src/ossie/decide.js";
import { ossieYaml } from "../src/ossie/index.js";
import { parseStatistics, profileSchema } from "../src/ossie/profile.js";
import { proposeMapping, type ProposalResult } from "../src/ossie/propose.js";
import { uvAvailable, validateUpstream } from "../src/ossie/validate.js";
import { COLUMNS, buildAdapter } from "../src/synthetic.js";
import { fixtureDb } from "./fixture-db.js";
import { acmeDdl, informationSchema, missing, pairs as pairsOf, parsedSchema as parsed } from "./ossie-helpers.js";

const data = loadStandard();
/** A value the recode table does not know, so the movement column stays a candidate for the Decide step. */
const flexValues = JSON.stringify([{ table: "billing.mrr_movements", column: "movement_type", rows: 1200, nulls: 0, distinct: 4, values: ["new", "upgrade", "cancel", "flex"] }]);
const recode = "CASE WHEN {{value}} = 'upgrade' THEN 'expansion' WHEN {{value}} = 'flex' THEN 'expansion' WHEN {{value}} = 'cancel' THEN 'churn' ELSE {{value}} END";

const ext = (doc: { custom_extensions?: Array<{ vendor_name: string; data: string }> }) => JSON.parse(doc.custom_extensions!.find((e) => e.vendor_name === "GASP")!.data) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("Decide: the Acme proposal", () => {
  let proposal: ProposalResult;
  beforeAll(() => {
    const stats = parseStatistics(flexValues);
    if ("error" in stats) throw new Error(stats.error);
    proposal = proposeMapping(profileSchema(parsed(acmeDdl), stats.stats, data, { organization: "Acme SaaS" }).model, data, { organization: "Acme SaaS" });
  });
  const decisions: Decision[] = [
    { about: "key", dataset: "analytics.usage_daily", answer: ["account_id", "workspace_id", "day"], owner: "Data platform", note: "one row per workspace per day" },
    { about: "type", dataset: "plan_prices", column: "price_tiers", answer: "String", owner: "Billing" },
    { about: "table", dataset: "plan_prices", to: "plan", owner: "Billing", note: "the price list is the plan catalogue" },
    { about: "table", dataset: "usage_daily", to: "lifecycle_event", accept: false, owner: "Product analytics" },
    { about: "field", dataset: "mrr_movements", column: "movement_type", to: "event_type", transform: recode, owner: "Finance", note: "flex is an expansion" },
    { about: "field", dataset: "subscriptions", column: "plan_code", to: "plan_id", accept: false, owner: "Billing", note: "plan_code is the SKU, not the plan" },
    { about: "owner", metric: "nrr", owner: "Finance", contact: "fpa@acme.example" },
    { about: "owner", metric: "All Core metrics", owner: "Finance" },
    { about: "topic", topic: "reporting currency", answer: "USD", owner: "Finance", note: "EUR invoices convert at the month-end rate" },
    { about: "topic", topic: "churn date", answer: "the subscription end date, not the cancellation request", owner: "Finance", date: "2026-10-30" },
  ];
  const decide = (list: Decision[] = decisions, from: { model: DecideResult["model"]; mapping: DecideResult["mapping"] } = proposal) => recordDecisions(from.model, from.mapping, list, data);

  it("lists what is open from the documents alone", () => {
    const r = decide([]);
    expect(r.decisions).toEqual([]);
    expect(r.open.questions.map((q) => `${q.dataset}:${q.about}`)).toEqual(["plan_prices:type", "usage_daily:key"]);
    expect(r.open.candidates.map((c) => `${c.source}${c.column ? `.${c.column}` : ""} -> ${c.dataset}${c.field ? `.${c.field}` : ""}`)).toEqual(["billing.plan_prices -> plan", "billing.mrr_movements.movement_type -> revenue_event.event_type"]);
    expect(r.open.unowned.length).toBeGreaterThan(10);
    expect(r.level2).toBe(false);
    expect(r.mapping.concept_mappings).toBe(proposal.mapping.concept_mappings); // the pairs as given; the extension gains the empty decisions list
    expect(ext(r.mapping).decisions).toEqual([]);
    const report = formatDecisionReport(r, 0);
    expect(report).toContain("**On file:** 0 decisions.");
    expect(report).toContain("**Readiness:** level 2 (mapped) is blocked by 2 open questions and 2 open candidates.");
    expect(report).toContain("1. **plan_prices** (type): What do the columns price_tiers (VARIANT)");
    expect(report).toContain("- billing.plan_prices → plan (");
    expect(report).toContain("## Covered metrics without an owner (");
  });

  it("applies the answers to the model and the accepted pairs to the mapping, and records the rest", () => {
    const r = decide();
    expect(r.problems).toEqual([]);
    expect(r.applied.map((d) => `${subjectOf(d)}: ${d.effect}`)).toEqual([
      "key:usage_daily: key set to account_id, workspace_id, day",
      "type:plan_prices.price_tiers: datatype set to String",
      "table:plan_prices>plan: plan read from plan_prices: 1 column mapped",
      "field:mrr_movements.movement_type>event_type: revenue_event.event_type read from movement_type through event_type",
      "field:subscriptions.plan_code>plan_id: plan_id no longer read from plan_code",
      "owner:net revenue retention (nrr): owned by Finance",
      "owner:all core metrics: owned by Finance",
    ]);
    expect(r.recorded.map((d) => `${subjectOf(d)}: ${d.effect}`)).toEqual([
      "table:usage_daily>lifecycle_event: usage_daily is not lifecycle_event",
      "topic:reporting currency: recorded: USD",
      "topic:churn date: recorded: the subscription end date, not the cancellation request",
    ]);
    // The model: the key, the type and the calculated field.
    expect(r.modelChanged).toBe(true);
    const usage = r.model.datasets.find((d) => d.name === "usage_daily")!;
    expect(usage.primary_key).toEqual(["account_id", "workspace_id", "day"]);
    expect(ext(usage).profile.confidence.key).toBe("declared");
    expect(ext(usage).profile.evidence.key).toBe("decided by Data platform: one row per workspace per day");
    expect(r.model.datasets.find((d) => d.name === "plan_prices")!.fields!.find((f) => f.name === "price_tiers")!.datatype).toBe("String");
    const calc = r.model.datasets.find((d) => d.name === "mrr_movements")!.fields!.find((f) => f.name === "event_type")!;
    expect(calc.expression).toEqual({ sql: recode.replace(/\{\{value\}\}/g, "movement_type") });
    expect(proposal.model.datasets.find((d) => d.name === "usage_daily")!.primary_key).toBeUndefined(); // the input is left alone
    // The mapping: the accepted pairs in, the rejected one out, the owners where validate_mapping reads them.
    expect(r.adapter.datasets).toMatchObject({ plan: "billing.plan_prices", revenue_event: "billing.mrr_movements" });
    const got = pairsOf(r.adapter, data);
    expect(got.has("plan.plan_id=plan_code")).toBe(true);
    expect(got.has(`revenue_event.event_type|${recode.replace(/\{\{value\}\}/g, "movement_type")}`)).toBe(true);
    expect(got.has("subscription.plan_id=plan_code")).toBe(false);
    expect(r.adapter.metricOwners).toEqual([{ metric: "Net Revenue Retention (NRR)", team: "Finance", contact: "fpa@acme.example" }, { metric: "All Core metrics", team: "Finance" }]);
    expect(r.open.unowned).not.toContain("Net Revenue Retention (NRR)");
    expect(r.open.unowned).not.toContain("MRR (Monthly Recurring Revenue)");
    expect(r.open.unowned).toContain("Billings");
    // On file, in the extension, with the candidates closed.
    const e = ext(r.mapping);
    expect(e.decisions.length).toBe(10);
    expect(e.decisions.find((d: Decision) => d.about === "topic" && d.topic === "churn date")).toMatchObject({ owner: "Finance", date: "2026-10-30", answer: "the subscription end date, not the cancellation request" });
    expect(e.decisions.every((d: Decision) => /^\d{4}-\d{2}-\d{2}$/.test(d.date!))).toBe(true);
    expect(e.proposed.candidates).toEqual([]);
    expect(e.proposed.unmatched.map((u: { table: string }) => u.table)).toEqual(["usage_daily"]);
    expect(e.metricOwners.length).toBe(2);
    expect(r.open.questions).toEqual([]);
    expect(r.open.candidates).toEqual([]);
    expect(r.level2).toBe(true);
    const report = formatDecisionReport(r, decisions.length);
    expect(report).toContain("**This run:** 10 decisions given, 7 applied to the model or the mapping, 3 recorded with nothing to change; 10 decisions on file.");
    expect(report).toContain("**Readiness:** level 2 (mapped) reached: every question and candidate is decided.");
    expect(report).toContain("- usage_daily key: key set to account_id, workspace_id, day (Data platform, 2026-11-03: one row per workspace per day)".replace("2026-11-03", new Date().toISOString().slice(0, 10)));
    expect(report).toContain("- churn date: recorded: the subscription end date, not the cancellation request (Finance, 2026-10-30)");
  });

  it("refuses a decision without an owner, an unknown column, a field of another dataset or an unknown metric, and keeps the rest", () => {
    const r = decide([
      ...decisions.slice(0, 2),
      { about: "key", dataset: "usage_daily", answer: ["account_id"] } as Decision,
      { about: "field", dataset: "subscriptions", column: "nope", to: "plan_id", owner: "Billing" },
      { about: "field", dataset: "subscriptions", column: "plan_code", to: "invoice_amount", owner: "Billing" },
      { about: "field", dataset: "usage_daily", column: "day", to: "event_date", owner: "Billing" },
      { about: "table", dataset: "usage_daily", to: "revenue_events", owner: "Product analytics" },
      { about: "owner", metric: "Nonsense Rate", owner: "Finance" },
      { about: "nonsense", owner: "Finance" } as unknown as Decision,
    ]);
    expect(r.problems).toEqual([
      "Decision 3 (usage_daily key): every decision names its owner.",
      "Decision 7 (usage_daily → revenue_events): GASP has no dataset \"revenue_events\". Near names: revenue_event.",
      "Decision 4 (subscriptions.nope → plan_id): subscriptions has no column \"nope\".",
      "Decision 5 (subscriptions.plan_code → invoice_amount): invoice_amount is a GASP field of invoice, not of subscription.",
      "Decision 6 (usage_daily.day → event_date): usage_daily is not read as a GASP dataset; decide the table first (about: table).",
      "Decision 8 (Nonsense Rate owner): \"Nonsense Rate\" is not a GASP metric. No close names. Try search with a word from the name.",
      "Decision 9 (nonsense): \"about\" must be one of key, time, kind, type, table, field, owner, topic.",
    ]);
    expect(r.applied.length).toBe(2);
    expect(r.decisions.length).toBe(2);
  });

  it("repeats without change, and a later decision on a subject replaces the earlier one", () => {
    const first = decide();
    const again = decide(decisions, first);
    expect(again.applied).toEqual([]);
    expect(again.recorded.length).toBe(decisions.length);
    expect(ossieYaml(again.mapping)).toBe(ossieYaml(first.mapping));
    expect(ossieYaml(again.model)).toBe(ossieYaml(first.model));
    expect(again.decisions.length).toBe(decisions.length);
    const changed = decide([{ about: "key", dataset: "usage_daily", answer: "account_id, day", owner: "Data platform", note: "workspaces were folded into accounts" }], first);
    expect(changed.applied.map((d) => d.effect)).toEqual(["key set to account_id, day"]);
    expect(changed.decisions.length).toBe(decisions.length);
    expect(changed.decisions.find((d) => subjectOf(d) === "key:usage_daily")!.note).toBe("workspaces were folded into accounts");
    expect(openQuestions(changed.model, changed.decisions)).toEqual([]);
  });

  it("validates as a mapping over the model and passes the upstream validator", async () => {
    const r = decide();
    const v = checkMapping({ document: r.mapping, model: r.model }, data);
    if ("error" in v) throw new Error(v.error);
    expect(v.ossieSchemaErrors).toEqual([]);
    expect(v.crossProblems).toEqual([]);
    expect(v.conversionProblems).toEqual([]);
    expect(v.coverage.unowned).toEqual(r.open.unowned);
    expect(r.gaps).toEqual([]);
    if (!uvAvailable()) return;
    const dir = mkdtempSync(join(tmpdir(), "gasp-decide-"));
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

  it("answers in prose and in each output shape, reading the decisions back from the mapping", () => {
    const model = ossieYaml(proposal.model);
    const mapping = ossieYaml(proposal.mapping);
    expect(recordDecisionFromText(undefined, mapping, undefined, data)).toContain("Pass semantic_model");
    expect(recordDecisionFromText(model, undefined, undefined, data)).toContain("Pass mapping");
    expect(recordDecisionFromText("- a list", mapping, undefined, data)).toContain("Invalid semantic model");
    expect(recordDecisionFromText(mapping, mapping, undefined, data)).toContain("must be an Ossie semantic model");
    expect(recordDecisionFromText(model, model, undefined, data)).toContain("must be an Ossie mapping");
    expect(recordDecisionFromText(model, mapping, "- 3", data)).toContain("Each decision is an object");
    const yaml = ["- about: key", "  dataset: usage_daily", "  answer: [account_id, workspace_id, day]", "  owner: Data platform", "- about: topic", "  topic: reporting currency", "  answer: USD", "  owner: Finance"].join("\n");
    const text = recordDecisionFromText(model, mapping, yaml, data);
    expect(text).toContain("# Decisions: Acme SaaS");
    expect(text).toContain("**This run:** 2 decisions given, 1 applied to the model or the mapping, 1 recorded with nothing to change; 2 decisions on file.");
    expect(text).toContain("\n## Mapping\n");
    expect(text).toContain("\n## Semantic model\n");
    const written = recordDecisionFromText(model, mapping, yaml, data, { output: "mapping" });
    const back = recordDecisionFromText(recordDecisionFromText(model, mapping, yaml, data, { output: "model" }), written, undefined, data);
    expect(back).toContain("**On file:** 2 decisions.");
    expect(back).toContain("**Open:** 1 question and 2 candidates;");
    expect(back).not.toContain("\n## Mapping\n");
    const json = JSON.parse(recordDecisionFromText(model, mapping, JSON.stringify({ decisions: [decisions[0]] }), data, { output: "json" })) as { applied: unknown[]; decisions: unknown[]; level2: boolean; open: { questions: unknown[] } };
    expect(json.applied.length).toBe(1);
    expect(json.decisions.length).toBe(1);
    expect(json.open.questions.length).toBe(1);
    expect(json.level2).toBe(false);
  });
});

describe("Decide: the synthetic dataset's own schema", () => {
  let db: PGlite;
  let proposal: ProposalResult;
  beforeAll(async () => {
    db = await fixtureDb();
    proposal = proposeMapping(profileSchema(parsed(await informationSchema(db)), [], data, { organization: "Fixture" }).model, data, { organization: "Fixture" });
  }, 300_000);
  afterAll(async () => { await db?.close(); });

  it("reaches level 2 with every field pair of the fixture adapter once the five questions and the one candidate are decided", () => {
    const open = recordDecisions(proposal.model, proposal.mapping, [], data);
    expect(open.open.questions.map((q) => `${q.dataset}:${q.about}`)).toEqual(["gasp_brand_mentions:key", "gasp_financials:key", "gasp_revenue_schedule:key", "gasp_trials:time", "gasp_web_traffic:key"]);
    expect(open.open.candidates.map((c) => `${c.source}.${c.column} -> ${c.dataset}.${c.field}`)).toEqual(["gasp_projects.deal_closed_on -> project.close_date"]);
    const datasets = data.ontology!.datasets;
    const column = (ds: string, field: string) => COLUMNS[ds]?.[field] ?? field;
    const decisions: Decision[] = open.open.questions.map((q) => {
      const ds = q.dataset.replace(/^gasp_/, "").replace(/s$/, "");
      const id = Object.keys(datasets).find((d) => d === ds || d === `${ds}s` || `${d}s` === ds || d === q.dataset.replace(/^gasp_/, ""))!;
      return q.about === "time"
        ? { about: "time", dataset: q.dataset, answer: column(id, datasets[id].date), owner: "Data platform" }
        : { about: "key", dataset: q.dataset, answer: [column(id, datasets[id].key), ...(datasets[id].kind === "snapshot" ? [column(id, datasets[id].date)] : [])], owner: "Data platform" };
    });
    decisions.push({ about: "field", dataset: "gasp_projects", column: "deal_closed_on", to: "close_date", owner: "Services" });
    const r = recordDecisions(proposal.model, proposal.mapping, decisions, data);
    expect(r.problems).toEqual([]);
    expect(r.applied.length).toBe(6);
    expect(r.level2).toBe(true);
    expect(r.gaps).toEqual([]);
    expect(missing(pairsOf(buildAdapter(), data), pairsOf(r.adapter, data))).toEqual([]);
    expect(missing(pairsOf(r.adapter, data), pairsOf(buildAdapter(), data))).toEqual([]);
    const v = checkMapping({ document: r.mapping, model: r.model }, data);
    if ("error" in v) throw new Error(v.error);
    expect(v.ossieSchemaErrors).toEqual([]);
    expect(v.crossProblems).toEqual([]);
    const fixture = checkMapping({ document: buildAdapter(), model: undefined }, data);
    if ("error" in fixture) throw new Error(fixture.error);
    expect(v.coverage.fully.map((m) => m.metric).sort()).toEqual(fixture.coverage.fully.map((m) => m.metric).sort());
  });
});
