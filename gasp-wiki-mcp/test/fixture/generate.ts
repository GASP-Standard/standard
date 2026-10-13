/**
 * Deterministic GASP fixture: about 20 customers over 2026-01-01 to 2026-06-30.
 *
 * The rows that drive the tested metrics come from explicit stories (customer
 * revenue movements, opportunities, user activity patterns, monthly costs), so
 * every expected value can be checked by hand. Every other column of a mapped
 * dataset is filled from a seeded PRNG so each compiled template has data to run on.
 *
 * Rows are keyed by canonical GASP field id. The physical table and column
 * names live in TABLES and COLUMNS; `buildAdapter()` maps them back to GASP
 * with per-dataset mappings. Regenerate adapter.json with:
 *
 *   npx tsx test/fixture/generate.ts --adapter
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SEED = 20260101;
export const START = "2026-01-01";
export const END = "2026-06-30";
/** Customer and subscription snapshots start here, so a one-year lag from June 2026 has rows to read. */
export const HISTORY_START = "2025-06-01";

type Value = string | number | boolean | null;
export type Row = Record<string, Value>;
export interface OntologyField { id: string; type: string; datasets?: string[]; values?: string[] }

const here = new URL(".", import.meta.url).pathname;
const ontology = JSON.parse(readFileSync(join(here, "..", "..", "..", "standard", "ontology.json"), "utf-8"));
export const FIELDS: OntologyField[] = ontology.fields;
const DATASETS: Record<string, { kind: string; date: string; key: string }> = ontology.datasets;

/** Warehouse table behind each dataset the fixture covers. */
export const TABLES: Record<string, string> = {
  customer: "gasp_customers",
  subscription: "gasp_subscriptions",
  revenue_event: "gasp_revenue_events",
  cost_event: "gasp_cost_events",
  financials: "gasp_financials",
  opportunity: "gasp_opportunities",
  lead: "gasp_leads",
  user: "gasp_users",
  product_event: "gasp_product_events",
  survey_response: "gasp_survey_responses",
  ticket: "gasp_tickets",
  contract_event: "gasp_contract_events",
  amendment_event: "gasp_amendment_events",
  employee: "gasp_employees",
  requisition: "gasp_requisitions",
  partner: "gasp_partners",
  deal_registration: "gasp_deal_registrations",
  partner_activity: "gasp_partner_activities",
  project: "gasp_projects",
  project_milestone: "gasp_project_milestones",
  deliverable: "gasp_deliverables",
  consultant: "gasp_consultant_capacity",
  time_entry: "gasp_time_entries",
  onboarding: "gasp_onboardings",
  onboarding_milestone: "gasp_onboarding_milestones",
  onboarding_session: "gasp_onboarding_sessions",
  invoice: "gasp_invoices",
  balance_sheet: "gasp_balance_sheet",
  revenue_schedule: "gasp_revenue_schedule",
  forecast: "gasp_forecasts",
  quote: "gasp_quotes",
  order: "gasp_orders",
  incident: "gasp_incidents",
  deployment: "gasp_deployments",
  vulnerability: "gasp_vulnerabilities",
  service_metrics: "gasp_service_metrics",
  issue: "gasp_issues",
  feature: "gasp_features",
  release: "gasp_releases",
  roadmap_item: "gasp_roadmap_items",
  campaign: "gasp_campaigns",
  sales_rep: "gasp_sales_reps",
  kb_article: "gasp_kb_articles",
  web_traffic: "gasp_web_traffic",
  brand_mention: "gasp_brand_mentions",
  crm_record: "gasp_crm_records",
  contact: "gasp_contacts",
  plan: "gasp_plans",
  product: "gasp_products",
  license: "gasp_licenses",
  lifecycle_event: "gasp_lifecycle_events",
};

/**
 * Columns whose warehouse name differs from the GASP field id. Shared fields get
 * a different column per table on purpose, so a filler that resolves a
 * placeholder against the wrong dataset produces SQL that fails or misreads.
 */
export const COLUMNS: Record<string, Record<string, string>> = {
  license: { snapshot_date: "as_of", seats_assigned: "assigned_seats", subscription_id: "sub_ref" },
  contact: { customer_id: "account_id", snapshot_date: "as_of" },
  customer: { snapshot_date: "as_of_date", customer_status: "lifecycle_status" },
  subscription: { snapshot_date: "snapshot_day", subscription_status: "status" },
  revenue_event: { event_date: "booked_on", customer_id: "account_ref" },
  cost_event: { event_date: "incurred_on" },
  product_event: { event_date: "occurred_on" },
  employee: { snapshot_date: "as_at", employee_status: "emp_status", hire_date: "started_on" },
  partner: { snapshot_date: "as_at", partner_status: "state" },
  project: { snapshot_date: "snap_date", close_date: "deal_closed_on", customer_id: "client_ref" },
  time_entry: { project_id: "project_ref", hours: "hours_logged" },
  deal_registration: { close_date: "closed_on", partner_id: "partner_ref" },
  onboarding: { snapshot_date: "snap_date", contract_start: "contract_began" },
};

export function columnName(dataset: string, field: string): string {
  return COLUMNS[dataset]?.[field] ?? field;
}

export function datasetFields(dataset: string): OntologyField[] {
  return FIELDS.filter((f) => (f.datasets ?? []).includes(dataset));
}

// ── seeded PRNG and dates ────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
const maxDate = (a: string, b: string) => (a > b ? a : b);
const weekday = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay(); // 0 Sunday
const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = [1, 2, 3, 4, 5, 6].map((m) => `2026-${pad(m)}`);

// ── stories ──────────────────────────────────────────────────────────────────

/** A revenue movement. mrr_change is signed: churn and contraction are negative. */
export interface Movement { date: string; type: "new" | "expansion" | "contraction" | "churn" | "reactivation"; change: number }

/**
 * Twelve customers were acquired in 2025 and are active on 2026-01-01; eight
 * arrive during the window. Revenue events fall on days 2 to 28 so month-end and
 * period-boundary snapshots never coincide with an event.
 */
export const CUSTOMER_STORIES: Record<string, Movement[]> = {
  c01: [{ date: "2025-07-08", type: "new", change: 1000 }, { date: "2026-02-10", type: "expansion", change: 500 }],
  c02: [{ date: "2025-07-15", type: "new", change: 2000 }, { date: "2026-03-12", type: "contraction", change: -400 }],
  c03: [{ date: "2025-08-04", type: "new", change: 500 }, { date: "2026-02-20", type: "churn", change: -500 }],
  c04: [{ date: "2025-08-19", type: "new", change: 1500 }, { date: "2026-04-08", type: "expansion", change: 300 }, { date: "2026-06-05", type: "expansion", change: 200 }],
  c05: [{ date: "2025-09-02", type: "new", change: 800 }, { date: "2026-04-15", type: "churn", change: -800 }, { date: "2026-06-10", type: "reactivation", change: 600 }],
  c06: [{ date: "2025-09-10", type: "new", change: 1200 }, { date: "2026-05-18", type: "contraction", change: -200 }],
  c07: [{ date: "2025-09-24", type: "new", change: 3000 }, { date: "2026-05-06", type: "expansion", change: 1000 }],
  c08: [{ date: "2025-10-07", type: "new", change: 600 }, { date: "2026-06-12", type: "churn", change: -600 }],
  c09: [{ date: "2025-10-21", type: "new", change: 900 }],
  c10: [{ date: "2025-11-05", type: "new", change: 2500 }, { date: "2026-01-20", type: "contraction", change: -500 }, { date: "2026-06-22", type: "expansion", change: 700 }],
  c11: [{ date: "2025-11-18", type: "new", change: 700 }],
  c12: [{ date: "2025-12-09", type: "new", change: 400 }, { date: "2026-03-03", type: "expansion", change: 100 }],
  c13: [{ date: "2026-01-14", type: "new", change: 800 }, { date: "2026-05-25", type: "expansion", change: 200 }],
  c14: [{ date: "2026-02-09", type: "new", change: 1200 }, { date: "2026-06-08", type: "contraction", change: -300 }],
  c15: [{ date: "2026-03-17", type: "new", change: 600 }],
  c16: [{ date: "2026-03-25", type: "new", change: 1500 }],
  c17: [{ date: "2026-04-21", type: "new", change: 900 }],
  c18: [{ date: "2026-05-13", type: "new", change: 2000 }],
  c19: [{ date: "2026-06-03", type: "new", change: 700 }],
  c20: [{ date: "2026-06-16", type: "new", change: 1100 }],
};
const CUSTOMERS = Object.keys(CUSTOMER_STORIES);
/** Plan and product catalogues. A customer's plan follows its number: c01 Starter, c02 Pro, c03 Enterprise, c04 Starter ... */
export const PLANS = ["plan_starter", "plan_pro", "plan_enterprise"];
export const PRODUCTS = ["prod_core", "prod_analytics", "prod_automation"];
export const planOf = (c: string) => PLANS[(Number(c.slice(1)) - 1) % PLANS.length];
/** Seats per license, by product position: Core 7 of 10, Analytics 3 of 5, Automation 2 of 5. */
export const SEATS: Array<[purchased: number, assigned: number]> = [[10, 7], [5, 3], [5, 2]];
/**
 * A customer that came and went before the window: active on 2025-06-30 (the
 * one-year lag of June 2026) and churned in November 2025. Generated after the
 * main stories with the second PRNG so the original rows do not move.
 */
export const PRIOR_CUSTOMERS: Record<string, Movement[]> = {
  c21: [{ date: "2025-05-12", type: "new", change: 900 }, { date: "2025-11-12", type: "churn", change: -900 }],
};
const storyOf = (c: string) => CUSTOMER_STORIES[c] ?? PRIOR_CUSTOMERS[c];

/**
 * Contracts ending in June 2026. c08 lets its contract lapse (it churns on
 * 2026-06-12), c11 renews by hand after a late notice, c12 renews automatically.
 * Every other subscription runs 12 months from acquisition.
 */
export interface Renewal { end: string; renewed: boolean; auto: boolean; notified: boolean; trigger: string; complete: string | null; forecast: number; amount: number }
export const RENEWALS: Record<string, Renewal> = {
  c08: { end: "2026-06-07", renewed: false, auto: false, notified: true, trigger: "2026-05-08", complete: null, forecast: 7200, amount: 0 },
  c11: { end: "2026-06-18", renewed: true, auto: false, notified: false, trigger: "2026-05-19", complete: "2026-06-16", forecast: 9000, amount: 8400 },
  c12: { end: "2026-06-09", renewed: true, auto: true, notified: true, trigger: "2026-05-10", complete: "2026-06-02", forecast: 6000, amount: 6000 },
};
const subscriptionOf = (c: string) => "s" + c.slice(1);
/** Customers acquired in the window spend 14 days in trial first. */
const TRIAL_DAYS = 14;

/** Opportunities: one closed_won per in-window customer, plus lost and open deals. */
export interface Deal {
  id: string; close: string; outcome: "closed_won" | "closed_lost" | "open"; customer?: string; amount: number; openStage?: string;
  revenueType?: "subscription" | "services"; source?: "marketing" | "sales" | "partner"; channel?: string; partner?: string;
}
export const DEALS: Deal[] = [
  ...CUSTOMERS.filter((c) => CUSTOMER_STORIES[c][0].date >= START).map((c, i): Deal => ({
    id: `o${pad(i + 1)}`, close: CUSTOMER_STORIES[c][0].date, outcome: "closed_won", customer: c, amount: CUSTOMER_STORIES[c][0].change * 12,
  })),
  { id: "o09", close: "2026-01-22", outcome: "closed_lost", amount: 18000 },
  { id: "o10", close: "2026-02-17", outcome: "closed_lost", amount: 9600 },
  { id: "o11", close: "2026-03-09", outcome: "closed_lost", amount: 24000 },
  { id: "o12", close: "2026-04-14", outcome: "closed_lost", amount: 12000 },
  { id: "o13", close: "2026-05-20", outcome: "closed_lost", amount: 30000 },
  { id: "o14", close: "2026-06-09", outcome: "closed_lost", amount: 8400 },
  { id: "o15", close: "2026-06-24", outcome: "closed_lost", amount: 15000 },
  { id: "o16", close: "2026-06-26", outcome: "closed_lost", amount: 21000 },
  // Open deals whose expected close date sits in June: the stage filter must exclude them.
  { id: "o17", close: "2026-06-28", outcome: "open", amount: 27000, openStage: "negotiation" },
  { id: "o18", close: "2026-07-15", outcome: "open", amount: 14400, openStage: "proposal" },
];
/**
 * Attribution on the deals above. o07 (c19) is marketing sourced from paid ads,
 * o08 (c20) is partner sourced through p02 via a marketplace listing, o15 is a
 * lost services deal and o18 open services pipeline. Every other deal is a
 * sales-sourced subscription deal from the direct channel.
 */
export const DEAL_TAGS: Record<string, Partial<Deal>> = {
  o07: { source: "marketing", channel: "paid_ads" },
  o08: { source: "partner", channel: "marketplace", partner: "p02" },
  o15: { revenueType: "services" },
  o17: { source: "marketing", channel: "content" },
  o18: { revenueType: "services" },
};
/**
 * Deals generated after the main stories with the second PRNG: a won services
 * engagement, and a partner deal won in June 2025 (the one-year lag of June 2026).
 */
export const EXTRA_DEALS: Deal[] = [
  { id: "o19", close: "2026-04-28", outcome: "closed_won", customer: "c04", amount: 36000, revenueType: "services", source: "sales", channel: "direct" },
  { id: "o20", close: "2025-06-18", outcome: "closed_won", customer: "c21", amount: 9600, source: "partner", channel: "referral", partner: "p01" },
  { id: "o21", close: "2026-03-12", outcome: "closed_lost", amount: 22000, revenueType: "services", source: "sales", channel: "direct" },
];
const DEAL_LENGTH = 45;
const STAGES = ["qualification", "discovery", "proposal", "negotiation"];

/** Monthly costs by function; each lands on a fixed day of the month. */
export const MONTHLY_COSTS: Array<{ day: number; cost_function: string; cost_centre: string; cost_type: string; amounts: number[] }> = [
  { day: 15, cost_function: "gtm", cost_centre: "marketing", cost_type: "services", amounts: [3000, 3100, 3600, 3300, 3700, 3800] },
  { day: 20, cost_function: "gtm", cost_centre: "sales", cost_type: "personnel", amounts: [2000, 2100, 2400, 2200, 2400, 2600] },
  { day: 25, cost_function: "infrastructure", cost_centre: "engineering", cost_type: "infrastructure", amounts: [1200, 1250, 1300, 1350, 1400, 1450] },
  { day: 10, cost_function: "support", cost_centre: "support", cost_type: "personnel", amounts: [900, 900, 950, 950, 1000, 1000] },
];

/**
 * Users and their activity pattern. daily: a qualifying event every day;
 * weekly: every Wednesday; monthly: the 10th; retention: signup day plus the
 * listed day offsets. Activity stops while the customer is churned.
 */
export interface UserStory { id: string; customer: string; signup: string; pattern: "daily" | "weekly" | "monthly" | "retention"; offsets?: number[] }
export const USERS: UserStory[] = [
  ...["c01", "c02", "c04", "c07", "c08", "c10"].map((c, i): UserStory => ({ id: `u${pad(i + 1)}`, customer: c, signup: "2025-11-03", pattern: "daily" })),
  ...["c01", "c02", "c03", "c05", "c06", "c09", "c11", "c12"].map((c, i): UserStory => ({ id: `u${pad(i + 7)}`, customer: c, signup: "2025-11-17", pattern: "weekly" })),
  ...["c01", "c04", "c06", "c07", "c09", "c10", "c11", "c12"].map((c, i): UserStory => ({ id: `u${pad(i + 15)}`, customer: c, signup: "2025-12-01", pattern: "monthly" })),
  { id: "u23", customer: "c13", signup: "2026-01-05", pattern: "retention", offsets: [0, 30, 48] },
  { id: "u24", customer: "c13", signup: "2026-01-08", pattern: "retention", offsets: [0, 30] },
  { id: "u25", customer: "c10", signup: "2026-01-12", pattern: "retention", offsets: [0, 29, 53] },
  { id: "u26", customer: "c07", signup: "2026-01-19", pattern: "retention", offsets: [0, 30, 49, 55] },
  { id: "u27", customer: "c09", signup: "2026-01-26", pattern: "retention", offsets: [0, 1, 2] },
  { id: "u28", customer: "c14", signup: "2026-02-11", pattern: "retention", offsets: [0, 30, 51] },
];

// ── derived state ────────────────────────────────────────────────────────────

/** MRR of a customer at the end of a day: the running sum of its movements. */
export function mrrOn(customer: string, day: string): number {
  return storyOf(customer).filter((m) => m.date <= day).reduce((s, m) => s + m.change, 0);
}
export function customerStatusOn(customer: string, day: string): string | undefined {
  const story = storyOf(customer);
  if (day < addDays(story[0].date, -TRIAL_DAYS)) return undefined;
  if (day < story[0].date) return "trial";
  return mrrOn(customer, day) > 0 ? "active" : "churned";
}

// ── generation ───────────────────────────────────────────────────────────────

export interface Fixture { tables: Record<string, Row[]> }

/**
 * Fields added after the seeded rows were pinned. Their stories always set them,
 * and attrsFor never draws for them, so the PRNG sequence (and every pinned
 * value) is unchanged by their addition.
 */
const STORY_ONLY = new Set(["ticket_type", "hire_source", "plan_id", "application_date"]);
export const TICKET_TYPES = ["how_to", "bug", "billing", "how_to", "feature_request", "account", "how_to", "bug", "other"];
export const HIRE_SOURCES = ["referral", "inbound", "sourced", "agency", "inbound", "internal", "campus", "referral", "other"];

/**
 * Row builders over one PRNG. `pools` names the ids a foreign-key field draws
 * from, so a PRNG-filled partner_id or project_id points at a real entity.
 */
function tools(rand: () => number, pools: Record<string, string[]> = {}) {
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  /** PRNG value for a column the stories leave open. */
  const filler = (f: OntologyField, key: string): Value => {
    if (pools[f.id]) return pick(pools[f.id]);
    if (f.values?.length) return pick(f.values);
    switch (f.type) {
      case "boolean": return rand() < 0.6;
      case "integer": return int(1, 20);
      case "decimal": return Math.round(rand() * 100000) / 100;
      case "date": return addDays(START, int(0, 180));
      case "timestamp": return `${addDays(START, int(0, 180))} ${pad(int(8, 18))}:${pad(int(0, 59))}:00`;
      default: return `${f.id}_${key}`;
    }
  };
  /** One row with every ontology field of the dataset: story values first, PRNG for the rest. */
  const row = (dataset: string, key: string, story: Row, attrs?: Row): Row => {
    const r: Row = {};
    for (const f of datasetFields(dataset)) r[f.id] = f.id in story ? story[f.id] : attrs && f.id in attrs ? attrs[f.id] : filler(f, key);
    return r;
  };
  /** Stable per-entity attributes, so a snapshot entity does not change randomly from day to day. */
  const attrsFor = (dataset: string, key: string): Row => {
    const a: Row = {};
    for (const f of datasetFields(dataset)) if (!STORY_ONLY.has(f.id)) a[f.id] = filler(f, key);
    return a;
  };
  return { rand, pick, int, row, attrsFor };
}

export function generateFixture(): Fixture {
  const { rand, pick, int, row, attrsFor } = tools(mulberry32(SEED));
  const days = eachDay(HISTORY_START, END);

  const t: Record<string, Row[]> = Object.fromEntries(Object.keys(TABLES).map((d) => [d, []]));

  // revenue_event, customer, subscription
  let ev = 0;
  const lifecycle: Record<string, string> = { new: "acquisition", expansion: "expansion", contraction: "retention", churn: "retention", reactivation: "reactivation" };
  for (const c of CUSTOMERS) {
    const story = CUSTOMER_STORIES[c];
    let prior = 0;
    for (const m of story) {
      ev++;
      t.revenue_event.push(row("revenue_event", `re${ev}`, {
        event_id: `re${pad(ev)}`, event_date: m.date, customer_id: c, subscription_id: subscriptionOf(c), event_type: m.type,
        mrr_change: m.change, prior_mrr: prior, new_mrr: prior + m.change, currency: "USD", change_nature: "permanent",
        expansion_classification: m.type === "expansion" ? "same_product" : null, lifecycle_attribution: lifecycle[m.type],
      }));
      prior += m.change;
    }
    const acquired = story[0].date;
    const ca = attrsFor("customer", c);
    const sa = attrsFor("subscription", c);
    for (const d of days) {
      const status = customerStatusOn(c, d);
      if (status) t.customer.push(row("customer", c, {
        customer_id: c, snapshot_date: d, customer_status: status, acquisition_date: acquired,
        activation_date: addDays(acquired, 7), onboarding_completion_date: addDays(acquired, 30), last_active_date: d,
      }, ca));
      if (d >= acquired) {
        const mrr = mrrOn(c, d);
        t.subscription.push(row("subscription", c, {
          subscription_id: subscriptionOf(c), customer_id: c, plan_id: planOf(c), snapshot_date: d, mrr, subscription_status: mrr > 0 ? "active" : "cancelled",
          contract_start: acquired, contract_end: RENEWALS[c]?.end ?? addDays(acquired, 365), mrr_start: mrrOn(c, addDays(d, -1)), mrr_end: mrr,
          ...renewalState(c, d),
        }, sa));
      }
    }
  }

  // cost_event
  let ce = 0;
  for (const [mi, month] of MONTHS.entries()) {
    for (const c of MONTHLY_COSTS) {
      ce++;
      t.cost_event.push(row("cost_event", `ce${ce}`, {
        event_id: `ce${pad(ce)}`, event_date: `${month}-${pad(c.day)}`, cost: c.amounts[mi], cost_function: c.cost_function,
        cost_centre: c.cost_centre, cost_type: c.cost_type, currency: "USD", customer_id: null, partner_id: null, project_id: null,
        lifecycle_attribution: c.cost_function === "gtm" ? "acquisition" : "servicing",
      }));
    }
  }

  // financials: one row per month; revenue is the MRR on the first of the month.
  for (const month of MONTHS) {
    const revenue = CUSTOMERS.reduce((s, c) => s + mrrOn(c, `${month}-01`), 0);
    t.financials.push(row("financials", month, {
      period_start: `${month}-01`, revenue, revenue_type: "subscription", ebitda: Math.round(revenue * 0.12),
      net_income: Math.round(revenue * 0.08), operating_cash_flow: Math.round(revenue * 0.15),
      capital_expenditures: Math.round(revenue * 0.03), bad_debt_expense: Math.round(revenue * 0.005),
    }));
  }

  // opportunity: daily snapshots from creation; stage advances weekly, then closes on close_date.
  const opportunityRows = (deal: Deal, a: Row, mk: typeof row) => {
    const created = addDays(deal.close, -DEAL_LENGTH);
    const tags = { ...deal, ...DEAL_TAGS[deal.id] };
    for (const d of eachDay(created, END)) {
      const closed = deal.outcome !== "open" && d >= deal.close;
      const stage = closed ? deal.outcome : deal.outcome === "open" && daysBetween(created, d) >= 21 ? deal.openStage! : STAGES[Math.min(3, Math.floor(daysBetween(created, d) / 7))];
      t.opportunity.push(mk("opportunity", deal.id, {
        opportunity_id: deal.id, snapshot_date: d, opportunity_stage: stage, close_date: deal.close, opportunity_created_date: created,
        opportunity_amount: deal.amount, customer_id: deal.customer ?? null, revenue_type: tags.revenueType ?? "subscription",
        forecast_category: closed ? "closed" : stage === "negotiation" ? "commit" : "pipeline",
        marketing_source: tags.source ?? "sales", channel: tags.channel ?? "direct",
        partner_sourced: tags.source === "partner", partner_id: tags.partner ?? null,
      }, a));
    }
  };
  for (const deal of DEALS) opportunityRows(deal, attrsFor("opportunity", deal.id), row);

  // lead: six a month from December; two thirds reach MQL after 5 days, half of those SQL after 10 more.
  let ld = 0;
  for (const month of ["2025-12", ...MONTHS]) {
    for (let i = 0; i < 6; i++) {
      ld++;
      const id = `l${pad(ld)}`;
      const created = `${month}-${pad(3 + i * 4)}`;
      const mql = rand() < 0.67 ? addDays(created, 5) : null;
      const sql = mql && rand() < 0.5 ? addDays(mql, 10) : null;
      const a = attrsFor("lead", id);
      for (const d of eachDay(maxDate(created, START), END)) {
        const stage = sql && d >= sql ? "sql" : mql && d >= mql ? "mql" : !mql && daysBetween(created, d) > 20 ? "disqualified" : "lead";
        t.lead.push(row("lead", id, { lead_id: id, snapshot_date: d, lead_created_date: created, mql_date: mql, sql_date: sql, lead_stage: stage, lead_source: pick(["webinar", "content", "outbound", "referral"]) }, a));
      }
    }
  }

  // user and product_event
  let pe = 0;
  for (const u of USERS) {
    const a = attrsFor("user", u.id);
    const active = (d: string) => customerStatusOn(u.customer, d) === "active";
    for (const d of eachDay(maxDate(u.signup, START), END)) {
      t.user.push(row("user", u.id, {
        user_id: u.id, customer_id: u.customer, snapshot_date: d, signup_date: u.signup, first_use_date: u.signup,
        activation_date: addDays(u.signup, 3), user_status: active(d) ? "active" : "deactivated",
      }, a));
    }
    const activity =
      u.pattern === "retention" ? u.offsets!.map((o) => addDays(u.signup, o))
      : eachDay(START, END).filter((d) => u.pattern === "daily" || (u.pattern === "weekly" ? weekday(d) === 3 : d.endsWith("-10")));
    for (const d of activity) {
      if (!active(d) && u.pattern !== "retention") continue;
      for (const type of ["qualifying", "login"]) {
        pe++;
        t.product_event.push(row("product_event", `pe${pe}`, {
          event_id: `pe${pe}`, event_date: d, user_id: u.id, customer_id: u.customer, signup_date: u.signup,
          product_event_type: type, session_id: `ss_${u.id}_${d}`, feature_id: pick(["f_reports", "f_dashboards", "f_alerts", "f_api"]),
          session_duration: int(60, 3600), usage_count: int(1, 12),
        }));
      }
    }
  }

  // survey_response: four customer NPS responses a month, plus onboarding and employee surveys.
  let sr = 0;
  for (const month of MONTHS) {
    const pool = CUSTOMERS.filter((c) => customerStatusOn(c, `${month}-01`) === "active");
    for (let i = 0; i < 6; i++) {
      sr++;
      const type = i < 4 ? "customer" : i === 4 ? "onboarding" : "employee";
      t.survey_response.push(row("survey_response", `sr${sr}`, {
        response_id: `sr${pad(sr)}`, survey_date: `${month}-${pad(4 + i * 4)}`, survey_type: type,
        customer_id: type === "employee" ? null : pick(pool), employee_id: type === "employee" ? `e${int(1, 30)}` : null,
        nps_score: int(3, 10), lead_id: null, partner_id: null, project_id: null, survey_completed: true,
      }));
    }
  }

  // ticket: five a month with plausible response and resolution times.
  let tk = 0;
  for (const month of MONTHS) {
    for (let i = 0; i < 5; i++) {
      tk++;
      const created = `${month}-${pad(2 + i * 5)} ${pad(int(8, 16))}:00:00`;
      const at = (h: number) => new Date(Date.parse(created.replace(" ", "T") + "Z") + h * 3600000).toISOString().replace("T", " ").slice(0, 19);
      const resolved = i < 4;
      t.ticket.push(row("ticket", `t${tk}`, {
        ticket_id: `t${pad(tk)}`, created_at: created, customer_id: pick(CUSTOMERS.slice(0, 12)), agent_id: `a${int(1, 3)}`,
        ticket_type: TICKET_TYPES[(tk - 1) % TICKET_TYPES.length],
        first_response_at: at(int(1, 6)), first_response_due_at: at(4), resolution_due_at: at(48), resolved_at: resolved ? at(int(4, 72)) : null,
        ticket_status: resolved ? "resolved" : "open", escalated: rand() < 0.2, reopened: rand() < 0.1, resolved_first_contact: rand() < 0.5,
      }));
    }
  }

  // A ticket created late on the last day of June: a timestamp after midnight of the period end must still count.
  // Every field comes from the story, so no PRNG draw.
  t.ticket.push(row("ticket", "t_late", {
    ticket_id: "t_late", created_at: "2026-06-30 18:00:00", customer_id: "c01", agent_id: "a1", ticket_type: "bug",
    first_response_at: "2026-06-30 19:00:00", first_response_due_at: "2026-06-30 22:00:00", resolution_due_at: "2026-07-02 18:00:00", resolved_at: null,
    ticket_status: "open", escalated: false, reopened: false, resolved_first_contact: false,
  }));

  generateExtensions(t);
  for (const ds of SEGMENT_DATASETS) for (const r of t[ds] ?? []) r.segment = segmentOf(r.customer_id as string | null);
  return { tables: t };
}

/** The datasets that carry `segment`; a post-pass sets it from customer_id so no PRNG draw moves. */
const SEGMENT_DATASETS = ["revenue_event", "contract_event", "amendment_event", "customer", "subscription"];
const SEGMENTS = ["enterprise", "smb", "mid_market"];

/** Deterministic segment by customer number: c01 smb, c02 mid_market, c03 enterprise, c04 smb and so on. */
export function segmentOf(customer: string | null): string | null {
  const n = customer?.match(/^c(\d+)$/)?.[1];
  return n === undefined ? null : SEGMENTS[Number(n) % 3];
}

/** Renewal fields of a subscription on a day: set for the contracts in RENEWALS, empty otherwise. */
function renewalState(c: string, d: string): Row {
  const r = RENEWALS[c];
  if (!r) return { renewed: false, auto_renewed: false, renewal_notified_on_time: null, renewal_trigger_date: null, renewal_complete_date: null, forecast_renewal_amount: null, renewal_amount: null };
  const done = r.complete !== null && d >= r.complete;
  return {
    renewed: done && r.renewed, auto_renewed: done && r.auto, renewal_notified_on_time: d >= r.trigger ? r.notified : null,
    renewal_trigger_date: r.trigger, renewal_complete_date: done ? r.complete : null,
    forecast_renewal_amount: r.forecast, renewal_amount: done ? r.amount : null,
  };
}

// ── extensions: datasets added after the first eleven ────────────────────────
//
// Everything below draws from a second PRNG (SEED + 1), so adding it left every
// row of the original eleven datasets as it was.

const monthEnd = (m: string) => addDays(`${nextMonth(m)}-01`, -1);
function nextMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`;
}
const weekdays = (from: string, to: string) => eachDay(from, to).filter((d) => weekday(d) >= 1 && weekday(d) <= 5);
/** "2026-06-03" plus h hours and m minutes, as a timestamp string. */
export function at(day: string, h: number, m = 0): string {
  const ms = Date.parse(day + "T00:00:00Z") + (h * 60 + m) * 60000;
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${pad(i + 1)}`);

export const EMPLOYEES = ids("e", 24);
export const PARTNERS = ids("p", 10);
export const PROJECTS = ids("pr", 12);
export const CONSULTANTS = ids("k", 6);
export const FEATURES = ["f_reports", "f_dashboards", "f_alerts", "f_api", "f_sso", "f_audit"];
const REPS = ids("rep", 5);

/**
 * Services projects. pr07, pr08 and pr09 complete in June 2026; pr10 to pr12
 * are still running on 2026-06-30. Revenue, cost and hours follow the index so
 * the June project margin can be read off this table.
 */
export interface ProjectStory { id: string; customer: string; consultant: string; start: string; closed: string; target: string; completion: string | null; revenue: number; cost: number; budgeted: number; actual: number }
export const PROJECT_STORIES: ProjectStory[] = PROJECTS.map((id, i) => {
  const start = addDays("2026-01-05", 14 * i);
  const completion = addDays(start, 55 + 5 * (i % 4));
  const revenue = 20000 + 2500 * i;
  const budgeted = 300 + 20 * i;
  return {
    id, customer: CUSTOMERS[i % CUSTOMERS.length], consultant: CONSULTANTS[i % CONSULTANTS.length], start,
    closed: addDays(start, -(7 + 3 * (i % 3))), target: addDays(start, 60), completion: completion <= END ? completion : null,
    revenue, cost: Math.round(revenue * [0.55, 0.62, 0.7][i % 3]), budgeted, actual: Math.round(budgeted * [0.9, 1, 1.15][i % 3]),
  };
});

/** Monthly costs the extension metrics read (services delivery, partner programme, recruiting and so on). */
export const EXTRA_MONTHLY_COSTS: Array<{ day: number; cost_function: string; cost_centre: string; cost_type: string; amounts: number[] }> = [
  { day: 12, cost_function: "services_delivery", cost_centre: "services", cost_type: "personnel", amounts: [2600, 2800, 3100, 3000, 3700, 3900] },
  { day: 14, cost_function: "general_administrative", cost_centre: "general", cost_type: "personnel", amounts: [2500, 2500, 2600, 2600, 2700, 2700] },
  { day: 16, cost_function: "research_development", cost_centre: "engineering", cost_type: "personnel", amounts: [4200, 4300, 4300, 4500, 4600, 4800] },
  { day: 18, cost_function: "partner_program", cost_centre: "partnerships", cost_type: "services", amounts: [600, 650, 700, 700, 750, 800] },
  { day: 22, cost_function: "partner_commission", cost_centre: "partnerships", cost_type: "other", amounts: [0, 0, 0, 0, 0, 1320] },
  { day: 24, cost_function: "recruiting", cost_centre: "people", cost_type: "services", amounts: [800, 900, 1100, 1000, 950, 1200] },
  { day: 26, cost_function: "onboarding", cost_centre: "customer_success", cost_type: "personnel", amounts: [700, 750, 800, 850, 900, 950] },
];
/** Services revenue recognised each month, a second financials row beside subscription revenue. */
export const SERVICES_REVENUE = [4000, 4500, 5200, 4800, 6100, 6600];

/** Two incidents a month. Minutes after start: detected, acknowledged (after detection), resolved. */
export const INCIDENTS = MONTHS.flatMap((month, mi) => [0, 1].map((k) => {
  const i = mi * 2 + k;
  return {
    id: `inc${pad(i + 1)}`, start: at(`${month}-${pad(6 + 12 * k)}`, 9 + 3 * k, 15),
    detect: 10 + 5 * (i % 3), ack: 5 + 2 * (i % 4), resolve: 90 + 30 * (i % 5),
    type: month === "2026-06" && k === 1 ? "security" : (["availability", "performance", "data"] as const)[i % 3],
    severity: (["sev2", "sev3", "sev1", "sev4"] as const)[i % 4],
  };
}));

/** Partners: recruited date, the day they turn active (null: never), churn date. */
export const PARTNER_STORIES: Record<string, { recruited: string; active: string | null; churned: string | null }> = {
  p01: { recruited: "2025-03-10", active: "2025-04-01", churned: null },
  p02: { recruited: "2025-05-14", active: "2025-06-01", churned: null },
  p03: { recruited: "2025-07-02", active: "2025-08-01", churned: null },
  p04: { recruited: "2025-08-20", active: "2025-09-15", churned: null },
  p05: { recruited: "2025-10-06", active: "2025-11-01", churned: null },
  p06: { recruited: "2025-11-17", active: "2025-12-15", churned: null },
  p07: { recruited: "2026-02-10", active: "2026-03-01", churned: null },
  p08: { recruited: "2026-06-04", active: null, churned: null },
  p09: { recruited: "2025-06-23", active: "2025-07-15", churned: "2026-06-15" },
  p10: { recruited: "2025-09-08", active: "2025-10-01", churned: "2026-03-20" },
};

function generateExtensions(t: Record<string, Row[]>): void {
  const pools: Record<string, string[]> = {
    customer_id: CUSTOMERS, subscription_id: CUSTOMERS.map(subscriptionOf), employee_id: EMPLOYEES, partner_id: PARTNERS,
    project_id: PROJECTS, consultant_id: CONSULTANTS, feature_id: FEATURES, rep_id: REPS, user_id: USERS.map((u) => u.id),
  };
  const { rand, pick, int, row, attrsFor } = tools(mulberry32(SEED + 1), pools);
  /** Daily snapshot rows of one entity from `from` (no earlier than START) to END; `state` gives what changes by day. */
  const daily = (ds: string, id: string, from: string, story: Row, state?: (d: string) => Row | null) => {
    const a = attrsFor(ds, id);
    for (const d of eachDay(maxDate(from, START), END)) {
      const s = state ? state(d) : {};
      if (s === null) continue;
      t[ds].push(row(ds, id, { ...story, ...s, [DATASETS[ds].date]: d }, a));
    }
  };

  // c21: customer, subscription and revenue events from HISTORY_START.
  for (const [c, story] of Object.entries(PRIOR_CUSTOMERS)) {
    let prior = 0;
    for (const m of story) {
      t.revenue_event.push(row("revenue_event", `re_${c}_${m.date}`, {
        event_id: `re_${c}_${m.date}`, event_date: m.date, customer_id: c, subscription_id: subscriptionOf(c), event_type: m.type,
        mrr_change: m.change, prior_mrr: prior, new_mrr: prior + m.change, currency: "USD", change_nature: "permanent",
        expansion_classification: null, lifecycle_attribution: m.type === "new" ? "acquisition" : "retention",
      }));
      prior += m.change;
    }
    const acquired = story[0].date;
    const ca = attrsFor("customer", c);
    const sa = attrsFor("subscription", c);
    for (const d of eachDay(HISTORY_START, END)) {
      const status = customerStatusOn(c, d);
      if (status) t.customer.push(row("customer", c, {
        customer_id: c, snapshot_date: d, customer_status: status, acquisition_date: acquired,
        activation_date: addDays(acquired, 7), onboarding_completion_date: addDays(acquired, 30), last_active_date: status === "active" ? d : story[1].date,
      }, ca));
      if (d >= acquired) {
        const mrr = mrrOn(c, d);
        t.subscription.push(row("subscription", c, {
          subscription_id: subscriptionOf(c), customer_id: c, plan_id: planOf(c), snapshot_date: d, mrr, subscription_status: mrr > 0 ? "active" : "cancelled",
          contract_start: acquired, contract_end: addDays(acquired, 365), mrr_start: mrrOn(c, addDays(d, -1)), mrr_end: mrr, ...renewalState(c, d),
        }, sa));
      }
    }
  }

  // revenue_event: the June renewals, with no MRR change.
  for (const [c, r] of Object.entries(RENEWALS)) {
    if (!r.renewed || !r.complete) continue;
    const mrr = mrrOn(c, r.complete);
    t.revenue_event.push(row("revenue_event", `re_${c}_renewal`, {
      event_id: `re_${c}_renewal`, event_date: r.complete, customer_id: c, subscription_id: subscriptionOf(c), event_type: "renewal",
      mrr_change: 0, prior_mrr: mrr, new_mrr: mrr, currency: "USD", change_nature: "permanent", expansion_classification: null, lifecycle_attribution: "retention",
    }));
  }

  // opportunity: the extra deals.
  for (const deal of EXTRA_DEALS) {
    const a = attrsFor("opportunity", deal.id);
    const created = addDays(deal.close, -DEAL_LENGTH);
    for (const d of eachDay(created, END)) {
      const closed = d >= deal.close;
      const stage = closed ? deal.outcome : STAGES[Math.min(3, Math.floor(daysBetween(created, d) / 7))];
      t.opportunity.push(row("opportunity", deal.id, {
        opportunity_id: deal.id, snapshot_date: d, opportunity_stage: stage, close_date: deal.close, opportunity_created_date: created,
        opportunity_amount: deal.amount, customer_id: deal.customer ?? null, revenue_type: deal.revenueType ?? "subscription",
        forecast_category: closed ? "closed" : stage === "negotiation" ? "commit" : "pipeline",
        marketing_source: deal.source ?? "sales", channel: deal.channel ?? "direct", partner_sourced: deal.source === "partner", partner_id: deal.partner ?? null,
      }, a));
    }
  }

  // cost_event and financials: services, partner, people and overhead lines.
  for (const [mi, month] of MONTHS.entries()) {
    for (const c of EXTRA_MONTHLY_COSTS) {
      const id = `ce_${c.cost_function}_${month}`;
      t.cost_event.push(row("cost_event", id, {
        event_id: id, event_date: `${month}-${pad(c.day)}`, cost: c.amounts[mi], cost_function: c.cost_function, cost_centre: c.cost_centre,
        cost_type: c.cost_type, currency: "USD", customer_id: null, partner_id: c.cost_function.startsWith("partner") ? "p02" : null, project_id: null,
        lifecycle_attribution: c.cost_function === "partner_program" ? "acquisition" : "servicing",
      }));
    }
    t.financials.push(row("financials", `${month}_services`, {
      period_start: `${month}-01`, revenue: SERVICES_REVENUE[mi], revenue_type: "services", ebitda: null, net_income: null,
      operating_cash_flow: null, capital_expenditures: null, bad_debt_expense: null,
    }));
  }

  // user and product_event: a dormant user who comes back in June, a June signup
  // with activity only after the window, and action and error events.
  const extraUsers = [
    { id: "u29", customer: "c11", signup: "2025-10-06", back: "2026-06-17" },
    { id: "u30", customer: "c18", signup: "2026-06-08", back: null },
  ];
  for (const u of extraUsers) {
    const a = attrsFor("user", u.id);
    for (const d of eachDay(maxDate(u.signup, START), END)) {
      t.user.push(row("user", u.id, {
        user_id: u.id, customer_id: u.customer, snapshot_date: d, signup_date: u.signup, first_use_date: u.signup,
        activation_date: addDays(u.signup, 3), user_status: u.back && d < u.back ? "dormant" : "active",
      }, a));
    }
  }
  const productEvent = (id: string, d: string, user: string, customer: string, signup: string, type: string) =>
    t.product_event.push(row("product_event", id, {
      event_id: id, event_date: d, user_id: user, customer_id: customer, signup_date: signup, product_event_type: type,
      session_id: `ss_${user}_${d}`, feature_id: pick(FEATURES), session_duration: int(60, 3600), usage_count: int(1, 12),
    }));
  productEvent("pe_u29_back", "2026-06-17", "u29", "c11", "2025-10-06", "reactivation");
  // u30 returns on day 30 and day 52, both after the window, so June MAU is unchanged.
  for (const o of [30, 52]) productEvent(`pe_u30_${o}`, addDays("2026-06-08", o), "u30", "c18", "2026-06-08", "qualifying");
  for (const u of USERS.filter((x) => x.pattern === "daily")) {
    for (const d of weekdays(START, END)) {
      if (customerStatusOn(u.customer, d) !== "active") continue;
      if (weekday(d) === 1 || weekday(d) === 4) productEvent(`pe_${u.id}_${d}_action`, d, u.id, u.customer, u.signup, "action");
      if (d.endsWith("-15") || d.endsWith("-02")) productEvent(`pe_${u.id}_${d}_error`, d, u.id, u.customer, u.signup, "error");
    }
  }

  // survey_response: partner, project and prospect surveys, two of each a month.
  for (const [mi, month] of MONTHS.entries()) {
    for (let i = 0; i < 6; i++) {
      const type = (["partner", "project", "prospect"] as const)[i % 3];
      const id = `sr_${month}_${i}`;
      t.survey_response.push(row("survey_response", id, {
        response_id: id, survey_date: `${month}-${pad(3 + i * 4)}`, survey_type: type, customer_id: type === "project" ? pick(CUSTOMERS.slice(0, 12)) : null,
        employee_id: null, lead_id: type === "prospect" ? `l${pad(mi * 6 + i + 1)}` : null, partner_id: type === "partner" ? PARTNERS[(mi + i) % 7] : null,
        project_id: type === "project" ? PROJECTS[(mi * 2 + i) % 12] : null, nps_score: int(4, 10), satisfaction_score: int(2, 5), survey_completed: true,
      }));
    }
  }

  // contract_event and amendment_event from the customer stories.
  for (const c of CUSTOMERS) {
    for (const m of CUSTOMER_STORIES[c]) {
      const id = `ct_${c}_${m.date}`;
      const type = m.type === "new" ? "new_contract" : m.type === "churn" ? "cancellation" : "amendment";
      const start = CUSTOMER_STORIES[c][0].date;
      t.contract_event.push(row("contract_event", id, {
        event_id: id, event_date: m.date, customer_id: c, subscription_id: subscriptionOf(c), contract_event_type: type, currency: "USD",
        contract_start: type === "new_contract" ? m.date : start, contract_end: RENEWALS[c]?.end ?? addDays(start, 365),
        acv: type === "cancellation" ? 0 : Math.abs(m.change) * 12, tcv: type === "cancellation" ? 0 : Math.abs(m.change) * 12,
      }));
      if (m.type === "expansion" || m.type === "contraction") {
        const amendment = m.type === "contraction" ? "downgrade" : c === "c10" ? "cross_sell" : c === "c07" ? "add_on" : "upgrade";
        t.amendment_event.push(row("amendment_event", `am_${c}_${m.date}`, {
          event_id: `am_${c}_${m.date}`, event_date: m.date, customer_id: c, subscription_id: subscriptionOf(c), amendment_type: amendment,
          mrr_change: m.change, change_nature: "permanent", lifecycle_attribution: m.type === "expansion" ? "expansion" : "retention",
          expansion_classification: m.type === "expansion" ? (amendment === "cross_sell" ? "new_module" : "same_product") : null,
        }));
      }
    }
    const r = RENEWALS[c];
    if (r?.renewed && r.complete) {
      t.contract_event.push(row("contract_event", `ct_${c}_renewal`, {
        event_id: `ct_${c}_renewal`, event_date: r.complete, customer_id: c, subscription_id: subscriptionOf(c), contract_event_type: "renewal",
        currency: "USD", contract_start: r.end, contract_end: addDays(r.end, 365), acv: r.amount, tcv: r.amount,
      }));
    }
  }

  // employee: 18 hired before the window, six during it; four leave.
  const leavers: Record<string, { date: string; type: "voluntary" | "involuntary" }> = {
    e05: { date: "2026-03-15", type: "voluntary" }, e07: { date: "2026-06-10", type: "involuntary" },
    e11: { date: "2026-06-22", type: "voluntary" }, e19: { date: "2026-04-06", type: "voluntary" },
  };
  const departments = ["engineering", "sales", "marketing", "customer_success", "finance", "people"];
  const levels = ["individual_contributor", "individual_contributor", "manager", "individual_contributor", "director", "vp"];
  for (const [i, e] of EMPLOYEES.entries()) {
    const hire = i < 18 ? addDays("2023-09-04", 45 * i) : ["2026-01-12", "2026-02-09", "2026-03-16", "2026-04-13", "2026-05-11", "2026-06-08"][i - 18];
    const salary = 60000 + 4000 * i;
    const leaver = leavers[e];
    daily("employee", e, hire, {
      employee_id: e, hire_date: hire, application_date: addDays(hire, -(21 + 7 * (i % 5))), hire_source: HIRE_SOURCES[i % HIRE_SOURCES.length], department: departments[i % 6], job_level: levels[i % 6], salary,
      market_midpoint: Math.round(salary * [0.95, 1, 1.08][i % 3]), underrepresented_group: i % 3 === 0, is_high_performer: i % 4 === 0,
      performance_rating: 2.5 + (i % 5) * 0.5, termination_type: leaver?.type ?? null,
    }, (d) => ({
      employee_status: leaver && d >= leaver.date ? "terminated" : e === "e03" && d >= "2026-05-04" && d <= "2026-05-29" ? "on_leave" : "active",
      termination_date: leaver && d >= leaver.date ? leaver.date : null,
    }));
  }

  // requisition: one opened every two weeks; rq04 and rq10 close unfilled.
  for (let i = 0; i < 12; i++) {
    const id = `rq${pad(i + 1)}`;
    const opened = addDays("2026-01-06", 14 * i);
    const closedUnfilled = i === 3 || i === 9;
    const filled = closedUnfilled ? null : addDays(opened, [35, 42, 50, 38, 60, 45][i % 6]);
    const hire = filled ? addDays(filled, 14) : null;
    daily("requisition", id, opened, { requisition_id: id, requisition_opened_date: opened }, (d) => {
      const isFilled = filled !== null && d >= filled;
      return {
        requisition_status: isFilled ? "filled" : closedUnfilled && d >= addDays(opened, 40) ? "closed" : "open",
        filled_date: isFilled ? filled : null, hire_date: hire && d >= hire ? hire : null,
        offer_status: isFilled ? "accepted" : i === 5 && d >= addDays(opened, 30) ? "declined" : filled && d >= addDays(filled, -7) ? "extended" : null,
      };
    });
  }

  // partner, deal_registration, partner_activity
  for (const [i, p] of PARTNERS.entries()) {
    const s = PARTNER_STORIES[p];
    daily("partner", p, s.recruited, {
      partner_id: p, partner_recruited_date: s.recruited, partner_tier: (["registered", "silver", "gold", "platinum"] as const)[i % 4],
      certification_status: (["certified", "in_progress", "certified", "none", "expired"] as const)[i % 5], training_completed: i % 3 !== 1,
    }, (d) => ({
      partner_status: s.churned && d >= s.churned ? "churned" : s.active && d >= s.active ? "active" : "recruited",
      partner_churn_date: s.churned && d >= s.churned ? s.churned : null,
    }));
  }
  const registrations = [
    { partner: "p01", registered: "2026-01-12", close: "2026-02-20", outcome: "closed_lost", opp: null },
    { partner: "p03", registered: "2026-02-09", close: "2026-03-25", outcome: "closed_won", opp: null },
    { partner: "p04", registered: "2026-03-16", close: "2026-05-04", outcome: "closed_won", opp: null },
    { partner: "p02", registered: "2026-05-01", close: "2026-06-16", outcome: "closed_won", opp: "o08" },
    { partner: "p05", registered: "2026-05-20", close: "2026-06-26", outcome: "closed_lost", opp: null },
    { partner: "p06", registered: "2026-06-05", close: "2026-07-30", outcome: "open", opp: null },
    { partner: "p07", registered: "2026-06-11", close: "2026-08-14", outcome: "open", opp: null },
  ];
  for (const [i, r] of registrations.entries()) {
    const id = `dr${pad(i + 1)}`;
    daily("deal_registration", id, r.registered, { registration_id: id, partner_id: r.partner, registration_date: r.registered, close_date: r.close, opportunity_id: r.opp }, (d) => ({
      opportunity_stage: r.outcome !== "open" && d >= r.close ? r.outcome : STAGES[Math.min(3, Math.floor(daysBetween(r.registered, d) / 10))],
    }));
  }
  for (const [mi, month] of MONTHS.entries()) {
    for (let k = 0; k < 2; k++) {
      const id = `pa${pad(mi * 2 + k + 1)}`;
      t.partner_activity.push(row("partner_activity", id, {
        activity_id: id, activity_date: `${month}-${pad(8 + 10 * k)}`, partner_id: PARTNERS[(mi + k) % 7],
        partner_activity_type: (["webinar", "event", "content", "campaign"] as const)[(mi * 2 + k) % 4],
      }));
    }
  }

  // project, project_milestone, deliverable
  for (const [i, p] of PROJECT_STORIES.entries()) {
    daily("project", p.id, p.closed, {
      project_id: p.id, customer_id: p.customer, consultant_id: p.consultant, close_date: p.closed, project_start_date: p.start, target_date: p.target,
      project_revenue: p.revenue, project_cost: p.cost, hours_budgeted: p.budgeted, escalated: i % 5 === 2, referenceable: i % 3 !== 2, scope_changed: i % 4 === 1,
    }, (d) => {
      const done = p.completion !== null && d >= p.completion;
      return { project_completion_date: done ? p.completion : null, hours_actual: done ? p.actual : Math.round(p.actual * Math.min(1, Math.max(0, daysBetween(p.start, d)) / daysBetween(p.start, p.completion ?? addDays(p.start, 70)))) };
    });
    for (let j = 0; j < 3; j++) {
      const id = `pm_${p.id}_${j + 1}`;
      const planned = addDays(p.start, 15 + 20 * j);
      const actual = addDays(planned, [-2, 0, 4, 7][(i + j) % 4]);
      daily("project_milestone", id, p.start, { project_milestone_id: id, project_id: p.id, planned_date: planned }, (d) => ({ actual_date: d >= actual ? actual : null }));
    }
    for (let j = 0; j < 2; j++) {
      const id = `dl_${p.id}_${j + 1}`;
      daily("deliverable", id, addDays(p.start, 20 + 20 * j), { deliverable_id: id, project_id: p.id, reworked: (i + j) % 4 === 1 });
    }
  }

  // consultant capacity (8 hours a weekday) and time entries (one 8-hour entry a weekday each).
  for (const month of MONTHS) {
    for (const k of CONSULTANTS) {
      t.consultant.push(row("consultant", `${k}_${month}`, { consultant_id: k, period_start: `${month}-01`, available_hours: weekdays(`${month}-01`, monthEnd(month)).length * 8 }));
    }
  }
  const nonBillable = ["training", "pre_sales", "internal"];
  for (const [di, d] of weekdays(START, END).entries()) {
    for (const [ci, k] of CONSULTANTS.entries()) {
      // k01 to k04 bill three days in four, k05 and k06 one day in two.
      const billable = ci < 4 ? (di + ci) % 4 !== 0 : (di + ci) % 2 === 0;
      const billed = billable ? (weekday(d) === 5 ? 6 : 8) : 0;
      const rate = ci < 3 ? 200 : 175;
      const id = `te_${k}_${d}`;
      t.time_entry.push(row("time_entry", id, {
        entry_id: id, entry_date: d, consultant_id: k, project_id: billable ? PROJECTS[(ci + 6 * (di % 2)) % 12] : null, hours: 8,
        time_entry_type: billable ? "billable" : nonBillable[(di + ci) % 3], billed_hours: billed, written_off_hours: billable ? 8 - billed : 0,
        standard_rate: rate, billed_revenue: billed * rate * (ci % 2 === 1 ? 0.9 : 1),
      }));
    }
  }

  // onboarding, onboarding_milestone, onboarding_session: one onboarding per customer acquired in the window.
  const inWindow = CUSTOMERS.filter((c) => CUSTOMER_STORIES[c][0].date >= START);
  for (const [i, c] of inWindow.entries()) {
    const id = `ob${pad(i + 1)}`;
    const start = CUSTOMER_STORIES[c][0].date;
    const completion = addDays(start, [24, 28, 35, 31, 26, 38, 29, 33][i]);
    daily("onboarding", id, start, {
      onboarding_id: id, customer_id: c, contract_start: start, onboarding_start_date: start, target_date: addDays(start, 30),
      resource_id: `cs${(i % 3) + 1}`, hours: 20 + 2 * i, steps_total: 10,
    }, (d) => {
      const done = completion <= d;
      return { onboarding_completion_date: done ? completion : null, steps_completed: done ? 10 : Math.min(9, Math.floor(daysBetween(start, d) / 4)) };
    });
    for (const [milestone, offset] of [["kickoff", 0], ["first_value", 10], ["go_live", 21], ["full_adoption", 45]] as const) {
      const d = addDays(start, offset + (i % 3));
      if (d <= END) t.onboarding_milestone.push(row("onboarding_milestone", `${id}_${milestone}`, { onboarding_id: id, milestone_date: d, contract_start: start, onboarding_milestone: milestone }));
    }
    for (let w = 0; w < 4; w++) {
      const d = addDays(start, 2 + 7 * w);
      if (d <= END) t.onboarding_session.push(row("onboarding_session", `${id}_s${w}`, { onboarding_id: id, onboarding_session_date: d, attendees: [3, 2, 0, 4][(i + w) % 4] }));
    }
  }

  // invoice: a monthly invoice to each of the first eight customers active on the 1st, then balance_sheet.
  let inv = 0;
  for (const month of MONTHS) {
    for (const c of CUSTOMERS.slice(0, 8)) {
      if (customerStatusOn(c, `${month}-01`) !== "active") continue;
      inv++;
      const id = `inv${pad(inv)}`;
      const invoiced = `${month}-03`;
      const paid = addDays(invoiced, [12, 20, 28, 45][inv % 4]);
      const amount = mrrOn(c, `${month}-01`);
      daily("invoice", id, invoiced, {
        invoice_id: id, customer_id: c, invoice_date: invoiced, billing_trigger_date: addDays(`${month}-01`, -(inv % 3)), invoice_amount: amount, currency: "USD",
        payment_method: (["credit_card", "ach", "wire", "credit_card", "check"] as const)[inv % 5], invoice_corrected: inv % 6 === 2,
        invoice_disputed: inv % 9 === 4, credit_memo_count: inv % 7 === 3 ? 1 : 0,
      }, (d) => ({ payment_date: d >= paid ? paid : null, payment_status: d >= paid ? "paid" : "unpaid", outstanding_amount: d >= paid ? 0 : amount }));
    }
  }
  // A partially paid June invoice: 1,800 of 3,000 received on 2026-06-20, 1,200 still outstanding.
  // Every field comes from the story (no attrsFor), so no PRNG draw.
  const partialCustomer = CUSTOMERS.slice(0, 8).find((c) => customerStatusOn(c, "2026-06-01") === "active")!;
  for (const d of eachDay("2026-06-10", END)) {
    const part = d >= "2026-06-20";
    t.invoice.push(row("invoice", "inv_partial", {
      invoice_id: "inv_partial", customer_id: partialCustomer, snapshot_date: d, invoice_date: "2026-06-10", billing_trigger_date: "2026-06-08",
      invoice_amount: 3000, currency: "USD", payment_method: "ach", invoice_corrected: false, invoice_disputed: false, credit_memo_count: 0,
      payment_date: null, payment_status: part ? "partial" : "unpaid", outstanding_amount: part ? 1200 : 3000,
    }));
  }
  const receivable = new Map<string, number>();
  for (const r of t.invoice) receivable.set(String(r.snapshot_date), (receivable.get(String(r.snapshot_date)) ?? 0) + Number(r.outstanding_amount));
  for (const [i, d] of eachDay(START, END).entries()) {
    t.balance_sheet.push(row("balance_sheet", d, { snapshot_date: d, cash_balance: 2000000 - 1500 * i, accounts_receivable: receivable.get(d) ?? 0 }));
  }

  // revenue_schedule: recognised MRR per subscription per month; c01, c04, c07 and c10 bill quarterly in advance.
  for (const month of MONTHS) {
    for (const [ci, c] of CUSTOMERS.entries()) {
      const mrr = mrrOn(c, `${month}-01`);
      if (mrr <= 0) continue;
      const quarterly = ci % 3 === 0;
      t.revenue_schedule.push(row("revenue_schedule", `${c}_${month}`, {
        subscription_id: subscriptionOf(c), customer_id: c, period_start: `${month}-01`, recognized_revenue: mrr,
        billed_amount: quarterly ? (["01", "04"].includes(month.slice(5)) ? mrr * 3 : 0) : mrr, recognition_correct: ci % 7 !== 3,
      }));
    }
  }

  // forecast: forecast against actual revenue (subscription plus services) per month.
  for (const [mi, month] of MONTHS.entries()) {
    const actual = CUSTOMERS.reduce((s, c) => s + mrrOn(c, `${month}-01`), 0) + SERVICES_REVENUE[mi];
    t.forecast.push(row("forecast", month, { period_start: `${month}-01`, actual_revenue: actual, forecasted_revenue: Math.round(actual * [1.04, 0.97, 1.02, 1.06, 0.95, 1.03][mi]) }));
  }

  // quote and order: three quotes a month; two in three become orders two days after sending.
  let q = 0;
  for (const month of MONTHS) {
    for (let k = 0; k < 3; k++) {
      const i = q++;
      const id = `q${pad(i + 1)}`;
      const requested = `${month}-${pad(4 + 9 * k)}`;
      const sentHours = [6, 20, 30][k];
      const sent = at(requested, 10 + sentHours);
      const list = 12000 + 1000 * i;
      daily("quote", id, requested, {
        quote_id: id, quote_requested_at: at(requested, 10), quote_sent_at: sent, list_price: list,
        quoted_price: Math.round(list * [0.9, 0.85, 1][i % 3]), revision_count: i % 4 === 1 ? 1 : 0,
      });
      if (i % 3 === 2) continue;
      const received = addDays(sent.slice(0, 10), 2);
      const completed = at(received, 9 + [4, 30][i % 2]);
      if (completed.slice(0, 10) > END) continue;
      daily("order", `or${pad(i + 1)}`, received, {
        order_id: `or${pad(i + 1)}`, quote_id: id, order_received_at: at(received, 9), order_completed_at: completed, has_error: i % 5 === 0,
      });
    }
  }

  // incident, deployment, vulnerability, service_metrics, issue
  for (const inc of INCIDENTS) {
    const startDay = inc.start.slice(0, 10);
    const startMin = Number(inc.start.slice(11, 13)) * 60 + Number(inc.start.slice(14, 16));
    t.incident.push(row("incident", inc.id, {
      incident_id: inc.id, started_at: inc.start, detected_at: at(startDay, 0, startMin + inc.detect),
      acknowledged_at: at(startDay, 0, startMin + inc.detect + inc.ack), resolved_at: at(startDay, 0, startMin + inc.resolve),
      recovery_time: inc.resolve, incident_type: inc.type, severity: inc.severity,
    }));
  }
  // An incident starting at 15:00 on the last day of June and resolved 75 minutes later: it must count in June.
  // Every field comes from the story, so no PRNG draw.
  t.incident.push(row("incident", "inc_late", {
    incident_id: "inc_late", started_at: at("2026-06-30", 15, 0), detected_at: at("2026-06-30", 15, 10),
    acknowledged_at: at("2026-06-30", 15, 15), resolved_at: at("2026-06-30", 16, 15),
    recovery_time: 75, incident_type: "availability", severity: "sev2",
  }));
  let dp = 0;
  for (const [mi, month] of MONTHS.entries()) {
    for (let k = 0; k < 8; k++) {
      dp++;
      const deployed = at(`${month}-${pad(2 + 3 * k)}`, 14);
      t.deployment.push(row("deployment", `dp${pad(dp)}`, {
        deployment_id: `dp${pad(dp)}`, deploy_date: deployed, committed_at: at(`${month}-${pad(2 + 3 * k)}`, 14 - (4 + 6 * (k % 3))),
        incident_id: k === 0 ? INCIDENTS[mi * 2].id : null,
      }));
    }
    for (let k = 0; k < 6; k++) {
      const id = `is${pad(mi * 6 + k + 1)}`;
      t.issue.push(row("issue", id, {
        issue_id: id, created_at: at(`${month}-${pad(3 + 4 * k)}`, 11), issue_type: (["bug", "feature_request", "bug", "question", "bug", "incident"] as const)[k],
        issue_source: (["user_report", "internal", "monitoring"] as const)[k % 3], issue_environment: (["production", "pre_production"] as const)[k % 2],
      }));
    }
    for (const [si, svc] of ["svc_api", "svc_web", "svc_worker"].entries()) {
      const requests = 900000 + int(0, 200000);
      t.service_metrics.push(row("service_metrics", `${svc}_${month}`, {
        service_id: svc, period_start: `${month}-01`, request_count: requests, error_count: Math.round(requests * (0.001 + 0.001 * si)),
        downtime_minutes: (mi + si) % 4 === 0 ? 12 + 5 * si : 0, response_time_ms: 120 + 40 * si + int(0, 60), sla_met: (mi + si) % 4 !== 0,
        utilization: Math.round((0.45 + 0.1 * si + rand() * 0.1) * 1000) / 1000,
      }));
    }
  }
  for (let i = 0; i < 12; i++) {
    const id = `v${pad(i + 1)}`;
    const discovered = at(addDays("2026-01-04", 15 * i), 10);
    const patched = i % 5 === 3 ? null : at(discovered.slice(0, 10), 10 + [30, 72, 120, 200][i % 4]);
    daily("vulnerability", id, discovered.slice(0, 10), { vulnerability_id: id, discovered_at: discovered }, (d) => {
      const done = patched !== null && d >= patched.slice(0, 10);
      return { patched_at: done ? patched : null, vulnerability_status: done ? "patched" : i % 5 === 3 && d >= addDays(discovered.slice(0, 10), 20) ? "accepted" : "open" };
    });
  }

  // feature, release, roadmap_item
  for (const [i, f] of FEATURES.entries()) {
    const planned = addDays("2026-01-20", 30 * i);
    const actual = addDays(planned, [-3, 5, 0, 8, -2, 0][i]);
    daily("feature", f, START, {
      feature_id: f, feature_created_date: addDays("2025-11-01", 20 * i), planned_date: planned, actual_date: actual, release_date: actual,
      first_use_date: addDays(actual, [2, 4, 1, 6, 3, 2][i]), release_id: `r${pad(i * 2 + 1)}`,
    });
  }
  for (const [mi, month] of MONTHS.entries()) {
    for (let k = 0; k < 2; k++) t.release.push(row("release", `r${pad(mi * 2 + k + 1)}`, { release_id: `r${pad(mi * 2 + k + 1)}`, release_date: `${month}-${pad(5 + 15 * k)}` }));
  }
  for (let i = 0; i < 10; i++) daily("roadmap_item", `rm${pad(i + 1)}`, START, { roadmap_item_id: `rm${pad(i + 1)}`, roadmap_item_completed: i % 3 !== 2 });

  // marketing and sales facts: campaigns, reps, knowledge base, web traffic, brand mentions, CRM record quality.
  for (const month of MONTHS) {
    const ps = `${month}-01`;
    for (const [i, cm] of ["cm01", "cm02", "cm03", "cm04"].entries()) {
      t.campaign.push(row("campaign", `${cm}_${month}`, { campaign_id: cm, period_start: ps, channel: (["paid_ads", "email", "events", "paid_ads"] as const)[i], ad_spend: 1500 + int(0, 1500) }));
    }
    for (const [i, rep] of REPS.entries()) {
      const hire = addDays("2025-04-07", 45 * i);
      t.sales_rep.push(row("sales_rep", `${rep}_${month}`, { rep_id: rep, period_start: ps, hire_date: hire, ramped_date: addDays(hire, 80 + 10 * i), quota: 50000, closed_revenue: 20000 + int(0, 40000) }));
    }
    for (const kb of ids("kb", 6)) t.kb_article.push(row("kb_article", `${kb}_${month}`, { article_id: kb, period_start: ps, deflections: int(5, 40) }));
    for (const source of ["organic_search", "paid_search", "paid_social", "social", "email", "referral", "direct", "other"]) {
      t.web_traffic.push(row("web_traffic", `${source}_${month}`, { traffic_source: source, period_start: ps, unique_visitors: int(200, 2000) }));
    }
    for (const [source, competitor] of [["g2", false], ["press", false], ["social", false], ["competitor_a", true], ["competitor_b", true]] as const) {
      t.brand_mention.push(row("brand_mention", `${source}_${month}`, { mention_source: source, period_start: ps, is_competitor: competitor, mention_count: int(3, 60) }));
    }
  }
  for (let i = 0; i < 10; i++) {
    const required = 12;
    daily("crm_record", `rec${pad(i + 1)}`, START, {
      record_id: `rec${pad(i + 1)}`, required_field_count: required, populated_field_count: required - (i % 4),
      sync_status: (["matched", "matched", "mismatched", "matched", "missing"] as const)[i % 5],
    });
  }

  // plan and product catalogues: one snapshot row per day for each.
  for (const [i, p] of PLANS.entries()) {
    daily("plan", p, START, { plan_id: p, plan_name: ["Starter", "Pro", "Enterprise"][i], billing_period: ["monthly", "annual", "annual"][i] });
  }
  for (const [i, p] of PRODUCTS.entries()) {
    daily("product", p, START, { product_id: p, product_name: ["Core", "Analytics", "Automation"][i], product_line: i === 0 ? "platform" : "add_on" });
  }

  // licenses: every customer holds Core; Pro adds Analytics; Enterprise adds Automation.
  // Seats come from SEATS, so June utilisation is a sum over the customers active on END.
  // A license is active while the subscription has MRR and expired (0 assigned) after churn.
  for (const c of CUSTOMERS) {
    const acquired = CUSTOMER_STORIES[c][0].date;
    const products = PRODUCTS.slice(0, PLANS.indexOf(planOf(c)) + 1);
    for (const [k, p] of products.entries()) {
      const id = `lic_${c}_${k + 1}`;
      const [purchased, assigned] = SEATS[k];
      daily("license", id, acquired, { license_id: id, subscription_id: subscriptionOf(c), product_id: p, seats_purchased: purchased }, (d) => {
        const active = mrrOn(c, d) > 0;
        return { license_status: active ? "active" : "expired", seats_assigned: active ? assigned : 0 };
      });
    }
  }

  // contacts: three per customer. The executive sponsor is engaged at even-numbered
  // customers, the champion always, the day-to-day contact never.
  for (const c of CUSTOMERS) {
    const even = Number(c.slice(1)) % 2 === 0;
    const roles: Array<[string, boolean]> = [["executive_sponsor", even], ["champion", true], ["day_to_day", false]];
    for (const [k, [role, engaged]] of roles.entries()) {
      const id = `ct_${c}_${k + 1}`;
      daily("contact", id, CUSTOMER_STORIES[c][0].date, { contact_id: id, customer_id: c, contact_role: role, contact_engaged: engaged });
    }
  }

  // lifecycle events: one Lifecycle_State_Change per customer_status transition in the
  // revenue stories (trial to active on acquisition, active to churned on churn, churned
  // to active on reactivation). Every value comes from the story, so no PRNG draw.
  const TRANSITIONS: Partial<Record<Movement["type"], [prior: string, next: string, category: string]>> = {
    new: ["trial", "active", "activation"], churn: ["active", "churned", "churned"], reactivation: ["churned", "active", "reactivated"],
  };
  let lsc = 0;
  for (const c of [...CUSTOMERS, ...Object.keys(PRIOR_CUSTOMERS)]) {
    for (const m of storyOf(c)) {
      const tr = TRANSITIONS[m.type];
      if (!tr) continue;
      lsc++;
      t.lifecycle_event.push(row("lifecycle_event", `lsc${lsc}`, {
        event_id: `lsc${pad(lsc)}`, event_date: m.date, customer_id: c, prior_state: tr[0], new_state: tr[1], state_category: tr[2],
      }));
    }
  }
}

// ── adapter ──────────────────────────────────────────────────────────────────

/**
 * Adapter schema 1.1 for the fixture: a table per dataset, and one mapping per
 * (field, dataset) pair. Fields that live on several GASP datasets name the
 * dataset; single-dataset fields do not need to.
 */
export function buildAdapter() {
  const mappings: Array<{ gaspField: string; dataset?: string; warehouseRef: string }> = [];
  for (const f of FIELDS) {
    for (const ds of (f.datasets ?? []).filter((d) => TABLES[d])) {
      mappings.push({
        gaspField: f.id,
        ...((f.datasets ?? []).length > 1 ? { dataset: ds } : {}),
        warehouseRef: `${TABLES[ds]}.${columnName(ds, f.id)}`,
      });
    }
  }
  return {
    $schema: "https://gaspwiki.com/schemas/gasp-adapter-v1.json",
    version: "1.1",
    organization: "GASP fixture",
    warehouse: "postgres",
    _instructions: "Generated by test/fixture/generate.ts --adapter. Do not edit by hand.",
    metricOwners: [{ metric: "All Core Metrics", team: "Finance" }],
    datasets: { ...TABLES },
    mappings,
  };
}

if (process.argv[1] && process.argv[1].endsWith("generate.ts") && process.argv.includes("--adapter")) {
  writeFileSync(join(here, "adapter.json"), JSON.stringify(buildAdapter(), null, 2) + "\n");
  console.log("wrote", join(here, "adapter.json"));
}
