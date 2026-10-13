# Finance Metrics

Metrics for measuring financial health, efficiency and operational performance.

---

## Revenue Metrics

### Revenue (GAAP)

**Definition:** Recognized revenue according to accounting standards.

**Formula:**
```
Revenue = Recognized revenue in period (per ASC 606)
```

**Note:** Different from bookings or billings. Revenue is recognized as service is delivered.

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

**What it tells you:** Cash coming in (or expected).

---

### ARR / MRR

See [Core Metrics: MRR](core.md#mrr-monthly-recurring-revenue) and [ARR](core.md#arr-annual-recurring-revenue) for full definitions.

---

### Deferred Revenue

See [RevOps](revops.md#deferred-revenue-balance) for the canonical definition. Deferred revenue is a balance: cumulative billings to date minus cumulative revenue recognised to date. It arises on billing, not on cash receipt.

---

### Revenue per Employee

**Definition:** Total revenue divided by headcount.

**Formula:**
```
Revenue per Employee = ARR / Total employees
```

**Benchmarks:**
- Below $100K: Early stage or overstaffed
- $100K-$200K: Growing
- $200K-$300K: Efficient
- Above $300K: Highly efficient

**What it tells you:** Overall company productivity.

---

## Profitability Metrics

### Gross Margin

See [Core Metrics](core.md#gross-margin) for full definition.

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

**Definition:** Earnings before interest, taxes, depreciation and amortization as a percentage of revenue.

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

**What it tells you:** Bottom line profitability.

---

### Rule of 40

See [Core Metrics](core.md#rule-of-40) for full definition.

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

See [Core Metrics](core.md#cac-payback-period) for full definition.

---

### LTV:CAC Ratio

See [Core Metrics](core.md#ltvcac-ratio) for full definition.

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

**Definition:** Net burn divided by net new ARR. Popularized by David Sacks.

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
| Gross Margin | Profitability | Unit economics |
| Operating Margin | Profitability | Operational efficiency |
| Rule of 40 | Profitability | Growth/profit balance |
| Burn Rate | Cash | Cash consumption |
| Runway | Cash | Financial sustainability |
| Magic Number | Efficiency | Sales efficiency |
| Burn Multiple | Efficiency | Capital efficiency |
| DSO | Collections | Payment collection speed |
