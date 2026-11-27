/**
 * The year-or-renewal test: which revenue counts in MRR and ARR, where the
 * rest is reported and what the start and the end of each kind are reported
 * as (standard/metrics/core.md, MRR; DECISIONS.md 2026-11-26).
 *
 * A subscription counts when its contract runs 12 months or more or when a
 * shorter one renews. A contract renews when it carries a renewal provision
 * or follows an earlier term with no break in access. Product access sold for
 * under 12 months with neither is fixed-term revenue.
 *
 * The two tables in the MRR entry of core.md and the two in the churn article
 * are the rows below, cell for cell: test/recurring.test.ts and the site's
 * consistency suite hold them equal. The module imports nothing, so a browser
 * bundle can read it.
 *
 * Three questions are answered in full for the `classify_revenue` tool and the
 * calculator at /research/does-it-count:
 * - `assessContract`: one contract or charge. The verdict, the amounts, its
 *   first and last day and `places`, every metric it reaches (MRR, ARR, CARR,
 *   Bookings, Billings, ACV, the retention rates, the customer counts and the
 *   lines beside MRR), each a rule the standard prints under that metric.
 * - `assessDeal`: a contract with several lines, each answered by its own kind
 *   and term, with the totals and a bundle price shared out by standalone price.
 * - `assessChange`: a change to a subscription the customer holds (an upgrade,
 *   a price cut, a discount, a move to annual billing, a credit).
 * Each has a query form, so an answer has an address.
 */

export type RevenueKind =
  /** Product access on a plan or a contract */
  | "subscription"
  /** Software licensed for a term, wherever it runs: the vendor's cloud or the customer's premises */
  | "term_licence"
  /** A perpetual licence fee, charged once */
  | "perpetual_licence"
  /** Hardware sold outright, charged once */
  | "hardware"
  /** Product access added to a subscription the customer already holds */
  | "add_on"
  /** A paid pilot or proof of concept */
  | "pilot"
  /** Support, maintenance or a managed service sold on subscription terms */
  | "support"
  /** Usage the contract commits the customer to: a contracted minimum */
  | "committed_usage"
  /** Usage billed beyond a commitment */
  | "usage_above_commitment"
  /** Usage billed in arrears with no commitment */
  | "on_demand_usage"
  /** Credits bought once, an automatic top-up included */
  | "credit_pack"
  /** Credits billed every period until the customer cancels */
  | "recurring_credits"
  /** Delivered work: implementation, consulting, training, a build */
  | "professional_services"
  /** A one-time fee such as setup */
  | "one_time_fee"
  | "free_trial";

export interface RevenueItem {
  kind: RevenueKind;
  /** The length of the contract's term in months. Omit it for a contract with no end date, which runs until the customer cancels */
  termMonths?: number;
  /** The contract carries a renewal provision: it continues unless cancelled or the customer holds an option to renew */
  renews?: boolean;
  /** The contract follows an earlier term with no break in access, which makes it a renewal */
  followsEarlierTerm?: boolean;
}

export type ReportingLine = "MRR and ARR" | "Fixed-term revenue" | "Services Revenue" | "Consumption Revenue" | null;

export interface RecurringVerdict {
  /** In MRR and ARR: yes, for the billed period alone (usage above a commitment) or no */
  counts: "yes" | "period" | "no";
  /** Where the revenue is reported; null for a one-time fee and a free trial, which have no line of their own here */
  line: ReportingLine;
  /** Whether its end can count against Revenue Churn Rate and Gross Revenue Retention */
  canChurn: boolean;
  /** The change_nature of its Revenue_Events, null when it has none */
  changeNature: "permanent" | "temporary" | null;
  /** The answer to "Counts in MRR and ARR?" as the tables print it */
  answer: string;
  /** The answer to "Can churn?" as the tables print it */
  churnAnswer: string;
  /** The rule that decided it, one or two sentences */
  rule: string;
}

/** The term a contract needs to count with no renewal, in months and in days of access */
export const MIN_TERM_MONTHS = 12;
export const MIN_TERM_DAYS = 365;

/** The kinds the year-or-renewal test is applied to, each by its own term */
export const TERM_KINDS: readonly RevenueKind[] = ["subscription", "term_licence", "add_on", "pilot", "support", "committed_usage"];

const FIXED: Omit<RecurringVerdict, "rule"> = {
  counts: "no",
  line: "Fixed-term revenue",
  canChurn: false,
  changeNature: null,
  answer: "No. Fixed-term revenue",
  churnAnswer: "No",
};

function counted(changeNature: "permanent" | "temporary", rule: string): RecurringVerdict {
  return {
    counts: "yes",
    line: "MRR and ARR",
    canChurn: true,
    changeNature,
    answer: "Yes",
    churnAnswer: changeNature === "temporary" ? "Yes, on the day it ends" : "Yes",
    rule,
  };
}

function outside(line: ReportingLine, answer: string, rule: string): RecurringVerdict {
  return { counts: "no", line, canChurn: false, changeNature: null, answer, churnAnswer: "No", rule };
}

/** Whether a contract renews: by its own provision, by having no end date or by following an earlier term */
export function renewable(item: RevenueItem): boolean {
  return Boolean(item.renews || item.followsEarlierTerm || item.termMonths === undefined);
}

/** Apply the test to one thing sold */
export function classifyRevenue(item: RevenueItem): RecurringVerdict {
  switch (item.kind) {
    case "subscription":
    case "term_licence":
    case "add_on":
    case "pilot":
    case "support":
    case "committed_usage": {
      if (item.renews) return counted("permanent", "It renews, so it counts in MRR and ARR at its monthly value from its first day.");
      if (item.termMonths === undefined)
        return counted("permanent", "It has no end date and runs until the customer cancels, so it counts in MRR and ARR from its first day.");
      if (item.followsEarlierTerm)
        return counted(
          "permanent",
          "It follows an earlier term with no break in access, which makes it a renewal. It counts in MRR and ARR from its own start date. An earlier term under 12 months with no renewal stays fixed-term revenue.",
        );
      if (item.termMonths >= MIN_TERM_MONTHS)
        return counted(
          "temporary",
          "It runs 12 months or more, so it counts in MRR and ARR with no renewal. Its end is known in advance and is reported as churn or contraction on the day it ends.",
        );
      return {
        ...FIXED,
        rule: "It runs under 12 months and has no renewal, so it is fixed-term revenue, reported beside MRR. Its end is neither churn nor contraction.",
      };
    }
    case "recurring_credits":
      return counted("permanent", "Credits billed every period until the customer cancels are a subscription, so they count in MRR and ARR.");
    case "usage_above_commitment":
      return {
        counts: "period",
        line: "MRR and ARR",
        canChurn: false,
        changeNature: "temporary",
        answer: "Yes, for the period billed",
        churnAnswer: "No",
        rule: "Usage above a commitment counts in MRR for the period it is billed and comes out the next day. Revenue Churn Rate and Gross Revenue Retention leave that reversal out.",
      };
    case "on_demand_usage":
      return outside("Consumption Revenue", "No. Consumption Revenue", "Usage with no commitment behind it is Consumption Revenue and Usage Run-Rate annualises it beside ARR.");
    case "credit_pack":
      return outside(
        "Consumption Revenue",
        "No. Consumption Revenue as the credits are used",
        "A pack of credits bought once is usage paid for in advance: a purchase with no term and no renewal. Each credit is Consumption Revenue when it is used.",
      );
    case "professional_services":
      return outside(
        "Services Revenue",
        "No, at any length. Services Revenue",
        "Delivered work is Services Revenue at any length, even when the work repeats.",
      );
    case "one_time_fee":
      return outside(null, "No", "A one-time fee is charged once and never recurs.");
    case "perpetual_licence":
      return outside(null, "No", "A perpetual licence fee is charged once and never recurs. Maintenance sold with the licence counts by its own term and renewal.");
    case "hardware":
      return outside(null, "No", "Hardware sold outright is charged once and never recurs. Hardware a subscription's price includes, with no separate charge, is part of that subscription.");
    case "free_trial":
      return outside(null, "No", "A free trial carries no revenue. The customer counts from the first paid day.");
  }
}

export interface RevenueRow {
  /** What is sold */
  label: string;
  /** The cases the row covers; a row whose cases differ answers "by its contract" */
  items: RevenueItem[];
}

export const REVENUE_HEADER = ["What is sold", "Counts in MRR and ARR", "Can churn?"] as const;

export const REVENUE_ROWS: RevenueRow[] = [
  { label: "A monthly or quarterly plan that renews", items: [{ kind: "subscription", termMonths: 1, renews: true }, { kind: "subscription", termMonths: 3, renews: true }] },
  { label: "A contract of 12 months or more that renews", items: [{ kind: "subscription", termMonths: 12, renews: true }, { kind: "subscription", termMonths: 36, renews: true }] },
  { label: "A contract of 12 months or more with no renewal", items: [{ kind: "subscription", termMonths: 12 }, { kind: "subscription", termMonths: 24 }] },
  { label: "A contract under 12 months with no renewal", items: [{ kind: "subscription", termMonths: 6 }, { kind: "subscription", termMonths: 11 }] },
  { label: "A second short contract that follows the first with no break", items: [{ kind: "subscription", termMonths: 4, followsEarlierTerm: true }] },
  { label: "An add-on under 12 months with no renewal, sold to a customer on a renewing subscription", items: [{ kind: "add_on", termMonths: 3 }] },
  { label: "An add-on that ends with its parent contract and renews with it", items: [{ kind: "add_on", termMonths: 5, renews: true }] },
  { label: "A paid pilot or proof of concept under 12 months with no renewal", items: [{ kind: "pilot", termMonths: 3 }] },
  { label: "A free trial", items: [{ kind: "free_trial" }] },
  { label: "Committed usage, a contracted minimum", items: [{ kind: "committed_usage", termMonths: 12, renews: true }, { kind: "committed_usage", termMonths: 6 }] },
  { label: "Usage above the commitment", items: [{ kind: "usage_above_commitment" }] },
  { label: "Support, maintenance or a managed service sold on subscription terms", items: [{ kind: "support", termMonths: 12, renews: true }, { kind: "support", termMonths: 6 }] },
  { label: "A term licence, on-premises software included", items: [{ kind: "term_licence", termMonths: 12, renews: true }, { kind: "term_licence", termMonths: 6 }] },
  { label: "A perpetual licence fee", items: [{ kind: "perpetual_licence" }] },
  { label: "Maintenance on a perpetual licence", items: [{ kind: "support", termMonths: 12, renews: true }, { kind: "support", termMonths: 6 }] },
  { label: "Hardware sold outright", items: [{ kind: "hardware" }] },
  { label: "Hardware a subscription's price includes, with no separate charge", items: [{ kind: "subscription", termMonths: 12, renews: true }, { kind: "subscription", termMonths: 6 }] },
  { label: "Delivered work: implementation, consulting, training, a build", items: [{ kind: "professional_services" }, { kind: "professional_services", termMonths: 24, renews: true }] },
  { label: "One-time fees such as setup", items: [{ kind: "one_time_fee" }] },
  { label: "Usage billed on demand with no commitment", items: [{ kind: "on_demand_usage" }] },
  { label: "A pack of credits bought once, automatic top-ups included", items: [{ kind: "credit_pack" }] },
  { label: "Credits billed every month until the customer cancels", items: [{ kind: "recurring_credits" }] },
];

const BY_CONTRACT = "By its contract, like the subscriptions above";
const IF_IT_COUNTS = "Yes, if it counts";

/** The three cells of a row: the label and the two answers, or "by its contract" when the row's cases differ */
export function revenueCells(row: RevenueRow): [string, string, string] {
  const verdicts = row.items.map(classifyRevenue);
  const same = (pick: (v: RecurringVerdict) => string) => verdicts.every((v) => pick(v) === pick(verdicts[0]));
  return [
    row.label,
    same((v) => v.answer) ? verdicts[0].answer : BY_CONTRACT,
    same((v) => v.churnAnswer) ? verdicts[0].churnAnswer : IF_IT_COUNTS,
  ];
}

export type MrrMovement = "New MRR" | "Expansion MRR" | "Reactivation MRR" | "Churned MRR" | "Contraction MRR";

export interface Movement {
  /** The MRR movement reported, null when MRR does not move */
  metric: MrrMovement | null;
  /** Whether the customer counts in Churned Customers and Logo Churn Rate */
  churnedCustomer: boolean;
}

/**
 * What can happen to a contract. Its start and its end, and three events
 * between them: notice of a future ending (or a right to cancel the customer
 * has not used), a payment that is late while the subscription stays open (a
 * contract with a committed term the company keeps in force included) and a
 * contracted step up in a ramp or a stepped price.
 */
export type MovementEvent = "start" | "end" | "notice" | "late_payment" | "step_up";

/**
 * What an event in a contract's life is reported as. otherMrr says whether
 * the customer holds MRR apart from this contract on that day and returning
 * whether it churned earlier: an increase on a day the customer starts with
 * no MRR is new, or a reactivation when it had MRR before. Notice and a late
 * payment move nothing: MRR follows the contract in force until an ending
 * takes effect. A contracted step counts from the day it takes effect.
 */
export function movement(item: RevenueItem, event: MovementEvent, otherMrr: boolean, returning = false): Movement {
  const verdict = classifyRevenue(item);
  if (verdict.counts === "no" || event === "notice" || event === "late_payment") return { metric: null, churnedCustomer: false };
  if (event === "step_up") return { metric: verdict.counts === "yes" ? "Expansion MRR" : null, churnedCustomer: false };
  if (verdict.counts === "period") return { metric: event === "start" ? "Expansion MRR" : "Contraction MRR", churnedCustomer: false };
  if (event === "start") return { metric: otherMrr ? "Expansion MRR" : returning ? "Reactivation MRR" : "New MRR", churnedCustomer: false };
  return otherMrr ? { metric: "Contraction MRR", churnedCustomer: false } : { metric: "Churned MRR", churnedCustomer: true };
}

export interface MovementRow {
  happens: string;
  reported: string;
  item: RevenueItem;
  event: MovementEvent;
  otherMrr: boolean;
  /** The customer churned earlier and is coming back */
  returning?: boolean;
}

export const MOVEMENT_HEADER = ["What happens", "How it is reported"] as const;

const COUNTS: RevenueItem = { kind: "subscription", termMonths: 12, renews: true };
const SHORT: RevenueItem = { kind: "subscription", termMonths: 6 };

export const MOVEMENT_ROWS: MovementRow[] = [
  { happens: "A contract that counts in MRR expires or is cancelled", reported: "Churned MRR and a churned customer, in the month it ends", item: COUNTS, event: "end", otherMrr: false },
  { happens: "It ends and the customer keeps another subscription", reported: "Contraction MRR. The customer has not churned", item: COUNTS, event: "end", otherMrr: true },
  { happens: "It ends early", reported: "Churned MRR on the day it ends. Contraction MRR when another subscription stays", item: { kind: "subscription", termMonths: 12 }, event: "end", otherMrr: false },
  { happens: "The customer gives notice of a later ending or holds a right to cancel it has not used", reported: "Nothing in MRR until the day the ending takes effect, when it is reported as above", item: COUNTS, event: "notice", otherMrr: false },
  { happens: "A payment is late and the subscription stays open", reported: "Nothing in MRR moves. The subscription keeps its MRR and the customer stays a customer while the invoice is collected", item: COUNTS, event: "late_payment", otherMrr: false },
  { happens: "A customer stops paying inside a committed term and the contract stays in force", reported: "Nothing in MRR moves. The contract is invoiced and keeps its MRR until the day it ends", item: { kind: "subscription", termMonths: 12 }, event: "late_payment", otherMrr: false },
  { happens: "The subscription is cancelled for non-payment", reported: "Churned MRR and a churned customer, on the day the cancellation takes effect and the subscription ends", item: COUNTS, event: "end", otherMrr: false },
  { happens: "A fixed-term contract ends, on schedule or early", reported: "Nothing in MRR, in churn or in contraction", item: SHORT, event: "end", otherMrr: true },
  { happens: "A customer with fixed-term revenue alone signs a contract that counts", reported: "New MRR from that contract's start date", item: COUNTS, event: "start", otherMrr: false },
  { happens: "A second short contract follows the first with no break", reported: "New MRR from the second contract's start date. The first term stays fixed-term revenue", item: { kind: "subscription", termMonths: 4, followsEarlierTerm: true }, event: "start", otherMrr: false },
  { happens: "A customer who already has MRR adds a contract that counts", reported: "Expansion MRR", item: COUNTS, event: "start", otherMrr: true },
  { happens: "A contracted step up takes effect, in a ramp or a stepped price", reported: "Expansion MRR on the day the step takes effect. MRR and ARR hold the current step until then", item: COUNTS, event: "step_up", otherMrr: false },
  { happens: "A customer who churned comes back on a contract that counts", reported: "Reactivation MRR from that contract's start date, counted apart from New MRR and New Customers", item: COUNTS, event: "start", otherMrr: false, returning: true },
];

/** A Markdown table of the rows, as core.md and the churn article print it */
function markdownTable(header: readonly string[], rows: string[][]): string {
  const line = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

export function revenueTable(): string {
  return markdownTable(REVENUE_HEADER, REVENUE_ROWS.map(revenueCells));
}

export function movementTable(): string {
  return markdownTable(MOVEMENT_HEADER, MOVEMENT_ROWS.map((r) => [r.happens, r.reported]));
}

// --- One contract, answered in full: the `classify_revenue` tool and the calculator at /research/does-it-count ---

/** What is sold, as a reader picks it */
export const KIND_LABELS: Record<RevenueKind, string> = {
  subscription: "Product access on a plan or a contract",
  term_licence: "A term licence, on-premises software included",
  perpetual_licence: "A perpetual licence fee",
  hardware: "Hardware sold outright",
  add_on: "An add-on to a subscription the customer holds",
  pilot: "A paid pilot or proof of concept",
  support: "Support, maintenance or a managed service",
  committed_usage: "Committed usage, a contracted minimum",
  usage_above_commitment: "Usage above a commitment",
  on_demand_usage: "Usage billed on demand",
  credit_pack: "A pack of credits bought once",
  recurring_credits: "Credits billed every period",
  professional_services: "Delivered work: implementation, consulting, training",
  one_time_fee: "A one-time fee such as setup",
  free_trial: "A free trial",
};

export const KIND_GROUPS: { label: string; kinds: RevenueKind[] }[] = [
  { label: "Product access", kinds: ["subscription", "add_on", "pilot"] },
  { label: "Support", kinds: ["support"] },
  { label: "Licences and hardware", kinds: ["term_licence", "perpetual_licence", "hardware"] },
  { label: "Usage and credits", kinds: ["committed_usage", "usage_above_commitment", "on_demand_usage", "credit_pack", "recurring_credits"] },
  { label: "Services and fees", kinds: ["professional_services", "one_time_fee"] },
  { label: "Trials", kinds: ["free_trial"] },
];

export const REVENUE_KINDS: RevenueKind[] = KIND_GROUPS.flatMap((g) => g.kinds);

/** The longest term a question carries, in months */
export const MAX_TERM_MONTHS = 120;

/** The largest amount a question carries. A larger one is dropped, as an amount that is no number is */
export const MAX_AMOUNT = 1e12;

/** The kinds that always sit beside a subscription the customer holds, so the customer has other MRR */
export const BESIDE_KINDS: readonly RevenueKind[] = ["add_on", "usage_above_commitment"];

/** The kinds charged once, outside MRR with no reporting line of their own here */
export const ONE_TIME_KINDS: readonly RevenueKind[] = ["one_time_fee", "perpetual_licence", "hardware"];

/** The kinds whose answer carries no amounts: nothing is charged, or the amount is known only once the period is billed */
export const UNPRICED_KINDS: readonly RevenueKind[] = ["free_trial", "usage_above_commitment"];

export interface ContractQuestion extends RevenueItem {
  /** Whether the customer holds MRR apart from this contract. An add-on always sits beside a subscription */
  otherMrr?: boolean;
  /** The contract's value over its whole term, or the amount charged for a kind with no term */
  contractValue?: number;
  /** The price per month, for a contract with no end date or one priced by the month */
  monthlyValue?: number;
  /** The customer churned earlier and is coming back. Read for a contract that counts, sold to a customer with no other MRR */
  returning?: boolean;
  /** The contract starts on the day a free trial converts. Read for a contract that counts, sold to a new customer */
  afterTrial?: boolean;
}

export interface Amounts {
  /** The value of one month of the term, null when the inputs give none */
  monthly: number | null;
  mrr: number;
  arr: number;
  /** The amount reported outside MRR, on the verdict's line; null when nothing is or the total is unknown */
  outside: number | null;
  /** What twelve times the monthly value would report as ARR. Set for fixed-term revenue alone */
  annualised: number | null;
}

export interface Timeline {
  /** The months drawn: the term, or 12 for a contract with no end date */
  months: number;
  /** Whether each of those months counts in MRR */
  inMrr: boolean;
  /** The contract runs on after the months drawn: it renews or has no end date */
  open: boolean;
  /** An earlier term sits before it, with its own answer */
  earlierTerm: boolean;
}

export interface Assessment {
  /** The question as answered: term fields dropped for a kind with no term, otherMrr set for an add-on */
  question: ContractQuestion;
  /** The contract in words */
  title: string;
  verdict: RecurringVerdict;
  start: Movement;
  end: Movement;
  /** What its first day is reported as */
  startReported: string;
  /** What its last day is reported as */
  endReported: string;
  /** When that last day comes */
  endWhen: string | null;
  /** What it does to the customer counts, null when it leaves them alone */
  customer: string | null;
  amounts: Amounts | null;
  timeline: Timeline | null;
  /** Every metric the contract reaches, each with its answer */
  places: Place[];
}

export type PlaceId =
  | "mrr"
  | "arr"
  | "carr"
  | "bookings"
  | "billings"
  | "acv"
  | "nrr"
  | "grr"
  | "adjusted_retention"
  | "total_customers"
  | "new_customers"
  | "logo_churn_rate"
  | "fixed_term_revenue"
  | "services_revenue"
  | "consumption_revenue"
  | "usage_run_rate"
  | "prepaid_credit_balance"
  | "trial_to_paid";

export type PlaceGroup = "Recurring revenue" | "Signed and invoiced" | "Retention" | "Customers" | "Beside MRR";

/** One metric and what the contract or the change does to it */
export interface Place {
  id: PlaceId;
  /** The metric as the standard names it */
  metric: string;
  group: PlaceGroup;
  /** Whether it reaches the metric: in full, in part or under a condition the answer states, or not at all */
  counts: "yes" | "part" | "no";
  answer: string;
  /** The amount it adds, where the question's amounts give one. Negative for a change that lowers the metric */
  amount: number | null;
}

export const PLACE_LABELS: Record<PlaceId, string> = {
  mrr: "Monthly Recurring Revenue (MRR)",
  arr: "Annual Recurring Revenue (ARR)",
  carr: "Contracted Annual Recurring Revenue (CARR)",
  bookings: "Bookings",
  billings: "Billings",
  acv: "Annual Contract Value (ACV)",
  nrr: "Net Revenue Retention (NRR)",
  grr: "Gross Revenue Retention (GRR) and Revenue Churn Rate",
  adjusted_retention: "Adjusted NRR and GRR",
  total_customers: "Total Customers",
  new_customers: "New Customers",
  logo_churn_rate: "Churned Customers and Logo Churn Rate",
  fixed_term_revenue: "Fixed-Term Revenue",
  services_revenue: "Services Revenue",
  consumption_revenue: "Consumption Revenue",
  usage_run_rate: "Usage Run-Rate",
  prepaid_credit_balance: "Prepaid Credit Balance",
  trial_to_paid: "Trial-to-Paid Conversion Rate",
};

/** The places in the order an answer prints them */
export const PLACE_GROUPS: { label: PlaceGroup; ids: PlaceId[] }[] = [
  { label: "Recurring revenue", ids: ["mrr", "arr", "carr"] },
  { label: "Signed and invoiced", ids: ["bookings", "billings", "acv"] },
  { label: "Retention", ids: ["nrr", "grr", "adjusted_retention"] },
  { label: "Customers", ids: ["total_customers", "new_customers", "logo_churn_rate", "trial_to_paid"] },
  { label: "Beside MRR", ids: ["fixed_term_revenue", "services_revenue", "consumption_revenue", "usage_run_rate", "prepaid_credit_balance"] },
];

export const PLACE_IDS: PlaceId[] = PLACE_GROUPS.flatMap((g) => g.ids);

const groupOf = (id: PlaceId): PlaceGroup => PLACE_GROUPS.find((g) => g.ids.includes(id))!.label;

const place = (id: PlaceId, counts: Place["counts"], answer: string, amount: number | null = null): Place => ({ id, metric: PLACE_LABELS[id], group: groupOf(id), counts, answer, amount });

/** The places in printing order */
const ordered = (places: Place[]) => PLACE_IDS.flatMap((id) => places.filter((p) => p.id === id));

const isTermKind = (kind: RevenueKind) => TERM_KINDS.includes(kind);

/** Whether the kind is priced by the month: it has a term to spread a value over, or it bills every period */
const isMonthlyKind = (kind: RevenueKind) => isTermKind(kind) || kind === "recurring_credits";

const usableAmount = (n: number | undefined) => (n !== undefined && Number.isFinite(n) && n > 0 && n <= MAX_AMOUNT ? n : undefined);

/**
 * The question as it is answered. A kind with no term loses the term fields, a
 * term is a whole number of months from 1 to MAX_TERM_MONTHS, an amount that
 * is no usable number is dropped and one amount is kept where two are given:
 * the price per month for a kind priced by the month, the amount charged for
 * the rest. A term that is no number is an error: read as absent it would mean
 * "no end date", which counts.
 */
function normalise(q: ContractQuestion): ContractQuestion {
  const out: ContractQuestion = { kind: q.kind };
  if (isTermKind(q.kind)) {
    if (q.termMonths !== undefined) {
      if (!Number.isFinite(q.termMonths)) throw new RangeError("termMonths must be a number of months, or absent for a contract with no end date");
      out.termMonths = Math.min(MAX_TERM_MONTHS, Math.max(1, Math.round(q.termMonths)));
    }
    if (q.renews) out.renews = true;
    if (q.followsEarlierTerm) out.followsEarlierTerm = true;
  }
  if (q.otherMrr || BESIDE_KINDS.includes(q.kind)) out.otherMrr = true;
  const counts = classifyRevenue(out).counts === "yes";
  if (q.returning && !out.otherMrr && counts) out.returning = true;
  if (q.afterTrial && !out.otherMrr && !out.returning && counts) out.afterTrial = true;
  if (UNPRICED_KINDS.includes(q.kind)) return out;
  const contract = usableAmount(q.contractValue);
  const monthly = usableAmount(q.monthlyValue);
  if (contract !== undefined && monthly !== undefined) {
    if (isMonthlyKind(q.kind)) out.monthlyValue = monthly;
    else out.contractValue = contract;
  } else {
    if (contract !== undefined) out.contractValue = contract;
    if (monthly !== undefined) out.monthlyValue = monthly;
  }
  return out;
}

/** Which amount gives this question its figures: "either" for a contract with a term, "monthly" where there is no term to divide by, "charged" for a kind sold once, null for a kind that carries none */
export function amountBasis(input: ContractQuestion): "either" | "monthly" | "charged" | null {
  if (UNPRICED_KINDS.includes(input.kind)) return null;
  if (!isMonthlyKind(input.kind)) return "charged";
  return isTermKind(input.kind) && input.termMonths !== undefined ? "either" : "monthly";
}

const months = (n: number) => `${n} month${n === 1 ? "" : "s"}`;

const TERM_NOUNS: Partial<Record<RevenueKind, string>> = {
  subscription: "Product access",
  term_licence: "A term licence",
  add_on: "An add-on",
  pilot: "A paid pilot",
  support: "Support, maintenance or a managed service",
  committed_usage: "Committed usage",
};

/** The contract in words: "Product access for 6 months with no renewal" */
export function describeContract(q: ContractQuestion): string {
  const noun = TERM_NOUNS[q.kind];
  if (!noun) return KIND_LABELS[q.kind];
  if (q.termMonths === undefined) return `${noun} with no end date`;
  const tail = q.renews ? "that renews" : q.followsEarlierTerm ? "following an earlier term with no break" : "with no renewal";
  return `${noun} for ${months(q.termMonths)} ${tail}`;
}

function amountsFor(q: ContractQuestion, verdict: RecurringVerdict): Amounts | null {
  if (UNPRICED_KINDS.includes(q.kind)) return null;
  const term = isTermKind(q.kind) ? q.termMonths : undefined;
  if (verdict.counts === "no" && verdict.line !== "Fixed-term revenue") {
    const charged = q.contractValue ?? q.monthlyValue;
    return charged === undefined ? null : { monthly: null, mrr: 0, arr: 0, outside: charged, annualised: null };
  }
  const monthly = q.monthlyValue ?? (q.contractValue !== undefined && term !== undefined ? q.contractValue / term : undefined);
  if (monthly === undefined) return null;
  if (verdict.counts === "yes") return { monthly, mrr: monthly, arr: monthly * 12, outside: null, annualised: null };
  return { monthly, mrr: 0, arr: 0, outside: q.contractValue ?? monthly * term!, annualised: monthly * 12 };
}

/** What the customer holds apart from the contract being answered */
interface Beside {
  /** The customer holds MRR apart from it on its first day */
  other: boolean;
  /** It is one line of a larger contract and another line counts, for a customer with no MRR outside that contract */
  siblings: boolean;
  /** The customer churned earlier and is coming back */
  returning: boolean;
  /** It starts on the day a free trial converts */
  afterTrial: boolean;
}

/** Why each kind outside MRR holds none */
const NO_MRR: Partial<Record<RevenueKind, string>> = {
  on_demand_usage: "No. Usage with no commitment behind it is Consumption Revenue",
  credit_pack: "No. A pack of credits bought once adds no MRR",
  professional_services: "No, at any length. Delivered work is Services Revenue",
  one_time_fee: "No. It is charged once and never recurs",
  perpetual_licence: "No. A perpetual licence fee is charged once and never recurs",
  hardware: "No. Hardware sold outright is charged once and never recurs",
  free_trial: "No. A free trial carries no revenue",
};

/** Every metric the contract reaches, each with its answer and the amount it adds */
function placesFor(q: ContractQuestion, verdict: RecurringVerdict, amounts: Amounts | null, ctx: Beside, end: Movement): Place[] {
  const kind = q.kind;
  const counts = verdict.counts === "yes";
  const period = verdict.counts === "period";
  const fixed = verdict.line === "Fixed-term revenue";
  const temporary = counts && verdict.changeNature === "temporary";
  const consumption = kind === "on_demand_usage" || kind === "credit_pack";
  const delivered = kind === "professional_services" || ONE_TIME_KINDS.includes(kind);
  const trialKind = kind === "free_trial";
  const held = ctx.other || ctx.siblings;
  const reactivated = counts && !ctx.other && ctx.returning;
  const converted = counts && !ctx.other && !ctx.returning && ctx.afterTrial;
  const charged = amounts?.outside ?? null;
  const out: Place[] = [];

  // Recurring revenue
  if (counts) {
    out.push(place("mrr", "yes", "Yes, at its monthly value from its first day", amounts?.mrr ?? null));
    out.push(place("arr", "yes", "Yes, at 12 times its MRR", amounts?.arr ?? null));
    out.push(
      place(
        "carr",
        "yes",
        "Yes, through ARR from its start date. A new contract signed ahead of its start adds its Annual Contract Value (ACV) from the day it is signed" +
          (temporary ? ". CARR net of known churn takes it off, since its end is known" : ""),
        amounts?.arr ?? null,
      ),
    );
  } else if (period) {
    out.push(place("mrr", "part", "For the period billed. It enters on the period's last day and comes out the next day"));
    out.push(place("arr", "part", "For the period billed, through MRR"));
    out.push(place("carr", "part", "Through ARR alone, for the period billed. A signed contract adds its ACV, which holds no usage above a commitment"));
  } else {
    out.push(place("mrr", "no", fixed ? "No. It runs under 12 months with no renewal, so it is fixed-term revenue" : NO_MRR[kind]!));
    out.push(place("arr", "no", "No. ARR is 12 times MRR and it holds none"));
    out.push(
      place(
        "carr",
        "no",
        fixed ? "No. A fixed-term contract carries no ACV and adds nothing to CARR"
        : delivered ? "No. CARR leaves out one-time fees and professional services, as ARR does"
        : "No. It holds no ARR and no ACV",
      ),
    );
  }

  // Signed and invoiced
  if (isMonthlyKind(kind)) {
    const total = q.contractValue ?? (amounts?.monthly != null && q.termMonths !== undefined ? amounts.monthly * q.termMonths : null);
    const type = !counts || reactivated ? "" : q.followsEarlierTerm ? "as Renewal Bookings " : ctx.other ? "as Expansion Bookings " : "as New Bookings ";
    out.push(
      place(
        "bookings",
        "yes",
        `Yes, ${type}at its total contract value in the period it is signed` + (q.renews ? ". Each renewal is booked in the period it is signed" : ""),
        isTermKind(kind) ? total : null,
      ),
    );
  } else if (delivered) out.push(place("bookings", "yes", "Yes. Total contract value takes in one-time fees and services", charged));
  else if (kind === "credit_pack") out.push(place("bookings", "yes", "Yes. A credit purchase is a prepayment, counted in Bookings and Billings", charged));
  else if (trialKind) out.push(place("bookings", "no", "No. Nothing is charged"));
  else out.push(place("bookings", "no", "No. Bookings is contract value signed and this usage is billed after it happens"));

  out.push(
    trialKind ? place("billings", "no", "No. Nothing is invoiced")
    : kind === "credit_pack" ? place("billings", "yes", "Yes, when the purchase is invoiced")
    : period || kind === "on_demand_usage" ? place("billings", "yes", "Yes, when the usage is invoiced")
    : place("billings", "yes", "Yes, as each invoice is issued"),
  );

  out.push(
    counts ? place("acv", "yes", "Yes, at its recurring value for one year", amounts?.arr ?? null)
    : fixed ? place("acv", "no", "No. It carries no ACV: its value is in total contract value and Bookings alone")
    : delivered ? place("acv", "no", "No. ACV leaves out one-time fees: setup, implementation and training")
    : trialKind ? place("acv", "no", "No. Nothing is charged")
    : kind === "credit_pack" ? place("acv", "no", "No. ACV is recurring value and a pack is bought once")
    : place("acv", "no", "No. ACV is contracted recurring value and this usage is billed after it happens"),
  );

  // Retention
  if (period) {
    out.push(place("nrr", "yes", "Yes. The realisation is expansion tagged usage_realisation, which both forms of NRR count. Its reversal the next day is contraction"));
    out.push(place("grr", "no", "No. Both leave out the contraction tagged usage_realisation and neither counts expansion"));
    out.push(place("adjusted_retention", "no", "No. The realisation is temporary and its reversal scheduled. The adjusted variants count permanent changes alone"));
  } else if (counts) {
    out.push(
      ctx.other ? place("nrr", "yes", "Yes. Its start is expansion: the Market form (NRR-M) counts every expansion and the Operating form (NRR-O) counts expansion tagged same_product or usage_realisation. Its end is contraction, which lowers both forms")
      : reactivated ? place("nrr", "part", "Its start is a reactivation. NRR follows the customers with MRR at period start, so a customer who churned before the period returns as new business. For one who churned and came back inside the period, the Market form (NRR-M) counts the reactivation and the Operating form (NRR-O) leaves it out. Its end lowers both forms")
      : place("nrr", "part", "Its start stays out: NRR follows the customers with MRR at period start. Once a period opens with it running, it is in that opening MRR and its end lowers NRR"),
    );
    out.push(place("grr", "yes", `Yes, when it ends. ${end.metric} lowers GRR and raises Revenue Churn Rate for a customer with MRR at period start. Its start moves neither`));
    out.push(
      temporary ? place("adjusted_retention", "no", "No. Its MRR is temporary: the adjusted variants take it out of the opening MRR while it runs and leave out its end, a scheduled reversal")
      : place("adjusted_retention", "yes", "Yes, as in NRR and GRR. Its Revenue_Events are permanent, the kind the adjusted variants count"),
    );
  } else {
    out.push(place("nrr", "no", "No. It holds no MRR, so NRR moves in neither direction" + (consumption ? ". Consumption Net Revenue Retention follows this revenue" : "")));
    out.push(place("grr", "no", "No. It holds no MRR, so its end is neither churn nor contraction"));
    out.push(place("adjusted_retention", "no", fixed ? "No. It has no event in the ledger, so the change nature tags never reach it" : "No. It holds no MRR"));
  }

  // Customers
  const beside = counts ? ctx.other : held;
  if (beside) {
    out.push(place("total_customers", "no", "No change. One customer is one billing entity, whatever its number of subscriptions"));
    out.push(place("new_customers", "no", "No. Growth from an existing customer is expansion, however large"));
    out.push(place("logo_churn_rate", "no", counts || period ? "No. The customer keeps other MRR when this ends, so it has not churned" : "No. Its end changes no customer count"));
  } else if (counts) {
    out.push(place("total_customers", "yes", `Yes, ${reactivated ? "again " : ""}from the contract's first day${converted ? ", the day the trial converts" : ""}`));
    out.push(
      reactivated ? place("new_customers", "no", "No. A reactivated customer returns through a reactivation event, counted in Reactivation MRR")
      : place("new_customers", "yes", "Yes, in the period the contract starts"),
    );
    out.push(
      ctx.siblings ? place("logo_churn_rate", "part", "When the last line that counts ends. While another runs on, this line's end is contraction and the customer has not churned")
      : place("logo_churn_rate", "yes", "Yes, when it ends: a churned customer. Logo Churn Rate counts it when the customer was active on the first day of the period"),
    );
  } else if (fixed) {
    out.push(place("total_customers", "no", "No. A customer whose only contract is fixed-term holds the status fixed_term. It joins the count on the day a contract that counts in MRR starts"));
    out.push(place("new_customers", "no", "No. New Customers counts customers with a new Revenue_Event and this contract has none"));
    out.push(place("logo_churn_rate", "no", "No. It sits outside Total Customers, so its end is no churned customer"));
  } else if (consumption) {
    out.push(place("total_customers", "no", "No. An account with usage and no subscription holds the status pay_as_you_go, which Consumption Net Revenue Retention counts"));
    out.push(place("new_customers", "no", "No. New Customers counts customers with a new Revenue_Event and this usage has none"));
    out.push(place("logo_churn_rate", "no", "No. It has nothing to cancel: its loss shows in Consumption Net Revenue Retention"));
  } else if (trialKind) {
    out.push(place("total_customers", "no", "No. Trial and free accounts are not customers until they pay"));
    out.push(place("new_customers", "no", "No, until a paid plan starts"));
    out.push(place("logo_churn_rate", "no", "No. A trial that ends is an expired or cancelled trial, never a churned customer"));
  }
  if (trialKind) out.push(place("trial_to_paid", "yes", "Yes, in the period it ends: as converted when the account becomes a paying customer, else as expired or cancelled"));
  else if (converted) out.push(place("trial_to_paid", "yes", "Yes. The trial ends on the day it converts and counts as converted in that period"));

  // Beside MRR
  if (fixed) out.push(place("fixed_term_revenue", "yes", "Yes, as it is recognised over the term", charged));
  if (kind === "professional_services") out.push(place("services_revenue", "yes", "Yes, as recognised, whether billed by the project or by time", charged));
  if (kind === "on_demand_usage") out.push(place("consumption_revenue", "yes", "Yes, on the basis on_demand", charged));
  else if (kind === "credit_pack") out.push(place("consumption_revenue", "yes", "Yes, as the credits are used, on the basis top_up. The purchase itself is a prepayment", charged));
  else if (period) out.push(place("consumption_revenue", "yes", "Yes, on the basis overage"));
  else if (counts && (kind === "committed_usage" || kind === "recurring_credits"))
    out.push(place("consumption_revenue", "part", "As the balance is drawn, on the basis committed. Usage within a ratable commitment is the commitment itself, already in MRR"));
  if (consumption) out.push(place("usage_run_rate", "yes", "Yes. Usage Run-Rate annualises the trailing three months of this consumption and ARR Including Usage Run-Rate adds it to ARR"));
  else if (period) out.push(place("usage_run_rate", "no", "No. Overage is already in MRR through its usage realisation"));
  else if (counts && (kind === "committed_usage" || kind === "recurring_credits")) out.push(place("usage_run_rate", "no", "No. Committed consumption is already in ARR through the commitment"));
  if (kind === "credit_pack" || kind === "recurring_credits") out.push(place("prepaid_credit_balance", "yes", "Yes: the credits paid for and not yet used or forfeited"));
  else if (counts && kind === "committed_usage") out.push(place("prepaid_credit_balance", "part", "When the commitment is paid in advance: what is paid for and not yet used"));
  else if (period || kind === "on_demand_usage") out.push(place("prepaid_credit_balance", "no", "No. Overage and on-demand consumption draw no balance"));

  return ordered(out);
}

/** One question answered against what the customer holds beside it */
function answer(question: ContractQuestion, ctx: Beside): Assessment {
  const item: RevenueItem = { kind: question.kind, termMonths: question.termMonths, renews: question.renews, followsEarlierTerm: question.followsEarlierTerm };
  const other = ctx.other;
  const verdict = classifyRevenue(item);
  const start = movement(item, "start", other, ctx.returning);
  const end = movement(item, "end", other || ctx.siblings);
  const fixed = verdict.line === "Fixed-term revenue";
  const trial = ctx.afterTrial && start.metric === "New MRR" ? ", the day the trial converts" : "";

  const startReported =
    verdict.counts === "period" ? "Expansion MRR on the last day of the period billed"
    : start.metric === "New MRR" ? `New MRR from its start date${trial}`
    : start.metric === "Reactivation MRR" ? "Reactivation MRR from its start date, counted apart from New MRR"
    : start.metric === "Expansion MRR" ? "Expansion MRR from its start date"
    : "Nothing in MRR";
  const endReported =
    verdict.counts === "period" ? "Contraction MRR the next day, a scheduled reversal that Revenue Churn Rate and Gross Revenue Retention leave out"
    : end.metric === "Churned MRR" ? "Churned MRR and a churned customer, in the month it ends"
    : end.metric === "Contraction MRR" && ctx.siblings ? "Contraction MRR while another line that counts runs on. The last of those lines to end is Churned MRR, as each is when they end on one day"
    : end.metric === "Contraction MRR" ? "Contraction MRR. The customer has not churned"
    : "Nothing in MRR, in churn or in contraction";
  const endWhen =
    verdict.counts !== "yes" ? null
    : verdict.changeNature === "temporary" ? "On the day the contract ends, a date known from the start"
    : "On the day it is cancelled or runs out with no renewal";

  const lastDay = ctx.siblings ? "when the last line that counts ends" : "when it ends";
  const customer =
    other || (ctx.siblings && verdict.counts !== "yes") ? null
    : verdict.counts === "yes" && ctx.returning ? `The customer counts in Total Customers again from the contract's first day and in Churned Customers ${lastDay}. A reactivated customer stays out of New Customers.`
    : verdict.counts === "yes" ? `The customer counts in Total Customers from the contract's first day${trial} and in Churned Customers ${lastDay}.`
    : fixed ? "A customer whose only contract is fixed-term holds the status fixed_term, outside Total Customers and Logo Churn Rate."
    : verdict.line === "Consumption Revenue" ? "An account with usage and no subscription holds the status pay_as_you_go, outside Total Customers and Logo Churn Rate."
    : null;

  const timeline: Timeline | null =
    isTermKind(question.kind) || question.kind === "recurring_credits"
      ? {
          months: question.termMonths ?? MIN_TERM_MONTHS,
          inMrr: verdict.counts === "yes",
          open: verdict.changeNature === "permanent" && !(question.followsEarlierTerm && !question.renews && question.termMonths !== undefined),
          earlierTerm: Boolean(question.followsEarlierTerm && question.termMonths !== undefined),
        }
      : null;

  const amounts = amountsFor(question, verdict);
  return { question, title: describeContract(question), verdict, start, end, startReported, endReported, endWhen, customer, amounts, timeline, places: placesFor(question, verdict, amounts, ctx, end) };
}

/** Answer every question about one contract: whether it counts, what its start and end are reported as, the amounts and every metric it reaches */
export function assessContract(input: ContractQuestion): Assessment {
  const question = normalise(input);
  return answer(question, { other: Boolean(question.otherMrr), siblings: false, returning: Boolean(question.returning), afterTrial: Boolean(question.afterTrial) });
}

/** The keys questionToQuery writes. The calculator replaces these in the address and keeps every other key */
export const QUERY_KEYS = ["kind", "term", "renews", "follows", "other", "returning", "trial", "value", "monthly", "line", "bundle", "bundle_monthly", "change", "by"] as const;

/** The keys of one line, in the order the address carries them: what is sold, then its amount */
function lineParts(q: ContractQuestion): { sold: string[]; amount: string[] } {
  const sold = [`kind=${q.kind}`];
  if (isTermKind(q.kind)) sold.push(`term=${q.termMonths ?? "none"}`);
  if (q.renews) sold.push("renews=1");
  if (q.followsEarlierTerm) sold.push("follows=1");
  const amount: string[] = [];
  if (q.contractValue !== undefined) amount.push(`value=${q.contractValue}`);
  if (q.monthlyValue !== undefined) amount.push(`monthly=${q.monthlyValue}`);
  return { sold, amount };
}

/** The customer's circumstances as keys. forced: a kind that always sits beside a subscription says "other" by itself */
function customerParts(q: { otherMrr?: boolean; returning?: boolean; afterTrial?: boolean }, forced: boolean): string[] {
  const parts: string[] = [];
  if (q.otherMrr && !forced) parts.push("other=1");
  if (q.returning) parts.push("returning=1");
  if (q.afterTrial) parts.push("trial=1");
  return parts;
}

/** The question as a URL query, the form the calculator reads and the tool links to */
export function questionToQuery(input: ContractQuestion): string {
  const q = normalise(input);
  const { sold, amount } = lineParts(q);
  return [...sold, ...customerParts(q, BESIDE_KINDS.includes(q.kind)), ...amount].join("&");
}

const readAmount = (params: URLSearchParams, key: string) => {
  const raw = params.get(key);
  return raw === null || raw.trim() === "" ? undefined : usableAmount(Number(raw.replace(/[$,\s]/g, "")));
};

/**
 * Read a question back from a URL query. Null when the query names no kind
 * this module knows, or gives a kind that has a term no term it can read: the
 * term is a whole number of months or "none" for no end date, and a missing or
 * malformed one is never read as "none", which would count the contract.
 */
export function questionFromQuery(query: string): ContractQuestion | null {
  const params = new URLSearchParams(query);
  const kind = params.get("kind") as RevenueKind | null;
  if (!kind || !REVENUE_KINDS.includes(kind)) return null;
  let termMonths: number | undefined;
  if (isTermKind(kind)) {
    const raw = params.get("term");
    if (raw !== "none") {
      if (raw === null || !/^\d+$/.test(raw) || Number(raw) < 1) return null;
      termMonths = Math.min(Number(raw), MAX_TERM_MONTHS);
    }
  }
  return normalise({
    kind,
    termMonths,
    renews: params.get("renews") === "1",
    followsEarlierTerm: params.get("follows") === "1",
    otherMrr: params.get("other") === "1",
    returning: params.get("returning") === "1",
    afterTrial: params.get("trial") === "1",
    contractValue: readAmount(params, "value"),
    monthlyValue: readAmount(params, "monthly"),
  });
}

/** Contracts worth asking about, the first of them the calculator's opening question */
export const PRESETS: { label: string; question: ContractQuestion }[] = [
  { label: "Six months, no renewal", question: { kind: "subscription", termMonths: 6, contractValue: 30000 } },
  { label: "Monthly plan", question: { kind: "subscription", termMonths: 1, renews: true, monthlyValue: 500 } },
  { label: "One year, no renewal", question: { kind: "subscription", termMonths: 12, contractValue: 60000 } },
  { label: "Paid pilot", question: { kind: "pilot", termMonths: 3, contractValue: 9000 } },
  { label: "Three-year contract", question: { kind: "subscription", termMonths: 36, contractValue: 108000 } },
  { label: "Second short contract", question: { kind: "subscription", termMonths: 4, followsEarlierTerm: true, contractValue: 12000 } },
  { label: "Short add-on", question: { kind: "add_on", termMonths: 3, contractValue: 6000 } },
  { label: "Credit pack", question: { kind: "credit_pack", contractValue: 2000 } },
  { label: "Implementation project", question: { kind: "professional_services", contractValue: 40000 } },
  { label: "Customer who comes back", question: { kind: "subscription", termMonths: 12, renews: true, returning: true, contractValue: 24000 } },
  { label: "Trial that converts", question: { kind: "subscription", termMonths: 1, renews: true, afterTrial: true, monthlyValue: 99 } },
  { label: "Usage above a commitment", question: { kind: "usage_above_commitment" } },
  { label: "Term licence on premises", question: { kind: "term_licence", termMonths: 36, renews: true, contractValue: 180000 } },
  { label: "Perpetual licence", question: { kind: "perpetual_licence", contractValue: 100000 } },
];

// --- A contract with several lines: each line answered by its own kind and term ---

/** The most lines one question carries */
export const MAX_LINES = 6;

export interface DealQuestion {
  /** The things sold under the contract. Each carries its kind, its term and its amount; the customer's circumstances belong to the contract */
  lines: ContractQuestion[];
  /** The customer holds MRR apart from this contract */
  otherMrr?: boolean;
  /** The customer churned earlier and is coming back */
  returning?: boolean;
  /** The contract starts on the day a free trial converts */
  afterTrial?: boolean;
  /** One price for every line over the whole contract, allocated by standalone price. Each line's own amount is then its standalone price */
  bundleValue?: number;
  /** One price per month for every line, allocated the same way */
  bundleMonthly?: number;
}

/** A bundle price shared across the lines by relative standalone price (core.md, Bundle Pricing and MRR Allocation) */
export interface Allocation {
  /** Whether the prices are per month or over the whole contract */
  basis: "monthly" | "total";
  /** The bundle price */
  price: number;
  /** Each line's standalone price, in the order of the lines */
  standalone: number[];
  /** Each line's share of the bundle price: its standalone price over the sum of them, times the bundle price */
  allocated: number[];
}

export interface DealTotal {
  id: PlaceId;
  metric: string;
  amount: number;
  /** False when a line that reaches the metric gave no amount, so the total is the part that is known */
  complete: boolean;
}

export interface DealAssessment {
  /** The question as answered */
  question: DealQuestion;
  title: string;
  /** One answer per line, in the order of the lines, at its allocated amount when a bundle price was shared out */
  lines: Assessment[];
  /** The amounts the lines add up to, per metric */
  totals: DealTotal[];
  allocation: Allocation | null;
  /** Why a bundle price was left unallocated, when one was given */
  allocationNote: string | null;
  /** What the contract does to the customer counts, null when it leaves them alone */
  customer: string | null;
}

/** The metrics whose amounts add up across the lines of one contract */
const TOTAL_IDS: PlaceId[] = ["mrr", "arr", "carr", "acv", "bookings", "fixed_term_revenue", "services_revenue", "consumption_revenue"];

const countsInMrr = (q: RevenueItem) => classifyRevenue(q).counts === "yes";

/** A line as a contract with several lines carries it: what is sold and its amount */
function lineOf(q: ContractQuestion): ContractQuestion {
  const line = normalise({ kind: q.kind, termMonths: q.termMonths, renews: q.renews, followsEarlierTerm: q.followsEarlierTerm, contractValue: q.contractValue, monthlyValue: q.monthlyValue });
  delete line.otherMrr;
  return line;
}

/**
 * Whether the lines say by themselves that the customer holds MRR outside the
 * contract: a kind that always sits beside a subscription with no line beside
 * it that counts.
 */
export function besideOutside(lines: ContractQuestion[]): boolean {
  return lines.some((line, i) => BESIDE_KINDS.includes(line.kind) && !lines.some((other, j) => j !== i && countsInMrr(other)));
}

function normaliseDeal(input: DealQuestion): DealQuestion {
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new RangeError("a contract needs at least one line");
  if (input.lines.length > MAX_LINES) throw new RangeError(`a contract carries at most ${MAX_LINES} lines`);
  const lines = input.lines.map(lineOf);
  const out: DealQuestion = { lines };
  const anyCounts = lines.some(countsInMrr);
  if (input.otherMrr || besideOutside(lines)) out.otherMrr = true;
  if (input.returning && !out.otherMrr && anyCounts) out.returning = true;
  if (input.afterTrial && !out.otherMrr && !out.returning && anyCounts) out.afterTrial = true;
  if (lines.length > 1) {
    const total = usableAmount(input.bundleValue);
    const monthly = usableAmount(input.bundleMonthly);
    if (total !== undefined) out.bundleValue = total;
    else if (monthly !== undefined) out.bundleMonthly = monthly;
  }
  return out;
}

/** A line's standalone price per month, null when its kind is priced another way or it carries no amount */
function standaloneMonthly(q: ContractQuestion): number | null {
  if (!isMonthlyKind(q.kind)) return null;
  if (q.monthlyValue !== undefined) return q.monthlyValue;
  return q.contractValue !== undefined && q.termMonths !== undefined ? q.contractValue / q.termMonths : null;
}

/** A line's standalone price over the whole contract, null when it has no end date or carries no amount */
function standaloneTotal(q: ContractQuestion): number | null {
  if (UNPRICED_KINDS.includes(q.kind)) return null;
  if (!isMonthlyKind(q.kind)) return q.contractValue ?? q.monthlyValue ?? null;
  if (q.contractValue !== undefined) return q.contractValue;
  return q.monthlyValue !== undefined && q.termMonths !== undefined ? q.monthlyValue * q.termMonths : null;
}

function allocate(q: DealQuestion): { lines: ContractQuestion[]; allocation: Allocation | null; note: string | null } {
  const price = q.bundleValue ?? q.bundleMonthly;
  if (price === undefined) return { lines: q.lines, allocation: null, note: null };
  const basis = q.bundleValue !== undefined ? "total" : "monthly";
  const standalone = q.lines.map(basis === "total" ? standaloneTotal : standaloneMonthly);
  if (standalone.some((s) => s === null)) {
    const note =
      basis === "total"
        ? "The bundle price is left unallocated: sharing one price over the whole contract needs a standalone price and an end date for every line."
        : "The bundle price is left unallocated: sharing one price per month needs a standalone price per month for every line, so each line is priced by the month.";
    return { lines: q.lines, allocation: null, note };
  }
  const prices = standalone as number[];
  const sum = prices.reduce((a, b) => a + b, 0);
  const allocated = prices.map((p) => (p / sum) * price);
  const lines = q.lines.map((line, i) => {
    const { contractValue: _value, monthlyValue: _monthly, ...sold } = line;
    return basis === "total" ? { ...sold, contractValue: allocated[i] } : { ...sold, monthlyValue: allocated[i] };
  });
  return { lines, allocation: { basis, price, standalone: prices, allocated }, note: null };
}

/**
 * Answer a contract with several lines. Each line is answered by its own kind
 * and term. A customer who starts the day with no MRR starts every line that
 * counts as New MRR, or as Reactivation MRR when it had MRR before; a line
 * that ends while another runs on is Contraction MRR and the last to end is
 * Churned MRR (cel.md, the derivation rules). One line and no bundle price
 * gives the answer assessContract gives.
 */
export function assessDeal(input: DealQuestion): DealAssessment {
  const question = normaliseDeal(input);
  const { lines: priced, allocation, note } = allocate(question);
  const existing = Boolean(question.otherMrr);
  const lines = priced.map((line, i) => {
    const siblings = !existing && priced.some((other, j) => j !== i && countsInMrr(other));
    return answer(line, { other: existing, siblings, returning: Boolean(question.returning), afterTrial: Boolean(question.afterTrial) });
  });

  const totals: DealTotal[] = [];
  for (const id of TOTAL_IDS) {
    const reached = lines.flatMap((l) => l.places.filter((p) => p.id === id && p.counts !== "no"));
    const known = reached.filter((p) => p.amount !== null);
    if (known.length === 0) continue;
    totals.push({ id, metric: PLACE_LABELS[id], amount: known.reduce((sum, p) => sum + p.amount!, 0), complete: known.length === reached.length });
  }

  const anyCounts = lines.some((l) => l.verdict.counts === "yes");
  const withCustomer = lines.filter((l) => l.customer !== null);
  const customer =
    existing ? null
    : anyCounts ? lines.find((l) => l.verdict.counts === "yes")!.customer
    : withCustomer.length > 0 && withCustomer.every((l) => l.customer === withCustomer[0].customer) ? withCustomer[0].customer
    : null;

  const title = lines.length === 1 ? lines[0].title : `A contract with ${lines.length} lines`;
  return { question, title, lines, totals, allocation, allocationNote: note, customer };
}

/** The contract as a URL query: the first line's keys with the customer's, each further line under "line" and the bundle price */
export function dealToQuery(input: DealQuestion): string {
  const q = normaliseDeal(input);
  const [first, ...rest] = q.lines;
  const { sold, amount } = lineParts(first);
  const parts = [...sold, ...customerParts(q, besideOutside(q.lines)), ...amount];
  for (const line of rest) {
    const p = lineParts(line);
    parts.push(`line=${encodeURIComponent([...p.sold, ...p.amount].join("&"))}`);
  }
  if (q.bundleValue !== undefined) parts.push(`bundle=${q.bundleValue}`);
  if (q.bundleMonthly !== undefined) parts.push(`bundle_monthly=${q.bundleMonthly}`);
  return parts.join("&");
}

/** Read a contract back from a URL query. Null when any line fails to read, as questionFromQuery is for one */
export function dealFromQuery(query: string): DealQuestion | null {
  const params = new URLSearchParams(query);
  const first = questionFromQuery(query);
  if (!first) return null;
  const rest = params.getAll("line");
  if (rest.length > MAX_LINES - 1) return null;
  const lines = [first];
  for (const raw of rest) {
    const line = questionFromQuery(raw);
    if (!line) return null;
    lines.push(line);
  }
  return normaliseDeal({
    lines,
    otherMrr: params.get("other") === "1",
    returning: params.get("returning") === "1",
    afterTrial: params.get("trial") === "1",
    bundleValue: readAmount(params, "bundle"),
    bundleMonthly: readAmount(params, "bundle_monthly"),
  });
}

/** Contracts with several lines worth asking about */
export const DEAL_PRESETS: { label: string; question: DealQuestion }[] = [
  {
    label: "Subscription, implementation and credits",
    question: {
      lines: [
        { kind: "subscription", termMonths: 12, renews: true, contractValue: 60000 },
        { kind: "professional_services", contractValue: 15000 },
        { kind: "credit_pack", contractValue: 5000 },
      ],
    },
  },
  {
    label: "Platform and a short add-on",
    question: {
      lines: [
        { kind: "subscription", termMonths: 12, renews: true, contractValue: 48000 },
        { kind: "add_on", termMonths: 3, contractValue: 6000 },
      ],
    },
  },
  {
    label: "Three products at one price",
    question: {
      lines: [
        { kind: "subscription", termMonths: 1, renews: true, monthlyValue: 300 },
        { kind: "add_on", termMonths: 1, renews: true, monthlyValue: 200 },
        { kind: "support", termMonths: 1, renews: true, monthlyValue: 100 },
      ],
      bundleMonthly: 500,
    },
  },
];

// --- A change to a subscription the customer holds ---

export type ChangeKind =
  /** More of what the customer already has: seats added, a higher tier */
  | "upgrade"
  /** A module the customer did not have */
  | "new_module"
  /** A higher price for the same service */
  | "price_increase"
  /** Less of the product: seats removed, a lower tier */
  | "downgrade"
  /** A price cut or a discount with no end date */
  | "price_cut"
  /** A discount with an end date */
  | "temporary_discount"
  /** A move to annual billing at a lower price */
  | "annual_billing_discount"
  /** A move to annual billing at the same yearly price */
  | "annual_billing_same_price"
  | "credit_or_refund"
  /** Notice of an ending on a later date, or a right to cancel the customer has not used */
  | "notice"
  /** A payment is late and the subscription stays open */
  | "late_payment"
  /** The customer stops paying inside a committed term and the contract stays in force */
  | "unpaid_in_term";

export const CHANGE_LABELS: Record<ChangeKind, string> = {
  upgrade: "More of the same product: seats added or a higher tier",
  new_module: "A module the customer did not have",
  price_increase: "A price increase, with the service as it was",
  downgrade: "Less of the product: seats removed or a lower tier",
  price_cut: "A price cut or a discount with no end date",
  temporary_discount: "A discount with an end date",
  annual_billing_discount: "A move to annual billing at a lower price",
  annual_billing_same_price: "A move to annual billing at the same yearly price",
  credit_or_refund: "A one-off credit or refund",
  notice: "Notice to cancel on a later date",
  late_payment: "A late payment, with the subscription still open",
  unpaid_in_term: "Payment stops inside a committed term, with the contract still in force",
};

export const CHANGE_GROUPS: { label: string; kinds: ChangeKind[] }[] = [
  { label: "MRR goes up", kinds: ["upgrade", "new_module", "price_increase"] },
  { label: "MRR goes down", kinds: ["downgrade", "price_cut", "temporary_discount", "annual_billing_discount"] },
  { label: "MRR stays where it was", kinds: ["annual_billing_same_price", "credit_or_refund", "notice", "late_payment", "unpaid_in_term"] },
];

export const CHANGE_KINDS: ChangeKind[] = CHANGE_GROUPS.flatMap((g) => g.kinds);

export interface ChangeQuestion {
  change: ChangeKind;
  /** The customer's MRR before the change */
  monthlyValue?: number;
  /** The size of the change per month, as a positive amount. Dropped for a change that leaves MRR alone and for a decrease as large as the MRR before it, which is a cancellation */
  changeMonthly?: number;
}

/** The expansion_classification tags a change to a running subscription takes (atl.md) */
export type Classification = "same_product" | "new_module" | "pricing_adjustment" | "recontracting";

export interface ChangeAmounts {
  /** MRR before the change, null when the question gives none */
  before: number | null;
  /** The change in MRR: positive for expansion, negative for contraction, 0 when MRR stays */
  change: number;
  after: number | null;
  arrAfter: number | null;
}

export interface ChangeAssessment {
  question: ChangeQuestion;
  title: string;
  /** The movement the change is reported as, null when MRR stays where it was */
  metric: "Expansion MRR" | "Contraction MRR" | null;
  /** The tag on its Revenue_Event, null where the standard names none */
  classification: Classification | null;
  changeNature: "permanent" | "temporary" | null;
  reported: string;
  rule: string;
  amounts: ChangeAmounts | null;
  places: Place[];
}

interface ChangeRule {
  metric: ChangeAssessment["metric"];
  classification: Classification | null;
  temporary?: boolean;
  rule: string;
}

const CHANGE_RULES: Record<ChangeKind, ChangeRule> = {
  upgrade: {
    metric: "Expansion MRR",
    classification: "same_product",
    rule: "More of what the customer already has is Expansion MRR tagged same_product, the expansion both forms of Net Revenue Retention (NRR) count.",
  },
  new_module: {
    metric: "Expansion MRR",
    classification: "new_module",
    rule: "A module the customer did not have is Expansion MRR tagged new_module. The Market form of Net Revenue Retention (NRR) counts it and the Operating form leaves it out.",
  },
  price_increase: {
    metric: "Expansion MRR",
    classification: "pricing_adjustment",
    rule: "A price increase is Expansion MRR tagged pricing_adjustment: MRR moved by a pricing action, with usage and scope as they were.",
  },
  downgrade: {
    metric: "Contraction MRR",
    classification: null,
    rule: "A plan downgrade or a removed seat is Contraction MRR: the customer stays and buys less.",
  },
  price_cut: {
    metric: "Contraction MRR",
    classification: "pricing_adjustment",
    rule: "Every decrease in committed recurring revenue counts, whether or not the service changed. A price cut or a discount is Contraction MRR tagged pricing_adjustment.",
  },
  temporary_discount: {
    metric: "Contraction MRR",
    classification: "pricing_adjustment",
    temporary: true,
    rule: "A discount applied to a running subscription is Contraction MRR tagged pricing_adjustment. With an end date it is temporary, with a scheduled reversal on the day it ends.",
  },
  annual_billing_discount: {
    metric: "Contraction MRR",
    classification: "recontracting",
    rule: "The lower monthly value is Contraction MRR tagged recontracting, with the plan, the seats and the entitlements as they were. A customer paying $1,000 a month who moves to annual billing at a 10% discount holds $900 of MRR and the $100 is Contraction MRR.",
  },
  annual_billing_same_price: {
    metric: null,
    classification: null,
    rule: "A move to annual billing at the same yearly price leaves MRR where it was and sits outside Contraction MRR.",
  },
  credit_or_refund: {
    metric: null,
    classification: null,
    rule: "A one-off credit or refund leaves MRR where it was and sits outside Contraction MRR.",
  },
  notice: {
    metric: null,
    classification: null,
    rule: "Notice of a future ending moves nothing until the day the ending takes effect. On that day it is Churned MRR for a customer left with no MRR and Contraction MRR for one who keeps another subscription. A right to cancel the customer has not used moves nothing either.",
  },
  late_payment: {
    metric: null,
    classification: null,
    rule: "A subscription with a payment overdue keeps its MRR and its customer stays a customer while the invoice is collected. If the subscription is cancelled for non-payment, it is Churned MRR and a churned customer on the day the cancellation takes effect and the subscription ends, which can fall after the day the payment was missed.",
  },
  unpaid_in_term: {
    metric: null,
    classification: null,
    rule: "A contract with a committed term is one the customer has agreed to pay for to its last day. While the company holds the customer to it the contract is invoiced and keeps its MRR, whatever has been paid and whenever the customer asked to leave. It is Churned MRR and a churned customer on the day the contract ends, whether the company ends it early or the term runs out with no renewal.",
  },
};

function normaliseChange(q: ChangeQuestion): ChangeQuestion {
  if (!CHANGE_KINDS.includes(q.change)) throw new RangeError(`change must be one of ${CHANGE_KINDS.join(", ")}`);
  const out: ChangeQuestion = { change: q.change };
  const before = usableAmount(q.monthlyValue);
  const by = usableAmount(q.changeMonthly);
  const metric = CHANGE_RULES[q.change].metric;
  if (before !== undefined) out.monthlyValue = before;
  if (by !== undefined && metric !== null && !(metric === "Contraction MRR" && before !== undefined && by >= before)) out.changeMonthly = by;
  return out;
}

/** Answer a change to a subscription the customer holds: the movement, its tags and every metric it reaches */
export function assessChange(input: ChangeQuestion): ChangeAssessment {
  const question = normaliseChange(input);
  const { metric, classification, temporary, rule } = CHANGE_RULES[question.change];
  const up = metric === "Expansion MRR";
  const down = metric === "Contraction MRR";
  const before = question.monthlyValue ?? null;
  const change = question.changeMonthly === undefined ? null : up ? question.changeMonthly : -question.changeMonthly;
  const amounts: ChangeAmounts | null =
    metric === null ? (before === null ? null : { before, change: 0, after: before, arrAfter: before * 12 })
    : change === null ? null
    : { before, change, after: before === null ? null : before + change, arrAfter: before === null ? null : (before + change) * 12 };

  const reported =
    up ? "Expansion MRR on the day the change takes effect"
    : down && temporary ? "Contraction MRR on the day the discount starts. A scheduled reversal brings the MRR back on the day it ends"
    : down ? "Contraction MRR on the day the change takes effect. The customer has not churned"
    : "Nothing in MRR";

  const tagged = classification === "pricing_adjustment" || classification === "recontracting";
  const out: Place[] = [];
  if (metric === null) {
    out.push(place("mrr", "no", "No. MRR stays where it was"));
    out.push(place("arr", "no", "No. ARR is 12 times MRR"));
    out.push(
      question.change === "notice"
        ? place("carr", "part", "CARR stays where it was until the ending takes effect. CARR net of known churn takes the cancellation's annual value off from the day notice is given")
        : place("carr", "no", "No. CARR moves through ARR alone"),
    );
    if (question.change === "late_payment") out.push(place("billings", "yes", "Yes. The invoice stays in Billings, reported as unpaid until it is paid or written off"));
    if (question.change === "unpaid_in_term") out.push(place("billings", "yes", "Yes. Each invoice of the term is issued and stays in Billings, reported as unpaid until it is paid or written off"));
    out.push(place("nrr", "no", "No. MRR has not moved"));
    out.push(place("grr", "no", "No. MRR has not moved, so nothing counts as contraction"));
    out.push(place("adjusted_retention", "no", "No. MRR has not moved"));
  } else {
    out.push(place("mrr", "yes", `Yes. MRR ${up ? "rises" : "falls"} by the change on the day it takes effect`, change));
    out.push(
      temporary ? place("arr", "part", `The Market form (ARR-M) moves with MRR while the discount runs. The Operating form (ARR-O) takes out the MRR change tagged ${classification} in the trailing 12 months`, change === null ? null : change * 12)
      : tagged ? place("arr", "part", `The Market form (ARR-M) moves with MRR. The Operating form (ARR-O) takes out the MRR change tagged ${classification} in the trailing 12 months, so the change reaches it a year later`, change === null ? null : change * 12)
      : place("arr", "yes", "Yes, at 12 times the change, in both forms", change === null ? null : change * 12),
    );
    out.push(place("carr", "yes", "Yes, through ARR on the day the change takes effect" + (temporary ? ". A temporary reduction is read as ARR reads it and nothing is added back before it reverses" : ""), change === null ? null : change * 12));
    if (question.change === "upgrade" || question.change === "new_module") out.push(place("bookings", "yes", "Yes. An upgrade from an existing customer is Expansion Bookings, at the contract value signed"));
    out.push(
      down ? place("nrr", "yes", "Yes. Every contraction lowers NRR in both forms, whatever its tag")
      : classification === "same_product" ? place("nrr", "yes", "Yes. Both forms count expansion tagged same_product")
      : place("nrr", "part", `The Market form (NRR-M) counts every expansion. The Operating form (NRR-O) counts expansion tagged same_product or usage_realisation, so it leaves ${classification} out`),
    );
    out.push(down ? place("grr", "yes", "Yes. The contraction lowers GRR and raises Revenue Churn Rate") : place("grr", "no", "No. GRR and Revenue Churn Rate count no expansion"));
    out.push(
      temporary ? place("adjusted_retention", "no", "No. The discount is temporary and its reversal scheduled. The adjusted variants count permanent changes alone")
      : down ? place("adjusted_retention", "yes", "Yes. The change is permanent, the kind both adjusted variants count")
      : place("adjusted_retention", "part", "In Adjusted NRR, which counts permanent expansion. Adjusted GRR counts no expansion"),
    );
  }
  out.push(place("total_customers", "no", "No change. The customer stays a customer"));
  if (question.change === "notice" || question.change === "late_payment" || question.change === "unpaid_in_term") {
    const day = question.change === "notice" ? "the ending takes effect" : question.change === "late_payment" ? "a cancellation takes effect" : "the contract ends";
    out.push(place("logo_churn_rate", "no", `No. The customer has not churned. It is a churned customer on the day ${day}, when it holds no other MRR`));
  }

  return {
    question,
    title: CHANGE_LABELS[question.change],
    metric,
    classification,
    changeNature: metric === null ? null : temporary ? "temporary" : "permanent",
    reported,
    rule,
    amounts,
    places: ordered(out),
  };
}

/** The change as a URL query */
export function changeToQuery(input: ChangeQuestion): string {
  const q = normaliseChange(input);
  const parts = [`change=${q.change}`];
  if (q.monthlyValue !== undefined) parts.push(`monthly=${q.monthlyValue}`);
  if (q.changeMonthly !== undefined) parts.push(`by=${q.changeMonthly}`);
  return parts.join("&");
}

/** Read a change back from a URL query. Null when the query names no change this module knows */
export function changeFromQuery(query: string): ChangeQuestion | null {
  const params = new URLSearchParams(query);
  const change = params.get("change") as ChangeKind | null;
  if (!change || !CHANGE_KINDS.includes(change)) return null;
  return normaliseChange({ change, monthlyValue: readAmount(params, "monthly"), changeMonthly: readAmount(params, "by") });
}

/** Changes worth asking about */
export const CHANGE_PRESETS: { label: string; question: ChangeQuestion }[] = [
  { label: "Annual billing at 10% off", question: { change: "annual_billing_discount", monthlyValue: 1000, changeMonthly: 100 } },
  { label: "Three-month discount", question: { change: "temporary_discount", monthlyValue: 2000, changeMonthly: 500 } },
  { label: "Seats added", question: { change: "upgrade", monthlyValue: 2000, changeMonthly: 1000 } },
  { label: "Price increase at renewal", question: { change: "price_increase", monthlyValue: 2000, changeMonthly: 100 } },
  { label: "One-off refund", question: { change: "credit_or_refund", monthlyValue: 1000 } },
  { label: "Notice to cancel", question: { change: "notice", monthlyValue: 1000 } },
  { label: "Late payment", question: { change: "late_payment", monthlyValue: 1000 } },
  { label: "Unpaid inside a term", question: { change: "unpaid_in_term", monthlyValue: 1000 } },
];

/** An amount as the examples print it: "$30,000", cents shown when it has them */
export function formatMoney(amount: number): string {
  const size = Math.abs(amount);
  const cents = Math.round(size * 100) % 100 !== 0;
  return (amount < 0 ? "-$" : "$") + size.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
}
