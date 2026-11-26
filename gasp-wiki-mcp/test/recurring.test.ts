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
  MAX_AMOUNT,
  QUERY_KEYS,
  UNPRICED_KINDS,
  amountBasis,
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

  it("counts usage above a commitment for the billed period and recurring credits as a subscription", () => {
    expect(classifyRevenue({ kind: "usage_above_commitment" })).toMatchObject({ counts: "period", canChurn: false, changeNature: "temporary" });
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

  it("holds each row of the movement table to the function", () => {
    for (const row of MOVEMENT_ROWS) {
      const m = movement(row.item, row.event, row.otherMrr);
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
    // A question with a value and a way to a monthly figure always has amounts; a free trial and usage above a commitment never do.
    for (const q of questions.filter((x) => x.monthlyValue !== undefined || (x.contractValue !== undefined && x.termMonths !== undefined && TERM_KINDS.includes(x.kind)))) {
      const a = assessContract(q);
      expect(a.amounts === null, JSON.stringify(q)).toBe(q.kind === "free_trial" || a.verdict.counts === "period");
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
    expect(assessContract({ kind: "usage_above_commitment" }).verdict.counts).toBe("period");
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
    }
    expect(new Set(PRESETS.map((p) => assessContract(p.question).verdict.line)).size).toBeGreaterThanOrEqual(4);
  });

  it("prints money with thousands separators and cents only when there are some", () => {
    expect(formatMoney(30000)).toBe("$30,000");
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(833.3333)).toBe("$833.33");
    expect(formatMoney(1250.5)).toBe("$1,250.50");
  });
});
