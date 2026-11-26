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
 */

export type RevenueKind =
  /** Product access on a plan or a contract */
  | "subscription"
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
export const TERM_KINDS: readonly RevenueKind[] = ["subscription", "add_on", "pilot", "support", "committed_usage"];

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

export type MrrMovement = "New MRR" | "Expansion MRR" | "Churned MRR" | "Contraction MRR";

export interface Movement {
  /** The MRR movement reported, null when MRR does not move */
  metric: MrrMovement | null;
  /** Whether the customer counts in Churned Customers and Logo Churn Rate */
  churnedCustomer: boolean;
}

/**
 * What the start or the end of a contract is reported as. otherMrr says
 * whether the customer holds MRR apart from this contract on that day.
 */
export function movement(item: RevenueItem, event: "start" | "end", otherMrr: boolean): Movement {
  const verdict = classifyRevenue(item);
  if (verdict.counts === "no") return { metric: null, churnedCustomer: false };
  if (verdict.counts === "period") return { metric: event === "start" ? "Expansion MRR" : "Contraction MRR", churnedCustomer: false };
  if (event === "start") return { metric: otherMrr ? "Expansion MRR" : "New MRR", churnedCustomer: false };
  return otherMrr ? { metric: "Contraction MRR", churnedCustomer: false } : { metric: "Churned MRR", churnedCustomer: true };
}

export interface MovementRow {
  happens: string;
  reported: string;
  item: RevenueItem;
  event: "start" | "end";
  otherMrr: boolean;
}

export const MOVEMENT_HEADER = ["What happens", "How it is reported"] as const;

const COUNTS: RevenueItem = { kind: "subscription", termMonths: 12, renews: true };
const SHORT: RevenueItem = { kind: "subscription", termMonths: 6 };

export const MOVEMENT_ROWS: MovementRow[] = [
  { happens: "A contract that counts in MRR expires or is cancelled", reported: "Churned MRR and a churned customer, in the month it ends", item: COUNTS, event: "end", otherMrr: false },
  { happens: "It ends and the customer keeps another subscription", reported: "Contraction MRR. The customer has not churned", item: COUNTS, event: "end", otherMrr: true },
  { happens: "It ends early", reported: "Churned MRR on the day it ends. Contraction MRR when another subscription stays", item: { kind: "subscription", termMonths: 12 }, event: "end", otherMrr: false },
  { happens: "A fixed-term contract ends, on schedule or early", reported: "Nothing in MRR, in churn or in contraction", item: SHORT, event: "end", otherMrr: true },
  { happens: "A customer with fixed-term revenue alone signs a contract that counts", reported: "New MRR from that contract's start date", item: COUNTS, event: "start", otherMrr: false },
  { happens: "A second short contract follows the first with no break", reported: "New MRR from the second contract's start date. The first term stays fixed-term revenue", item: { kind: "subscription", termMonths: 4, followsEarlierTerm: true }, event: "start", otherMrr: false },
  { happens: "A customer who already has MRR adds a contract that counts", reported: "Expansion MRR", item: COUNTS, event: "start", otherMrr: true },
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

/** The kinds whose answer carries no amounts: nothing is charged, or the amount is known only once the period is billed */
export const UNPRICED_KINDS: readonly RevenueKind[] = ["free_trial", "usage_above_commitment"];

export interface ContractQuestion extends RevenueItem {
  /** Whether the customer holds MRR apart from this contract. An add-on always sits beside a subscription */
  otherMrr?: boolean;
  /** The contract's value over its whole term, or the amount charged for a kind with no term */
  contractValue?: number;
  /** The price per month, for a contract with no end date or one priced by the month */
  monthlyValue?: number;
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
}

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

/** Answer every question about one contract: whether it counts, what its start and end are reported as and the amounts */
export function assessContract(input: ContractQuestion): Assessment {
  const question = normalise(input);
  const item: RevenueItem = { kind: question.kind, termMonths: question.termMonths, renews: question.renews, followsEarlierTerm: question.followsEarlierTerm };
  const other = Boolean(question.otherMrr);
  const verdict = classifyRevenue(item);
  const start = movement(item, "start", other);
  const end = movement(item, "end", other);
  const fixed = verdict.line === "Fixed-term revenue";

  const startReported =
    verdict.counts === "period" ? "Expansion MRR on the last day of the period billed"
    : start.metric === "New MRR" ? "New MRR from its start date"
    : start.metric === "Expansion MRR" ? "Expansion MRR from its start date"
    : "Nothing in MRR";
  const endReported =
    verdict.counts === "period" ? "Contraction MRR the next day, a scheduled reversal that Revenue Churn Rate and Gross Revenue Retention leave out"
    : end.metric === "Churned MRR" ? "Churned MRR and a churned customer, in the month it ends"
    : end.metric === "Contraction MRR" ? "Contraction MRR. The customer has not churned"
    : "Nothing in MRR, in churn or in contraction";
  const endWhen =
    verdict.counts !== "yes" ? null
    : verdict.changeNature === "temporary" ? "On the day the contract ends, a date known from the start"
    : "On the day it is cancelled or runs out with no renewal";

  const customer =
    other ? null
    : verdict.counts === "yes" ? "The customer counts in Total Customers from the contract's first day and in Churned Customers when it ends."
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

  return { question, title: describeContract(question), verdict, start, end, startReported, endReported, endWhen, customer, amounts: amountsFor(question, verdict), timeline };
}

/** The keys questionToQuery writes. The calculator replaces these in the address and keeps every other key */
export const QUERY_KEYS = ["kind", "term", "renews", "follows", "other", "value", "monthly"] as const;

/** The question as a URL query, the form the calculator reads and the tool links to */
export function questionToQuery(input: ContractQuestion): string {
  const q = normalise(input);
  const parts = [`kind=${q.kind}`];
  if (isTermKind(q.kind)) parts.push(`term=${q.termMonths ?? "none"}`);
  if (q.renews) parts.push("renews=1");
  if (q.followsEarlierTerm) parts.push("follows=1");
  if (q.otherMrr && !BESIDE_KINDS.includes(q.kind)) parts.push("other=1");
  if (q.contractValue !== undefined) parts.push(`value=${q.contractValue}`);
  if (q.monthlyValue !== undefined) parts.push(`monthly=${q.monthlyValue}`);
  return parts.join("&");
}

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
  const amount = (key: string) => {
    const raw = params.get(key);
    return raw === null || raw.trim() === "" ? undefined : usableAmount(Number(raw.replace(/[$,\s]/g, "")));
  };
  return normalise({
    kind,
    termMonths,
    renews: params.get("renews") === "1",
    followsEarlierTerm: params.get("follows") === "1",
    otherMrr: params.get("other") === "1",
    contractValue: amount("value"),
    monthlyValue: amount("monthly"),
  });
}

/** Contracts worth asking about, the first of them the calculator's opening question */
export const PRESETS: { label: string; question: ContractQuestion }[] = [
  { label: "Six months, no renewal", question: { kind: "subscription", termMonths: 6, contractValue: 30000 } },
  { label: "Monthly plan", question: { kind: "subscription", termMonths: 1, renews: true, monthlyValue: 500 } },
  { label: "One fixed year", question: { kind: "subscription", termMonths: 12, contractValue: 60000 } },
  { label: "Paid pilot", question: { kind: "pilot", termMonths: 3, contractValue: 9000 } },
  { label: "Second short contract", question: { kind: "subscription", termMonths: 4, followsEarlierTerm: true, contractValue: 12000 } },
  { label: "Short add-on", question: { kind: "add_on", termMonths: 3, contractValue: 6000 } },
  { label: "Credit pack", question: { kind: "credit_pack", contractValue: 2000 } },
  { label: "Implementation project", question: { kind: "professional_services", contractValue: 40000 } },
];

/** An amount as the examples print it: "$30,000", cents shown when it has them */
export function formatMoney(amount: number): string {
  const cents = Math.round(amount * 100) % 100 !== 0;
  return "$" + amount.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
}
