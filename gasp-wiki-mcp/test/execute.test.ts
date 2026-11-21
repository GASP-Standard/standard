import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { loadStandard } from "../src/loader.js";
import { buildAdapter, addDays, START, END, type Row } from "./fixture/generate.js";
import { fixture, adapter, fixtureDb, fill as fillFor, bind, runTemplate } from "./fixture-db.js";
import { TABLES, columnName } from "../src/synthetic.js";

// Runs the compiled SQL. The fixture (test/fixture) is loaded into an in-process
// Postgres, every template is filled from the fixture's per-dataset adapter and
// must return a value for June 2026, and selected metrics are checked against values
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
const trialsEnded = (start: string, end: string) => T.trial.filter((r) => between(r.trial_end_date, start, end) && r.trial_status !== "active");
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
    expect(trialsEnded(...JUNE).map((r) => r.trial_status).sort()).toEqual(["cancelled", "converted", "converted", "expired", "expired"]);
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
  // Two exceptions. One reads twelve months back: the credit ledger starts in 2026 and the customers
  // in the June 2026 cohort have no June 2025 consumption, so the lagged denominator is 0 and the ratio NULL.
  // Average Services Deal Size reads services deals won in the period, and the one won services deal (o19)
  // closed in April, so June has none (formula-fixes.test.ts checks April).
  const NULL_BY_DESIGN = new Set(["consumption_net_revenue_retention", "average_services_deal_size"]);
  it("every fully mapped template returns a value, June", async () => {
    const nulls: string[] = [];
    for (const f of runnable) {
      if (NULL_BY_DESIGN.has(f.id)) continue;
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

  it("customer counts: total at period end, new and churned in the period", async () => {
    expect(await run("total_customers", ...JUNE)).toBe(activeCustomersOn(END).length);
    expect(await run("new_customers", ...JUNE)).toBe(distinct(revenueEvents(...JUNE, "new"), "customer_id"));
    expect(await run("new_customers", ...JUNE)).toBe(2);
    expect(await run("churned_customers", ...JUNE)).toBe(distinct(revenueEvents(...JUNE, "churn"), "customer_id"));
    expect(await run("churned_customers", ...JUNE)).toBe(1);
    const q2 = await run("logo_churn_rate", ...Q2);
    expect(q2).toBeCloseTo((await run("churned_customers", ...Q2))! / activeCustomersOn(Q2[0]).length, 10);
  });

  it("reactivation MRR is the fifth movement and net new MRR reconciles to the MRR change", async () => {
    expect(await run("reactivation_mrr", ...JUNE)).toBe(sum(revenueEvents(...JUNE, "reactivation"), "mrr_change"));
    expect(await run("reactivation_mrr", ...JUNE)).toBe(600);
    const movements = await Promise.all(["new_mrr", "expansion_mrr", "reactivation_mrr", "churned_mrr", "contraction_mrr"].map((id) => run(id, ...JUNE)));
    const [n, e, r, c, k] = movements.map((v) => v!);
    expect(await run("net_new_mrr", ...JUNE)).toBeCloseTo(n + e + r - c - k, 6);
    expect(await run("net_new_mrr", ...JUNE)).toBeCloseTo(mrrOn(END) - mrrOn("2026-05-31"), 6);
  });

  it("trial-to-paid conversion counts trials by the date they ended", async () => {
    const ended = trialsEnded(...JUNE);
    expect(await run("trial_to_paid_conversion_rate", ...JUNE)).toBeCloseTo(ended.filter((r) => r.trial_status === "converted").length / ended.length, 10);
    expect(await run("trial_to_paid_conversion_rate", ...JUNE)).toBeCloseTo(2 / 5, 10);
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
  it("Magic Number, June (ARR change since 2026-03-31 over GTM spend January to March)", async () => {
    const priorEnd = "2026-03-31"; // the quarter before the one ending 2026-06-30 ends on a month end (the shift steps from the day after the end)
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
describe("a sum over no matching rows is 0", () => {
  const MONTHS: Array<[string, string]> = [["2026-01-01", "2026-01-31"], ["2026-02-01", "2026-02-28"], ["2026-03-01", "2026-03-31"], ["2026-04-01", "2026-04-30"], ["2026-05-01", "2026-05-31"], ["2026-06-01", "2026-06-30"]];

  it("a movement with no event in the month is 0, not NULL", async () => {
    expect(revenueEvents("2026-01-01", "2026-01-31", "churn")).toEqual([]); // the fixture has no churn in January
    expect(await run("churned_mrr", "2026-01-01", "2026-01-31")).toBe(0);
    expect(await run("net_new_mrr", "2026-01-01", "2026-01-31")).toBe(sum(T.revenue_event.filter((r) => between(r.event_date, "2026-01-01", "2026-01-31")), "mrr_change"));
  });

  it("NRR and GRR have a value in every month, the hand-computed one", async () => {
    for (const [start, end] of MONTHS) {
      expect(await run("nrr", start, end), `nrr ${start}`).toBeCloseTo(expectedNrr(start, end), 10);
      expect(await run("grr", start, end), `grr ${start}`).toBeCloseTo(expectedNrr(start, end, true), 10);
    }
  });
});

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

  it("Marketplace Revenue, June (o08 is the one closed-won marketplace deal)", async () => {
    const won = snapshot("opportunity", END).filter((r) => r.channel === "marketplace" && r.opportunity_stage === "closed_won" && between(r.close_date, ...JUNE));
    expect(won.map((r) => r.opportunity_id)).toEqual(["o08"]);
    expect(sum(won, "opportunity_amount")).toBe(13200);
    expect(await run("marketplace_revenue", ...JUNE)).toBe(13200);
  });

  it("Renewal Rate and Auto-Renewal Rate, June (contracts ending in June)", async () => {
    const ending = snapshot("subscription", END).filter((r) => between(r.contract_end, ...JUNE));
    expect(ending.map((r) => r.customer_id).sort()).toEqual(["c08", "c11", "c12"]);
    expect(await run("renewal_rate", ...JUNE)).toBeCloseTo(ending.filter((r) => r.renewed === true).length / ending.length, 10);
    expect(await run("renewal_rate", ...JUNE)).toBeCloseTo(2 / 3, 10);
    const renewed = ending.filter((r) => r.renewed === true);
    expect(await run("auto_renewal_rate", ...JUNE)).toBeCloseTo(renewed.filter((r) => r.auto_renewed === true).length / renewed.length, 10);
  });

  it("MTTR, June (minutes from start to resolution, averaged over incidents started in June)", async () => {
    const june = T.incident.filter((r) => between(r.started_at, ...JUNE));
    const expected = june.reduce((s, r) => s + minutes(r.started_at, r.resolved_at), 0) / june.length;
    // inc11 and inc12, plus inc_late (15:00 on 2026-06-30, resolved 75 minutes later).
    expect(june.map((r) => r.incident_id)).toContain("inc_late");
    expect(expected).toBe((90 + 120 + 75) / 3);
    expect(await run("mttr", ...JUNE)).toBeCloseTo(expected, 6);
  });

  // Timestamp-dated datasets: a row late on the last day of the period counts (upper bound < period_end + 1 day).
  it("Incident Count and Ticket Volume, June, include the rows timestamped on the afternoon and evening of 2026-06-30", async () => {
    const incidents = T.incident.filter((r) => between(r.started_at, ...JUNE));
    const tickets = T.ticket.filter((r) => between(r.created_at, ...JUNE));
    expect(incidents.map((r) => r.incident_id)).toContain("inc_late");
    expect(tickets.map((r) => r.ticket_id)).toContain("t_late");
    expect(await run("incident_count", ...JUNE)).toBe(distinct(incidents, "incident_id"));
    expect(await run("ticket_volume", ...JUNE)).toBe(distinct(tickets, "ticket_id"));
    // And they fall out of a period that ends the day before.
    expect(await run("ticket_volume", JUNE[0], "2026-06-29")).toBe(distinct(tickets, "ticket_id") - 1);
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

  it("Time to Hire, Q2 (application to start date for e22, e23 and e24: 28, 35 and 42 days)", async () => {
    const hires = snapshot("employee", END).filter((r) => between(r.hire_date, ...Q2));
    expect(hires.map((r) => [r.employee_id, (Date.parse(String(r.hire_date)) - Date.parse(String(r.application_date))) / 86400000])).toEqual([["e22", 28], ["e23", 35], ["e24", 42]]);
    expect(await run("time_to_hire", ...Q2)).toBeCloseTo(35, 10);
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
    expect(rows).toEqual({ sev1: 3, sev2: 4, sev3: 3, sev4: 3 }); // inc_late on 2026-06-30 is sev2
    for (const [sev, n] of Object.entries(rows)) expect(n, sev).toBe(distinct(h1.filter((r) => r.severity === sev), "incident_id"));
    expect(Object.values(rows).reduce((s, v) => s! + (v ?? 0), 0)).toBe(await run("incident_count", ...H1));
  });

  it("Ticket Volume by ticket type, June: counts match the story rows and sum to the total", async () => {
    const june = T.ticket.filter((r) => between(r.created_at, ...JUNE));
    const rows = await runNamed("ticket_volume", "by_ticket_type", ...JUNE);
    for (const [type, n] of Object.entries(rows)) expect(n ?? 0, type).toBe(distinct(june.filter((r) => r.ticket_type === type), "ticket_id"));
    expect(Object.values(rows).reduce((s, v) => s! + (v ?? 0), 0)).toBe(june.length);
  });

  it("MRR by plan, June: one row per plan name, reached through plan_id, and the rows sum to MRR", async () => {
    const rows = await runNamed("mrr", "by_plan", ...JUNE);
    expect(Object.keys(rows).sort()).toEqual(["Enterprise", "Pro", "Starter"]);
    const plans = new Map(snapshot("plan", END).map((r) => [r.plan_name, r.plan_id]));
    for (const [name, v] of Object.entries(rows)) {
      expect(v ?? 0, name).toBe(sum(snapshot("subscription", END).filter((r) => r.subscription_status === "active" && r.plan_id === plans.get(name)), "mrr"));
    }
    expect(Object.values(rows).reduce((s, v) => s! + (v ?? 0), 0)).toBe(await run("mrr", ...JUNE));
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

  it("Accounts Receivable Balance at 2026-06-30: open invoice outstanding amounts, status rows sum to the total", async () => {
    const open = snapshot("invoice", END).filter((r) => Number(r.outstanding_amount) > 0);
    const byStatus = (st: string) => sum(open.filter((r) => r.payment_status === st), "outstanding_amount");
    // 4,000 unpaid plus inv_partial's 1,200 still outstanding of 3,000 invoiced.
    expect([byStatus("unpaid"), byStatus("partial")]).toEqual([4000, 1200]);
    expect(sum(open, "outstanding_amount")).toBe(5200);
    expect(await run("accounts_receivable_balance", ...JUNE)).toBe(5200);
    const rows = await runNamed("accounts_receivable_balance", "by_payment_status", ...JUNE);
    expect(rows.unpaid).toBe(4000);
    expect(rows.partial).toBe(1200);
    expect(Object.values(rows).reduce((s, v) => s! + (v ?? 0), 0)).toBe(5200);
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

// The credit ledger (Credit_Event): the CREDITS stories in src/synthetic.ts plus one
// overage row per USAGE customer and month above the commitment. Every expected value
// is worked by hand from the stories; the filters over the rows restate it.
describe("hand-computed metric values, credit ledger", () => {
  /** A formula compiled straight from formulas.json (a named breakdown when `name` is given) and run over the fixture. */
  async function runFormula(id: string, start: string, end: string, name?: string): Promise<number | null | Record<string, number | null>> {
    const { compileMetric } = await import("../src/compile.js");
    const { fillTemplate } = await import("../src/tools.js");
    const ctx = { fields: Object.fromEntries(data.ontology!.fields!.map((f) => [f.id, f])), datasets: data.ontology!.datasets!, formulas: data.formulas! };
    const c = compileMetric(id, ctx, name);
    const template = {
      metric: id, fields: c.fields, datasets: c.datasets, sourceTable: c.datasets.length === 1 ? c.datasets[0] : null, grain: "", frequency: "", source: "",
      parameterizedQuery: c.sql, staged: c.staged, placeholders: c.placeholders, breakdown: c.breakdown,
    };
    const filled = fillTemplate(template, adapter, data);
    expect([...filled.missingFields, ...filled.missingTables], id).toEqual([]);
    const res = await db.query<Record<string, unknown>>(bind(filled.sql, start, end));
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    if (!c.breakdown) return num(res.rows[0] ? Object.values(res.rows[0])[0] : null);
    return Object.fromEntries(res.rows.map((r) => [String(r[c.breakdown!.field]), num(r[id])]));
  }

  const MONTH_ENDS: Array<[string, string]> = [["2026-01-01", "2026-01-31"], ["2026-02-01", "2026-02-28"], ["2026-03-01", "2026-03-31"], ["2026-04-01", "2026-04-30"], ["2026-05-01", "2026-05-31"], ["2026-06-01", "2026-06-30"]];
  const credits = (start: string, end: string, keep: (r: Row) => boolean) => T.credit_event.filter((r) => between(r.event_date, start, end) && keep(r));
  const consumed = (start: string, end: string, basis?: string) =>
    -sum(credits(start, end, (r) => r.credit_event_type === "consumption" && (!basis || r.consumption_basis === basis)), "credit_amount");
  // Per month: c09 committed + c11 committed (+ its March overage) + c01 and c06 on demand + the USAGE overages
  // (c02 Feb 300 and Apr 150; c07 Mar 400, May 900, Jun 500; c10 May 200).
  const CONSUMPTION = [
    1200 + 1800 + 400 + 300,
    1500 + 2100 + 450 + 300 + 300,
    1400 + 2100 + 300 + 500 + 350 + 400,
    1700 + 1900 + 520 + 300 + 150,
    1600 + 2000 + 610 + 400 + 900 + 200,
    1300 + 2000 + 700 + 380 + 500,
  ];

  it("the ledger holds the stories: 35 rows, each balance chained", () => {
    expect(T.credit_event.length).toBe(35);
    expect(CONSUMPTION).toEqual([3700, 4650, 5050, 4570, 5710, 4880]);
    MONTH_ENDS.forEach((m, i) => expect(consumed(...m), m[1]).toBe(CONSUMPTION[i]));
  });

  it("Consumption Revenue per month, and by basis in March", async () => {
    for (const [i, m] of MONTH_ENDS.entries()) expect(await runFormula("consumption_revenue", ...m), m[1]).toBe(CONSUMPTION[i]);
    expect(await runFormula("consumption_revenue", ...H1)).toBe(CONSUMPTION.reduce((a, b) => a + b, 0));
    // March: committed c09 1,400 + c11 2,100; overage c11 300 + c07 400; on demand c01 500 + c06 350.
    const march = await runFormula("consumption_revenue", "2026-03-01", "2026-03-31", "by_basis") as Record<string, number | null>;
    expect(march).toEqual({ committed: 3500, overage: 700, on_demand: 850 });
    for (const basis of ["committed", "overage", "on_demand"]) expect(march[basis], basis).toBe(consumed("2026-03-01", "2026-03-31", basis));
  });

  it("Usage Run-Rate at 2026-06: on-demand consumption April to June, times four", async () => {
    // c01 520 + 610 + 700, c06 300 + 400 + 380.
    const expected = (520 + 610 + 700 + 300 + 400 + 380) * 4;
    expect(expected).toBe(11640);
    expect(consumed(...Q2, "on_demand") * 4).toBe(expected);
    expect(await runFormula("usage_run_rate", ...JUNE)).toBe(expected);
  });

  it("Prepaid Credit Balance at the end of March and June", async () => {
    // March: c09 9,000 - 1,200 - 1,500 - 1,400 = 4,900; c11 6,000 - 1,800 - 2,100 - 2,100 = 0 (the overage draws nothing).
    expect(await runFormula("prepaid_credit_balance", "2026-03-01", "2026-03-31")).toBe(4900);
    // June: c09 drawn to 300 and forfeited; c11's second 6,000 less 1,900, 2,000 and 2,000 leaves 100.
    expect(await runFormula("prepaid_credit_balance", ...JUNE)).toBe(100);
    const lastAfter = (c: string, day: string) => T.credit_event.filter((r) => r.customer_id === c && String(r.event_date) <= day && r.consumption_basis !== "overage").at(-1)!.credit_balance_after;
    expect(Number(lastAfter("c09", "2026-03-31")) + Number(lastAfter("c11", "2026-03-31"))).toBe(4900);
    expect(Number(lastAfter("c09", END)) + Number(lastAfter("c11", END))).toBe(100);
  });

  it("Credit Breakage: c09's 300 forfeited in June, nothing before", async () => {
    expect(await runFormula("credit_breakage", ...JUNE)).toBe(300);
    expect(await runFormula("credit_breakage", "2026-03-01", "2026-03-31")).toBe(0);
  });

  it("ARR including Usage Run-Rate at 2026-06: the pinned ARR plus the run-rate", async () => {
    expect(await runFormula("arr_including_usage_run_rate", ...JUNE)).toBe(290400 + 11640);
  });

  it("Consumption Revenue Growth Rate, March over February and February over January", async () => {
    expect(await runFormula("consumption_revenue_growth_rate", "2026-03-01", "2026-03-31")).toBeCloseTo((5050 - 4650) / 4650, 10);
    expect(await runFormula("consumption_revenue_growth_rate", "2026-02-01", "2026-02-28")).toBeCloseTo((4650 - 3700) / 3700, 10);
  });

  it("Consumption NRR has no value: the ledger holds no consumption twelve months before June 2026", async () => {
    expect(await runFormula("consumption_net_revenue_retention", "2025-07-01", END)).toBeNull();
  });
});

// CARR (Contracted ARR) is ARR plus the annual value of new contracts signed by
// period end that start later (finance.md, the SaaS Metrics Standards Board
// formula). Every contract in the synthetic data starts on the day it is signed,
// so the contracts that wait for a start date are planted in this block's own database.
describe("Contracted ARR (CARR)", () => {
  let own: PGlite;
  const table = TABLES.contract_event;
  const col = (f: string) => columnName("contract_event", f);
  const months = [["2026-04-01", "2026-04-30"], ["2026-05-01", "2026-05-31"], ["2026-06-01", END]] as const;

  /** Copy a new contract row as another contract event with its own dates and annual value. */
  async function plantContract(id: string, type: string, signed: string, start: string, end: string, acv: number) {
    await own.exec(`CREATE TEMP TABLE planted AS SELECT * FROM ${table} WHERE ${col("contract_event_type")} = 'new_contract' LIMIT 1;
      UPDATE planted SET ${col("event_id")} = '${id}', ${col("contract_event_type")} = '${type}', ${col("event_date")} = '${signed}',
        ${col("contract_start")} = '${start}', ${col("contract_end")} = '${end}', ${col("acv")} = ${acv}, ${col("tcv")} = ${acv};
      INSERT INTO ${table} SELECT * FROM planted;
      DROP TABLE planted;`);
  }

  beforeAll(async () => {
    own = await fixtureDb();
    await plantContract("p_may", "new_contract", "2026-05-20", "2026-06-15", "2027-06-14", 12000);
    await plantContract("p_june", "new_contract", "2026-06-10", "2026-07-15", "2027-07-14", 24000);
    await plantContract("p_july", "new_contract", "2026-07-02", "2026-08-01", "2027-07-31", 36000);
    await plantContract("p_renewal", "renewal", "2026-06-20", "2026-09-01", "2027-08-31", 50000);
    await plantContract("p_notice", "cancellation", "2026-06-25", "2025-10-01", "2026-09-30", 0);
  }, 120_000);

  afterAll(async () => { await own?.close(); });

  it("equals ARR while every contract starts on the day it is signed", async () => {
    for (const [start, end] of months) expect(await run("carr", start, end), end).toBe(await run("arr", start, end));
    expect(await run("carr", ...JUNE)).toBe(290400);
  });

  it("adds a contract signed in May for a June start to May and to no later month", async () => {
    expect(await runTemplate(own, data, "carr", ...months[1])).toBe((await run("arr", ...months[1]))! + 12000);
    expect(await runTemplate(own, data, "carr", ...months[0])).toBe(await run("arr", ...months[0]));
  });

  it("at the end of June holds the contract that starts in July alone", async () => {
    // p_may has started and left the second term, p_july is signed after the period,
    // a renewal signed early adds nothing and notice of an ending in September takes nothing off.
    expect(await runTemplate(own, data, "carr", ...JUNE)).toBe(290400 + 24000);
    expect(await runTemplate(own, data, "arr", ...JUNE)).toBe(290400);
  });
});

// The two variants of CARR take churn off before it takes effect: the first reads
// what the ledgers state as contract, the second the renewal forecast. Each planted
// row is one a company would hold: a temporary add-on, a fixed-term project, notice
// of an ending, a forecast below the current value.
describe("CARR net of known churn and net of forecast churn", () => {
  let known: PGlite;
  let forecast: PGlite;
  const months = [["2026-04-01", "2026-04-30"], ["2026-05-01", "2026-05-31"], ["2026-06-01", END]] as const;
  const events = TABLES.revenue_event;
  const ev = (f: string) => columnName("revenue_event", f);
  const subs = TABLES.subscription;
  const sub = (f: string) => columnName("subscription", f);
  const contracts = TABLES.contract_event;
  const con = (f: string) => columnName("contract_event", f);

  /** A named variant compiled straight from formulas.json and run over a database. */
  async function variant(on: PGlite, name: string, start: string, end: string): Promise<number | null> {
    const { compileMetric } = await import("../src/compile.js");
    const { fillTemplate } = await import("../src/tools.js");
    const ctx = { fields: Object.fromEntries(data.ontology!.fields!.map((f) => [f.id, f])), datasets: data.ontology!.datasets!, formulas: data.formulas! };
    const c = compileMetric("carr", ctx, name);
    const filled = fillTemplate({ ...data.queryTemplates.carr, fields: c.fields, datasets: c.datasets, parameterizedQuery: c.sql, placeholders: c.placeholders }, adapter, data);
    expect([...filled.missingFields, ...filled.missingTables], name).toEqual([]);
    const res = await on.query<Record<string, unknown>>(bind(filled.sql, start, end));
    const value = Object.values(res.rows[0])[0];
    return value === null || value === undefined ? null : Number(value);
  }

  /** Copy a revenue event as another customer's movement with its own tags. */
  async function plantEvent(id: string, customer: string, date: string, type: string, change: number, nature: string, classification: string | null, subscription = `s${customer.slice(1)}`) {
    await known.exec(`CREATE TEMP TABLE planted AS SELECT * FROM ${events} LIMIT 1;
      UPDATE planted SET ${ev("event_id")} = '${id}', ${ev("customer_id")} = '${customer}', ${ev("subscription_id")} = '${subscription}',
        ${ev("event_date")} = '${date}', ${ev("event_type")} = '${type}', ${ev("mrr_change")} = ${change}, ${ev("change_nature")} = '${nature}',
        ${ev("expansion_classification")} = ${classification ? `'${classification}'` : "NULL"};
      INSERT INTO ${events} SELECT * FROM planted;
      DROP TABLE planted;`);
  }

  /** Add an amount to a customer's MRR on every snapshot from one day up to another, or to the end. */
  async function addMrr(customer: string, amount: number, from: string, before?: string) {
    await known.exec(`UPDATE ${subs} SET ${sub("mrr")} = ${sub("mrr")} + ${amount}
      WHERE ${sub("customer_id")} = '${customer}' AND ${sub("snapshot_date")} >= '${from}'${before ? ` AND ${sub("snapshot_date")} < '${before}'` : ""}`);
  }

  beforeAll(async () => {
    known = await fixtureDb();
    forecast = await fixtureDb();

    // A three-month add-on from May, $200 a month, due to end on 1 August.
    await plantEvent("p_addon", "c01", "2026-05-01", "expansion", 200, "temporary", "same_product");
    await addMrr("c01", 200, "2026-05-01");
    // A six-month project from 10 April at $1,000 a month, as a subscription of its own.
    await known.exec(`CREATE TEMP TABLE planted AS SELECT * FROM ${subs} WHERE ${sub("subscription_id")} = 's16' AND ${sub("snapshot_date")} >= '2026-04-10';
      UPDATE planted SET ${sub("subscription_id")} = 'p_project', ${sub("customer_id")} = 'p_customer', ${sub("mrr")} = 1000,
        ${sub("contract_start")} = '2026-04-10', ${sub("contract_end")} = '2026-10-09';
      INSERT INTO ${subs} SELECT * FROM planted;
      DROP TABLE planted;`);
    await plantEvent("p_project", "p_customer", "2026-04-10", "new", 1000, "temporary", null, "p_project");
    // An add-on from 5 April, $300 a month, due to end in July and ended early on 20 May.
    await plantEvent("p_early", "c02", "2026-04-05", "expansion", 300, "temporary", "same_product");
    await plantEvent("p_early_end", "c02", "2026-05-20", "contraction", -300, "scheduled_reversal", "same_product");
    await addMrr("c02", 300, "2026-04-05", "2026-05-20");
    // An add-on from 12 April, $150 a month, made permanent on 10 June: the temporary
    // event is corrected with its opposite and the change booked again as permanent.
    await plantEvent("p_kept", "c09", "2026-04-12", "expansion", 150, "temporary", "same_product");
    await plantEvent("p_kept_correction", "c09", "2026-06-10", "expansion", -150, "temporary", "same_product");
    await plantEvent("p_kept_permanent", "c09", "2026-06-10", "expansion", 150, "permanent", "same_product");
    await addMrr("c09", 150, "2026-04-12");
    // A month of usage over the commitment: the realisation pair, which MRR never held.
    await plantEvent("p_usage", "c15", "2026-06-30", "expansion", 500, "temporary", "usage_realisation");
    await plantEvent("p_usage_reversal", "c15", "2026-07-01", "contraction", -500, "scheduled_reversal", "usage_realisation");
    // Notice given on 25 June that a $500 a month subscription ends on 30 September.
    await known.exec(`CREATE TEMP TABLE planted AS SELECT * FROM ${contracts} WHERE ${con("contract_event_type")} = 'cancellation' LIMIT 1;
      UPDATE planted SET ${con("event_id")} = 'p_notice', ${con("event_date")} = '2026-06-25', ${con("contract_end")} = '2026-09-30', ${con("acv")} = 6000;
      INSERT INTO ${contracts} SELECT * FROM planted;
      DROP TABLE planted;`);

    // Forecasts: c12 ($500 a month, term ending 9 June) is expected to renew at $3,000 a year,
    // c08 ($600 a month, term ending 7 June) to leave and c15 ($600 a month, term ending
    // in March 2027) to renew at $5,000. c11 keeps the fixture's forecast of an uplift.
    for (const [customer, amount] of [["c12", 3000], ["c08", 0], ["c15", 5000]] as const) {
      await forecast.exec(`UPDATE ${subs} SET ${sub("forecast_renewal_amount")} = ${amount} WHERE ${sub("customer_id")} = '${customer}'`);
    }
  }, 240_000);

  afterAll(async () => { await known?.close(); await forecast?.close(); });

  it("both equal CARR on the fixture, which tags nothing temporary, ends every contract the day it is cancelled and forecasts no shortfall", async () => {
    for (const [start, end] of months) {
      const carr = await run("carr", start, end);
      expect(await variant(db, "net_of_known_churn", start, end), end).toBe(carr);
      expect(await variant(db, "net_of_forecast_churn", start, end), end).toBe(carr);
    }
  });

  it("CARR holds the add-on and the project and the variant leaves both out", async () => {
    // April: the project, the add-on that ends early and the add-on later kept.
    expect(await runTemplate(known, data, "carr", ...months[0])).toBe(225600 + 12000 + 3600 + 1800);
    expect(await variant(known, "net_of_known_churn", ...months[0])).toBe(225600);
    // May: the three-month add-on has started and the early ending has reversed.
    expect(await runTemplate(known, data, "carr", ...months[1])).toBe(261600 + 2400 + 12000 + 1800);
    expect(await variant(known, "net_of_known_churn", ...months[1])).toBe(261600);
  });

  it("an add-on ended early and one made permanent leave nothing behind", async () => {
    // By the end of June the early ending is out of MRR and the kept add-on is permanent,
    // so the variant holds the $1,800 a year it left out in April and May.
    expect(await runTemplate(known, data, "carr", ...months[2])).toBe(290400 + 2400 + 12000 + 1800);
    expect(await variant(known, "net_of_known_churn", ...months[2])).toBe(290400 + 1800 - 6000);
  });

  it("a usage realisation pair moves neither figure and notice of a later ending comes off the variant alone", async () => {
    await known.exec(`DELETE FROM ${contracts} WHERE ${con("event_id")} = 'p_notice'`);
    expect(await variant(known, "net_of_known_churn", ...months[2])).toBe(290400 + 1800);
    await known.exec(`DELETE FROM ${events} WHERE ${ev("event_id")} IN ('p_usage', 'p_usage_reversal')`);
    expect(await variant(known, "net_of_known_churn", ...months[2])).toBe(290400 + 1800);
    expect(await runTemplate(known, data, "carr", ...months[2])).toBe(290400 + 2400 + 12000 + 1800);
  });

  it("a temporary discount is read as ARR reads it, with nothing added back before it reverses", async () => {
    // $100 a month off for three months from 15 June. Summing every temporary event would add the $1,200 back.
    await plantEvent("p_discount", "c16", "2026-06-15", "contraction", -100, "temporary", "pricing_adjustment");
    await addMrr("c16", -100, "2026-06-15");
    expect(await runTemplate(known, data, "carr", ...months[2])).toBe(290400 + 2400 + 12000 + 1800 - 1200);
    expect(await variant(known, "net_of_known_churn", ...months[2])).toBe(290400 + 1800 - 1200);
  });

  it("a forecast below the current value comes off until the term ends and an uplift adds nothing", async () => {
    // April and May: c12 falls short by 6,000 - 3,000, c08 by 7,200 and c15 by 7,200 - 5,000.
    for (const [start, end] of [months[0], months[1]]) {
      expect(await runTemplate(forecast, data, "carr", start, end), end).toBe(await run("carr", start, end));
      expect(await variant(forecast, "net_of_forecast_churn", start, end), end).toBe((await run("carr", start, end))! - 3000 - 7200 - 2200);
    }
    // June: the terms of c12 and c08 have ended, so what happened is in ARR and only c15's forecast is left.
    expect(await variant(forecast, "net_of_forecast_churn", ...months[2])).toBe(290400 - 2200);
    expect(await variant(forecast, "net_of_known_churn", ...months[2])).toBe(290400);
  });
});
