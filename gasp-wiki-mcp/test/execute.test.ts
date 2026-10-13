import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { loadStandard } from "../src/loader.js";
import { buildAdapter, addDays, START, END, type Row } from "./fixture/generate.js";
import { fixture, adapter, fixtureDb, fill as fillFor, bind, runTemplate } from "./fixture-db.js";

// Runs the compiled SQL. The fixture (test/fixture) is loaded into an in-process
// Postgres, every template is filled from the fixture's per-dataset adapter and
// must return a value for June 2026, and 21 metrics are checked against values
// computed in plain TypeScript over the same rows. The expected values never go through the compiler or the filler.

const data = loadStandard();
let db: PGlite;

beforeAll(async () => { db = await fixtureDb(); }, 120_000);

afterAll(async () => { await db?.close(); });

const fill = (id: string) => fillFor(data, id);
const run = (id: string, start: string, end: string) => runTemplate(db, data, id, start, end);

/** A breakdown template's rows: dimension value → metric value. */
async function runBreakdown(id: string, start: string, end: string): Promise<Record<string, number | null>> {
  const field = data.queryTemplates[id].breakdown!.field;
  const res = await db.query<Record<string, unknown>>(bind(fill(id).sql, start, end));
  return Object.fromEntries(res.rows.map((r) => [String(r[field]), r[id] === null || r[id] === undefined ? null : Number(r[id])]));
}

// ── independent expected values over the generated rows ──────────────────────

const T = fixture.tables;
const between = (d: unknown, start: string, end: string) => typeof d === "string" && d.slice(0, 10) >= start && d.slice(0, 10) <= end;
const sum = (rows: Row[], f: string) => rows.reduce((s, r) => s + Number(r[f]), 0);
const distinct = (rows: Row[], f: string) => new Set(rows.map((r) => r[f])).size;
const snapshot = (ds: string, day: string) => T[ds].filter((r) => r.snapshot_date === day);
const activeCustomersOn = (day: string) => snapshot("customer", day).filter((r) => r.customer_status === "active");
const mrrOn = (day: string, customers?: Set<unknown>) =>
  sum(snapshot("subscription", day).filter((r) => r.subscription_status === "active" && (!customers || customers.has(r.customer_id))), "mrr");
const revenueEvents = (start: string, end: string, type: string, customers?: Set<unknown>) =>
  T.revenue_event.filter((r) => between(r.event_date, start, end) && r.event_type === type && (!customers || customers.has(r.customer_id)));
const gtmCost = (start: string, end: string) => sum(T.cost_event.filter((r) => between(r.event_date, start, end) && r.cost_function === "gtm"), "cost");
const qualifyingUsers = (start: string, end: string) =>
  distinct(T.product_event.filter((r) => between(r.event_date, start, end) && r.product_event_type === "qualifying"), "user_id");

function expectedNrr(start: string, end: string, gross = false) {
  const cohort = new Set(activeCustomersOn(start).map((r) => r.customer_id));
  const opening = mrrOn(start, cohort);
  const expansion = gross ? 0 : sum(revenueEvents(start, end, "expansion", cohort), "mrr_change");
  const contraction = -sum(revenueEvents(start, end, "contraction", cohort), "mrr_change");
  const churn = -sum(revenueEvents(start, end, "churn", cohort), "mrr_change");
  return (opening + expansion - contraction - churn) / opening;
}
const expectedCac = (start: string, end: string) => gtmCost(start, end) / distinct(revenueEvents(start, end, "new"), "customer_id");
function expectedCacPayback(start: string, end: string) {
  const arpa = mrrOn(end) / activeCustomersOn(end).length;
  const revenue = sum(T.financials.filter((r) => between(r.period_start, start, end)), "revenue");
  const infra = sum(T.cost_event.filter((r) => between(r.event_date, start, end) && r.cost_function === "infrastructure"), "cost");
  return expectedCac(start, end) / (arpa * ((revenue - infra) / revenue));
}
function expectedWinRate(start: string, end: string) {
  const closedInPeriod = snapshot("opportunity", end).filter((r) => between(r.close_date, start, end));
  return closedInPeriod.filter((r) => r.opportunity_stage === "closed_won").length
    / closedInPeriod.filter((r) => r.opportunity_stage === "closed_won" || r.opportunity_stage === "closed_lost").length;
}
/** Users who signed up in the period and had a qualifying event `from` to `to` days after signup (any date). */
function expectedRetention(start: string, end: string, from: number, to: number) {
  const cohort = snapshot("user", end).filter((r) => between(r.signup_date, start, end)).map((r) => r.user_id);
  const retained = cohort.filter((u) => T.product_event.some((e) => {
    if (e.user_id !== u || e.product_event_type !== "qualifying") return false;
    const d = Math.round((Date.parse(String(e.event_date)) - Date.parse(String(e.signup_date))) / 86400000);
    return d >= from && d <= to;
  }));
  return retained.length / cohort.length;
}

const minutes = (from: unknown, to: unknown) => (Date.parse(String(to).replace(" ", "T") + "Z") - Date.parse(String(from).replace(" ", "T") + "Z")) / 60000;

const H1 = [START, END] as const;              // 2026-01-01 to 2026-06-30
const JUNE = ["2026-06-01", END] as const;
const Q2 = ["2026-04-01", END] as const;
const JANUARY = [START, "2026-01-31"] as const;

// ── tests ────────────────────────────────────────────────────────────────────

describe("fixture", () => {
  it("adapter.json is current (npx tsx test/fixture/generate.ts --adapter)", () => {
    expect(adapter).toEqual(buildAdapter());
  });

  it("subscription MRR is the running sum of revenue event mrr_change", () => {
    for (const day of ["2026-01-01", "2026-03-31", END]) {
      for (const s of snapshot("subscription", day)) {
        const running = sum(T.revenue_event.filter((r) => r.customer_id === s.customer_id && String(r.event_date) <= day), "mrr_change");
        expect(s.mrr, `${s.customer_id} on ${day}`).toBe(running);
      }
    }
  });

  it("locks the fixture's shape", () => {
    expect(mrrOn(START)).toBe(15100);
    expect(mrrOn(END)).toBe(24200);
    expect(activeCustomersOn(END).length).toBe(18);
    expect(expectedNrr(...H1)).toBeCloseTo(14900 / 15100, 10);
    expect(expectedNrr(...H1, true)).toBeCloseTo(12100 / 15100, 10);
    expect(expectedWinRate(...JUNE)).toBeCloseTo(2 / 5, 10);
    expect(qualifyingUsers(END, END)).toBe(5);
    expect(qualifyingUsers(addDays(END, -6), END)).toBe(12);
    expect(qualifyingUsers(addDays(END, -29), END)).toBe(21);
  });
});

describe("fixture lifecycle events", () => {
  it("has one state change per acquisition, churn and reactivation in the revenue stories, loaded as a table", async () => {
    const transitions = T.revenue_event.filter((r) => ["new", "churn", "reactivation"].includes(String(r.event_type)));
    const rows = T.lifecycle_event;
    expect(rows.length).toBe(transitions.length);
    const key = (r: Row) => `${r.customer_id} ${r.event_date}`;
    expect(rows.map(key).sort()).toEqual(transitions.map(key).sort());
    const c05 = rows.filter((r) => r.customer_id === "c05").map((r) => [r.prior_state, r.new_state, r.state_category]);
    expect(c05).toEqual([["trial", "active", "activation"], ["active", "churned", "churned"], ["churned", "active", "reactivated"]]);
    const res = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM gasp_lifecycle_events");
    expect(res.rows[0].n).toBe(rows.length);
  });
});

describe("compiled SQL runs on Postgres", () => {
  const ids = Object.keys(data.queryTemplates).sort();
  const filled = ids.map((id) => ({ id, ...fill(id) }));
  const runnable = filled.filter((f) => f.missingFields.length === 0 && f.missingTables.length === 0);
  const skipped = filled.filter((f) => !runnable.includes(f));
  console.info(`execute.test: ${runnable.length} of ${ids.length} templates fully mapped; skipped (missing mappings): ${skipped.map((f) => f.id).join(", ")}`);

  it("maps at least 200 templates, so a regression that drops datasets is caught", () => {
    expect(runnable.length).toBeGreaterThanOrEqual(200);
  });

  it("fully mapped templates leave no placeholder unfilled", () => {
    const left = runnable
      .map((f) => ({ id: f.id, placeholders: [...new Set(f.sql.match(/\{\{[^}]+\}\}/g) ?? [])] }))
      .filter((x) => x.placeholders.length > 0);
    expect(left, JSON.stringify(left, null, 1)).toEqual([]);
  });

  it(`every fully mapped template executes (${runnable.length} templates)`, async () => {
    const failures: Array<{ id: string; error: string }> = [];
    for (const f of runnable) {
      try {
        await db.query(bind(f.sql, ...JUNE));
      } catch (e) {
        failures.push({ id: f.id, error: (e as Error).message });
      }
    }
    expect(failures, failures.map((x) => `${x.id}: ${x.error}`).join("\n")).toEqual([]);
  });

  // An empty table or a filter that matches nothing reads as NULL, so this holds
  // the fixture to having rows for every metric, not just valid SQL.
  it("every fully mapped template returns a value, June", async () => {
    const nulls: string[] = [];
    for (const f of runnable) {
      const res = await db.query<Record<string, unknown>>(bind(f.sql, ...JUNE));
      // A breakdown returns one row per value; at least one must carry a value.
      const values = data.queryTemplates[f.id].breakdown ? res.rows.map((r) => r[f.id]) : [Object.values(res.rows[0])[0]];
      if (values.every((v) => v === null || v === undefined)) nulls.push(f.id);
    }
    expect(nulls, `templates returning NULL: ${nulls.join(", ")}`).toEqual([]);
  });
});

describe("hand-computed metric values", () => {
  it("MRR at 2026-06-30", async () => {
    expect(await run("mrr", ...JUNE)).toBe(24200);
    expect(await run("mrr", ...JUNE)).toBe(mrrOn(END));
  });

  it("ARR at 2026-06-30", async () => {
    expect(await run("arr", ...JUNE)).toBe(290400);
    expect(await run("arr", ...JUNE)).toBe(mrrOn(END) * 12);
  });

  it("Logo Churn Rate, Q2", async () => {
    const churned = distinct(revenueEvents(...Q2, "churn"), "customer_id");
    const expected = churned / activeCustomersOn(Q2[0]).length;
    expect(churned).toBe(2);
    expect(await run("logo_churn_rate", ...Q2)).toBeCloseTo(expected, 10);
  });

  it("CAC, June", async () => {
    expect(expectedCac(...JUNE)).toBe((3800 + 2600) / 2);
    expect(await run("cac", ...JUNE)).toBeCloseTo(expectedCac(...JUNE), 6);
  });

  it("CAC Payback, June", async () => {
    expect(await run("cac_payback", ...JUNE)).toBeCloseTo(expectedCacPayback(...JUNE), 6);
  });

  it("Win Rate, June (open deals with a June close date are excluded)", async () => {
    expect(await run("win_rate", ...JUNE)).toBeCloseTo(expectedWinRate(...JUNE), 10);
  });

  it("NRR, 2026-01-01 to 2026-06-30", async () => {
    expect(await run("nrr", ...H1)).toBeCloseTo(expectedNrr(...H1), 10);
  });

  it("GRR, 2026-01-01 to 2026-06-30", async () => {
    expect(await run("grr", ...H1)).toBeCloseTo(expectedNrr(...H1, true), 10);
  });

  // Item 3: DAU is the day ending at period_end, MAU the 30 days ending there.
  it("DAU/MAU Ratio, June (DAU on 2026-06-30 over MAU for the 30 days to 2026-06-30)", async () => {
    const expected = qualifyingUsers(END, END) / qualifyingUsers(addDays(END, -29), END);
    expect(expected).toBeCloseTo(5 / 21, 10);
    expect(await run("dau_mau", ...JUNE)).toBeCloseTo(expected, 10);
  });

  // Item 3: quarter-over-quarter ARR change over one quarter of GTM spend in the prior quarter.
  it("Magic Number, June (ARR change since 2026-03-30 over GTM spend January to March)", async () => {
    const priorEnd = "2026-03-30"; // 2026-06-30 minus 3 months in Postgres
    const arrChange = (mrrOn(END) - mrrOn(priorEnd)) * 12;
    const spend = gtmCost(addDays(priorEnd, -89), priorEnd);
    expect(spend).toBe(3000 + 2000 + 3100 + 2100 + 3600 + 2400);
    expect(await run("magic_number", ...JUNE)).toBeCloseTo(arrChange / spend, 6);
  });
});

// Item 2: per-dataset mappings. snapshot_date is as_of_date on the customer
// table and snapshot_day on the subscription table; customer_id is account_ref
// on revenue events. The cohort subquery inside NRR and GRR must read the
// customer table's own columns.
describe("per-dataset mappings (item 2)", () => {
  it.each(["nrr", "grr"])("%s fills every placeholder from its own dataset and matches the expected value", async (id) => {
    const f = fill(id);
    expect(f.missingFields).toEqual([]);
    expect(f.missingTables).toEqual([]);
    expect(f.sql).not.toMatch(/\{\{/);
    expect(f.sql).not.toMatch(/FROM gasp_customers WHERE snapshot_day/);
    expect(await run(id, ...H1)).toBeCloseTo(expectedNrr(...H1, id === "grr"), 10);
  });
});

// Item 3: windows. DAU, WAU and MAU are the 1, 7 and 30 days ending at period_end;
// retention numerators look past the period for users who signed up in it.
describe("windows (item 3)", () => {
  it("DAU, WAU and MAU differ", async () => {
    expect(await run("daily_active_users_dau", ...JUNE)).toBe(5);
    expect(await run("weekly_active_users_wau", ...JUNE)).toBe(12);
    expect(await run("monthly_active_users_mau", ...JUNE)).toBe(21);
  });

  it("week 8 retention for the January signup cohort", async () => {
    const expected = expectedRetention(...JANUARY, 49, 55);
    expect(expected).toBeCloseTo(2 / 5, 10);
    expect(await run("cohort_retention", ...JANUARY)).toBeCloseTo(expected, 10);
  });

  it("day 30 retention for the January signup cohort", async () => {
    const expected = expectedRetention(...JANUARY, 30, 30);
    expect(expected).toBeCloseTo(3 / 5, 10);
    expect(await run("user_retention_day_n", ...JANUARY)).toBeCloseTo(expected, 10);
  });
});

// Metrics on the datasets added after the first eleven: services, partners,
// renewals, incidents. Expected values are plain filters over the story rows.
describe("hand-computed metric values, extended datasets", () => {
  it("License Utilization, June (active licenses on the 2026-06-30 snapshot)", async () => {
    const active = snapshot("license", END).filter((r) => r.license_status === "active");
    const activeCustomers = snapshot("customer", END).filter((r) => r.customer_status === "active").length;
    // one Core license per active customer, Analytics for Pro and Enterprise, Automation for Enterprise
    expect(active.length).toBeGreaterThanOrEqual(activeCustomers);
    const expected = sum(active, "seats_assigned") / sum(active, "seats_purchased");
    expect(expected).toBeGreaterThan(0.5);
    expect(expected).toBeLessThan(0.7);
    expect(await run("license_utilization", ...JUNE)).toBeCloseTo(expected, 10);
  });

  it("Contact Coverage and Executive Sponsor Coverage, June (contact snapshot over active accounts)", async () => {
    const contacts = snapshot("contact", END);
    const activeCustomers = snapshot("customer", END).filter((r) => r.customer_status === "active").length;
    const engaged = contacts.filter((r) => r.contact_engaged === true).length;
    const sponsored = new Set(contacts.filter((r) => r.contact_role === "executive_sponsor" && r.contact_engaged === true).map((r) => r.customer_id)).size;
    expect([engaged, sponsored]).toEqual([30, 10]);
    expect(await run("contact_coverage", ...JUNE)).toBeCloseTo(engaged / activeCustomers, 10);
    expect(await run("executive_sponsor_coverage", ...JUNE)).toBeCloseTo(sponsored / activeCustomers, 10);
  });

  it("Project Margin, June (projects completed in June, read on the 2026-06-30 snapshot)", async () => {
    const done = snapshot("project", END).filter((r) => between(r.project_completion_date, ...JUNE));
    expect(done.map((r) => r.project_id)).toEqual(["pr07", "pr08", "pr09"]);
    const revenue = sum(done, "project_revenue");
    const expected = (revenue - sum(done, "project_cost")) / revenue;
    expect([revenue, sum(done, "project_cost")]).toEqual([35000 + 37500 + 40000, 19250 + 23250 + 28000]);
    expect(await run("project_margin", ...JUNE)).toBeCloseTo(expected, 10);
  });

  it("Realization Rate, June (billed revenue over billed hours at standard rate)", async () => {
    const entries = T.time_entry.filter((r) => between(r.entry_date, ...JUNE));
    const expected = sum(entries, "billed_revenue") / entries.reduce((s, r) => s + Number(r.billed_hours) * Number(r.standard_rate), 0);
    expect(expected).toBeCloseTo(120765 / 126950, 10);
    expect(await run("realization_rate", ...JUNE)).toBeCloseTo(expected, 10);
  });

  it("Billable Utilization, June (billable hours over consultant capacity)", async () => {
    const billable = sum(T.time_entry.filter((r) => between(r.entry_date, ...JUNE) && r.time_entry_type === "billable"), "hours");
    const capacity = sum(T.consultant.filter((r) => between(r.period_start, ...JUNE)), "available_hours");
    expect([billable, capacity]).toEqual([704, 6 * 22 * 8]);
    expect(await run("billable_utilization", ...JUNE)).toBeCloseTo(billable / capacity, 10);
  });

  it("Partner-Sourced Revenue, June, and its growth on June 2025", async () => {
    const partnerWon = (end: string, start: string) => sum(snapshot("opportunity", end).filter((r) =>
      r.partner_sourced === true && r.opportunity_stage === "closed_won" && between(r.close_date, start, end)), "opportunity_amount");
    expect(partnerWon(END, JUNE[0])).toBe(13200);
    expect(partnerWon("2025-06-30", "2025-06-01")).toBe(9600);
    expect(await run("partner_sourced_revenue", ...JUNE)).toBe(13200);
    expect(await run("partner_revenue_growth", ...JUNE)).toBeCloseTo((13200 - 9600) / 9600, 10);
  });

  it("Renewal Rate and Auto-Renewal Rate, June (contracts ending in June)", async () => {
    const ending = snapshot("subscription", END).filter((r) => between(r.contract_end, ...JUNE));
    expect(ending.map((r) => r.customer_id).sort()).toEqual(["c08", "c11", "c12"]);
    expect(await run("renewal_rate", ...JUNE)).toBeCloseTo(ending.filter((r) => r.renewed === true).length / ending.length, 10);
    expect(await run("renewal_rate", ...JUNE)).toBeCloseTo(2 / 3, 10);
    expect(await run("auto_renewal_rate", ...JUNE)).toBeCloseTo(ending.filter((r) => r.auto_renewed === true).length / ending.length, 10);
  });

  it("MTTR, June (minutes from start to resolution, averaged over incidents started in June)", async () => {
    const june = T.incident.filter((r) => between(r.started_at, ...JUNE));
    const expected = june.reduce((s, r) => s + minutes(r.started_at, r.resolved_at), 0) / june.length;
    expect(expected).toBe((90 + 120) / 2);
    expect(await run("mttr", ...JUNE)).toBeCloseTo(expected, 6);
  });

  it("Services Gross Margin, June (services revenue less services delivery cost)", async () => {
    const revenue = sum(T.financials.filter((r) => between(r.period_start, ...JUNE) && r.revenue_type === "services"), "revenue");
    const cost = sum(T.cost_event.filter((r) => between(r.event_date, ...JUNE) && r.cost_function === "services_delivery"), "cost");
    expect([revenue, cost]).toEqual([6600, 3900]);
    expect(await run("services_gross_margin", ...JUNE)).toBeCloseTo((revenue - cost) / revenue, 10);
  });

  it("Partner Churn Rate, June (p09 churns; eight partners active on 2026-06-01)", async () => {
    const churned = snapshot("partner", END).filter((r) => between(r.partner_churn_date, ...JUNE)).length;
    const active = snapshot("partner", JUNE[0]).filter((r) => r.partner_status === "active").length;
    expect([churned, active]).toEqual([1, 8]);
    expect(await run("partner_churn_rate", ...JUNE)).toBeCloseTo(churned / active, 10);
  });

  it("Employee Turnover, June (leavers in June over average headcount)", async () => {
    const headcount = (day: string) => snapshot("employee", day).filter((r) => r.employee_status === "active").length;
    const leavers = snapshot("employee", END).filter((r) => between(r.termination_date, ...JUNE)).length;
    expect([leavers, headcount(JUNE[0]), headcount(END)]).toEqual([2, 21, 20]);
    expect(await run("employee_turnover", ...JUNE)).toBeCloseTo(leavers / ((headcount(JUNE[0]) + headcount(END)) / 2), 10);
  });
});

// Breakdowns: one row per value of the breakdown field; total() reads the whole population.
describe("breakdowns", () => {
  it("every breakdown template returns one row per declared value", async () => {
    const ids = Object.keys(data.queryTemplates).filter((id) => data.queryTemplates[id].breakdown);
    expect(ids.sort()).toEqual(["aging_buckets", "cac_by_channel", "partner_tier_distribution", "payment_method_distribution", "source_of_hire", "ticket_distribution_by_type"]);
    for (const id of ids) {
      const b = data.queryTemplates[id].breakdown!;
      const values = b.buckets ? Object.keys(b.buckets) : data.ontology!.fields!.find((f) => f.id === b.field)!.values!;
      const rows = await runBreakdown(id, ...JUNE);
      expect(Object.keys(rows).sort(), id).toEqual([...values].sort());
      expect(Object.values(rows).some((v) => v !== null), id).toBe(true);
    }
  });

  it("Aging Buckets, June: each bucket's share of the 2026-06-30 outstanding balance matches the story rows, and the shares sum to 1", async () => {
    const open = snapshot("invoice", END).filter((r) => r.outstanding_amount !== null);
    const age = (r: Row) => Math.round((Date.parse(String(r.snapshot_date)) - Date.parse(String(r.invoice_date))) / 86400000);
    const total = sum(open, "outstanding_amount");
    const expected: Record<string, number> = {
      current: sum(open.filter((r) => age(r) >= 0 && age(r) <= 30), "outstanding_amount") / total,
      days_31_60: sum(open.filter((r) => age(r) >= 31 && age(r) <= 60), "outstanding_amount") / total,
      days_61_90: sum(open.filter((r) => age(r) >= 61 && age(r) <= 90), "outstanding_amount") / total,
      days_90_plus: sum(open.filter((r) => age(r) >= 91), "outstanding_amount") / total,
    };
    expect(total).toBeGreaterThan(0);
    const rows = await runBreakdown("aging_buckets", ...JUNE);
    for (const [bucket, share] of Object.entries(expected)) expect(rows[bucket] ?? 0, bucket).toBeCloseTo(share, 10);
    expect(Object.values(rows).reduce((s, v) => s + (v ?? 0), 0)).toBeCloseTo(1, 10);
  });

  it("Ticket Distribution by Type, June: shares match the story rows and sum to 1", async () => {
    const june = T.ticket.filter((r) => between(r.created_at, ...JUNE));
    const rows = await runBreakdown("ticket_distribution_by_type", ...JUNE);
    for (const [type, share] of Object.entries(rows)) {
      expect(share ?? 0, type).toBeCloseTo(june.filter((r) => r.ticket_type === type).length / june.length, 10);
    }
    expect(Object.values(rows).reduce((s, v) => s + (v ?? 0), 0)).toBeCloseTo(1, 10);
  });

  it("CAC by Channel, June: paid ads spend over paid ads deals won in June", async () => {
    const spend = sum(T.campaign.filter((r) => between(r.period_start, ...JUNE) && r.channel === "paid_ads"), "ad_spend");
    const won = snapshot("opportunity", END).filter((r) => r.channel === "paid_ads" && r.opportunity_stage === "closed_won" && between(r.close_date, ...JUNE));
    expect(won.map((r) => r.opportunity_id)).toEqual(["o07"]);
    const rows = await runBreakdown("cac_by_channel", ...JUNE);
    expect(rows.paid_ads).toBeCloseTo(spend / won.length, 6);
    // Email and events campaigns spend with no deal won through them: no value.
    expect(rows.email).toBeNull();
  });
});

// Named breakdowns (formulas.json `breakdowns`) compile the main formula grouped by the field.
describe("named breakdowns", () => {
  async function runNamed(id: string, name: string, start: string, end: string): Promise<Record<string, number | null>> {
    const { compileMetric } = await import("../src/compile.js");
    const { fillTemplate } = await import("../src/tools.js");
    const ctx = { fields: Object.fromEntries(data.ontology!.fields!.map((f) => [f.id, f])), datasets: data.ontology!.datasets!, formulas: data.formulas! };
    const c = compileMetric(id, ctx, name);
    const template = { ...data.queryTemplates[id], fields: c.fields, datasets: c.datasets, parameterizedQuery: c.sql, placeholders: c.placeholders, breakdown: c.breakdown };
    const res = await db.query<Record<string, unknown>>(bind(fillTemplate(template, adapter, data).sql, start, end));
    const field = c.breakdown!.field;
    return Object.fromEntries(res.rows.map((r) => [String(r[field]), r[id] === null || r[id] === undefined ? null : Number(r[id])]));
  }

  it("every named breakdown runs and returns at least one value for H1", async () => {
    for (const [id, f] of Object.entries(data.formulas!)) {
      for (const name of Object.keys(f.breakdowns ?? {})) {
        const rows = await runNamed(id, name, ...H1);
        expect(Object.keys(rows).length, `${id}:${name}`).toBeGreaterThan(0);
        expect(Object.values(rows).some((v) => v !== null), `${id}:${name}`).toBe(true);
      }
    }
  });

  it("Incident Count by severity, H1: one row per severity, counts match the story rows and sum to the total", async () => {
    const h1 = T.incident.filter((r) => between(r.started_at, ...H1));
    const rows = await runNamed("incident_count", "by_severity", ...H1);
    expect(Object.keys(rows).sort()).toEqual(["sev1", "sev2", "sev3", "sev4"]);
    expect(rows).toEqual({ sev1: 3, sev2: 3, sev3: 3, sev4: 3 });
    for (const [sev, n] of Object.entries(rows)) expect(n, sev).toBe(distinct(h1.filter((r) => r.severity === sev), "incident_id"));
    expect(Object.values(rows).reduce((s, v) => s! + (v ?? 0), 0)).toBe(await run("incident_count", ...H1));
  });

  it("Ticket Volume by ticket type, June: counts match the story rows and sum to the total", async () => {
    const june = T.ticket.filter((r) => between(r.created_at, ...JUNE));
    const rows = await runNamed("ticket_volume", "by_ticket_type", ...JUNE);
    for (const [type, n] of Object.entries(rows)) expect(n ?? 0, type).toBe(distinct(june.filter((r) => r.ticket_type === type), "ticket_id"));
    expect(Object.values(rows).reduce((s, v) => s! + (v ?? 0), 0)).toBe(june.length);
  });

  it("MRR by segment, June: each row matches the subscription snapshot and the rows sum to MRR", async () => {
    const rows = await runNamed("mrr", "by_segment", ...JUNE);
    const bySegment = (seg: string) => sum(snapshot("subscription", END).filter((r) => r.subscription_status === "active" && r.segment === seg), "mrr");
    expect(rows).toEqual({ smb: 13400, mid_market: 5800, enterprise: 5000 });
    for (const [seg, v] of Object.entries(rows)) expect(v, seg).toBe(bySegment(seg));
    expect(Object.values(rows).reduce((s, v) => s! + (v ?? 0), 0)).toBe(await run("mrr", ...JUNE));
  });

  it("Logo Churn Rate by segment, Q2: one row per segment present, each churned over active at period start", async () => {
    const rows = await runNamed("logo_churn_rate", "by_segment", ...Q2);
    const present = [...new Set(T.revenue_event.map((r) => r.segment))].map(String).sort();
    expect(Object.keys(rows).sort()).toEqual(present);
    expect(present).toEqual(["enterprise", "mid_market", "smb"]);
    for (const seg of present) {
      const churned = distinct(revenueEvents(...Q2, "churn").filter((r) => r.segment === seg), "customer_id");
      const active = activeCustomersOn(Q2[0]).filter((r) => r.segment === seg).length;
      expect(rows[seg], seg).toBeCloseTo(churned / active, 10);
    }
  });

  it("Billings by payment status, H1: each row matches the period-end invoice snapshot and the rows sum to Billings", async () => {
    const rows = await runNamed("billings", "by_payment_status", ...H1);
    const billed = snapshot("invoice", END).filter((r) => between(r.invoice_date, ...H1));
    for (const [status, v] of Object.entries(rows)) expect(v ?? 0, status).toBeCloseTo(sum(billed.filter((r) => r.payment_status === status), "invoice_amount"), 6);
    expect(Object.values(rows).reduce((s, v) => s! + (v ?? 0), 0)).toBeCloseTo((await run("billings", ...H1))!, 6);
    expect(Object.values(rows).filter((v) => v !== null).length).toBeGreaterThan(1);
  });

  it("Leads by lead stage, H1: each row matches the period-end lead snapshot and the rows sum to Leads", async () => {
    const rows = await runNamed("leads", "by_lead_stage", ...H1);
    const created = snapshot("lead", END).filter((r) => between(r.lead_created_date, ...H1));
    for (const [stage, v] of Object.entries(rows)) expect(v ?? 0, stage).toBe(distinct(created.filter((r) => r.lead_stage === stage), "lead_id"));
    expect(Object.values(rows).reduce((s, v) => s! + (v ?? 0), 0)).toBe(await run("leads", ...H1));
    expect(Object.values(rows).filter((v) => v !== null && v > 0).length).toBeGreaterThan(1);
  });

  it("CAC by cost centre, June (total mode): marketing and sales rows over all new customers sum to CAC", async () => {
    const rows = await runNamed("cac", "by_cost_centre", ...JUNE);
    const newCustomers = distinct(revenueEvents(...JUNE, "new"), "customer_id");
    const gtm = (centre: string) => sum(T.cost_event.filter((r) => between(r.event_date, ...JUNE) && r.cost_function === "gtm" && r.cost_centre === centre), "cost");
    expect([gtm("marketing"), gtm("sales"), newCustomers]).toEqual([3800, 2600, 2]);
    expect(rows.marketing).toBeCloseTo(3800 / 2, 6);
    expect(rows.sales).toBeCloseTo(2600 / 2, 6);
    expect((rows.marketing ?? 0) + (rows.sales ?? 0)).toBeCloseTo((await run("cac", ...JUNE))!, 6);
  });
});
