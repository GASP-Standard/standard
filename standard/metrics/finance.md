# Finance Metrics

Metrics for measuring financial health, efficiency and operational performance.

---

## Revenue Metrics

### Revenue (GAAP)

**Definition:** Recognised revenue according to accounting standards.

**Formula:**
```
Revenue = Recognised revenue in period (per ASC 606)
```

**Note:** Different from bookings or billings. Revenue is recognised as service is delivered.

**What it tells you:** Actual earned revenue for the period.

---

### Bookings

**Definition:** Total contract value signed in a period.

**Formula:**
```
Bookings = Sum of total contract value for deals signed in period
```

**Types:**
- New Bookings: From new customers
- Expansion Bookings: Upgrades from existing customers
- Renewal Bookings: Contract renewals

**What it tells you:** Sales output and future revenue committed.

---

### Billings

**Definition:** Amounts invoiced in a period.

**Formula:**
```
Billings = Total invoiced amount in period
```

Billings are reported per payment status (paid, unpaid, partial, written off) as of period end.

**What it tells you:** The cash the period's invoices should bring in. The payment status breakdown shows how much of it has arrived.

---

### ARR / MRR

See [Core Metrics: MRR](core.md#mrr-monthly-recurring-revenue) and [ARR](core.md#arr-annual-recurring-revenue) for the canonical definitions: recurring revenue at period end, monthly and annualised.

---

### Deferred Revenue

See [RevOps](revops.md#deferred-revenue-balance) for the canonical definition: deferred revenue is a balance, cumulative billings to date minus cumulative revenue recognised to date. It arises on billing, not on cash receipt.

---

### Consumption Revenue

**Definition:** Revenue earned as customers use the product: consumption drawn from a prepaid balance, billed as overage above a commitment or billed on demand with no commitment.

**Formula:**
```
Consumption Revenue = Sum of consumption drawn, billed as overage or billed on demand in the period
```

Consumption Revenue reads the `consumption` events of the [Commercial Event Ledger (CEL)](../cel.md#credit_event) `Credit_Event` class. Those events carry a negative `credit_amount`, since they reduce what the customer has left to use, and the metric reports the positive amount.

Consumption Revenue is reported per consumption basis (committed, overage, on demand) and per customer segment.

**Includes:**
- Consumption drawn from a prepaid balance (basis `committed`)
- Consumption above an exhausted or per-period commitment (basis `overage`)
- Consumption billed with no commitment (basis `on_demand`)

**Excludes:**
- Usage within a ratable commitment: that revenue is the commitment itself, already in MRR
- Credit purchases: a prepayment is a contract liability until it is consumed, so it counts in bookings and billings
- Expired credits, which [Credit Breakage](#credit-breakage) reports

**What it tells you:** How much revenue usage earned in the period, whichever way the customer bought it. The breakdown by basis shows how much came from prepaid commitments, how much ran past them and how much arrived with no commitment at all.

**Note:** Under ASC 606 and IFRS 15 a SaaS usage fee is variable consideration, recognised as the usage occurs. Consumption Revenue is the commercial figure read from the credit ledger; [Revenue (GAAP)](#revenue-gaap) remains the accounting figure.

**Common mistakes:**
- Counting credit purchases as consumption revenue
- Adding consumption revenue to MRR, which excludes uncommitted usage
- Counting usage within a ratable commitment a second time beside the commitment

**Related metrics:** Usage Run-Rate, Prepaid Credit Balance, Credit Breakage, Consumption Revenue Growth Rate, Consumption Net Revenue Retention, Revenue (GAAP)

**Sources:**
- [FASB: ASU 2014-09, Topic 606](https://storage.fasb.org/ASU%202014-09_Section%20A.pdf)
- [IFRS 15](https://www.icab.org.bd/icabadmin/uploads/ckeditor/7910IFRS%2015.pdf)
- [Deloitte: Cloud arrangements with variable consideration](https://www.deloitte.com/content/dam/assets-zone3/us/en/docs/services/audit-assurance/2024/us-audit-tech-alert-accounting-for-cloud-basedor-hosted-software-arrangements-with-variable-consideration.pdf)
- [Snowflake: Form 10-K, fiscal 2026](https://www.sec.gov/Archives/edgar/data/1640147/000164014726000008/snow-20260131.htm)
- [Stripe: Billing credits](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits)
- [Metronome: Glossary](https://metronome.com/glossary)

---

### Usage Run-Rate

**Definition:** On-demand consumption revenue over the trailing three months, annualised. Also called Usage ARR.

**Formula:**
```
Usage Run-Rate = On-demand Consumption Revenue in the three months ending at period end × 4
```

**Window:** The GASP Standard fixes the window at three months × 4, the basis of MongoDB's 90 days and Confluent's three months. Companies also use one month × 12 (Datadog), which moves with every unusual month, and a six-month average × 12 (Metronome's guidance), which is slower to show a trend; daily × 365 appears too. The standard picks one window so two companies' figures compare. A company that reports on another window states it beside the GASP figure.

**Base:** Only on-demand consumption enters. Committed consumption is already in ARR through the commitment, and overage is already in MRR through the `usage_realisation` expansion the [CEL](../cel.md#deriving-usage-realisation) derives. With the base held to on-demand consumption, ARR plus Usage Run-Rate counts each dollar once.

**Includes:** Consumption with basis `on_demand`.

**Excludes:** Committed consumption and overage, which ARR already carries.

**What it tells you:** The annual scale of the usage that no contract guarantees. Set beside ARR it shows how much of the business runs on commitments and how much on customers who could stop tomorrow.

**Note:** A run-rate, not a forecast. Datadog describes its usage-inclusive figures as "not intended to be replacements or forecasts of revenue".

**Common mistakes:**
- Annualising all consumption and adding it to ARR, which counts commitments and overage twice
- Changing the window from one period to the next
- Comparing two companies' usage figures without checking their windows

**Related metrics:** ARR Including Usage Run-Rate, Consumption Revenue, ARR

**Sources:**
- [MongoDB: Form 10-K, fiscal 2026](https://www.sec.gov/Archives/edgar/data/1441816/000162828026016799/mdb-20260131.htm)
- [Confluent: Form 10-K, 2025](https://www.sec.gov/Archives/edgar/data/1699838/000169983826000006/cflt-20251231.htm)
- [Datadog: Form 10-K, 2025](https://www.sec.gov/Archives/edgar/data/1561550/000162828026008819/ddog-20251231.htm)
- [Ordway: Cloud usage-based pricing ARR study](https://ordwaylabs.com/blog/cloud-usage-based-pricing-report-arr/)
- [Metronome: ARR for usage-heavy SaaS](https://metronome.com/blog/arr-usage-heavy-saas)
- [m3ter: SaaS usage metrics](https://www.m3ter.com/guides/saas-usage-metrics)

---

### Prepaid Credit Balance

**Definition:** The prepaid commitment customers have paid for and not yet consumed or forfeited, as of period end. Also called Remaining Commitment.

**Formula:**
```
Prepaid Credit Balance = Purchases + granting adjustments - committed consumption - expiries - reducing adjustments, cumulative to period end
```

Every `purchase`, `expiry` and `adjustment` event and every consumption with basis `committed` is summed from the start of the ledger to period end, each with the sign it carries.

**Includes:** Prepaid commitments and blocks of credits, rollover grants and promotional grants, less what has been drawn down, forfeited or reduced.

**Excludes:** Overage and on-demand consumption, which draw no balance.

**What it tells you:** How much consumption customers have paid for in advance and not yet used: revenue still to be earned through use, or forfeited at expiry.

**Note:** A prepayment is a contract liability when it is received and becomes revenue as the service is consumed (ASC 606-10-55-46, IFRS 15.B44). The Prepaid Credit Balance is the part of the [Deferred Revenue Balance](revops.md#deferred-revenue-balance) that is prepaid consumption. A balance that can roll over extends the obligation, so it is not yet breakage. The GASP Standard records the commercial fact and leaves the breakage method to the company's accounting policy.

**Common mistakes:**
- Drawing on-demand or overage consumption against the balance
- Reading the balance as a revenue forecast: rollover and consumption timing move it, and Snowflake states its deferred revenue "is not a meaningful indicator of future revenue"
- Letting the balance go negative: consumption beyond the balance is overage

**Related metrics:** Consumption Revenue, Credit Breakage, Deferred Revenue Balance

**Sources:**
- [FASB: ASU 2014-09, Topic 606](https://storage.fasb.org/ASU%202014-09_Section%20A.pdf)
- [IFRS 15](https://www.icab.org.bd/icabadmin/uploads/ckeditor/7910IFRS%2015.pdf)
- [Stripe: Credit grant object](https://docs.stripe.com/api/billing/credit-grant/object)
- [Stripe: Billing credits](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits)
- [Orb: Credit ledger](https://docs.withorb.com/api-reference/credit/fetch-customer-credits-ledger)
- [Metronome: Remaining balance](https://docs.metronome.com/guides/customers-billing/optimize-customer-experience/get-remaining-balance.md)
- [Zuora: Prepaid balance transaction fields](https://docs.zuora.com/en/zuora-billing/bill-your-customer/usage-billing/prepaid-with-drawdown/query-the-prepaid-with-drawdown-objects-through-data-query/prepaid-balance-transaction-fields)
- [Lago: Wallets and prepaid credits](https://doc.getlago.com/guide/wallet-and-prepaid-credits/overview)

---

### ARR Including Usage Run-Rate

**Definition:** Annual Recurring Revenue (ARR) plus Usage Run-Rate: committed recurring revenue and annualised on-demand usage together. It is the figure Datadog, MongoDB and Confluent report as ARR.

**Formula:**
```
ARR Including Usage Run-Rate = ARR + Usage Run-Rate
```

**No double counting:** ARR carries commitments and the overage realised above them; Usage Run-Rate carries on-demand consumption alone. Each dollar of usage sits in exactly one of the two.

**Relation to ARR:** The GASP Standard keeps [ARR](core.md#arr-annual-recurring-revenue) committed, which is what the industry calls Committed ARR, CARR or Baseline ARR. Public consumption companies split between that policy and a usage-inclusive ARR, so the combined figure carries its own name and the two stay distinct.

**What it tells you:** The annual scale of the business with usage included, on a basis comparable to the ARR consumption companies report. The gap to ARR is the share of scale that no contract guarantees.

**Common mistakes:**
- Reporting this figure as ARR
- Adding a run-rate over all consumption, which counts commitments and overage twice

**Related metrics:** ARR, Usage Run-Rate, Consumption Revenue

**Sources:**
- [Datadog: Form 10-K, 2025](https://www.sec.gov/Archives/edgar/data/1561550/000162828026008819/ddog-20251231.htm)
- [MongoDB: Form 10-K, fiscal 2026](https://www.sec.gov/Archives/edgar/data/1441816/000162828026016799/mdb-20260131.htm)
- [Confluent: Form 10-K, 2025](https://www.sec.gov/Archives/edgar/data/1699838/000169983826000006/cflt-20251231.htm)
- [Ordway: ARR at public SaaS companies](https://ordwaylabs.com/resources/research/arr-public-saas-companies-research-study/)
- [Stripe: Committed ARR explained](https://stripe.com/resources/more/committed-annual-recurring-revenue-explained)
- [Bessemer: Cloud computing metrics](https://www.bvp.com/atlas/cloud-computing-metrics)

---

### Credit Breakage

**Definition:** The prepaid balance forfeited at expiry in the period.

**Formula:**
```
Credit Breakage = Sum of prepaid balances forfeited at expiry in the period
```

Expiry events carry a negative `credit_amount` and the metric reports the positive amount.

**Excludes:** Balances that roll over into a new term. A rollover writes no expiry event; the new term's grant carries the new expiry date.

**What it tells you:** How much prepaid consumption customers paid for and never used. A rising figure means commitments are sized above what customers consume, which tends to show up at renewal as a smaller commitment.

**Note:** The event is the forfeiture, not the recognition. Breakage is codified in ASC 606-10-55-48 and IFRS 15.B46: a company that expects to be entitled to breakage recognises it in proportion to the pattern of consumption, and otherwise when the chance of the customer using the balance becomes remote. Recognising breakage only when it occurs is not a permitted policy, and amounts owed under unclaimed-property law are never revenue. Credit Breakage therefore differs in timing from breakage revenue. Credit-billing systems record expiry as a movement on the ledger; the public consumption filers do not disclose breakage.

**Common mistakes:**
- Treating Credit Breakage as the period's breakage revenue
- Counting a rolled-over balance as forfeited

**Related metrics:** Prepaid Credit Balance, Consumption Revenue

**Sources:**
- [FASB: ASU 2014-09, Topic 606](https://storage.fasb.org/ASU%202014-09_Section%20A.pdf)
- [IFRS 15](https://www.icab.org.bd/icabadmin/uploads/ckeditor/7910IFRS%2015.pdf)
- [PwC Viewpoint: Unexercised rights (RR 7.4)](https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/revenue_from_contrac/revenue_from_contrac_US/chapter_7_options_to_US/74unexercised_rights_US.html)
- [Stripe: Billing credits](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits)
- [Orb: Prepurchase](https://docs.withorb.com/product-catalog/prepurchase)
- [Zenskar: Credit breakage](https://www.zenskar.com/finance-glossary/credit-breakage)

---

### Consumption Revenue Growth Rate

**Definition:** The month-over-month change in Consumption Revenue.

**Formula:**
```
Consumption Revenue Growth Rate = (Consumption Revenue this month - Consumption Revenue last month) / Consumption Revenue last month × 100
```

**What it tells you:** Whether usage is accelerating or slowing. It is the consumption counterpart of MRR Growth Rate and the figure consumption companies discuss on their earnings calls.

**Note:** No benchmark publisher defines this metric; the GASP Standard defines it so consumption growth is measured one way. It is undefined for a month that follows one with no consumption revenue.

**Common mistakes:**
- Comparing periods of different lengths without adjusting
- Counting credit purchases as growth

**Related metrics:** Consumption Revenue, MRR Growth Rate, Consumption Net Revenue Retention

**Sources:**
- [Snowflake: Form 10-K, fiscal 2026](https://www.sec.gov/Archives/edgar/data/1640147/000164014726000008/snow-20260131.htm)
- [MongoDB: Form 10-K, fiscal 2026](https://www.sec.gov/Archives/edgar/data/1441816/000162828026016799/mdb-20260131.htm)

---

### Consumption Net Revenue Retention

**Definition:** The consumption revenue of the customers active at period start, over a twelve-month period, divided by the same customers' consumption revenue over the twelve months before. Consumption Net Revenue Retention (Consumption NRR) reads year two over year one, Snowflake's basis.

**Formula:**
```
Consumption NRR = Consumption Revenue of the period-start cohort in the twelve-month period / Consumption Revenue of the same cohort in the prior twelve months × 100
```

**Cohort:** The customers on the customer snapshot at period start. A customer in the cohort that consumed nothing in the period counts at zero; customers acquired during the period stay out. A pay-as-you-go customer enters the cohort once the company's customer status marks it active.

**Two bases:** [Net Revenue Retention (NRR)](core.md#net-revenue-retention-nrr) reads MRR movements and already includes realised usage through the `usage_realisation` expansion, so it stays the main retention figure. Consumption NRR is a second basis, on recognised consumption: Snowflake reports on it, Twilio on recognised revenue, and Ordway finds public companies split between a revenue basis and an ARR basis. A company reporting this figure names it Consumption NRR rather than NRR.

**What it tells you:** Whether the customers you had a year ago consume more or less today, including the pay-as-you-go customers whom NRR leaves outside its cohort.

**Common mistakes:**
- Reporting Consumption NRR as NRR
- Including customers acquired during the period
- Measuring over a period shorter than twelve months, where seasonal consumption distorts the ratio

**Related metrics:** Net Revenue Retention (NRR), Consumption Revenue, Consumption Revenue Growth Rate

**Sources:**
- [Snowflake: Form 10-K, fiscal 2026](https://www.sec.gov/Archives/edgar/data/1640147/000164014726000008/snow-20260131.htm)
- [Twilio: Form 10-K, 2025](https://www.sec.gov/Archives/edgar/data/1447669/000144766926000021/twlo-20251231.htm)
- [Ordway: How public companies calculate NRR](https://ordwaylabs.com/resources/research/how-public-companies-calculate-net-revenue-retention.md)
- [Ordway: NRR for usage-based pricing](https://ordwaylabs.com/blog/net-revenue-retention-for-usage-based-pricing/)
- [SaaS Capital: Pitfalls in measuring churn](https://www.saas-capital.com/blog-posts/grrumbling-about-retention-metrics-or-pitfalls-in-measuring-saas-churn/)

---

### Revenue per Employee

**Definition:** Annual Recurring Revenue (ARR) divided by total headcount.

**Formula:**
```
Revenue per Employee = ARR / Total employees
```

**Benchmarks:**
- Below $100K: Early stage or overstaffed
- $100K-$200K: Growing
- $200K-$300K: Efficient
- Above $300K: Highly efficient

**What it tells you:** How much recurring revenue the company carries per person, a rough measure of overall productivity.

---

## Profitability Metrics

### Gross Margin

See [Core Metrics](core.md#gross-margin) for the canonical definition: revenue minus COGS over revenue.

---

### Operating Margin (EBIT Margin)

**Definition:** Operating income as a percentage of revenue.

**Formula:**
```
Operating Margin = Operating Income / Revenue × 100
```

Operating Income = Revenue - COGS - Operating Expenses

**Benchmarks:**
- Below -50%: Heavy investment phase
- -50% to 0%: Growth mode
- 0-20%: Path to profitability
- Above 20%: Profitable and efficient

---

### EBITDA Margin

**Definition:** Earnings before interest, taxes, depreciation and amortisation as a percentage of revenue.

**Formula:**
```
EBITDA Margin = EBITDA / Revenue × 100
```

**What it tells you:** Operational profitability before non-cash charges.

---

### Net Income Margin

**Definition:** Net income as a percentage of revenue.

**Formula:**
```
Net Income Margin = Net Income / Revenue × 100
```

**What it tells you:** How much of each dollar of revenue is left after every cost.

---

### Rule of 40

See [Core Metrics](core.md#rule-of-40) for the canonical definition: year-over-year ARR growth plus EBITDA margin.

---

## Cash Metrics

### Cash Burn Rate

**Definition:** Net cash consumed per month.

**Formula:**
```
Burn Rate = (Cash at start of period - Cash at end of period) / Months in period
```

**What it tells you:** How fast cash is being consumed.

---

### Cash Runway

**Definition:** Time until cash runs out at current burn rate.

**Formula:**
```
Runway = Current cash / Monthly burn rate
```

Measured in months.

**Targets:**
- Below 6 months: Critical, fundraise immediately
- 6-12 months: Urgent attention needed
- 12-18 months: Planning window
- Above 18 months: Comfortable

---

### Free Cash Flow (FCF)

**Definition:** Cash generated from operations minus capital expenditures.

**Formula:**
```
FCF = Operating cash flow - Capital expenditures
```

**What it tells you:** Cash available for growth, debt repayment or distribution.

---

### Free Cash Flow Margin

**Definition:** FCF as a percentage of revenue.

**Formula:**
```
FCF Margin = Free Cash Flow / Revenue × 100
```

**Benchmarks:**
- Below -20%: Heavy investment
- -20% to 0%: Growth mode
- 0-10%: Cash flow positive
- Above 10%: Strong cash generation

---

## Efficiency Metrics

### CAC Payback Period

See [Core Metrics](core.md#cac-payback-period) for the canonical definition: CAC over ARPA times gross margin.

---

### LTV:CAC Ratio

See [Core Metrics](core.md#ltvcac-ratio) for the canonical definition: LTV over CAC.

---

### Magic Number

**Definition:** Sales efficiency metric measuring revenue generated per dollar of sales and marketing spend.

**Formula:**
```
Magic Number = (QoQ ARR growth) / (Prior quarter S&M spend)
```

**Benchmarks:**
- Below 0.5: Inefficient, fix before scaling
- 0.5-0.75: Acceptable
- 0.75-1.0: Efficient (2024 median: 0.90)
- Above 1.0: Very efficient, invest more aggressively

**What it tells you:** Whether sales and marketing investment is generating sufficient returns.

**Sources:**
- [Benchmarkit: 2025 SaaS Metrics](https://www.benchmarkit.ai/2025benchmarks)
- [Drivetrain: SaaS Magic Number](https://www.drivetrain.ai/strategic-finance-glossary/what-is-magic-number-saas-companies)

---

### Burn Multiple

**Definition:** Net burn divided by net new ARR. Popularised by David Sacks.

**Formula:**
```
Burn Multiple = Net burn / Net new ARR
```

**Benchmarks:**
- Below 1x: Excellent (top 10% of Series A companies)
- 1.0-1.5x: Strong (top quartile)
- 1.5-2x: Median, acceptable
- 2.0-3x: Concerning, especially above $20M ARR
- Above 3x: Critical, requires immediate attention

**Scale expectations:** Burn multiple should decrease as company scales. Target <1.0x by $25M-$50M ARR range.

**What it tells you:** How much cash is being burned to generate each dollar of new ARR.

**Sources:**
- [CFO Advisors: 2025 Burn Multiple Benchmarks](https://www.cfoadvisors.com/blog/2025-burn-multiple-benchmarks_-how-series-a-saas-startups-can-prove-capital-efficiency)
- [Benchmarkit: SaaS Performance Metrics](https://www.benchmarkit.ai/2025benchmarks)

---

## Operating Expense Metrics

### Opex Ratio

**Definition:** Operating expenses as a percentage of revenue.

**Formula:**
```
Opex Ratio = Operating expenses / Revenue × 100
```

Opex Ratio can also be reported per cost centre, over all revenue: each row divides that centre's operating expenses by total revenue, so the rows sum to the Opex Ratio.

---

### S&M as % of Revenue

**Definition:** Sales and marketing spend as percentage of revenue.

**Formula:**
```
S&M % = Sales & Marketing expense / Revenue × 100
```

**Benchmarks:**
- Early stage: 80-120%
- Growth stage: 40-60%
- Mature: 20-40%

---

### R&D as % of Revenue

**Definition:** Research and development spend as percentage of revenue.

**Formula:**
```
R&D % = R&D expense / Revenue × 100
```

**Benchmarks:**
- SaaS typical: 15-25%

---

### G&A as % of Revenue

**Definition:** General and administrative spend as percentage of revenue.

**Formula:**
```
G&A % = G&A expense / Revenue × 100
```

**Benchmarks:**
- SaaS typical: 10-15%

---

## Collections Metrics

### Days Sales Outstanding (DSO)

See [RevOps](revops.md#days-sales-outstanding-dso) for the canonical definition: accounts receivable over revenue, times days in the period.

---

### Collection Rate

**Definition:** Percentage of invoiced amounts collected.

**Formula:**
```
Collection Rate = Amount of invoices paid / Amount invoiced × 100
```

Both sides read the invoices issued in the period. An invoice counts as collected at its full amount once it carries a payment date. The GASP Standard has no payment amount field, so a partial payment counts as the whole invoice and cash received is measured at the invoice level.

**Target:** >95%

---

### Bad Debt Rate

**Definition:** Percentage of revenue written off as uncollectable.

**Formula:**
```
Bad Debt Rate = Bad debt expense / Revenue × 100
```

**Target:** <1%

---

## Summary Table

| Metric | Type | Primary Indicator Of |
|--------|------|---------------------|
| ARR | Revenue | Business scale |
| Consumption Revenue | Revenue | Usage earned |
| Usage Run-Rate | Revenue | Scale of uncommitted usage |
| Prepaid Credit Balance | Revenue | Prepaid consumption not yet used |
| ARR Including Usage Run-Rate | Revenue | Business scale with usage |
| Credit Breakage | Revenue | Prepaid consumption forfeited |
| Consumption Revenue Growth Rate | Revenue | Usage momentum |
| Consumption Net Revenue Retention | Retention | Consumption growth in the existing base |
| Gross Margin | Profitability | Unit economics |
| Operating Margin | Profitability | Operational efficiency |
| Rule of 40 | Profitability | Growth/profit balance |
| Burn Rate | Cash | Cash consumption |
| Runway | Cash | Financial sustainability |
| Magic Number | Efficiency | Sales efficiency |
| Burn Multiple | Efficiency | Capital efficiency |
| DSO | Collections | Payment collection speed |
