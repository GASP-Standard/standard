# Canonical Definitions

Single source of truth for all terms used in the GASP Standard.

When a term appears in multiple departmental metrics, this is the authoritative definition. Departmental files reference this document; they do not redefine.

---

## Foundational Entities

The SaaS data model is built on a three-level hierarchy. All metrics must be understood in context of which level they measure.

### Customer (Account, Organization)
A distinct billing entity with one or more subscriptions. The "who" of your business relationship.
- **Attributes:** Legal entity, billing contact, payment methods, contract terms
- **Key metrics at this level:** Logo count, Logo churn rate, Customer LTV, NPS
- **Industry equivalents:** Account (Stripe, Zuora, Salesforce), Organization (many B2B tools)

### Subscription (Contract, Agreement)
A billable agreement between a customer and your product, with defined terms, pricing and status. The "what and when" of the relationship.
- **Attributes:** Plan/tier, term (monthly/annual/multi-year), status, billing schedule
- **Key metrics at this level:** MRR, ARR, Subscription churn, Plan distribution
- **Industry equivalents:** Subscription (Stripe, Chargebee), Contract (Salesforce CPQ)

### License (Entitlement, Access, Quota)
A specific capability, quantity or configuration granted by a subscription. The "how much" of the relationship.
- **Types:**
  - **Feature Gates.** Binary access (on/off): SSO, API access, advanced analytics
  - **Quantity Limits.** Numeric caps: seats, storage, API calls
  - **Configuration.** Behavioral parameters: data retention, SLA tier
- **Key metrics at this level:** Seat utilization, Feature adoption, Usage vs quota
- **Industry equivalents:** Entitlements (Stripe), Licenses (Salesforce, Microsoft), Rate Plan Charges (Zuora)

### Hierarchy Principles
1. **Customers own subscriptions, not the reverse.** A customer churns when *all* their subscriptions end.
2. **MRR lives at the subscription level.** Expansion and contraction are measured by subscription changes.
3. **Licenses are derived from subscriptions.** The subscription is the source of truth; licenses are computed.
4. **Metrics must specify their level.** "Churn rate" is ambiguous. Specify logo churn (customer), MRR churn (subscription) or seat churn (license).

---

## Revenue Terms

### MRR (Monthly Recurring Revenue)
The total predictable revenue from active subscriptions, normalized to a monthly value.
- **Canonical definition:** [Core Metrics](metrics/core.md#mrr-monthly-recurring-revenue)
- **Used in:** Core, Finance, Customer Success

### ARR (Annual Recurring Revenue)
MRR × 12. The annualized value of recurring revenue.
- **Canonical definition:** [Core Metrics](metrics/core.md#arr-annual-recurring-revenue)
- **Used in:** Core, Finance, Sales, Customer Success, People

### New MRR
MRR added from newly acquired customers in the period.
- **Canonical definition:** [Core Metrics](metrics/core.md#new-mrr)
- **Used in:** Core, Sales

### Expansion MRR
Additional MRR from existing customers (upgrades, add-ons, seat increases).
- **Canonical definition:** [Core Metrics](metrics/core.md#expansion-mrr)
- **Used in:** Core, Customer Success

### Churned MRR
MRR lost from customers who cancelled.
- **Canonical definition:** [Core Metrics](metrics/core.md#churned-mrr)
- **Used in:** Core, Customer Success

### Contraction MRR
MRR reduction from existing customers who downgraded (but didn't churn).
- **Canonical definition:** [Core Metrics](metrics/core.md#contraction-mrr)
- **Used in:** Core, Customer Success

### Carry MRR
MRR from existing customers that renewed unchanged. No expansion, contraction or churn.
- **Formula:** Beginning MRR − Churned MRR − Contraction MRR
- **Canonical definition:** [Core Metrics](metrics/core.md#carry-mrr)
- **Used in:** Core

### Net New MRR
The net change in MRR after all movements.
- **Formula:** New MRR + Expansion MRR - Churned MRR - Contraction MRR
- **Canonical definition:** [Core Metrics](metrics/core.md#net-new-mrr)
- **Used in:** Core

### Revenue (GAAP)
Recognized revenue according to ASC 606 accounting standards.
- **Canonical definition:** [Finance Metrics](metrics/finance.md#revenue-gaap)
- **Used in:** Finance, RevOps

### Bookings
Total contract value signed in a period.
- **Canonical definition:** [Finance Metrics](metrics/finance.md#bookings)
- **Used in:** Finance, Sales

### ACV (Annual Contract Value)
The annualized value of a contract, normalizing multi-year deals to a single year. When aggregated, represents average deal size on an annual basis.
- **Canonical definition:** [Sales Metrics](metrics/sales.md#acv-annual-contract-value)
- **Used in:** Sales, Finance

### ARPA (Average Revenue Per Account)
Average monthly recurring revenue per customer account.
- **Formula:** MRR / Active Customers
- **Canonical definition:** [Core Metrics](metrics/core.md#arpa-average-revenue-per-account)
- **Used in:** Core (LTV, CAC Payback), Finance

---

## Retention Terms

### NRR (Net Revenue Retention)
Percentage of revenue retained from existing customers over a period, including expansion, contraction and churn. Two methods are widely used: cohort method (preferred) and formula method. Recommended: trailing 12 months, annualized if using shorter periods.
- **Canonical definition:** [Core Metrics](metrics/core.md#net-revenue-retention-nrr)
- **Used in:** Core, Customer Success
- **Adjusted variant:** Filter CEL events by [`change_nature`](cel.md#change-nature) to compute Adjusted NRR excluding temporary revenue movements.

### GRR (Gross Revenue Retention)
Percentage of revenue retained from existing customers, excluding expansion. Cannot exceed 100%. Two methods are widely used: cohort method (preferred) and formula method.
- **Canonical definition:** [Core Metrics](metrics/core.md#gross-revenue-retention-grr)
- **Adjusted variant:** Filter CEL events by [`change_nature`](cel.md#change-nature) to compute Adjusted GRR excluding temporary revenue movements.
- **Used in:** Core, Customer Success

### Logo Churn Rate
Percentage of customers lost in a period.
- **Canonical definition:** [Core Metrics](metrics/core.md#logo-churn-rate-customer-churn)
- **Used in:** Core, Customer Success

### Revenue Churn Rate
Percentage of MRR lost to churn and contraction in a period. Gross (losses only, not netted against expansion).
- **Formula:** (Churned MRR + Contraction MRR) / Beginning MRR × 100
- **Canonical definition:** [Core Metrics](metrics/core.md#revenue-churn-rate)
- **Used in:** Core

### Renewal Rate
Percentage of contracts renewed at term.
- **Canonical definition:** [Customer Success Metrics](metrics/customer-success.md#renewal-rate)
- **Used in:** Customer Success, RevOps

---

## Efficiency Terms

### CAC (Customer Acquisition Cost)
Total cost to acquire a new customer.
- **Canonical definition:** [Core Metrics](metrics/core.md#cac-customer-acquisition-cost)
- **Used in:** Core, Marketing, Finance

### Marketing CAC
Marketing-only portion of CAC (excludes sales costs).
- **Canonical definition:** [Marketing Metrics](metrics/marketing.md#marketing-cac)
- **Used in:** Marketing

### LTV (Customer Lifetime Value)
Total profit expected from a customer over their lifetime. Calculated with gross margin.
- **Formula:** (ARPA × Gross Margin) / Revenue Churn Rate
- **Canonical definition:** [Core Metrics](metrics/core.md#ltv-customer-lifetime-value)
- **Used in:** Core, Finance

### LTV:CAC Ratio
Ratio of customer lifetime value to acquisition cost.
- **Canonical definition:** [Core Metrics](metrics/core.md#ltvcac-ratio)
- **Used in:** Core, Finance

### CAC Payback Period
Time required to recover customer acquisition cost.
- **Canonical definition:** [Core Metrics](metrics/core.md#cac-payback-period)
- **Used in:** Core, Finance

### Gross Margin
Revenue minus cost of goods sold, as percentage of revenue.
- **Canonical definition:** [Core Metrics](metrics/core.md#gross-margin)
- **Used in:** Core, Finance

### Rule of 40
ARR Growth Rate (YoY %) + EBITDA Margin (%).
- **Canonical definition:** [Core Metrics](metrics/core.md#rule-of-40)
- **Used in:** Core, Finance

### Magic Number
Sales efficiency metric: QoQ ARR growth divided by prior quarter S&M spend.
- **Canonical definition:** [Finance Metrics](metrics/finance.md#magic-number)
- **Used in:** Finance

### Burn Multiple
Capital efficiency metric: Net burn divided by net new ARR. Popularized by David Sacks.
- **Canonical definition:** [Finance Metrics](metrics/finance.md#burn-multiple)
- **Used in:** Finance

---

## Customer Terms

### Customer
An entity (company/account) with a paid subscription.
- **Not:** Trial users, free tier users
- **Counting:** One customer = one billing entity, regardless of users
- **In formulas:** Unless otherwise specified, "Customers" means Active Customers

### Active Customer
A customer in good standing at a point in time.
- **Criteria:** Not churned, not suspended, payment current
- **Used for:** MRR counts, ARPA calculations, denominator in retention metrics

### User
An individual person using the product within a customer account.
- **Distinct from:** Customer (account level)

### Active User
A user who performed a qualifying action in the defined period.
- **Canonical definition:** [Product Metrics](metrics/product.md#daily-active-users-dau)
- **Qualifying action:** Defined per product; must be intentional engagement

### Lead
A contact who has expressed interest (form fill, signup, etc.).
- **Canonical definition:** [Marketing Metrics](metrics/marketing.md#leads)

### MQL (Marketing Qualified Lead)
A lead meeting criteria indicating sales-readiness.
- **Canonical definition:** [Marketing Metrics](metrics/marketing.md#marketing-qualified-leads-mqls)

### SQL (Sales Qualified Lead)
An MQL accepted by sales as worth pursuing.
- **Canonical definition:** [Marketing Metrics](metrics/marketing.md#sales-qualified-leads-sqls)

### Opportunity
A qualified sales prospect in the pipeline.
- **Distinct from:** Lead, MQL, SQL (earlier funnel stages)

---

## Satisfaction Terms

### NPS (Net Promoter Score)
% Promoters (9-10 rating) minus % Detractors (0-6 rating).
- **Canonical definition:** [Core Metrics](metrics/core.md#nps-net-promoter-score)
- **Used in:** Core, Onboarding, Partnerships, Professional Services
- **Note:** Same formula everywhere, but measured for different populations (customers, project completions, partners)

### CSAT (Customer Satisfaction Score)
Percentage of positive ratings on satisfaction survey.
- **Canonical definition:** [Support Metrics](metrics/support.md#customer-satisfaction-score-csat)
- **Used in:** Support, Customer Success, Onboarding, Professional Services
- **Note:** Same formula, different contexts (ticket, relationship, project)

### CES (Customer Effort Score)
Average rating on ease of experience (typically 1-7 scale).
- **Canonical definition:** [Support Metrics](metrics/support.md#customer-effort-score-ces)
- **Used in:** Support

### Health Score
Composite score predicting likelihood of retention or churn.
- **Canonical definition:** [Customer Success Metrics](metrics/customer-success.md#customer-health-score)
- **Used in:** Customer Success, Product

---

## Time Terms

### Period
A defined time interval for measurement. Always specify:
- Daily
- Weekly
- Monthly (calendar month)
- Quarterly (calendar quarter)
- Annual (trailing 12 months or calendar year - specify which)

### Cohort
A group of customers/users defined by a shared characteristic, typically signup date.
- Example: "January 2026 cohort" = customers who signed up in January 2026

### Trailing / Rolling
A period ending at the current date.
- Example: "Trailing 12 months" = past 365 days from today

### YoY (Year over Year)
Comparison to same period in prior year.
- Example: "Q1 2026 vs Q1 2025"

### MoM (Month over Month)
Comparison to prior month.

### QoQ (Quarter over Quarter)
Comparison to prior quarter.

---

## Financial Terms

### COGS (Cost of Goods Sold)
Direct costs to deliver the product/service.
- **SaaS COGS includes:** Hosting, support team, payment processing, third-party software
- **SaaS COGS excludes:** Sales, marketing, R&D, G&A

### Operating Expenses (Opex)
Costs of running the business (excluding COGS).
- **Categories:** S&M, R&D, G&A

### EBITDA
Earnings before interest, taxes, depreciation and amortization.
- **Formula:** Net income + Interest + Taxes + Depreciation + Amortization

### Burn Rate
Net cash consumed per month.
- **Canonical definition:** [Finance Metrics](metrics/finance.md#cash-burn-rate)

### Runway
Months until cash runs out at current burn rate.
- **Canonical definition:** [Finance Metrics](metrics/finance.md#cash-runway)

### DSO (Days Sales Outstanding)
Average days to collect payment after invoicing.
- **Canonical definition:** [Finance Metrics](metrics/finance.md#days-sales-outstanding-dso)
- **Used in:** Finance, RevOps (same definition)

### Bad Debt Rate
Percentage of revenue written off as uncollectable.
- **Canonical definition:** [Finance Metrics](metrics/finance.md#bad-debt-rate)
- **Used in:** Finance, RevOps (same definition)

---

## Reliability Terms

### Uptime / Availability
Percentage of time service is operational.
- **Canonical definition:** [Engineering Metrics](metrics/engineering.md#uptime-availability)

### SLA (Service Level Agreement)
Contractual commitment for service levels (uptime, response time, etc.).

### Incident
An unplanned interruption or degradation of service.
- **Severity levels:** SEV1 (critical), SEV2 (major), SEV3 (minor)

### MTTR (Mean Time to Resolve/Recover)
Average time from incident start to resolution.
- **Canonical definition:** [Engineering Metrics](metrics/engineering.md#mean-time-to-resolve-mttr)
- **Note:** DORA uses "Mean Time to Recovery" - same concept

### Error Rate
Percentage of requests resulting in errors.
- **Canonical definition:** [Engineering Metrics](metrics/engineering.md#error-rate)
- **Product variant:** User-facing error rate (per user action)

---

## Pipeline Terms

### Pipeline
Total value of active sales opportunities.
- **Canonical definition:** [Sales Metrics](metrics/sales.md#pipeline-value)

### Pipeline Coverage
Ratio of pipeline value to quota.
- **Canonical definition:** [Sales Metrics](metrics/sales.md#pipeline-coverage-ratio)

### Win Rate
Percentage of opportunities closed as won.
- **Canonical definition:** [Sales Metrics](metrics/sales.md#win-rate)
- **Used in:** Sales, Partnerships (partner win rate)

### Sales Cycle
Time from opportunity creation to close.
- **Canonical definition:** [Sales Metrics](metrics/sales.md#sales-cycle-length)

---

## Engagement Terms

### Session
A period of continuous user activity in the product.
- **Ends:** After defined inactivity period (typically 30 minutes)

### DAU / WAU / MAU
Daily / Weekly / Monthly Active Users.
- **Canonical definition:** [Product Metrics](metrics/product.md)

### Stickiness
DAU/MAU ratio - how often users return.
- **Canonical definition:** [Product Metrics](metrics/product.md#daumau-ratio-stickiness)

### Feature Adoption
Percentage of users using a specific feature.
- **Canonical definition:** [Product Metrics](metrics/product.md#feature-adoption-rate)

### Activation
Moment when new user experiences core product value.
- **Definition:** Product-specific, must be explicitly defined
- **Canonical framework:** [Product Metrics](metrics/product.md#activation-rate)

---

## Time-Based Metrics

### TTFV (Time to First Value)
Time from signup to achieving first meaningful value.
- **Canonical definition:** [Onboarding Metrics](metrics/onboarding.md#time-to-first-value-ttfv)

### FRT (First Response Time)
Time from ticket/request to first human response.
- **Canonical definition:** [Support Metrics](metrics/support.md#first-response-time-frt)

### Resolution Time
Time from request to final resolution.
- **Canonical definition:** [Support Metrics](metrics/support.md#resolution-time-time-to-resolution)

### Lead Time for Changes
Time from code commit to production deployment.
- **Canonical definition:** [Engineering Metrics](metrics/engineering.md#lead-time-for-changes)

---

## Percentile Conventions

When reporting distributions:
- **Median (P50):** Middle value, use for "typical" experience
- **P95:** 95th percentile, use for "almost everyone" experience
- **P99:** 99th percentile, use for tail/worst case

**Never use averages** for latency or time metrics - outliers skew results.

---

## Counting Conventions

### Point-in-Time vs Period
- **Point-in-time:** Value at a specific moment (e.g., "Customers as of Dec 31")
- **Period:** Activity during an interval (e.g., "Customers acquired in Q4")

### Beginning vs Ending
- **Beginning of period:** Value at start (for retention calculations)
- **End of period:** Value at end (for current state)

### Unique vs Total
- **Unique:** Deduplicated count (e.g., unique users)
- **Total:** All occurrences (e.g., total sessions)

---

## Measurement Period Conventions

Standard measurement frequencies by metric type. Always specify the period used.

### Revenue Metrics
| Metric | Typical Period | Notes |
|--------|---------------|-------|
| MRR | Monthly | Point-in-time, end of month |
| ARR | Monthly | MRR × 12, point-in-time |
| MRR Growth Rate | Monthly | Month-over-month comparison |
| New/Expansion/Churned/Contraction MRR | Monthly | Activity during the month |

### Retention Metrics
| Metric | Typical Period | Notes |
|--------|---------------|-------|
| NRR | Annual (trailing 12 months) | Monthly for operational tracking; annualize if using shorter periods |
| GRR | Annual (trailing 12 months) | Same as NRR |
| Logo Churn Rate | Monthly or Annual | Always specify which; monthly × 12 ≠ annual |
| Revenue Churn Rate | Monthly | Annualize for comparison: (1 - monthly rate)^12 |

### Efficiency Metrics
| Metric | Typical Period | Notes |
|--------|---------------|-------|
| CAC | Quarterly | Lag 1-2 months for long sales cycles |
| LTV | N/A | Lifetime calculation, not periodic |
| CAC Payback | Quarterly | Result in months |
| Gross Margin | Monthly or Quarterly | Aligns with financial reporting |
| Rule of 40 | Annual | YoY growth + trailing margin |

### Engagement Metrics
| Metric | Typical Period | Notes |
|--------|---------------|-------|
| DAU/WAU/MAU | Daily/Weekly/Monthly | Rolling windows |
| NPS | Quarterly or Annual | Avoid survey fatigue |

---

## GASP Framework Terms

The terms below describe the GASP standard itself. How metrics are classified, how events are captured, how access is scoped, how the twin is assembled. They are distinct from the SaaS business concepts above. You will see these terms in the MCP server output, the ontology, the adapter schema and the governance framework.

### CEL (Commercial Event Ledger)
The atomic, immutable event layer from which all GASP metrics derive. Every metric in the standard traces back to CEL events. If an event is not in the CEL, it does not exist for metric purposes.
- **Canonical definition:** [CEL](cel.md#commercial-event-ledger-cel)
- **Used in:** All revenue, retention and cost metrics

### ATL (Attribution Taxonomy Layer)
The tagging layer that classifies CEL events by lifecycle stage, expansion type and cost function. ATL is what enables dual-lens metrics (Operating form vs Market form).
- **Canonical definition:** [ATL](atl.md#attribution-taxonomy-layer-atl)
- **Used in:** Core metrics with dual-lens forms (ARR, NRR, CAC, LTV, Gross Margin, Churn)

### Adapter
The JSON mapping file that connects GASP's canonical field names to your warehouse columns. Each field declares its `schema.table.column` reference plus optional owners for the definition and the pipeline. The adapter is the only file a consuming organization writes.
- **Reference:** [Adapter Guide](/v1/adapter)

### Digital Twin
The combination of the GASP standard (metrics, relationships, ontology), your adapter (warehouse mapping) and an MCP server (agent access layer). Together they form a read-only semantic model of how a SaaS business operates. Agents read from the twin, not from source systems directly.
- **Reference:** [SaaS Digital Twin](/v1/digital-twin)

### Ontology
The structured representation of GASP's entities, concepts, fields, source categories, temporal semantics and validation rules. The ontology sits below the metric layer and provides the canonical vocabulary that adapters, queries and agents reference.
- **Reference:** ontology.json in the GASP repository

### Signal Type
A classification that describes what kind of signal a metric provides. Every GASP metric has exactly one primary signal type; some carry a secondary.
- **Outcome.** A result that matters on its own (ARR, NRR, Gross Margin).
- **Leading.** Predicts a future outcome (Pipeline Value, Health Score, NPS).
- **Efficiency.** A ratio measuring productivity (CAC Payback, LTV:CAC, Magic Number).
- **Operational.** Operational health or throughput (Uptime, MTTR, Ticket Volume).
- **Reference:** [Taxonomy](/v1/taxonomy)

### Sensitivity Tier
GASP's recommended data sensitivity classification for each metric. Aligns with ISO 27001 and OSSA `data_classification` conventions.
- **`public`.** Shareable externally with no restriction (rare for internal SaaS metrics).
- **`internal`.** Shareable across the organization. Default for most operational metrics.
- **`confidential`.** Cross-functional but sensitive. Typically restricted to managers and above.
- **`restricted`.** Highly sensitive. Executive and finance-leadership only by default.
- **Reference:** [Governance](/v1/governance#sensitivity-tier)

### Access Scope
GASP's recommended filtering pattern for each metric. Describes whether the metric is naturally filterable by user context.
- **`unscoped`.** Same value for everyone with access (e.g. company-wide ARR).
- **`department-scoped`.** Filtered by the viewer's department context.
- **`owner-scoped`.** Visible only for records the viewer owns or manages. Interpretation (individual, team, territory, book, segment) lives in the adapter.
- **Reference:** [Governance](/v1/governance#access-scope)

### Change Nature
Optional CEL field that captures the intent behind a revenue movement. Does not alter metric calculations. Enables downstream analysis of revenue quality (e.g. Adjusted NRR).
- **`permanent`.** Durable shift in the customer relationship (default when omitted).
- **`temporary`.** Expected to reverse within a defined period.
- **`scheduled_reversal`.** Reverses a prior `temporary` event.
- **Reference:** [CEL change_nature](/v1/cel#change-nature)

### Structured Formula
A decomposed representation of a metric's formula: explicit references to other metric nodes (with roles like numerator, denominator, addend) and the raw fields required. Enables agents to walk the dependency tree without parsing formula text.
- **Reference:** ontology.json structuredFormulas in the GASP repository

### Metric Owner
The named team or person responsible for a metric definition in an organization's adapter. Ownership is a required adapter field. When a metric value is disputed, the owner resolves the dispute. GASP provides the canonical definition; the owner decides whether their organization follows it or deviates, and documents the deviation.
- **Reference:** [Adapter Guide](/v1/adapter#metric-owners)

### Temporal Semantics
GASP's structured description of a metric's time grain, aggregation method and reporting frequency. Each metric has a mapping (e.g. MRR = End-of-month snapshot, Daily sync).
- **Reference:** ontology.json temporalSemantics in the GASP repository

---

## Null Handling

When data is missing:
- **Exclude from calculations:** Don't impute or assume
- **Report coverage:** What percentage of records have data
- **Flag uncertainty:** If sample size is too small, note it

---

## Benchmark Sources

When benchmarks are cited in this standard, they are drawn from:
- [SaaS Metrics Standards Board](https://www.saasmetricsboard.com/) - core metric definitions
- [KeyBanc Capital Markets SaaS Survey](https://www.key.com/businesses-institutions/industry-expertise/saas-resources.html) - annual survey of private SaaS companies
- [SaaS Capital](https://www.saas-capital.com/research/) - retention and growth benchmarks
- [OpenView/High Alpha SaaS Benchmarks](https://www.highalpha.com/saas-benchmarks) - comprehensive annual report
- [Benchmarkit](https://www.benchmarkit.ai/2025benchmarks) - CAC, payback, efficiency metrics
- [Bessemer Cloud Index](https://cloudindex.bvp.com/) - public SaaS company performance tracking
- [ICONIQ Growth](https://www.iconiqcapital.com/growth/insights) - SaaS scaling and efficiency research
- [McKinsey](https://www.mckinsey.com/industries/technology-media-and-telecommunications/our-insights/saas-and-the-rule-of-40-keys-to-the-critical-value-creation-metric) - Rule of 40 analysis
- [DORA State of DevOps Report](https://dora.dev/research/) - engineering metrics
- [Gainsight](https://www.gainsight.com/resource/the-customer-success-index-2024/) - customer success metrics
- [Mixpanel](https://mixpanel.com/benchmarks/) - product metrics

Benchmarks are general guidance. Your targets may differ based on business model, market and stage.
