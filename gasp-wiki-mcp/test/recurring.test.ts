/**
 * The year-or-renewal test (src/recurring.ts): which revenue counts in MRR and
 * ARR, and what the start and the end of each kind are reported as. The tables
 * in the MRR entry of standard/metrics/core.md are the module's rows, cell for
 * cell, and the ontology states the same rule in its field descriptions.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  KIND_GROUPS,
  KIND_LABELS,
  MAX_TERM_MONTHS,
  MIN_TERM_DAYS,
  PRESETS,
  REVENUE_KINDS,
  assessContract,
  describeContract,
  kindNoun,
  formatMoney,
  questionFromQuery,
  questionToQuery,
  type ContractQuestion,
  type RevenueKind,
  MIN_TERM_MONTHS,
  MOVEMENT_ROWS,
  REVENUE_ROWS,
  TERM_KINDS,
  classifyRevenue,
  movement,
  movementTable,
  renewable,
  revenueCells,
  revenueTable,
  BESIDE_KINDS,
  ONE_TIME_KINDS,
  MAX_AMOUNT,
  QUERY_KEYS,
  UNPRICED_KINDS,
  amountBasis,
  CHANGE_GROUPS,
  CHANGE_KINDS,
  CHANGE_LABELS,
  CHANGE_PRESETS,
  DEAL_PRESETS,
  MAX_LINES,
  PLACE_GROUPS,
  PLACE_IDS,
  PLACE_LABELS,
  assessChange,
  assessDeal,
  changeFromQuery,
  changeToQuery,
  dealFromQuery,
  dealToQuery,
  type Assessment,
  type ChangeKind,
  type DealQuestion,
  type Place,
  type PlaceId,
} from "../src/recurring.js";

const standard = (file: string) => readFileSync(fileURLToPath(new URL(`../../standard/${file}`, import.meta.url)), "utf8");

describe("the year-or-renewal test", () => {
  it("counts a contract of 12 months or more with or without a renewal", () => {
    for (const termMonths of [12, 18, 36]) {
      expect(classifyRevenue({ kind: "subscription", termMonths, renews: true })).toMatchObject({ counts: "yes", canChurn: true, changeNature: "permanent" });
      expect(classifyRevenue({ kind: "subscription", termMonths })).toMatchObject({ counts: "yes", line: "MRR and ARR", canChurn: true, changeNature: "temporary", churnAnswer: "Yes, on the day it ends" });
    }
  });

  it("counts a shorter contract when it renews, has no end date or follows an earlier term", () => {
    expect(classifyRevenue({ kind: "subscription", termMonths: 1, renews: true })).toMatchObject({ counts: "yes", changeNature: "permanent" });
    expect(classifyRevenue({ kind: "subscription" })).toMatchObject({ counts: "yes", changeNature: "permanent" });
    expect(classifyRevenue({ kind: "subscription", termMonths: 4, followsEarlierTerm: true })).toMatchObject({ counts: "yes", canChurn: true, changeNature: "permanent" });
  });

  it("puts a contract under 12 months with no renewal in fixed-term revenue, at every length up to the line", () => {
    for (const termMonths of [1, 3, 6, 11, 11.9]) {
      expect(classifyRevenue({ kind: "subscription", termMonths })).toMatchObject({ counts: "no", line: "Fixed-term revenue", canChurn: false, changeNature: null });
    }
    expect(MIN_TERM_MONTHS).toBe(12);
    expect(MIN_TERM_DAYS).toBe(365);
  });

  it("applies the same test to an add-on, a pilot, support and committed usage", () => {
    for (const kind of TERM_KINDS) {
      expect(classifyRevenue({ kind, termMonths: 6 }).line, kind).toBe("Fixed-term revenue");
      expect(classifyRevenue({ kind, termMonths: 6, renews: true }).counts, kind).toBe("yes");
      expect(classifyRevenue({ kind, termMonths: 12 }).counts, kind).toBe("yes");
    }
  });

  it("keeps delivered work, one-time fees, on-demand usage and credit packs out at any length", () => {
    const out: Array<[RevenueKind, string | null]> = [
      ["professional_services", "Services Revenue"],
      ["one_time_fee", null],
      ["free_trial", null],
      ["on_demand_usage", "Consumption Revenue"],
      ["credit_pack", "Consumption Revenue"],
    ];
    for (const [kind, line] of out) {
      for (const item of [{ kind }, { kind, termMonths: 24, renews: true }, { kind, termMonths: 6, followsEarlierTerm: true }]) {
        expect(classifyRevenue(item), kind).toMatchObject({ counts: "no", line, canChurn: false, changeNature: null });
      }
    }
  });

  // Decided 2026-11-26 on the practice of listed companies: a term licence is a subscription wherever
  // the software runs, and a perpetual licence fee and hardware sold outright are charged once.
  it("counts a term licence by the test and keeps a perpetual licence fee and hardware sold outright out", () => {
    expect(TERM_KINDS).toContain("term_licence");
    for (const item of [{ termMonths: 36, renews: true }, { termMonths: 12 }, { termMonths: 6, renews: true }, { termMonths: 6 }, {}]) {
      const { rule: _a, ...licence } = classifyRevenue({ kind: "term_licence", ...item });
      const { rule: _b, ...subscription } = classifyRevenue({ kind: "subscription", ...item });
      expect(licence, JSON.stringify(item)).toEqual(subscription);
    }
    expect(classifyRevenue({ kind: "term_licence", termMonths: 6 }).line).toBe("Fixed-term revenue");
    expect([...ONE_TIME_KINDS]).toEqual(["one_time_fee", "perpetual_licence", "hardware"]);
    for (const kind of ONE_TIME_KINDS) {
      for (const item of [{ kind }, { kind, termMonths: 36, renews: true }]) {
        expect(classifyRevenue(item), kind).toMatchObject({ counts: "no", line: null, canChurn: false, changeNature: null });
      }
      for (const event of ["start", "end", "step_up"] as const) expect(movement({ kind }, event, false), kind).toEqual({ metric: null, churnedCustomer: false });
    }
    // Maintenance on a perpetual licence is support, counted by its own term and renewal.
    expect(classifyRevenue({ kind: "support", termMonths: 12, renews: true }).counts).toBe("yes");
    expect(classifyRevenue({ kind: "support", termMonths: 6 }).line).toBe("Fixed-term revenue");
    const core = standard("metrics/core.md");
    expect(core).toContain("- Term licence fees, on-premises software included, by the same test");
    expect(core).toContain("- One-time fees (setup, implementation, a perpetual licence fee, hardware sold outright)");
    expect(core).toContain("A term licence counts by the same test as a subscription, whether the software runs in the vendor's cloud or on the customer's premises");
    expect(core).toContain("A perpetual licence fee and hardware sold outright are charged once and stay out of MRR and ARR");
    expect(core).toContain("Maintenance on a perpetual licence counts by its own term and renewal");
    expect(core).toContain("Hardware that a subscription's price includes, with no separate charge, is part of that subscription");
  });

  // The Exclude list under MRR used to keep all usage out "unless contractually guaranteed", against the table below it.
  it("states the usage lines of the Exclude lists as the table decides them", () => {
    const core = standard("metrics/core.md");
    expect(core).not.toContain("unless contractually guaranteed");
    expect(core).toContain("- Usage no commitment covers: usage billed above a commitment and usage billed on demand. Committed usage counts by the same test");
    expect(core).not.toContain("counts for the period billed");
    expect(classifyRevenue({ kind: "on_demand_usage" }).counts).toBe("no");
    expect(classifyRevenue({ kind: "committed_usage", termMonths: 12 }).counts).toBe("yes");
    expect(classifyRevenue({ kind: "usage_above_commitment" }).counts).toBe("no");
    const finance = standard("metrics/finance.md");
    expect(finance).not.toContain("usage above a commitment, as in ARR");
    expect(finance).toContain("- One-time fees and professional services, as in ARR");
  });

  // Regression (2026-11-27): the row read "Yes, for the period billed", a temporary expansion, against the
  // SaaS Metrics Standards Board, which keeps overage out of ARR whether or not it is invoiced.
  it("keeps usage above a commitment out of MRR as Consumption Revenue and counts recurring credits as a subscription", () => {
    expect(classifyRevenue({ kind: "usage_above_commitment" })).toMatchObject({ counts: "no", line: "Consumption Revenue", answer: "No. Consumption Revenue", canChurn: false, changeNature: null });
    // No kind counts for part of a period: every answer is yes or no.
    for (const kind of REVENUE_KINDS)
      for (const termMonths of [1, 6, 12, 36]) expect(["yes", "no"], `${kind} ${termMonths}`).toContain(classifyRevenue({ kind, termMonths }).counts);
    expect(classifyRevenue({ kind: "recurring_credits" })).toMatchObject({ counts: "yes", canChurn: true, changeNature: "permanent" });
  });

  it("says a contract renews by its provision, by having no end date or by following an earlier term", () => {
    expect(renewable({ kind: "subscription", termMonths: 6 })).toBe(false);
    expect(renewable({ kind: "subscription", termMonths: 24 })).toBe(false);
    expect(renewable({ kind: "subscription", termMonths: 6, renews: true })).toBe(true);
    expect(renewable({ kind: "subscription", termMonths: 4, followsEarlierTerm: true })).toBe(true);
    expect(renewable({ kind: "subscription" })).toBe(true);
  });

  it("gives every verdict a rule and an answer in the standard's style", () => {
    for (const row of REVENUE_ROWS) {
      for (const item of row.items) {
        const v = classifyRevenue(item);
        expect(v.rule.length, row.label).toBeGreaterThan(20);
        expect(`${v.rule} ${v.answer} ${v.churnAnswer}`, row.label).not.toMatch(/—|, and |, or /);
        expect(v.canChurn, row.label).toBe(v.churnAnswer.startsWith("Yes"));
        expect(v.counts === "no", row.label).toBe(v.answer.startsWith("No"));
      }
    }
  });
});

describe("what a start and an end are reported as", () => {
  const counts = { kind: "subscription" as const, termMonths: 12, renews: true };
  const fixed = { kind: "subscription" as const, termMonths: 6 };

  it("reports a contract that counts as New or Expansion MRR at its start and Churned or Contraction MRR at its end", () => {
    expect(movement(counts, "start", false)).toEqual({ metric: "New MRR", churnedCustomer: false });
    expect(movement(counts, "start", true)).toEqual({ metric: "Expansion MRR", churnedCustomer: false });
    expect(movement(counts, "end", false)).toEqual({ metric: "Churned MRR", churnedCustomer: true });
    expect(movement(counts, "end", true)).toEqual({ metric: "Contraction MRR", churnedCustomer: false });
  });

  it("reports the end of a contract of 12 months or more with no renewal as churn", () => {
    expect(movement({ kind: "subscription", termMonths: 18 }, "end", false)).toEqual({ metric: "Churned MRR", churnedCustomer: true });
  });

  it("reports nothing in MRR for fixed-term revenue, at its start or its end", () => {
    for (const event of ["start", "end"] as const) for (const otherMrr of [true, false]) {
      expect(movement(fixed, event, otherMrr)).toEqual({ metric: null, churnedCustomer: false });
    }
    expect(movement({ kind: "professional_services" }, "end", true).metric).toBeNull();
  });

  it("starts New MRR on the second of two short contracts in a row", () => {
    expect(movement({ kind: "subscription", termMonths: 4 }, "start", false).metric).toBeNull();
    expect(movement({ kind: "subscription", termMonths: 4, followsEarlierTerm: true }, "start", false).metric).toBe("New MRR");
  });

  // cel.md, rule 5: an increase on a date the customer started at 0 is new, or reactivation when
  // the customer had MRR on an earlier date.
  it("starts a returning customer as Reactivation MRR, where a customer with MRR expands", () => {
    expect(movement(counts, "start", false, true)).toEqual({ metric: "Reactivation MRR", churnedCustomer: false });
    expect(movement(counts, "start", true, true).metric).toBe("Expansion MRR");
    expect(movement(fixed, "start", false, true).metric).toBeNull();
    expect(movement(counts, "end", false, true)).toEqual({ metric: "Churned MRR", churnedCustomer: true });
    expect(MOVEMENT_ROWS.filter((r) => r.returning)).toHaveLength(1);
    expect(standard("cel.md")).toContain("or `reactivation` when the customer had MRR on an earlier date");
  });

  // Decided 2026-11-26: MRR follows the contract in force. Notice, an unused right to cancel and a
  // late payment move nothing, and a contracted step counts from the day it takes effect.
  it("moves nothing on notice or a late payment, whatever else the customer holds", () => {
    for (const event of ["notice", "late_payment"] as const) {
      for (const item of [counts, fixed, { kind: "subscription" as const, termMonths: 12 }, { kind: "usage_above_commitment" as const }]) {
        for (const otherMrr of [true, false]) expect(movement(item, event, otherMrr), event).toEqual({ metric: null, churnedCustomer: false });
      }
    }
    const core = standard("metrics/core.md");
    expect(core).toContain("A clause that lets the customer cancel for convenience changes neither, so the contract counts at its stated value until an ending takes effect");
    expect(core).toContain("Notice of a future ending moves nothing in MRR or ARR until that day");
    expect(core).toContain("A subscription with a payment overdue keeps its MRR and its customer stays a customer while the invoice is collected");
    expect(standard("metrics/finance.md")).toContain("Notice of a future ending changes nothing until that day");
  });

  // Reworded 2026-11-27: "the day it is cancelled" read as the day the customer stopped paying or
  // asked to leave. The day is the one the subscription ends.
  it("reports a subscription cancelled for non-payment as any ending, on the day the subscription ends", () => {
    const row = MOVEMENT_ROWS.find((r) => r.happens === "The subscription is cancelled for non-payment")!;
    expect(row.event).toBe("end");
    expect(row.reported).toBe("Churned MRR and a churned customer, on the day the cancellation takes effect and the subscription ends");
    expect(movement(row.item, row.event, row.otherMrr)).toEqual({ metric: "Churned MRR", churnedCustomer: true });
    const core = standard("metrics/core.md");
    expect(core).toContain("When the subscription is cancelled for non-payment it is Churned MRR and a churned customer on the day the cancellation takes effect and the subscription ends, which can fall after the day the payment was missed");
    expect(core).not.toContain("on the day it is cancelled");
    expect(assessChange({ change: "late_payment" }).rule).not.toContain("on the day it is cancelled");
    // The glossary used to make "payment current" a condition of an active customer.
    const definitions = standard("definitions.md");
    expect(definitions).not.toContain("payment current");
    expect(definitions).toContain("A customer with a payment overdue stays active while the invoice is collected and until the subscription is cancelled");
    const ontology = JSON.parse(standard("ontology.json")) as { fields: Array<{ id: string; description: string }> };
    expect(ontology.fields.find((f) => f.id === "subscription_status")!.description).toContain("A subscription with a payment overdue stays active until it is cancelled");
  });

  // 2026-11-27: a customer inside a committed term is invoiced to its last day whatever they pay
  // and whenever they ask to leave, so the contract leaves MRR on the day it ends. The standard
  // names no number of days past due at which an unpaid contract must be closed: practice splits.
  it("keeps a contract with a committed term in MRR while the company keeps it in force, paid or unpaid", () => {
    const row = MOVEMENT_ROWS.find((r) => r.happens === "A customer stops paying inside a committed term and the contract stays in force")!;
    expect(row.reported).toBe("Nothing in MRR moves. The contract is invoiced and keeps its MRR until the day it ends");
    expect(row.event).toBe("late_payment");
    expect(classifyRevenue(row.item).counts).toBe("yes");
    expect(movement(row.item, row.event, row.otherMrr)).toEqual({ metric: null, churnedCustomer: false });
    expect(movement(row.item, "end", false)).toEqual({ metric: "Churned MRR", churnedCustomer: true });
    const rows = MOVEMENT_ROWS.map((r) => r.happens);
    expect(rows.indexOf(row.happens)).toBe(rows.indexOf("A payment is late and the subscription stays open") + 1);
    expect(rows.indexOf("The subscription is cancelled for non-payment")).toBe(rows.indexOf(row.happens) + 1);

    const c = assessChange({ change: "unpaid_in_term", monthlyValue: 1000 });
    expect(c).toMatchObject({ metric: null, classification: null, changeNature: null, reported: "Nothing in MRR", title: CHANGE_LABELS.unpaid_in_term });
    expect(c.amounts).toMatchObject({ before: 1000, change: 0, after: 1000, arrAfter: 12000 });
    const at = (id: PlaceId) => c.places.find((p) => p.id === id)!;
    for (const id of ["mrr", "arr", "carr", "nrr", "grr", "adjusted_retention", "total_customers", "logo_churn_rate"] as const) expect(at(id).counts, id).toBe("no");
    expect(at("billings")).toMatchObject({ counts: "yes", answer: "Yes. Each invoice of the term is issued and stays in Billings, reported as unpaid until it is paid or written off" });
    expect(at("logo_churn_rate").answer).toBe("No. The customer has not churned. It is a churned customer on the day the contract ends, when it holds no other MRR");
    expect(c.rule).toContain("While the company holds the customer to it the contract is invoiced and keeps its MRR, whatever has been paid and whenever the customer asked to leave");
    expect(c.rule).toContain("It is Churned MRR and a churned customer on the day the contract ends, whether the company ends it early or the term runs out with no renewal");
    expect(changeFromQuery(changeToQuery(c.question))).toEqual(c.question);
    expect(changeToQuery(c.question)).toBe("change=unpaid_in_term&monthly=1000");
    expect(CHANGE_PRESETS.filter((p) => p.question.change === "unpaid_in_term")).toHaveLength(1);
    expect(CHANGE_GROUPS.find((g) => g.label === "MRR stays where it was")!.kinds).toContain("unpaid_in_term");

    // A late payment on an open subscription reads the invoice the same way and churns on the day a cancellation takes effect.
    const late = assessChange({ change: "late_payment" });
    expect(late.places.find((p) => p.id === "billings")).toMatchObject({ counts: "yes", answer: "Yes. The invoice stays in Billings, reported as unpaid until it is paid or written off" });
    expect(late.places.find((p) => p.id === "logo_churn_rate")!.answer).toContain("on the day a cancellation takes effect");
    expect(assessChange({ change: "notice" }).places.find((p) => p.id === "billings")).toBeUndefined();

    const core = standard("metrics/core.md");
    expect(core).toContain("A contract with a committed term, one the customer has agreed to pay for to its last day, is read the same way");
    expect(core).toContain("While the company holds the customer to the term the contract is invoiced and keeps its MRR, whatever has been paid and whenever the customer asked to leave");
    expect(core).toContain("It is Churned MRR and a churned customer on the day the contract ends, whether the company ends it early or the term runs out with no renewal");
    expect(core).toContain("An invoice left unpaid stays in [Billings](finance.md#billings) under its payment status and enters [Bad Debt Rate](finance.md#bad-debt-rate) when it is written off");
    expect(standard("metrics/finance.md")).toContain("Billings are reported per payment status (paid, unpaid, partial, written off) as of period end");
    // Where practice splits the standard stays silent: no day count after which an unpaid contract leaves MRR.
    expect(core).not.toMatch(/days past due|uncollect/i);
    expect(`${c.rule} ${late.rule}`).not.toMatch(/days past due|uncollect/i);
  });

  it("reports a contracted step up as Expansion MRR on its day, for a contract that counts", () => {
    expect(movement(counts, "step_up", false)).toEqual({ metric: "Expansion MRR", churnedCustomer: false });
    expect(movement(counts, "step_up", true).metric).toBe("Expansion MRR");
    expect(movement({ kind: "subscription", termMonths: 36 }, "step_up", false).metric).toBe("Expansion MRR");
    expect(movement(fixed, "step_up", false).metric).toBeNull();
    expect(movement({ kind: "usage_above_commitment" }, "step_up", true).metric).toBeNull();
    const core = standard("metrics/core.md");
    expect(core).toContain("MRR holds the current step and ARR is 12 times it, never the average over the term and never a later year's price");
    expect(core).toContain("more seats or volume is `same_product` and a higher price for the same service is `pricing_adjustment`");
    expect(core).toContain("an uplift signed for a later date enters when it takes effect");
    expect(standard("formulas.json")).toContain("An upgrade or a renewal uplift signed for a later date enters when it takes effect");
    expect(standard("metrics/finance.md")).toContain("- The later years of a multi-year agreement: a contract adds one year of recurring value");
  });

  it("holds each row of the movement table to the function", () => {
    for (const row of MOVEMENT_ROWS) {
      const m = movement(row.item, row.event, row.otherMrr, row.returning);
      expect(row.reported.startsWith(m.metric ?? "Nothing in MRR"), row.happens).toBe(true);
      if (/a churned customer/.test(row.reported)) expect(m.churnedCustomer, row.happens).toBe(true);
      if (/has not churned/.test(row.reported)) expect(m.churnedCustomer, row.happens).toBe(false);
    }
  });
});

describe("the tables in the standard", () => {
  const core = standard("metrics/core.md");

  it("prints the revenue table in the MRR entry, cell for cell", () => {
    expect(core).toContain(revenueTable());
    expect(REVENUE_ROWS.map((r) => revenueCells(r)[0])).toHaveLength(new Set(REVENUE_ROWS.map((r) => r.label)).size);
  });

  it("prints the movement table in the MRR entry, cell for cell", () => {
    expect(core).toContain(movementTable());
  });

  it("answers a row by its contract only when its cases differ", () => {
    const cells = new Map(REVENUE_ROWS.map((r) => [r.label, revenueCells(r)]));
    expect(cells.get("Committed usage, a contracted minimum")?.slice(1)).toEqual(["By its contract, like the subscriptions above", "Yes, if it counts"]);
    expect(cells.get("A contract under 12 months with no renewal")?.slice(1)).toEqual(["No. Fixed-term revenue", "No"]);
    expect(cells.get("A contract of 12 months or more with no renewal")?.slice(1)).toEqual(["Yes", "Yes, on the day it ends"]);
    for (const label of ["A term licence, on-premises software included", "Maintenance on a perpetual licence", "Hardware a subscription's price includes, with no separate charge"]) {
      expect(cells.get(label)?.slice(1), label).toEqual(["By its contract, like the subscriptions above", "Yes, if it counts"]);
    }
    for (const label of ["A perpetual licence fee", "Hardware sold outright"]) expect(cells.get(label)?.slice(1), label).toEqual(["No", "No"]);
  });

  it("prints a row for notice, a late payment, a cancellation for non-payment and a contracted step", () => {
    const events = MOVEMENT_ROWS.map((r) => r.event);
    for (const event of ["start", "end", "notice", "late_payment", "step_up"] as const) expect(events, event).toContain(event);
    for (const row of MOVEMENT_ROWS) expect(`${row.happens} ${row.reported}`, row.happens).not.toMatch(/—|–|, and |, or |\.$/);
  });

  it("states the rule in the ontology and the glossary", () => {
    const ontology = JSON.parse(standard("ontology.json")) as { fields: Array<{ id: string; datasets: string[]; values?: string[]; description: string }> };
    const field = (id: string) => ontology.fields.find((f) => f.id === id)!;
    expect(field("renewable").datasets.sort()).toEqual(["contract_event", "subscription"]);
    expect(field("renewable").description).toContain(`under ${MIN_TERM_MONTHS} months`);
    expect(field("customer_status").values).toContain("fixed_term");
    expect(field("revenue_type").values).toContain("fixed_term");
    expect(field("mrr").description).toContain(`${MIN_TERM_MONTHS} months`);
    expect(standard("definitions.md")).toMatch(/^### Fixed-Term Revenue$/m);
    expect(core).toContain(`Twelve months means ${MIN_TERM_DAYS} days of access or more`);
  });
});

// One contract answered in full: the function behind the classify_revenue tool and the
// calculator at /research/does-it-count. Every answer it gives is classifyRevenue and
// movement for the same inputs, over the whole space of questions the two can be asked.
describe("assessContract", () => {
  const TERMS = [undefined, 1, 3, 6, 11, 12, 13, 24, 36];
  const FLAGS = [false, true];
  const VALUES: Array<Pick<ContractQuestion, "contractValue" | "monthlyValue">> = [{}, { contractValue: 30000 }, { monthlyValue: 500 }];
  const questions: ContractQuestion[] = [];
  for (const kind of REVENUE_KINDS)
    for (const termMonths of TERMS)
      for (const renews of FLAGS)
        for (const followsEarlierTerm of FLAGS)
          for (const otherMrr of FLAGS) for (const value of VALUES) questions.push({ kind, termMonths, renews, followsEarlierTerm, otherMrr, ...value });

  const itemOf = (q: ContractQuestion) => (TERM_KINDS.includes(q.kind) ? { kind: q.kind, termMonths: q.termMonths, renews: q.renews, followsEarlierTerm: q.followsEarlierTerm } : { kind: q.kind });
  const otherOf = (q: ContractQuestion) => Boolean(q.otherMrr) || q.kind === "add_on" || q.kind === "usage_above_commitment";
  expect([...BESIDE_KINDS]).toEqual(["add_on", "usage_above_commitment"]);

  it("covers every kind, with a label and a group for each", () => {
    const kinds = Object.keys(KIND_LABELS) as RevenueKind[];
    expect([...REVENUE_KINDS].sort()).toEqual([...kinds].sort());
    expect(new Set(KIND_GROUPS.flatMap((g) => g.kinds)).size).toBe(kinds.length);
    expect(questions).toHaveLength(kinds.length * TERMS.length * 8 * VALUES.length);
  });

  it("gives the verdict and the movements of classifyRevenue and movement for every question", () => {
    for (const q of questions) {
      const a = assessContract(q);
      const label = JSON.stringify(q);
      expect(a.verdict, label).toEqual(classifyRevenue(itemOf(q)));
      expect(a.start, label).toEqual(movement(itemOf(q), "start", otherOf(q)));
      expect(a.end, label).toEqual(movement(itemOf(q), "end", otherOf(q)));
      // The sentence for each day names the movement, or says MRR does not move.
      if (a.start.metric) expect(a.startReported, label).toContain(a.start.metric);
      else expect(a.startReported, label).toBe("Nothing in MRR");
      if (a.end.metric) expect(a.endReported, label).toContain(a.end.metric);
      else expect(a.endReported, label).toBe("Nothing in MRR, in churn or in contraction");
      expect(a.endReported.includes("a churned customer"), label).toBe(a.end.churnedCustomer);
      expect(a.endWhen === null, label).toBe(a.verdict.counts !== "yes");
    }
  });

  it("puts the amounts where the verdict puts the revenue", () => {
    for (const q of questions) {
      const a = assessContract(q);
      const label = JSON.stringify(q);
      const m = a.amounts;
      if (!m) continue;
      if (a.verdict.counts === "yes") {
        expect(m.mrr, label).toBeGreaterThan(0);
        expect(m.arr, label).toBe(m.mrr * 12);
        expect(m.outside, label).toBeNull();
        expect(m.annualised, label).toBeNull();
      } else {
        expect([m.mrr, m.arr], label).toEqual([0, 0]);
        expect(m.outside, label).toBeGreaterThan(0);
        expect(m.annualised !== null, label).toBe(a.verdict.line === "Fixed-term revenue");
      }
    }
    // A question with a value and a way to a monthly figure always has amounts; a free trial never does.
    for (const q of questions.filter((x) => x.monthlyValue !== undefined || (x.contractValue !== undefined && x.termMonths !== undefined && TERM_KINDS.includes(x.kind)))) {
      const a = assessContract(q);
      expect(a.amounts === null, JSON.stringify(q)).toBe(q.kind === "free_trial");
    }
  });

  it("answers the six-month contract for $30,000: nothing in MRR or ARR, where annualising would show $60,000", () => {
    const a = assessContract({ kind: "subscription", termMonths: 6, contractValue: 30000 });
    expect(a.title).toBe("Product access for 6 months with no renewal");
    expect(a.amounts).toEqual({ monthly: 5000, mrr: 0, arr: 0, outside: 30000, annualised: 60000 });
    expect(a.customer).toContain("fixed_term");
    expect(a.timeline).toEqual({ months: 6, inMrr: false, open: false, earlierTerm: false });
  });

  it("answers the contracts that count, by term or by renewal", () => {
    const year = assessContract({ kind: "subscription", termMonths: 12, contractValue: 60000 });
    expect(year.amounts).toEqual({ monthly: 5000, mrr: 5000, arr: 60000, outside: null, annualised: null });
    expect(year.endWhen).toContain("known from the start");
    expect(year.timeline).toEqual({ months: 12, inMrr: true, open: false, earlierTerm: false });
    const monthly = assessContract({ kind: "subscription", termMonths: 1, renews: true, monthlyValue: 500 });
    expect(monthly.amounts).toMatchObject({ mrr: 500, arr: 6000 });
    expect(monthly.timeline).toMatchObject({ inMrr: true, open: true });
    const open = assessContract({ kind: "subscription", monthlyValue: 500 });
    expect(open.title).toBe("Product access with no end date");
    expect(open.timeline).toEqual({ months: 12, inMrr: true, open: true, earlierTerm: false });
    const second = assessContract({ kind: "subscription", termMonths: 4, followsEarlierTerm: true, contractValue: 12000 });
    expect(second.amounts).toMatchObject({ mrr: 3000, arr: 36000 });
    expect(second.timeline).toEqual({ months: 4, inMrr: true, open: false, earlierTerm: true });
    expect(second.startReported).toBe("New MRR from its start date");
  });

  // The verdicts above are compared with classifyRevenue, which would agree with itself if a rule
  // were wrong. These are the rules as the standard states them, written out.
  it("draws the line at 12 months and at a renewal, for every kind the test reads by its term", () => {
    for (const kind of TERM_KINDS) {
      const counts = (q: Omit<ContractQuestion, "kind">) => assessContract({ kind, ...q }).verdict.counts;
      expect(counts({ termMonths: 11 }), kind).toBe("no");
      expect(counts({ termMonths: 12 }), kind).toBe("yes");
      expect(counts({ termMonths: 1, renews: true }), kind).toBe("yes");
      expect(counts({ termMonths: 4, followsEarlierTerm: true }), kind).toBe("yes");
      expect(counts({}), kind).toBe("yes");
      expect(assessContract({ kind, termMonths: 11 }).verdict.line, kind).toBe("Fixed-term revenue");
      expect(assessContract({ kind, termMonths: 11 }).end.metric, kind).toBeNull();
      expect(assessContract({ kind, termMonths: 12 }).verdict.changeNature, kind).toBe("temporary");
    }
    expect(assessContract({ kind: "professional_services" }).verdict.line).toBe("Services Revenue");
    expect(assessContract({ kind: "on_demand_usage" }).verdict.line).toBe("Consumption Revenue");
    expect(assessContract({ kind: "credit_pack" }).verdict.counts).toBe("no");
    expect(assessContract({ kind: "recurring_credits" }).verdict.counts).toBe("yes");
    expect(assessContract({ kind: "usage_above_commitment" }).verdict.line).toBe("Consumption Revenue");
    expect(assessContract({ kind: "usage_above_commitment", contractValue: 400 }).amounts).toMatchObject({ mrr: 0, arr: 0, outside: 400 });
    expect(assessContract({ kind: "one_time_fee" }).verdict.line).toBeNull();
    expect(assessContract({ kind: "free_trial" }).verdict.counts).toBe("no");
  });

  // A contract that follows an earlier term says nothing of how long that term ran, so the answer
  // leaves the earlier term its own answer: fixed-term revenue only where it ran under 12 months.
  it("leaves the earlier term its own answer", () => {
    const after = assessContract({ kind: "subscription", termMonths: 24, followsEarlierTerm: true });
    expect(after.verdict.rule).toContain("An earlier term under 12 months with no renewal stays fixed-term revenue.");
    expect(after.verdict.rule).not.toContain("the first term stays");
    expect(after.timeline?.earlierTerm).toBe(true);
    // Ticking both boxes keeps the earlier term in the picture, as it stays in the question.
    const both = assessContract({ kind: "subscription", termMonths: 6, renews: true, followsEarlierTerm: true });
    expect(both.question.followsEarlierTerm).toBe(true);
    expect(both.timeline).toEqual({ months: 6, inMrr: true, open: true, earlierTerm: true });
  });

  // Regression, 2026-11-26: with both amounts given the figures contradicted each other, $1,000 for
  // each month of a $30,000 six-month contract and $12,000 of ARR "on a contract worth $30,000".
  it("answers from one amount where two are given", () => {
    const term = assessContract({ kind: "subscription", termMonths: 6, contractValue: 30000, monthlyValue: 1000 });
    expect(term.question).toEqual({ kind: "subscription", termMonths: 6, monthlyValue: 1000 });
    expect(term.amounts).toEqual({ monthly: 1000, mrr: 0, arr: 0, outside: 6000, annualised: 12000 });
    const counted = assessContract({ kind: "subscription", termMonths: 12, contractValue: 60000, monthlyValue: 1000 });
    expect(counted.amounts).toMatchObject({ mrr: 1000, arr: 12000 });
    const once = assessContract({ kind: "one_time_fee", contractValue: 500, monthlyValue: 20 });
    expect(once.question).toEqual({ kind: "one_time_fee", contractValue: 500 });
    expect(once.amounts?.outside).toBe(500);
    for (const q of questions) {
      const a = assessContract({ ...q, contractValue: 30000, monthlyValue: 1000 });
      const label = JSON.stringify(q);
      expect(a.question.contractValue !== undefined && a.question.monthlyValue !== undefined, label).toBe(false);
      if (a.amounts?.monthly != null && a.amounts.outside !== null) expect(a.amounts.outside, label).toBe(a.amounts.monthly * a.question.termMonths!);
    }
  });

  // Regression, 2026-11-26: a term or an amount that is no usable number reached the arithmetic,
  // where 1e308 a month printed "$∞" of ARR and a term of 0 divided a contract value by zero.
  it("holds the term and the amounts inside their bounds", () => {
    expect(assessContract({ kind: "subscription", termMonths: 0, contractValue: 1200 }).question.termMonths).toBe(1);
    expect(assessContract({ kind: "subscription", termMonths: 6.4 }).question.termMonths).toBe(6);
    expect(assessContract({ kind: "subscription", termMonths: 100000 }).question.termMonths).toBe(MAX_TERM_MONTHS);
    expect(() => assessContract({ kind: "subscription", termMonths: Number.NaN })).toThrow(RangeError);
    expect(() => assessContract({ kind: "subscription", termMonths: Infinity })).toThrow(RangeError);
    for (const bad of [1e308, Infinity, Number.NaN, MAX_AMOUNT * 10, 0, -5]) {
      const a = assessContract({ kind: "subscription", termMonths: 12, monthlyValue: bad, contractValue: bad });
      expect(a.amounts, String(bad)).toBeNull();
    }
    const top = assessContract({ kind: "subscription", termMonths: 12, monthlyValue: MAX_AMOUNT });
    expect(Number.isFinite(top.amounts!.arr)).toBe(true);
    for (const q of questions) {
      const m = assessContract(q).amounts;
      if (m) for (const n of Object.values(m)) expect(n === null || Number.isFinite(n), JSON.stringify(q)).toBe(true);
    }
  });

  it("carries no amount for a kind whose answer shows none, and says which amount each kind reads", () => {
    for (const kind of UNPRICED_KINDS) {
      const a = assessContract({ kind, contractValue: 900, monthlyValue: 75 });
      expect(a.question.contractValue ?? a.question.monthlyValue, kind).toBeUndefined();
      expect(a.amounts, kind).toBeNull();
      expect(questionToQuery({ kind, contractValue: 900 }), kind).not.toContain("value");
      expect(amountBasis({ kind }), kind).toBeNull();
    }
    expect(amountBasis({ kind: "subscription", termMonths: 6 })).toBe("either");
    expect(amountBasis({ kind: "subscription" })).toBe("monthly");
    expect(amountBasis({ kind: "recurring_credits" })).toBe("monthly");
    expect(amountBasis({ kind: "one_time_fee" })).toBe("charged");
    // The basis names an amount that gives figures: passing it always does.
    for (const q of questions) {
      const basis = amountBasis(q);
      const label = JSON.stringify(q);
      if (basis === "either") expect(assessContract({ ...q, monthlyValue: undefined, contractValue: 100 }).amounts, label).not.toBeNull();
      if (basis === "either" || basis === "monthly") expect(assessContract({ ...q, contractValue: undefined, monthlyValue: 100 }).amounts, label).not.toBeNull();
      if (basis === "monthly") expect(assessContract({ ...q, monthlyValue: undefined, contractValue: 100 }).amounts, label).toBeNull();
      if (basis === "charged") expect(assessContract({ ...q, monthlyValue: undefined, contractValue: 100 }).amounts, label).not.toBeNull();
    }
  });

  it("treats an add-on as sitting beside a subscription and drops the term of a kind that has none", () => {
    const addOn = assessContract({ kind: "add_on", termMonths: 12 });
    expect(addOn.question.otherMrr).toBe(true);
    expect(addOn.start.metric).toBe("Expansion MRR");
    expect(addOn.end).toEqual({ metric: "Contraction MRR", churnedCustomer: false });
    expect(addOn.customer).toBeNull();
    const services = assessContract({ kind: "professional_services", termMonths: 24, renews: true, contractValue: 40000 });
    expect(services.question).toEqual({ kind: "professional_services", contractValue: 40000 });
    expect(services.amounts).toEqual({ monthly: null, mrr: 0, arr: 0, outside: 40000, annualised: null });
    expect(services.timeline).toBeNull();
    expect(assessContract({ kind: "credit_pack" }).customer).toContain("pay_as_you_go");
  });

  it("writes each question as a query and reads the same question back", () => {
    for (const q of questions) {
      const query = questionToQuery(q);
      const back = questionFromQuery(query);
      expect(back, query).toEqual(assessContract(q).question);
      expect(questionToQuery(back!), query).toBe(query);
    }
    expect(questionToQuery({ kind: "subscription", termMonths: 6, contractValue: 30000 })).toBe("kind=subscription&term=6&value=30000");
    expect(questionToQuery({ kind: "subscription", renews: true, otherMrr: true, monthlyValue: 500 })).toBe("kind=subscription&term=none&renews=1&other=1&monthly=500");
    expect(questionFromQuery("?kind=subscription&term=6&value=30000")).toEqual({ kind: "subscription", termMonths: 6, contractValue: 30000 });
    expect(questionFromQuery("kind=subscription&term=9999")?.termMonths).toBe(MAX_TERM_MONTHS);
    for (const bad of ["", "kind=", "kind=nonsense", "term=6", "utm_source=x"]) expect(questionFromQuery(bad), bad).toBeNull();
    expect(questionFromQuery("kind=pilot&term=3&value=-4&monthly=x")).toEqual({ kind: "pilot", termMonths: 3 });
    // Every key a question is written with is declared, so the calculator replaces all of them in the address.
    for (const q of questions) for (const key of new URLSearchParams(questionToQuery(q)).keys()) expect(QUERY_KEYS, key).toContain(key);
  });

  // Regression, 2026-11-26: a missing or malformed term was read as "no end date", so
  // ?kind=subscription&term=6.5 answered "Yes, counts" for a contract of about six months.
  it("reads no end date from term=none alone", () => {
    expect(questionFromQuery("kind=subscription&term=none")).toEqual({ kind: "subscription" });
    for (const term of ["", "0", "-3", "6.5", "abc", "1e2", " 6", "none "]) {
      expect(questionFromQuery(`kind=subscription&term=${term}`), term).toBeNull();
      expect(questionFromQuery(`kind=pilot&term=${term}&renews=1`), term).toBeNull();
    }
    for (const kind of TERM_KINDS) expect(questionFromQuery(`kind=${kind}`), kind).toBeNull();
    // A kind with no term needs none and ignores one.
    expect(questionFromQuery("kind=one_time_fee")).toEqual({ kind: "one_time_fee" });
    expect(questionFromQuery("kind=credit_pack&term=abc&value=40")).toEqual({ kind: "credit_pack", contractValue: 40 });
  });

  // Regression, 2026-11-26: an encoded amount failed to parse and was dropped in silence, and an
  // amount too large for the arithmetic was kept.
  it("reads an encoded amount and drops one it cannot use", () => {
    expect(questionFromQuery("kind=subscription&term=6&value=30%2C000")?.contractValue).toBe(30000);
    expect(questionFromQuery("kind=subscription&term=6&value=%2430000")?.contractValue).toBe(30000);
    expect(questionFromQuery("?kind=subscription&term=none&monthly=1%2C250.50")?.monthlyValue).toBe(1250.5);
    for (const value of ["1e308", "Infinity", "NaN", "", "abc", "-4", "0"]) expect(questionFromQuery(`kind=subscription&term=6&value=${value}`), value).toEqual({ kind: "subscription", termMonths: 6 });
  });

  it("holds presets that each survive the query form and give a different answer from the first", () => {
    expect(PRESETS[0].question).toEqual({ kind: "subscription", termMonths: 6, contractValue: 30000 });
    expect(new Set(PRESETS.map((p) => p.label)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(questionFromQuery(questionToQuery(p.question)), p.label).toEqual(assessContract(p.question).question);
      expect(describeContract(p.question).length, p.label).toBeGreaterThan(0);
      // The title opens with the noun the calculator's sentence prints for the kind
      expect(describeContract(p.question).startsWith(kindNoun(p.question.kind)), p.label).toBe(true);
    }
    for (const kind of Object.keys(KIND_LABELS) as RevenueKind[]) expect(kindNoun(kind).length, kind).toBeGreaterThan(0);
    expect(new Set(PRESETS.map((p) => assessContract(p.question).verdict.line)).size).toBeGreaterThanOrEqual(4);
  });

  // 2026-11-27: a reader asked where a contract of several years goes. The slider stops at 36
  // months and "One fixed year" read as the only contract with a set end.
  it("holds a contract of several years, counted at one year's value", () => {
    const preset = PRESETS.find((p) => p.label === "Three-year contract");
    expect(preset?.question).toEqual({ kind: "subscription", termMonths: 36, contractValue: 108000 });
    const a = assessContract(preset!.question);
    expect(a.verdict.counts).toBe("yes");
    expect(a.amounts).toMatchObject({ mrr: 3000, arr: 36000 });
    const amount = (id: string) => a.places.find((p) => p.id === id)?.amount;
    expect(amount("acv")).toBe(36000);
    expect(amount("bookings")).toBe(108000);
    // The four the homepage prints stay the first four, the year without a renewal among them.
    expect(PRESETS.slice(0, 4).map((p) => p.label)).toEqual(["Six months, no renewal", "Monthly plan", "One year, no renewal", "Paid pilot"]);
  });

  it("prints money with thousands separators and cents only when there are some", () => {
    expect(formatMoney(30000)).toBe("$30,000");
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(833.3333)).toBe("$833.33");
    expect(formatMoney(1250.5)).toBe("$1,250.50");
  });
});

// A customer who comes back and a trial that converts: two circumstances of the customer,
// read for a contract that counts and sold to a customer with no other MRR.
describe("a returning customer and a trial that converts", () => {
  const year = { kind: "subscription" as const, termMonths: 12, renews: true, contractValue: 24000 };

  it("reports a contract that counts as Reactivation MRR and keeps the customer out of New Customers", () => {
    const a = assessContract({ ...year, returning: true });
    expect(a.start).toEqual({ metric: "Reactivation MRR", churnedCustomer: false });
    expect(a.startReported).toBe("Reactivation MRR from its start date, counted apart from New MRR");
    expect(a.end.metric).toBe("Churned MRR");
    expect(a.customer).toContain("Total Customers again");
    expect(a.customer).toContain("stays out of New Customers");
    const by = (id: PlaceId) => a.places.find((p) => p.id === id)!;
    expect(by("new_customers").counts).toBe("no");
    expect(by("total_customers").counts).toBe("yes");
    expect(by("nrr").answer).toContain("the Market form (NRR-M) counts the reactivation and the Operating form (NRR-O) leaves it out");
    expect(standard("metrics/core.md")).toContain("Reactivated customers, who return through a `reactivation` event and are counted in Reactivation MRR");
  });

  it("drops returning for a customer with other MRR and for a contract that stays out of MRR", () => {
    expect(assessContract({ ...year, returning: true, otherMrr: true }).question.returning).toBeUndefined();
    expect(assessContract({ ...year, returning: true, otherMrr: true }).start.metric).toBe("Expansion MRR");
    expect(assessContract({ kind: "subscription", termMonths: 6, returning: true }).question).toEqual({ kind: "subscription", termMonths: 6 });
    expect(assessContract({ kind: "add_on", termMonths: 12, returning: true }).question.returning).toBeUndefined();
    expect(assessContract({ kind: "professional_services", returning: true, afterTrial: true }).question).toEqual({ kind: "professional_services" });
  });

  it("starts a converted trial as New MRR on the day it converts and counts the trial as converted", () => {
    const a = assessContract({ kind: "subscription", termMonths: 1, renews: true, afterTrial: true, monthlyValue: 99 });
    expect(a.start.metric).toBe("New MRR");
    expect(a.startReported).toBe("New MRR from its start date, the day the trial converts");
    expect(a.customer).toContain("the day the trial converts");
    expect(a.places.find((p) => p.id === "trial_to_paid")).toMatchObject({ counts: "yes", group: "Customers" });
    expect(a.places.find((p) => p.id === "new_customers")?.counts).toBe("yes");
    // The trial itself is counted in the period it ends, converted or not.
    const trial = assessContract({ kind: "free_trial" });
    expect(trial.places.find((p) => p.id === "trial_to_paid")?.counts).toBe("yes");
    expect(trial.places.find((p) => p.id === "total_customers")?.answer).toContain("not customers until they pay");
    expect(standard("metrics/core.md")).toContain("Trial and free accounts are not customers until they pay");
    expect(standard("metrics/product.md")).toContain("A trial that converts before its end date ends on the day it converts");
  });

  it("reads a trial for a new customer alone", () => {
    expect(assessContract({ ...year, afterTrial: true, returning: true }).question).toMatchObject({ returning: true });
    expect(assessContract({ ...year, afterTrial: true, returning: true }).question.afterTrial).toBeUndefined();
    expect(assessContract({ ...year, afterTrial: true, otherMrr: true }).question.afterTrial).toBeUndefined();
    expect(assessContract({ kind: "subscription", termMonths: 3, afterTrial: true }).question.afterTrial).toBeUndefined();
  });

  it("writes both circumstances into the query and reads them back", () => {
    expect(questionToQuery({ ...year, returning: true })).toBe("kind=subscription&term=12&renews=1&returning=1&value=24000");
    expect(questionToQuery({ kind: "subscription", termMonths: 1, renews: true, afterTrial: true, monthlyValue: 99 })).toBe("kind=subscription&term=1&renews=1&trial=1&monthly=99");
    for (const returning of [false, true]) for (const afterTrial of [false, true]) for (const otherMrr of [false, true]) for (const termMonths of [undefined, 6, 12]) for (const kind of REVENUE_KINDS) {
      const q: ContractQuestion = { kind, termMonths, returning, afterTrial, otherMrr };
      const query = questionToQuery(q);
      expect(questionFromQuery(query), query).toEqual(assessContract(q).question);
      for (const key of new URLSearchParams(query).keys()) expect(QUERY_KEYS, key).toContain(key);
    }
  });
});

// Every metric a contract reaches. The answers restate rules the standard prints, so each
// family of answers is checked against the verdict and the movements, and the sentences an
// answer borrows are checked against the standard's text.
describe("every metric a contract reaches", () => {
  const TERMS = [undefined, 1, 6, 12, 24];
  const FLAGS = [false, true];
  const questions: ContractQuestion[] = [];
  for (const kind of REVENUE_KINDS)
    for (const termMonths of TERMS)
      for (const renews of FLAGS)
        for (const followsEarlierTerm of FLAGS)
          for (const otherMrr of FLAGS)
            for (const returning of FLAGS)
              for (const afterTrial of FLAGS) for (const value of [{}, { contractValue: 30000 }, { monthlyValue: 500 }]) questions.push({ kind, termMonths, renews, followsEarlierTerm, otherMrr, returning, afterTrial, ...value });
  const by = (a: { places: Place[] }, id: PlaceId) => a.places.find((p) => p.id === id);
  const ALWAYS: PlaceId[] = ["mrr", "arr", "carr", "bookings", "billings", "acv", "nrr", "grr", "adjusted_retention"];

  it("names every place once, with a label and a group", () => {
    expect([...PLACE_IDS].sort()).toEqual(Object.keys(PLACE_LABELS).sort());
    expect(new Set(PLACE_IDS).size).toBe(PLACE_IDS.length);
    expect(PLACE_GROUPS.map((g) => g.label)).toEqual(["Recurring revenue", "Signed and invoiced", "Retention", "Customers", "Beside MRR"]);
  });

  // Every kind against every term, flag and amount: several thousand answers, so the default five seconds is short on a busy machine.
  it("answers each place once, in order, in the standard's style", () => {
    for (const q of questions) {
      const a = assessContract(q);
      const label = JSON.stringify(q);
      const ids = a.places.map((p) => p.id);
      expect(new Set(ids).size, label).toBe(ids.length);
      expect(ids, label).toEqual(PLACE_IDS.filter((id) => ids.includes(id)));
      for (const id of ALWAYS) expect(ids, label).toContain(id);
      for (const p of a.places) {
        expect(p.metric, label).toBe(PLACE_LABELS[p.id]);
        expect(PLACE_GROUPS.find((g) => g.label === p.group)?.ids, label).toContain(p.id);
        expect(p.answer, label).not.toMatch(/—|–|, and |, or |\.$/);
        expect(p.answer.startsWith("Yes"), `${label} ${p.id}`).toBe(p.counts === "yes");
        expect(p.answer.startsWith("No"), `${label} ${p.id}`).toBe(p.counts === "no");
        if (p.amount !== null) expect(Number.isFinite(p.amount) && p.amount > 0, `${label} ${p.id}`).toBe(true);
        if (p.counts === "no") expect(p.amount, `${label} ${p.id}`).toBeNull();
      }
    }
  }, 60_000);

  it("puts each place where the verdict and the movements put the contract", () => {
    for (const q of questions) {
      const a = assessContract(q);
      const label = JSON.stringify(q);
      const counts = a.verdict.counts;
      const tri = counts === "yes" ? "yes" : "no";
      for (const id of ["mrr", "arr", "carr"] as const) expect(by(a, id)!.counts, `${label} ${id}`).toBe(tri);
      expect(by(a, "mrr")!.amount, label).toBe(counts === "yes" ? a.amounts?.mrr ?? null : null);
      expect(by(a, "arr")!.amount, label).toBe(counts === "yes" ? a.amounts?.arr ?? null : null);
      expect(by(a, "acv")!.counts, label).toBe(counts === "yes" ? "yes" : "no");
      // Retention: GRR and Revenue Churn Rate move at the end of a contract that counts and at no other time.
      expect(by(a, "grr")!.counts === "yes", label).toBe(counts === "yes");
      if (counts === "yes") expect(by(a, "grr")!.answer, label).toContain(a.end.metric!);
      expect(by(a, "adjusted_retention")!.counts === "yes", label).toBe(counts === "yes" && a.verdict.changeNature === "permanent");
      expect(by(a, "nrr")!.counts === "no", label).toBe(counts === "no");
      // Customers: the counts move with the first and the last day.
      expect(by(a, "new_customers")?.counts === "yes", label).toBe(a.start.metric === "New MRR");
      expect(by(a, "logo_churn_rate")?.counts === "yes", label).toBe(a.end.churnedCustomer);
      expect(by(a, "total_customers")?.counts === "yes", label).toBe(a.start.metric === "New MRR" || a.start.metric === "Reactivation MRR");
      expect(by(a, "trial_to_paid") !== undefined, label).toBe(a.question.kind === "free_trial" || Boolean(a.question.afterTrial));
      // Beside MRR: the line the verdict names.
      expect(by(a, "fixed_term_revenue") !== undefined, label).toBe(a.verdict.line === "Fixed-term revenue");
      expect(by(a, "services_revenue") !== undefined, label).toBe(a.verdict.line === "Services Revenue");
      if (a.verdict.line === "Consumption Revenue") expect(by(a, "consumption_revenue")?.counts, label).toBe("yes");
      if (by(a, "fixed_term_revenue")) expect(by(a, "fixed_term_revenue")!.amount, label).toBe(a.amounts?.outside ?? null);
    }
  });

  it("books a contract at its total contract value, whether or not it counts in MRR", () => {
    const fixed = assessContract({ kind: "subscription", termMonths: 6, contractValue: 30000 });
    expect(by(fixed, "bookings")).toMatchObject({ counts: "yes", amount: 30000 });
    expect(by(fixed, "acv")!.answer).toContain("carries no ACV");
    expect(by(fixed, "carr")!.answer).toBe("No. A fixed-term contract carries no ACV and adds nothing to CARR");
    const multi = assessContract({ kind: "subscription", termMonths: 36, renews: true, monthlyValue: 1000 });
    expect(by(multi, "bookings")).toMatchObject({ amount: 36000 });
    expect(by(multi, "bookings")!.answer).toContain("as New Bookings");
    expect(by(multi, "acv")).toMatchObject({ amount: 12000 });
    expect(by(multi, "carr")).toMatchObject({ amount: 12000 });
    expect(by(assessContract({ kind: "subscription", termMonths: 12, followsEarlierTerm: true }), "bookings")!.answer).toContain("as Renewal Bookings");
    expect(by(assessContract({ kind: "subscription", termMonths: 12, otherMrr: true }), "bookings")!.answer).toContain("as Expansion Bookings");
    expect(by(assessContract({ kind: "subscription", monthlyValue: 500 }), "bookings")).toMatchObject({ counts: "yes", amount: null });
    expect(by(assessContract({ kind: "professional_services", contractValue: 40000 }), "bookings")).toMatchObject({ counts: "yes", amount: 40000 });
    expect(by(assessContract({ kind: "credit_pack", contractValue: 5000 }), "bookings")).toMatchObject({ counts: "yes", amount: 5000 });
    for (const kind of ["on_demand_usage", "usage_above_commitment", "free_trial"] as const) expect(by(assessContract({ kind }), "bookings")!.counts, kind).toBe("no");
    expect(by(assessContract({ kind: "free_trial" }), "billings")!.counts).toBe("no");
    for (const kind of REVENUE_KINDS.filter((k) => k !== "free_trial")) expect(by(assessContract({ kind }), "billings")!.counts, kind).toBe("yes");
  });

  it("books a perpetual licence fee and hardware at what is charged and keeps them out of CARR and ACV", () => {
    for (const kind of ["perpetual_licence", "hardware"] as const) {
      const a = assessContract({ kind, contractValue: 100000 });
      expect(a.verdict.counts, kind).toBe("no");
      expect(a.amounts, kind).toMatchObject({ mrr: 0, arr: 0, outside: 100000 });
      for (const id of ["mrr", "arr", "carr", "acv", "nrr", "grr", "adjusted_retention"] as const) expect(by(a, id)!.counts, `${kind} ${id}`).toBe("no");
      expect(by(a, "bookings"), kind).toMatchObject({ counts: "yes", amount: 100000 });
      expect(by(a, "billings")!.counts, kind).toBe("yes");
      expect(by(a, "services_revenue"), kind).toBeUndefined();
      expect(by(a, "fixed_term_revenue"), kind).toBeUndefined();
      expect(a.start.metric, kind).toBeNull();
      expect(a.end, kind).toEqual({ metric: null, churnedCustomer: false });
    }
    // A term licence on premises for three years is answered as the same subscription is.
    const licence = assessContract({ kind: "term_licence", termMonths: 36, renews: true, contractValue: 180000 });
    const subscription = assessContract({ kind: "subscription", termMonths: 36, renews: true, contractValue: 180000 });
    expect(licence.amounts).toEqual(subscription.amounts);
    expect(licence.amounts).toMatchObject({ mrr: 5000, arr: 60000 });
    expect(licence.places.map((p) => [p.id, p.counts, p.amount])).toEqual(subscription.places.map((p) => [p.id, p.counts, p.amount]));
    expect(describeContract(licence.question)).toContain("A term licence");
  });

  it("keeps usage above a commitment out of every MRR metric and in Usage Run-Rate, and a temporary contract out of the adjusted variants", () => {
    const over = assessContract({ kind: "usage_above_commitment", contractValue: 400 });
    for (const id of ["mrr", "arr", "carr", "nrr", "grr", "adjusted_retention", "total_customers", "new_customers", "logo_churn_rate"] as const) expect(by(over, id)!.counts, id).toBe("no");
    expect(over.start.metric).toBeNull();
    expect(over.end.metric).toBeNull();
    expect(by(over, "consumption_revenue")).toMatchObject({ counts: "yes", amount: 400 });
    expect(by(over, "consumption_revenue")!.answer).toContain("overage");
    // Usage Run-Rate read on-demand and top-up consumption alone while overage sat in MRR.
    expect(by(over, "usage_run_rate")!.counts).toBe("yes");
    const eighteen = assessContract({ kind: "subscription", termMonths: 18 });
    expect(by(eighteen, "adjusted_retention")!.counts).toBe("no");
    expect(by(eighteen, "carr")!.answer).toContain("CARR net of known churn takes it off");
    expect(by(assessContract({ kind: "subscription", termMonths: 12, renews: true }), "adjusted_retention")!.counts).toBe("yes");
  });

  it("sends usage and credits to the metrics that carry them", () => {
    const pack = assessContract({ kind: "credit_pack", contractValue: 5000 });
    expect(by(pack, "consumption_revenue")).toMatchObject({ counts: "yes", amount: 5000 });
    expect(by(pack, "consumption_revenue")!.answer).toContain("top_up");
    expect(by(pack, "usage_run_rate")!.counts).toBe("yes");
    expect(by(pack, "prepaid_credit_balance")!.counts).toBe("yes");
    expect(by(pack, "total_customers")!.answer).toContain("pay_as_you_go");
    const demand = assessContract({ kind: "on_demand_usage" });
    expect(by(demand, "consumption_revenue")!.answer).toContain("on_demand");
    expect(by(demand, "usage_run_rate")!.counts).toBe("yes");
    expect(by(demand, "prepaid_credit_balance")!.counts).toBe("no");
    const committed = assessContract({ kind: "committed_usage", termMonths: 12 });
    expect(by(committed, "consumption_revenue")!.counts).toBe("part");
    expect(by(committed, "usage_run_rate")!.counts).toBe("no");
    expect(by(committed, "prepaid_credit_balance")!.counts).toBe("part");
    expect(by(assessContract({ kind: "recurring_credits" }), "prepaid_credit_balance")!.counts).toBe("yes");
    // A commitment under 12 months with no renewal is fixed-term revenue: no usage place speaks for it.
    const short = assessContract({ kind: "committed_usage", termMonths: 6 });
    expect(by(short, "consumption_revenue")).toBeUndefined();
    expect(by(short, "fixed_term_revenue")!.counts).toBe("yes");
  });

  // The sentences the answers borrow, where the standard prints them.
  it("restates rules the standard prints", () => {
    const finance = standard("metrics/finance.md");
    const core = standard("metrics/core.md");
    const all = [finance, core, standard("metrics/sales.md"), standard("definitions.md"), standard("cel.md")].join("\n");
    for (const quoted of [
      "carries no ACV and adds nothing to CARR",
      "One customer is one billing entity, whatever its number of users, seats or subscriptions",
      "Count of customers with a new revenue event",
      "expansion of an existing customer, however large",
      "which draw no balance",
      "Usage within a ratable commitment: that revenue is the commitment itself, already in MRR",
      "Usage Run-Rate carries the usage billed above them, on-demand consumption and top-up consumption",
      "counts in bookings and billings",
      "Notice of a future ending changes nothing until that day",
      "has no event in the ledger, so the tags never reach it",
    ]) expect(all, quoted).toContain(quoted);
    expect(all).toMatch(/One-time fees \(setup, implementation, training\)/);
  });
});

// A contract with several lines: each line answered by its own kind and term.
describe("assessDeal", () => {
  const sub = { kind: "subscription" as const, termMonths: 12, renews: true, contractValue: 60000 };
  const services = { kind: "professional_services" as const, contractValue: 15000 };
  const pack = { kind: "credit_pack" as const, contractValue: 5000 };
  const strip = (a: Assessment) => ({ ...a, question: { ...a.question, otherMrr: undefined, returning: undefined, afterTrial: undefined } });

  it("gives one line the answer assessContract gives, and the same address", () => {
    for (const kind of REVENUE_KINDS)
      for (const termMonths of [undefined, 3, 12])
        for (const renews of [false, true])
          for (const otherMrr of [false, true])
            for (const returning of [false, true])
              for (const afterTrial of [false, true])
                for (const value of [{}, { contractValue: 30000 }, { monthlyValue: 500 }]) {
                  const q: ContractQuestion = { kind, termMonths, renews, otherMrr, returning, afterTrial, ...value };
                  const label = JSON.stringify(q);
                  const one = assessContract(q);
                  const deal = assessDeal({ lines: [q], otherMrr, returning, afterTrial, bundleValue: 999 });
                  expect(deal.lines, label).toHaveLength(1);
                  expect(strip(deal.lines[0]), label).toEqual(strip(one));
                  expect(deal.customer, label).toBe(one.customer);
                  expect(deal.allocation, label).toBeNull();
                  expect(deal.title, label).toBe(one.title);
                  expect(dealToQuery({ lines: [q], otherMrr, returning, afterTrial }), label).toBe(questionToQuery(q));
                  expect(Boolean(deal.question.otherMrr), label).toBe(Boolean(one.question.otherMrr));
                  expect(deal.question.returning, label).toBe(one.question.returning);
                  expect(deal.question.afterTrial, label).toBe(one.question.afterTrial);
                }
  });

  it("answers a subscription, an implementation fee and a credit pack line by line", () => {
    const d = assessDeal({ lines: [sub, services, pack] });
    expect(d.title).toBe("A contract with 3 lines");
    expect(d.lines.map((l) => l.verdict.counts)).toEqual(["yes", "no", "no"]);
    expect(d.lines.map((l) => l.verdict.line)).toEqual(["MRR and ARR", "Services Revenue", "Consumption Revenue"]);
    expect(d.lines[0].start.metric).toBe("New MRR");
    expect(d.lines[0].end).toEqual({ metric: "Churned MRR", churnedCustomer: true });
    const total = Object.fromEntries(d.totals.map((t) => [t.id, t.amount]));
    expect(total).toEqual({ mrr: 5000, arr: 60000, carr: 60000, acv: 60000, bookings: 80000, services_revenue: 15000, consumption_revenue: 5000 });
    expect(d.totals.every((t) => t.complete)).toBe(true);
    expect(d.customer).toContain("Total Customers");
    // The credit pack sits beside a subscription, so the customer is no pay-as-you-go account.
    expect(d.lines[2].customer).toBeNull();
    expect(d.lines[2].places.find((p) => p.id === "total_customers")?.answer).toContain("No change");
  });

  // cel.md, rule 5: an increase on a date the customer started at 0 is new, a decrease on a date
  // the customer ends at 0 is churn and any other decrease is contraction.
  it("starts every line of a new customer as New MRR and ends the last of them as churn", () => {
    const d = assessDeal({ lines: [sub, { kind: "add_on", termMonths: 12, renews: true, contractValue: 12000 }] });
    expect(d.question.otherMrr).toBeUndefined();
    expect(d.lines.map((l) => l.start.metric)).toEqual(["New MRR", "New MRR"]);
    expect(d.lines.map((l) => l.end.metric)).toEqual(["Contraction MRR", "Contraction MRR"]);
    for (const l of d.lines) {
      expect(l.endReported).toContain("The last of those lines to end is Churned MRR");
      expect(l.places.find((p) => p.id === "logo_churn_rate")?.counts).toBe("part");
      expect(l.places.find((p) => p.id === "new_customers")?.counts).toBe("yes");
      expect(l.places.find((p) => p.id === "bookings")?.answer).toContain("as New Bookings");
    }
    expect(d.customer).toContain("when the last line that counts ends");
    const back = assessDeal({ lines: [sub, { kind: "add_on", termMonths: 12, renews: true }], returning: true });
    expect(back.lines.map((l) => l.start.metric)).toEqual(["Reactivation MRR", "Reactivation MRR"]);
    const existing = assessDeal({ lines: [sub, { kind: "add_on", termMonths: 12, renews: true }], otherMrr: true, returning: true });
    expect(existing.question.returning).toBeUndefined();
    expect(existing.lines.map((l) => l.start.metric)).toEqual(["Expansion MRR", "Expansion MRR"]);
    expect(existing.lines.map((l) => l.end.metric)).toEqual(["Contraction MRR", "Contraction MRR"]);
    expect(existing.customer).toBeNull();
  });

  it("reads an add-on or usage above a commitment with no line beside it that counts as a customer with MRR", () => {
    const alone = assessDeal({ lines: [{ kind: "add_on", termMonths: 12 }, services] });
    expect(alone.question.otherMrr).toBe(true);
    expect(alone.lines[0].start.metric).toBe("Expansion MRR");
    // A fixed-term line is no anchor: it holds no MRR.
    const short = assessDeal({ lines: [{ kind: "subscription", termMonths: 6 }, { kind: "usage_above_commitment" }] });
    expect(short.question.otherMrr).toBe(true);
    const anchored = assessDeal({ lines: [sub, { kind: "usage_above_commitment", contractValue: 400 }] });
    expect(anchored.question.otherMrr).toBeUndefined();
    // The usage is no movement of MRR: the subscription's line carries the deal's and the usage is Consumption Revenue.
    expect(anchored.lines[1].start.metric).toBeNull();
    expect(anchored.lines[1].end.metric).toBeNull();
    expect(anchored.lines[0].start.metric).toBe("New MRR");
    expect(anchored.lines[0].end.metric).toBe("Churned MRR");
    expect(anchored.totals.find((x) => x.id === "mrr")!.amount).toBe(5000);
    expect(anchored.totals.find((x) => x.id === "consumption_revenue")!.amount).toBe(400);
  });

  it("names the customer status of a contract with no line that counts", () => {
    expect(assessDeal({ lines: [{ kind: "subscription", termMonths: 6 }, services] }).customer).toContain("fixed_term");
    expect(assessDeal({ lines: [pack, { kind: "one_time_fee" }] }).customer).toContain("pay_as_you_go");
    expect(assessDeal({ lines: [{ kind: "subscription", termMonths: 6 }, pack] }).customer).toBeNull();
    expect(assessDeal({ lines: [services, { kind: "one_time_fee" }] }).customer).toBeNull();
  });

  // core.md, Bundle Pricing and MRR Allocation: $300, $200 and $100 of standalone price
  // sold at $500 allocate $250, $167 and $83.
  it("shares a bundle price by relative standalone price, as the standard's example does", () => {
    const d = assessDeal(DEAL_PRESETS[2].question);
    expect(d.allocation).toMatchObject({ basis: "monthly", price: 500, standalone: [300, 200, 100] });
    expect(d.allocation!.allocated.map((n) => Math.round(n))).toEqual([250, 167, 83]);
    expect(d.lines.map((l) => Math.round(l.amounts!.mrr))).toEqual([250, 167, 83]);
    expect(d.totals.find((t) => t.id === "mrr")!.amount).toBeCloseTo(500, 9);
    expect(d.allocationNote).toBeNull();
    const core = standard("metrics/core.md");
    expect(core).toContain("Item MRR = (Item SSP / Sum of all item SSPs) × Bundle Price");
    expect(core).toMatch(/\$250[\s\S]{0,200}\$167[\s\S]{0,200}\$83/);
  });

  it("shares a price over the whole contract across lines that stay out of MRR too", () => {
    const d = assessDeal({ lines: [sub, services, pack], bundleValue: 64000 });
    expect(d.allocation).toMatchObject({ basis: "total", price: 64000, standalone: [60000, 15000, 5000] });
    expect(d.allocation!.allocated).toEqual([48000, 12000, 4000]);
    expect(d.lines[0].amounts).toMatchObject({ mrr: 4000, arr: 48000 });
    expect(d.lines[1].amounts?.outside).toBe(12000);
    expect(d.totals.find((t) => t.id === "bookings")).toEqual({ id: "bookings", metric: "Bookings", amount: 64000, complete: true });
    // Where both prices are given the whole-contract price is read.
    expect(assessDeal({ lines: [sub, services], bundleValue: 100, bundleMonthly: 5 }).question.bundleMonthly).toBeUndefined();
  });

  it("leaves a bundle price unallocated when a line has no standalone price on its basis", () => {
    const noEnd = assessDeal({ lines: [{ kind: "subscription", monthlyValue: 500 }, services], bundleValue: 20000 });
    expect(noEnd.allocation).toBeNull();
    expect(noEnd.allocationNote).toContain("an end date for every line");
    expect(noEnd.lines[0].amounts?.mrr).toBe(500);
    const once = assessDeal({ lines: [{ kind: "subscription", termMonths: 12, monthlyValue: 500 }, services], bundleMonthly: 400 });
    expect(once.allocation).toBeNull();
    expect(once.allocationNote).toContain("priced by the month");
    const missing = assessDeal({ lines: [sub, { kind: "professional_services" }], bundleValue: 50000 });
    expect(missing.allocation).toBeNull();
    expect(missing.totals.find((t) => t.id === "bookings")).toMatchObject({ amount: 60000, complete: false });
  });

  it("holds between one line and the most a question carries", () => {
    expect(() => assessDeal({ lines: [] })).toThrow(RangeError);
    expect(() => assessDeal({ lines: Array.from({ length: MAX_LINES + 1 }, () => sub) })).toThrow(RangeError);
    expect(assessDeal({ lines: Array.from({ length: MAX_LINES }, () => sub) }).lines).toHaveLength(MAX_LINES);
  });

  it("writes a contract as a query and reads the same contract back", () => {
    const deals: DealQuestion[] = [
      ...DEAL_PRESETS.map((p) => p.question),
      { lines: [sub, services, pack], bundleValue: 64000, returning: true },
      { lines: [{ kind: "subscription", termMonths: 1, renews: true, monthlyValue: 99 }, { kind: "one_time_fee", contractValue: 500 }], afterTrial: true },
      { lines: [{ kind: "add_on", termMonths: 12 }, services] },
      { lines: [sub, { kind: "subscription" }, { kind: "pilot", termMonths: 3, followsEarlierTerm: true }], otherMrr: true },
    ];
    for (const q of deals) {
      const query = dealToQuery(q);
      const back = dealFromQuery(query);
      expect(back, query).toEqual(assessDeal(q).question);
      expect(dealToQuery(back!), query).toBe(query);
      for (const key of new URLSearchParams(query).keys()) expect(QUERY_KEYS, key).toContain(key);
    }
    expect(dealToQuery(DEAL_PRESETS[0].question)).toBe("kind=subscription&term=12&renews=1&value=60000&line=kind%3Dprofessional_services%26value%3D15000&line=kind%3Dcredit_pack%26value%3D5000");
    expect(dealFromQuery("kind=subscription&term=6&value=30000")).toEqual({ lines: [{ kind: "subscription", termMonths: 6, contractValue: 30000 }] });
    // An unreadable line is no contract, as an unreadable term is no question.
    expect(dealFromQuery("kind=subscription&term=12&line=kind%3Dnonsense")).toBeNull();
    expect(dealFromQuery("kind=subscription&term=12&line=kind%3Dpilot")).toBeNull();
    expect(dealFromQuery("kind=subscription&term=12" + "&line=kind%3Done_time_fee".repeat(MAX_LINES))).toBeNull();
    expect(dealFromQuery("line=kind%3Done_time_fee")).toBeNull();
  });

  it("holds presets with labels of their own that survive the query form", () => {
    expect(new Set(DEAL_PRESETS.map((p) => p.label)).size).toBe(DEAL_PRESETS.length);
    for (const p of DEAL_PRESETS) {
      expect(p.question.lines.length, p.label).toBeGreaterThan(1);
      expect(dealFromQuery(dealToQuery(p.question)), p.label).toEqual(assessDeal(p.question).question);
    }
  });
});

// A change to a subscription the customer holds. The rules are in the Contraction MRR and
// Expansion MRR entries of core.md and the classification table of atl.md.
describe("assessChange", () => {
  const by = (kind: ChangeKind, id: PlaceId) => assessChange({ change: kind }).places.find((p) => p.id === id);

  it("covers every change, with a label and a group for each", () => {
    expect([...CHANGE_KINDS].sort()).toEqual(Object.keys(CHANGE_LABELS).sort());
    expect(new Set(CHANGE_GROUPS.flatMap((g) => g.kinds)).size).toBe(CHANGE_KINDS.length);
    expect(() => assessChange({ change: "nonsense" as ChangeKind })).toThrow(RangeError);
  });

  it("reports each change as the movement and the tags the standard gives it", () => {
    const answer = (kind: ChangeKind) => { const c = assessChange({ change: kind }); return [c.metric, c.classification, c.changeNature]; };
    expect(answer("upgrade")).toEqual(["Expansion MRR", "same_product", "permanent"]);
    expect(answer("new_module")).toEqual(["Expansion MRR", "new_module", "permanent"]);
    expect(answer("price_increase")).toEqual(["Expansion MRR", "pricing_adjustment", "permanent"]);
    expect(answer("downgrade")).toEqual(["Contraction MRR", null, "permanent"]);
    expect(answer("price_cut")).toEqual(["Contraction MRR", "pricing_adjustment", "permanent"]);
    expect(answer("temporary_discount")).toEqual(["Contraction MRR", "pricing_adjustment", "temporary"]);
    expect(answer("annual_billing_discount")).toEqual(["Contraction MRR", "recontracting", "permanent"]);
    expect(answer("annual_billing_same_price")).toEqual([null, null, null]);
    expect(answer("credit_or_refund")).toEqual([null, null, null]);
    expect(answer("notice")).toEqual([null, null, null]);
    expect(answer("late_payment")).toEqual([null, null, null]);
    expect(answer("unpaid_in_term")).toEqual([null, null, null]);
    const core = standard("metrics/core.md");
    const atl = standard("atl.md");
    expect(core).toContain("Every decrease in committed recurring revenue counts, whether or not the service changed");
    expect(core).toContain("A customer paying $1,000 a month who moves to annual billing at a 10% discount pays $10,800 a year, which is $900 of MRR");
    expect(core).toContain("`recontracting` for a restructured contract and `pricing_adjustment` for a price cut or a discount");
    expect(core).toContain("A discount with an end date takes the [`change_nature`](../cel.md#change-nature) `temporary`, with a `scheduled_reversal` on the day it ends");
    expect(core).toContain("A one-off credit or refund leaves MRR where it was and sits outside Contraction MRR, as does a move to annual billing at the same yearly price");
    expect(atl).toContain("A price cut, a discount or a restructured contract that lowers MRR is a contraction tagged `pricing_adjustment` or `recontracting`");
    expect(atl).toContain("ARR-O reads those tags whatever the direction");
  });

  it("answers the standard's own example: $1,000 a month to annual billing at 10% off", () => {
    const c = assessChange({ change: "annual_billing_discount", monthlyValue: 1000, changeMonthly: 100 });
    expect(c.amounts).toEqual({ before: 1000, change: -100, after: 900, arrAfter: 10800 });
    expect(c.reported).toContain("Contraction MRR");
    expect(c.places.find((p) => p.id === "mrr")).toMatchObject({ counts: "yes", amount: -100 });
    expect(c.places.find((p) => p.id === "arr")).toMatchObject({ counts: "part", amount: -1200 });
    expect(c.places.find((p) => p.id === "arr")!.answer).toContain("tagged recontracting");
  });

  it("moves each metric as the formulas read the change", () => {
    // NRR: every contraction lowers both forms; the Operating form counts same_product expansion alone.
    for (const kind of ["downgrade", "price_cut", "temporary_discount", "annual_billing_discount"] as const) {
      expect(by(kind, "nrr")!.counts, kind).toBe("yes");
      expect(by(kind, "grr")!.counts, kind).toBe("yes");
    }
    expect(by("upgrade", "nrr")!.counts).toBe("yes");
    expect(by("new_module", "nrr")!.counts).toBe("part");
    expect(by("price_increase", "nrr")!.counts).toBe("part");
    for (const kind of ["upgrade", "new_module", "price_increase"] as const) expect(by(kind, "grr")!.counts, kind).toBe("no");
    // The adjusted variants count permanent changes alone, and Adjusted GRR no expansion.
    expect(by("temporary_discount", "adjusted_retention")!.counts).toBe("no");
    expect(by("price_cut", "adjusted_retention")!.counts).toBe("yes");
    expect(by("upgrade", "adjusted_retention")!.counts).toBe("part");
    // ARR-O takes out the changes tagged pricing_adjustment or recontracting.
    for (const kind of ["price_increase", "price_cut", "temporary_discount", "annual_billing_discount"] as const) expect(by(kind, "arr")!.counts, kind).toBe("part");
    for (const kind of ["upgrade", "new_module", "downgrade"] as const) expect(by(kind, "arr")!.counts, kind).toBe("yes");
    expect(by("temporary_discount", "carr")!.answer).toContain("nothing is added back before it reverses");
    expect(by("upgrade", "bookings")!.answer).toContain("Expansion Bookings");
    expect(by("price_cut", "bookings")).toBeUndefined();
    for (const kind of ["annual_billing_same_price", "credit_or_refund"] as const) {
      for (const id of ["mrr", "arr", "carr", "nrr", "grr", "adjusted_retention"] as const) expect(by(kind, id)!.counts, `${kind} ${id}`).toBe("no");
      expect(by(kind, "logo_churn_rate"), kind).toBeUndefined();
    }
    // Notice, a late payment and an unpaid contract still in force move nothing in MRR. CARR net of known churn reads the notice.
    for (const kind of ["notice", "late_payment", "unpaid_in_term"] as const) {
      const c = assessChange({ change: kind, monthlyValue: 1000 });
      expect(c.reported, kind).toBe("Nothing in MRR");
      expect(c.amounts, kind).toMatchObject({ before: 1000, change: 0, after: 1000 });
      for (const id of ["mrr", "arr", "nrr", "grr", "adjusted_retention", "logo_churn_rate"] as const) expect(by(kind, id)!.counts, `${kind} ${id}`).toBe("no");
      expect(by(kind, "logo_churn_rate")!.answer, kind).toContain("The customer has not churned");
    }
    expect(by("notice", "carr")).toMatchObject({ counts: "part" });
    expect(by("notice", "carr")!.answer).toContain("CARR net of known churn takes the cancellation's annual value off from the day notice is given");
    expect(by("late_payment", "carr")!.counts).toBe("no");
    expect(assessChange({ change: "notice" }).rule).toContain("A right to cancel the customer has not used moves nothing either");
    expect(assessChange({ change: "late_payment" }).rule).toContain("cancelled for non-payment, it is Churned MRR and a churned customer on the day the cancellation takes effect and the subscription ends");
    expect(by("unpaid_in_term", "carr")!.counts).toBe("no");
    expect(standard("metrics/finance.md")).toContain("The other is the annual value of each cancellation made on or before period end for a contract that ends after it");
    for (const kind of CHANGE_KINDS) {
      const c = assessChange({ change: kind, monthlyValue: 2000, changeMonthly: 500 });
      expect(c.places.find((p) => p.id === "total_customers")?.answer, kind).toBe("No change. The customer stays a customer");
      const ids = c.places.map((p) => p.id);
      expect(ids, kind).toEqual(PLACE_IDS.filter((id) => ids.includes(id)));
      for (const p of c.places) {
        expect(p.answer, `${kind} ${p.id}`).not.toMatch(/—|–|, and |, or |\.$/);
        expect(p.answer.startsWith("Yes"), `${kind} ${p.id}`).toBe(p.counts === "yes");
        expect(p.answer.startsWith("No"), `${kind} ${p.id}`).toBe(p.counts === "no");
      }
      expect(`${c.rule} ${c.reported}`, kind).not.toMatch(/—|–|, and |, or /);
    }
    const norm = (t: string) => t.replace(/`/g, "");
    expect(norm(standard("metrics/finance.md"))).toContain("A temporary reduction, such as a three-month discount, is read as ARR reads it and nothing is added back before it reverses");
    expect(standard("metrics/finance.md")).toContain("Expansion Bookings: Upgrades from existing customers");
  });

  it("signs the amounts by the direction of the change and holds them in bounds", () => {
    expect(assessChange({ change: "upgrade", monthlyValue: 2000, changeMonthly: 1000 }).amounts).toEqual({ before: 2000, change: 1000, after: 3000, arrAfter: 36000 });
    expect(assessChange({ change: "price_cut", changeMonthly: 50 }).amounts).toEqual({ before: null, change: -50, after: null, arrAfter: null });
    expect(assessChange({ change: "upgrade", monthlyValue: 2000 }).amounts).toBeNull();
    expect(assessChange({ change: "credit_or_refund", monthlyValue: 1000, changeMonthly: 400 })).toMatchObject({ question: { change: "credit_or_refund", monthlyValue: 1000 }, amounts: { before: 1000, change: 0, after: 1000, arrAfter: 12000 } });
    // A decrease as large as the MRR before it is a cancellation, which a change is not.
    expect(assessChange({ change: "downgrade", monthlyValue: 500, changeMonthly: 500 }).question).toEqual({ change: "downgrade", monthlyValue: 500 });
    expect(assessChange({ change: "downgrade", monthlyValue: 500, changeMonthly: 900 }).amounts).toBeNull();
    for (const bad of [1e308, Infinity, Number.NaN, MAX_AMOUNT * 10, 0, -5]) expect(assessChange({ change: "upgrade", monthlyValue: bad, changeMonthly: bad }).question, String(bad)).toEqual({ change: "upgrade" });
  });

  it("writes each change as a query and reads the same change back", () => {
    for (const change of CHANGE_KINDS) for (const monthlyValue of [undefined, 1000]) for (const changeMonthly of [undefined, 100, 5000]) {
      const q = { change, monthlyValue, changeMonthly };
      const query = changeToQuery(q);
      expect(changeFromQuery(query), query).toEqual(assessChange(q).question);
      for (const key of new URLSearchParams(query).keys()) expect(QUERY_KEYS, key).toContain(key);
    }
    expect(changeToQuery({ change: "annual_billing_discount", monthlyValue: 1000, changeMonthly: 100 })).toBe("change=annual_billing_discount&monthly=1000&by=100");
    expect(changeFromQuery("?change=price_cut&by=1%2C250")).toEqual({ change: "price_cut", changeMonthly: 1250 });
    for (const bad of ["", "change=", "change=nonsense", "kind=subscription&term=6"]) expect(changeFromQuery(bad), bad).toBeNull();
    expect(new Set(CHANGE_PRESETS.map((p) => p.label)).size).toBe(CHANGE_PRESETS.length);
    for (const p of CHANGE_PRESETS) expect(changeFromQuery(changeToQuery(p.question)), p.label).toEqual(assessChange(p.question).question);
  });

  it("prints a fall in MRR with its sign ahead of the currency", () => {
    expect(formatMoney(-100)).toBe("-$100");
    expect(formatMoney(-1250.5)).toBe("-$1,250.50");
  });
});
