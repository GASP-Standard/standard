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

type Value = string | number | boolean | null;
export type Row = Record<string, Value>;
export interface OntologyField { id: string; type: string; datasets?: string[]; values?: string[] }

const here = new URL(".", import.meta.url).pathname;
const ontology = JSON.parse(readFileSync(join(here, "..", "..", "..", "standard", "ontology.json"), "utf-8"));
export const FIELDS: OntologyField[] = ontology.fields;

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
};

/**
 * Columns whose warehouse name differs from the GASP field id. Shared fields get
 * a different column per table on purpose, so a filler that resolves a
 * placeholder against the wrong dataset produces SQL that fails or misreads.
 */
export const COLUMNS: Record<string, Record<string, string>> = {
  customer: { snapshot_date: "as_of_date", customer_status: "lifecycle_status" },
  subscription: { snapshot_date: "snapshot_day", subscription_status: "status" },
  revenue_event: { event_date: "booked_on", customer_id: "account_ref" },
  cost_event: { event_date: "incurred_on" },
  product_event: { event_date: "occurred_on" },
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
const subscriptionOf = (c: string) => "s" + c.slice(1);
/** Customers acquired in the window spend 14 days in trial first. */
const TRIAL_DAYS = 14;

/** Opportunities: one closed_won per in-window customer, plus lost and open deals. */
export interface Deal { id: string; close: string; outcome: "closed_won" | "closed_lost" | "open"; customer?: string; amount: number; openStage?: string }
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
  return CUSTOMER_STORIES[customer].filter((m) => m.date <= day).reduce((s, m) => s + m.change, 0);
}
export function customerStatusOn(customer: string, day: string): string | undefined {
  const story = CUSTOMER_STORIES[customer];
  if (day < addDays(story[0].date, -TRIAL_DAYS)) return undefined;
  if (day < story[0].date) return "trial";
  return mrrOn(customer, day) > 0 ? "active" : "churned";
}

// ── generation ───────────────────────────────────────────────────────────────

export interface Fixture { tables: Record<string, Row[]> }

export function generateFixture(): Fixture {
  const rand = mulberry32(SEED);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const days = eachDay(START, END);

  /** PRNG value for a column the stories leave open. */
  const filler = (f: OntologyField, key: string): Value => {
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
    for (const f of datasetFields(dataset)) a[f.id] = filler(f, key);
    return a;
  };

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
          subscription_id: subscriptionOf(c), customer_id: c, snapshot_date: d, mrr, subscription_status: mrr > 0 ? "active" : "cancelled",
          contract_start: acquired, contract_end: addDays(acquired, 365), mrr_start: mrrOn(c, addDays(d, -1)), mrr_end: mrr,
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
  for (const deal of DEALS) {
    const created = addDays(deal.close, -DEAL_LENGTH);
    const a = attrsFor("opportunity", deal.id);
    for (const d of eachDay(maxDate(created, START), END)) {
      const closed = deal.outcome !== "open" && d >= deal.close;
      const stage = closed ? deal.outcome : deal.outcome === "open" && daysBetween(created, d) >= 21 ? deal.openStage! : STAGES[Math.min(3, Math.floor(daysBetween(created, d) / 7))];
      t.opportunity.push(row("opportunity", deal.id, {
        opportunity_id: deal.id, snapshot_date: d, opportunity_stage: stage, close_date: deal.close, opportunity_created_date: created,
        opportunity_amount: deal.amount, customer_id: deal.customer ?? null, revenue_type: "subscription",
        forecast_category: closed ? "closed" : stage === "negotiation" ? "commit" : "pipeline",
      }, a));
    }
  }

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
        first_response_at: at(int(1, 6)), first_response_due_at: at(4), resolution_due_at: at(48), resolved_at: resolved ? at(int(4, 72)) : null,
        ticket_status: resolved ? "resolved" : "open", escalated: rand() < 0.2, reopened: rand() < 0.1, resolved_first_contact: rand() < 0.5,
      }));
    }
  }

  return { tables: t };
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
