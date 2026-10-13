# Decision: ATL tags in the formulas and rate/amount cycles in the graph

TODO.md next steps 4 and 5. Drafted 2026-10-13 against `main` at dd7a532 plus the working tree. Nothing in `standard/` or the graph has been changed. Every draft formula below parses, validates (fields, enum literals, one dataset per aggregate) and compiles with the real ontology; how that was checked is in A.6.

## Recommendations in one screen

1. **Net Revenue Retention (NRR)**: NRR-O reads `expansion_classification in ('same_product', 'usage_realisation')`. NRR-M counts expansion and reactivation with all six classifications. NRR-M drops the cohort (core.md calls it the account method); without that, the reactivation it counts is almost always zero.
2. **Annual Recurring Revenue (ARR)**: ARR-M is `metric.mrr * 12` (today's formula). ARR-O subtracts the cumulative `pricing_adjustment` and `recontracting` MRR change of today's customers before annualising.
3. **At-Risk Rate**: keep the health score formula (the canon) and add a `state_category` variant, `entered_at_risk`.
4. **Customer Lifetime Value (LTV)**: add form-reference syntax `metric.gross_margin.O` to the grammar and write LTV-O with it. The same syntax later gives LTV:CAC and CAC Payback their O/M forms without duplicating anything.
5. **Graph cycles**: there are four rate/amount 2-cycles, not two. Delete the four curated edges and point the three curated drivers of Expansion Revenue Rate at Expansion MRR instead. Add the test.
6. **Stale notes**: eight replacements, ready to apply now (section "Note fixes").

---

## Part A: encode the ATL tags (item 4)

### A.1 What is in place

| Field | Datasets | Values | Formulas reading it today |
|---|---|---|---|
| `expansion_classification` | revenue_event, amendment_event | same_product, new_module, new_buying_centre, pricing_adjustment, recontracting, usage_realisation | 0 |
| `lifecycle_attribution` | revenue_event, cost_event, amendment_event | acquisition, activation, retention, expansion, reactivation, servicing | 0 |
| `state_category` | lifecycle_event | activation, onboarding_complete, healthy, at_risk, churned, reactivated | 0 |
| `event_type` | revenue_event | new, expansion, contraction, churn, reactivation, renewal | 19 |
| `mrr_change` | revenue_event, amendment_event | decimal, negative for contraction and churn | 13 |
| `change_nature` | revenue_event, amendment_event | permanent, temporary, scheduled_reversal | 2 |

Convention already used by `cac`, `gross_margin` and `ltv`: the main `formula` is the Market form, `forms.M` repeats it and `forms.O` differs. Only the main formula feeds the graph (`derive.ts` builds `component` edges from it), so forms can change without touching relationships.json.

The drafts do not filter on `lifecycle_attribution`. atl.md Rule 4 makes `event_type = 'expansion'` and `lifecycle_attribution = 'expansion'` the same rows, and reading `event_type` keeps the forms consistent with `expansion_mrr`.

### A.2 NRR-O and NRR-M

**Canon.** atl.md, Expansion Classification: "NRR-O (Operating) focuses on organic, durable expansion: `same_product` and `usage_realisation`." "NRR-M (Market) includes all expansion types because investor-comparable NRR counts everything that is not net-new logo acquisition." core.md, NRR-O: "Excludes: `expansion_classification` ∈ (`new_module`, `new_buying_centre`, `pricing_adjustment`, `recontracting`) and `lifecycle_attribution` = `reactivation`". core.md, NRR-M: "NRR-M uses the account-level formula method and includes all expansion types. Only net-new logo acquisition is excluded." Bridge: "NRR-M ≈ NRR-O + Reactivation + Cross-Module + New Buying Centre + Pricing Adjustment + Recontracting expansion".

**Current `forms.O`** (identical to the main formula; counts every classification, so it is not the Operating form):
```
(metric.mrr at period_start + metric.expansion_mrr - metric.contraction_mrr - metric.churned_mrr) / metric.mrr at period_start over cohort(field.customer_id, period_start)
```

**Proposed `forms.O`:**
```
(metric.mrr at period_start + sum(field.mrr_change where field.event_type = 'expansion' and field.expansion_classification in ('same_product', 'usage_realisation')) - metric.contraction_mrr - metric.churned_mrr) / metric.mrr at period_start over cohort(field.customer_id, period_start)
```

**Current `forms.M`:**
```
(metric.mrr at period_start + sum(field.mrr_change where field.event_type in ('expansion', 'reactivation')) - metric.contraction_mrr - metric.churned_mrr) / metric.mrr at period_start over cohort(field.customer_id, period_start)
```

**Proposed `forms.M`** (recommended: account method, no cohort):
```
(metric.mrr at period_start + sum(field.mrr_change where field.event_type in ('expansion', 'reactivation') and field.expansion_classification in ('same_product', 'new_module', 'new_buying_centre', 'pricing_adjustment', 'recontracting', 'usage_realisation')) - metric.contraction_mrr - metric.churned_mrr) / metric.mrr at period_start
```

**Owner's choices:**

- *Which classifications M includes.* Recommended: all six, as atl.md and core.md say. Listing them explicitly (rather than no filter) makes the choice visible, satisfies the acceptance test ("both forms read the tag field") and excludes untagged events, which Rule 2 forbids anyway. Cost: a seventh classification added later is excluded until the list is updated.
- *Cohort on M.* The compiled cohort is "customers with `customer_status = 'active'` at period start". A reactivating customer was churned at period start, so under the cohort the reactivation term in M is zero except for customers who churn and return inside the period. Recommended: drop the cohort from M, matching core.md's "account-level formula method". Side effect: expansion, contraction and churn of customers acquired during the period also count. If the owner prefers to keep the cohort, keep `over cohort(...)` on M and accept that reactivation is effectively excluded (then say so in core.md).
- *Main `formula`.* Recommended: leave it as is. It is core.md's "Formula Method" and its `metric.expansion_mrr` reference is what gives the graph its Expansion MRR → NRR edge.

**Note once the forms land:** "Period is trailing 12 months. NRR-O counts expansion tagged same_product or usage_realisation over the start-of-period cohort. NRR-M is the account method: every expansion classification plus reactivation, no cohort. The main formula is core.md's formula method."

### A.3 ARR-O and ARR-M

**Canon.** core.md, ARR-O: "ATL Inclusion: All `expansion_classification` values except `pricing_adjustment` and `recontracting`" and "Where MRR excludes changes tagged with `expansion_classification` ∈ (`pricing_adjustment`, `recontracting`)." ARR-M: "All MRR sources included." Bridge: "ARR-M = ARR-O + Pricing_Adjustment_MRR × 12 + Recontracting_MRR × 12". atl.md table: "Durable ARR: excludes recontracting, pricing_adjustment".

**Current:** `formula: metric.mrr * 12`, no forms.

**Proposed:**
```
forms.M: metric.mrr * 12
forms.O: (metric.mrr - sum(field.mrr_change where field.expansion_classification in ('pricing_adjustment', 'recontracting')) to_date) * 12 over cohort(field.customer_id, period_end)
```

MRR is a snapshot and carries no tag, so ARR-O is MRR minus the tagged flow. `to_date` sums the flow from the start of history to period end. The cohort restricts that sum to customers active at period end, so price rises on customers who have since churned are not subtracted from MRR they no longer contribute.

**Owner's choice: the horizon.** The canon does not say how far back a price rise stops being "mechanical". Recommended: all history (`to_date`), the literal reading of "MRR excludes changes tagged ...". Alternative once item 3 ships `window()`: trailing 12 months, `window(sum(...), 12 month)`, which matches the Durability Gap's framing as a growth diagnostic. Period-only (no `to_date`) is not recommended: a balance would then depend on the reporting period's length.

**Note once the forms land:** "ARR-M equals this formula. ARR-O subtracts the cumulative MRR change tagged pricing_adjustment or recontracting for customers active at period end, so ARR-M minus ARR-O is the Durability Gap (core.md)."

### A.4 At-Risk Rate (`at_risk_rate`)

**Canon.** customer-success.md: "At-Risk Rate = Customers with health score < 40 / Total scored customers × 100". cel.md, `Lifecycle_State_Change`: "`state_category` ... `at_risk`" with trigger "health score drop below 40". atl.md table, Churn-O: "Hazard-based: includes at-risk state transitions".

**Current:** `count_distinct(field.customer_id where field.composite_score < 40) / count_distinct(field.customer_id where field.composite_score is not null)`

**Proposed variant `entered_at_risk`:**
```
count_distinct(field.customer_id where field.state_category = 'at_risk') / count_distinct(field.customer_id where field.customer_status = 'active') at period_start
```
Share of customers active at period start who moved into the at-risk state during the period (numerator on lifecycle_event, denominator on the customer snapshot).

**Owner's choice.** Recommended: add as a variant and keep the health score formula as the main one, because it is the canon and it is a stock ("customers at risk now"). A stock from `state_category` needs "latest state per customer at period end", which the grammar cannot express. The alternative is replacing the main formula with the flow above, which changes what the metric means.

Observation for item 7: atl.md defines Churn-O as hazard-based with at-risk transitions; core.md defines Churn-O as Revenue Churn Rate. One of them should change.

### A.5 LTV-O and the form-reference problem

**Canon.** core.md, LTV-O: "LTV-O = (ARPA × Contribution Margin) / Revenue Churn Rate" where "Contribution Margin = Revenue − COGS − Implementation − Onboarding − Support − Success Engineering costs." `gross_margin.forms.O` already encodes exactly that (core.md calls it "Contribution Margin (GM-O)").

**Problem.** `metric.gross_margin` compiles the main formula (GM-M). The tokenizer accepts one dot in an identifier, so `metric.gross_margin.O` fails today with "Unexpected character '.' at position 33".

| Option | What it takes | Verdict |
|---|---|---|
| (a) New `contribution_margin` metric | A new metric section in `finance.md` (formula ids must key a real metric), a 301st metric, a graph node decision and a second copy of the GM-O expression | Not recommended: it duplicates GM-O and grows the metric count for a form that already exists |
| (b) Form references `metric.<id>.O` / `.M` | Tokenizer accepts an optional `.O` / `.M` suffix on `metric.` ids; `Node.metric` gains `form?`; `validateFormula` checks the form exists; the compiler compiles `forms[form]`; `analyzeFormula` still reports the ref to `gross_margin`, so graph edges are unchanged; grammar header updated; tests for each | **Recommended.** About half a day. Also unlocks `ltv_cac_ratio` (`metric.ltv.O / metric.cac.O`) and `cac_payback` O/M without restating anything |
| (c) Inline GM-O inside LTV-O | Works today, no grammar change | Fallback only: the cost list then lives in two places and can drift |

**Proposed under (b):**
```
forms.M: metric.arpa * metric.gross_margin / metric.revenue_churn_rate
forms.O: metric.arpa * metric.gross_margin.O / metric.revenue_churn_rate
```
**Fallback (c), valid today:**
```
forms.O: metric.arpa * (sum(field.revenue) - sum(field.cost where field.cost_function in ('infrastructure', 'support', 'success_engineering', 'implementation', 'onboarding'))) / sum(field.revenue) / metric.revenue_churn_rate
```

**Note once the forms land:** "LTV-M equals this formula. LTV-O uses contribution margin (gross_margin.forms.O) in place of gross margin."

### A.6 Validation

Each draft was run through `parseFormula` and `validateFormula` from `gasp-wiki-mcp/src/formula.ts` with the same context `formulas-data.test.ts` builds from `loadStandard()` (field ids, metric formula ids, declared enum values, datasets per field), then through `compileMetric`.

| Draft | Result | Datasets in compiled SQL |
|---|---|---|
| NRR `forms.O` | parses, validates, compiles (staged) | customer, revenue_event, subscription |
| NRR `forms.M`, no cohort | parses, validates, compiles | revenue_event, subscription |
| NRR `forms.M`, with cohort | parses, validates, compiles (staged) | customer, revenue_event, subscription |
| ARR `forms.O` | parses, validates, compiles (staged) | customer, revenue_event, subscription |
| ARR `forms.M` | parses, validates, compiles | subscription |
| At-Risk `entered_at_risk` | parses, validates, compiles | customer, lifecycle_event |
| LTV `forms.O` fallback (c) | parses, validates, compiles | cost_event, customer, financials, revenue_event, subscription |
| LTV `forms.O` under (b) | fails to tokenize until the grammar change | |

Every string literal is a declared value of the field it is compared with.

### A.7 One question the drafts cannot answer

Every ATL-tagged aggregate above compiles to `revenue_event`, the first dataset `mrr_change` and `expansion_classification` share, as `expansion_mrr` does today. cel.md examples 3 and 4 record a seat add and a cross-module upsell as `Amendment_Event` only. If MRR-changing amendments do not also write a `Revenue_Event`, NRR and ARR miss mid-term expansion, including the `new_module` upsell that NRR-M exists to count. Recommended: state in cel.md that every MRR-changing amendment also writes a `Revenue_Event` (the amendment row keeps the contract detail), and fix examples 3 and 4 in item 7.

---

## Note fixes (no decision needed)

Apply verbatim to the `notes` key in `standard/formulas.json`. The `arr` and `nrr` notes here describe the state before item 4; A.2 and A.3 give their replacements once the forms land. TODO item 4 names `latency`; the entry is keyed `latency_response_time`.

**`arr`**
- Current: "ARR-M adds pricing-adjustment and recontracting MRR x 12; those ATL movement types are not canonical fields yet, so only the shared form is encoded."
- Stale: `expansion_classification` is a declared enum on revenue_event and amendment_event with both values. The reason given for not encoding the forms is false.
- Proposed: "ARR-M equals this formula. ARR-O excludes MRR changes tagged expansion_classification pricing_adjustment or recontracting (core.md); encoding the forms is TODO item 4."

**`nrr`**
- Current: "Period is trailing 12 months. NRR-M also counts cross-module, new buying centre, pricing-adjustment and recontracting expansion; those ATL tags are not canonical fields yet, so M encodes reactivation only."
- Stale: the tags are canonical fields. The note also hides that `forms.O` equals the main formula and counts every classification, which core.md's NRR-O excludes.
- Proposed: "Period is trailing 12 months. forms.O does not yet filter expansion_classification to same_product and usage_realisation (core.md, NRR-O), so it equals this formula; forms.M adds reactivation. Encoding the ATL filter is TODO item 4."

**`time_to_feature_adoption`**
- Current: "Median days from signup or activation to first use of a feature."
- Stale: the formula is `median(field.first_use_date - field.release_date where in_period(field.release_date))`, measured from the feature's release. The note restates product.md ("First feature use date - Signup date") rather than the formula.
- Proposed: "Median days from a feature's release to its first use, for features released in the period. product.md measures from the user's signup date; the feature dataset carries no signup date, so release date is the anchor."
- Backlog, not part of this fix: the formula and product.md disagree on the start date. Closing that needs a per-user, per-feature first-use dataset.

**`qbr_completion`**
- Current: "Each row is a scheduled QBR; completed marks those held."
- Stale: the formula counts distinct customers on the customer snapshot using the booleans `qbr_completed` and `qbr_due`. There are no QBR rows.
- Proposed: "Counted per account: customers with a QBR held in the period (qbr_completed) over customers with a QBR due (qbr_due), both on the customer snapshot. customer-success.md defines it over eligible accounts."

**`bad_debt_rate`**
- Current: "Defined in both Finance and RevOps; one formula."
- Stale: revops.md no longer defines it; it says "See Finance for the canonical definition".
- Proposed: "Canonical definition is in finance.md; revops.md links to it. Denominator is GAAP recognised revenue (metric.revenue_gaap), not billings."

**`mean_time_to_recovery_mttr`**
- Current: "Recovery time minus failure time. Unit of recovery_time assumed minutes."
- Stale: the ontology declares `recovery_time` as "Minutes from start to service restored", so nothing is assumed, and the formula reads the duration directly rather than subtracting two times.
- Proposed: "recovery_time is minutes from failure to service restored per incident (ontology field), so the formula averages it directly. Mean Time to Resolve (mttr) is a separate metric that reads started_at and resolved_at."

**`latency_response_time`**
- Current: "Encoded as P50 (median). Report P95 or P99 rather than averages; the grammar has no percentile function."
- Stale on both counts: the formula is `percentile(field.response_time_ms, 0.95)`, so P95, and the grammar has `percentile`. P50 is a variant.
- Proposed: "Canonical value is P95. Variants p50 and p99 give the other percentiles engineering.md lists. Report percentiles rather than averages, which hide tail latency."

**`uptime`**
- Current: "total_minutes is the minutes in the period. Scheduled maintenance is counted as downtime."
- Stale: there is no `total_minutes`; the formula uses `period_days * 1440`.
- Proposed: "Total time is period_days * 1440 minutes. Scheduled maintenance counts as downtime (engineering.md)."

---

## Part B: rate and amount cycles in the graph (item 5)

### B.1 Every metric pair with edges both ways

Script over `gasp-wiki-frontend/src/data/relationships.json` (176 edges). `component` and `measures` are derived by `npm run derive`; everything else is curated.

| Pair | Derived edge (from the formula) | Curated edge (opposite direction) |
|---|---|---|
| Churned MRR / Revenue Churn Rate | `churned_mrr → revenue_churn_rate` component | `revenue_churn_rate → churned_mrr` drives |
| Expansion MRR / Expansion Revenue Rate | `expansion_mrr → expansion_rate` component | `expansion_rate → expansion_mrr` drives |
| Ticket Volume / Self-Service Rate | `ticket_volume → self_service_rate` component | `self_service_rate → ticket_volume` reduces |
| MQLs / Lead Velocity Rate (LVR) | `mqls → lvr` component | `lvr → mqls` predicts |

The TODO names the first two. The other two have the same shape: the rate is computed from the amount, and a curated edge claims the rate moves the amount. The only other 2-cycle in the file is the `entity_customer → entity_customer` `parent_of` self-loop, which is intended and outside the metric test.

### B.2 Why Contraction MRR shows up as a driver of Churned MRR

`inferDrivers` walks incoming edges in reverse and multiplies attenuations (component 0.9, drives and reduces 0.75, predicts 0.6). From Churned MRR it steps back along the curated `revenue_churn_rate → churned_mrr` edge (0.75), then along the derived edges into Revenue Churn Rate: `contraction_mrr → revenue_churn_rate` (0.9) and `mrr → revenue_churn_rate` (0.9, flipped as the denominator). Contraction MRR therefore scores 0.675 as a cause of Churned MRR, when it is a sibling input of the same ratio. MRR down, Net New MRR down, Expansion MRR down and New MRR down arrive by the same route. The visited set stops infinite loops, so the damage is ranking, not hangs.

### B.3 The options and what `infer_drivers` returns

Option 1 deletes the curated edge in each pair. Option 2 keeps the edges in relationships.json and has `buildContext` skip any curated metric edge whose reverse is a derived edge. For traversal the two produce **identical** output; they differ in what the diagram, the Cypher export and `get_relationships` show.

`infer_drivers("Churned MRR", up)`, top 10:

| # | Today | Option 1 or 2 |
|---|---|---|
| 1 | Logo Churn Rate up 0.750 | Logo Churn Rate up 0.750 |
| 2 | Revenue Churn Rate up 0.750 | NPS down 0.600 |
| 3 | Contraction MRR up 0.675 | Customer Health Score down 0.563 |
| 4 | MRR down 0.675 | CSAT down 0.450 |
| 5 | NPS down 0.600 | Uptime down 0.450 |
| 6 | Customer Health Score down 0.563 | At-Risk Customer Rate up 0.450 |
| 7 | Net New MRR down 0.506 | Feature Adoption Rate down 0.422 |
| 8 | Expansion MRR down 0.456 | DAU/MAU Ratio down 0.422 |
| 9 | New MRR down 0.456 | QBR Completion Rate down 0.422 |
| 10 | CSAT down 0.450 | Ticket Volume up 0.337 |

The ratio's own inputs leave the list and the behavioural causes move up.

Side effect under both options: Expansion MRR, Ticket Volume and MQLs are left with no incoming edges, so `infer_drivers` returns nothing for them. For Expansion MRR that loses real drivers, because Customer Health Score, QBR Completion Rate and Product Qualified Accounts (PQAs) currently point at Expansion Revenue Rate and reached Expansion MRR only through the cycle. Fix: point those three `drives` edges at `expansion_mrr`. Expansion Revenue Rate still inherits them through its component edge. With that change, `infer_drivers("Expansion MRR", up)` returns Customer Health Score, QBR Completion Rate and PQAs at 0.750, then Feature Adoption Rate and DAU/MAU Ratio at 0.563. `infer_drivers("Expansion Revenue Rate", up)` keeps the same candidates (the three at 0.675 instead of 0.750). Ticket Volume and MQLs have no other curated driver to move. LVR is MQL growth, so "LVR predicts MQLs" was circular anyway. The self-service claim survives as the formula edge (Ticket Volume is the denominator of Self-Service Rate).

### B.4 Recommendation: option 1 with the re-point

Option 2 leaves a graph that says one thing in the diagram and Cypher and another in traversal, and needs a special case in `buildContext`. Option 1 keeps one graph.

**Delete from `relationships.json`:**
```json
{"source":"revenue_churn_rate","target":"churned_mrr","type":"drives"}
{"source":"expansion_rate","target":"expansion_mrr","type":"drives"}
{"source":"self_service_rate","target":"ticket_volume","type":"reduces"}
{"source":"lvr","target":"mqls","type":"predicts"}
```

**Re-point (change `target` from `expansion_rate` to `expansion_mrr`):**
```json
{"source":"health_score","target":"expansion_mrr","type":"drives"}
{"source":"qbr_completion","target":"expansion_mrr","type":"drives"}
{"source":"pqas","target":"expansion_mrr","type":"drives"}
```

Then `npm run derive` (regenerates the Cypher), and update the edge count in CLAUDE.md (176 to 172). Existing traversal tests still pass: NPS stays a candidate for Churned MRR and ARR down still reaches Churned MRR through Net New MRR.

**Test to add to `gasp-wiki-mcp/test/traversal.test.ts`:**
```ts
describe("graph shape", () => {
  it("no two metric nodes have edges in both directions", () => {
    const metric = new Set(data.nodes.filter((n) => !n.nodeType).map((n) => n.id));
    const pairs = new Set(
      data.edges.filter((e) => metric.has(e.source) && metric.has(e.target)).map((e) => `${e.source}|${e.target}`),
    );
    const cycles = [...pairs].filter((p) => {
      const [s, t] = p.split("|");
      return s < t && pairs.has(`${t}|${s}`);
    });
    expect(cycles).toEqual([]);
  });
});
```
It fails today with the four pairs above. Under option 2 this test cannot pass; it would have to assert on the traversal context (`ctx.edgesBySource`) instead.

Adjacent finding, no action proposed: eight pairs carry a parallel curated edge beside the derived one in the same direction (for example `churned_mrr → nrr` as both `reduces` and `component`). They are redundant but harmless; traversal keeps the higher score.

---

## Decisions required

Part A (item 4)
- [ ] NRR-M includes all six `expansion_classification` values, listed explicitly. (Recommended: yes)
- [ ] NRR-M drops the cohort and uses the account method, so reactivation counts. (Recommended: yes. If no, core.md should say reactivation is excluded in practice)
- [ ] NRR-O counts only `same_product` and `usage_realisation` expansion and no reactivation, as core.md says. (Recommended: yes)
- [ ] The NRR main `formula` stays the formula method with `metric.expansion_mrr`. (Recommended: yes)
- [ ] ARR-O subtracts pricing_adjustment and recontracting MRR over all history for current customers. (Recommended: yes; revisit with `window()` after item 3)
- [ ] At-Risk Rate keeps the health score formula and gains the `entered_at_risk` variant. (Recommended: yes)
- [ ] Add `metric.<id>.O` / `.M` form references to the grammar and write LTV-O with them. (Recommended: yes. If no, use fallback (c))
- [ ] cel.md states that every MRR-changing amendment also writes a Revenue_Event. (Recommended: yes)

Part B (item 5)
- [ ] Delete the four curated edges that oppose a derived edge (option 1). (Recommended: yes)
- [ ] Point the Customer Health Score, QBR Completion Rate and PQAs `drives` edges at Expansion MRR instead of Expansion Revenue Rate. (Recommended: yes)
- [ ] Add the "no two metric nodes have edges in both directions" test. (Recommended: yes)

The note fixes need no decision and can go in with either answer.
