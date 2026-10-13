# The GASP Standard

## The Unified SaaS Reporting Standard

**GAAP for SaaS.**

Generally Accepted Accounting Principles standardised financial reporting for management and investors alike. The GASP Standard does the same for SaaS metrics, with one consensus definition per metric and one way to calculate it.

---

## Foundation

The GASP Standard provides canonical definitions for SaaS metrics across all departments, drawing on published work from the [SaaS Metrics Standards Board](https://www.saasmetricsboard.com/), SaaS Capital, KeyBanc and others.

**The standard includes:**
- Core financial metrics (ARR, NRR, GRR, CAC, etc.) with precise formulas and benchmarks
- Operational metrics across all departments (Support, Engineering, Product, HR, etc.)
- Relationships between metrics showing cause and effect
- This overview and the [metrics index](https://gaspwiki.com/v1/metrics), which together give the standard view of business health
- Practical implementation guidance

We follow industry consensus where it exists and fill the gaps from practitioner input and published research.

---

## The Problem

Every SaaS company measures "churn" differently. Ask five companies for their NRR and you'll get five different formulas. Boards, investors and operators spend meetings arguing about definitions when they could be discussing the numbers.

The GASP Standard writes down how the industry already measures performance: a consensus that exists in practice but had not been recorded in one place.

---

## What This Standard Provides

- **Canonical definitions** for every metric, from the ops review to the board room
- **Exact formulas**, one calculation per metric, written in a machine-readable grammar. Each compiles to SQL in four dialects (Postgres, Snowflake, BigQuery and Databricks) and ships as Apache Ossie files. Breakdowns such as by segment or by plan are declared on the metric itself
- **Industry benchmarks** for context
- **Relationships** between metrics, showing how they move together
- **The [metrics index](https://gaspwiki.com/v1/metrics)**, every metric by department with the Core Metrics as the view of business health

The standard is opinionated on purpose and expects you to adopt the definitions as written.

---

## From Ops Dashboard to Board Deck

Most SaaS metrics frameworks are written for operators or for investors. The GASP Standard serves both through its dual-lens framework: key metrics have two forms, Operating (O) and Market (M), computed from the same underlying data through the [Commercial Event Ledger](cel.md) and [Attribution Taxonomy Layer](atl.md).

- **O-form** metrics reflect the internal economics, the numbers ops teams run the business on
- **M-form** metrics follow investor-comparable definitions, the numbers boards and investors benchmark against peers

Both forms come from the same events, so nobody has to keep a spreadsheet reconciling the ops number with the board number.

---

## Scope

**This standard covers:** Subscription-based SaaS with recurring revenue. It defines the building blocks every SaaS business shares.

**This standard does not cover:**
- **Pure consumption pricing**: metered revenue with no contracted commitment. MRR and ARR exclude usage fees that are not contractually guaranteed, while usage that meets or exceeds a contracted commitment counts as expansion (the ATL `usage_realisation` tag)
- **Implementation edge cases**: downstream concerns for individual businesses
- **Industry-specific variations**: vertical SaaS may have additional metrics

The aim is a foundation any SaaS business can adopt. Daily is the atomic unit, with weekly, monthly and annual views derived from it.

---

## Principles

1. **Consensus over custom.** These definitions reflect industry standard practice. Your business is not special enough to need different definitions. Where you must deviate, keep the canonical formula as it is and document your variant beside it, using the adapter's field `transform` and `notes` to record how your data differs, so the two can be reconciled.

2. **Precision over flexibility.** Each metric has one canonical formula, never "it depends." Where a metric has Operating and Market forms, the standard declares both beside the canonical formula.

3. **Outcomes over activity.** We pick metrics for what they say about the business rather than for how easy they are to track.

4. **Connection over isolation.** Metrics move together. The standard records how each one feeds the others, since a single number makes most sense read next to the metrics that move it.

---

## Structure

### Layers

| Layer | Purpose | Audience |
|-------|---------|----------|
| **Core Metrics** | Define overall business health | Board, Executives |
| **Departmental Metrics** | Function-specific performance | Department leaders |
| **Diagnostic Metrics** | Investigate problems | Analysts, Operators |

### Documents

| Document | Purpose |
|----------|---------|
| [Definitions](definitions.md) | Canonical definitions for all terms, the source of truth |
| [Relationships](relationships.md) | How metrics connect and influence each other |
| [Commercial Event Ledger (CEL)](cel.md) | The atomic event layer behind the revenue, retention and cost metrics |
| [Attribution Taxonomy Layer (ATL)](atl.md) | The event tags that separate the Operating and Market forms |
| [Signal Type Taxonomy](taxonomy.json) | The four signal types (outcome, leading, efficiency and operational) and each metric's classification |
| [Formulas](formulas.json) | The canonical formula for every metric in the GASP formula grammar, with forms, variants and breakdowns |
| [Ontology](ontology.json) | Entities, concepts, datasets and canonical fields, with temporal semantics, access-control recommendations and validation rules |

---

## Departments Covered

| Department | File | Focus |
|------------|------|-------|
| **Core** | [core.md](metrics/core.md) | MRR, ARR, NRR, CAC, LTV: the fundamentals |
| **Sales** | [sales.md](metrics/sales.md) | Pipeline, win rate, quota, deal velocity |
| **Marketing** | [marketing.md](metrics/marketing.md) | Funnel, MQLs, CAC, demand generation |
| **Customer Success** | [customer-success.md](metrics/customer-success.md) | Health scores, retention, expansion |
| **Support** | [support.md](metrics/support.md) | Tickets, CSAT, resolution, efficiency |
| **Onboarding** | [onboarding.md](metrics/onboarding.md) | TTFV, completion, activation |
| **Product** | [product.md](metrics/product.md) | Usage, adoption, stickiness, delivery |
| **Engineering** | [engineering.md](metrics/engineering.md) | Uptime, DORA metrics, incidents |
| **Finance** | [finance.md](metrics/finance.md) | Margins, burn, cash, profitability |
| **RevOps / Order to Cash** | [revops.md](metrics/revops.md) | Billing, collections, revenue recognition |
| **People (HR)** | [people.md](metrics/people.md) | Turnover, eNPS, hiring, engagement |
| **Partnerships** | [partnerships.md](metrics/partnerships.md) | Channel revenue, partner performance |
| **Professional Services** | [professional-services.md](metrics/professional-services.md) | Utilization, project delivery, margins |

---

## Signal Types

Every metric carries one primary signal type of four: outcome, leading, efficiency or operational. [taxonomy.json](taxonomy.json) defines each type and classifies every metric; the site renders it at [gaspwiki.com/v1/taxonomy](https://gaspwiki.com/v1/taxonomy).

---

## Hierarchy

```
                    ┌─────────────────┐
                    │  Core Metrics   │
                    │ business health │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
   ┌─────────┐        ┌───────────┐        ┌───────────┐
   │ Revenue │        │ Retention │        │ Efficiency│
   │  Health │        │   Health  │        │   Health  │
   └────┬────┘        └─────┬─────┘        └─────┬─────┘
        │                   │                    │
   ┌────┴────┐        ┌─────┴─────┐        ┌────┴────┐
   │MRR, ARR │        │NRR, Churn │        │Margin,  │
   │Growth   │        │GRR, NPS   │        │CAC, LTV │
   └─────────┘        └───────────┘        └─────────┘
        ▲                   ▲                    ▲
        │                   │                    │
   [Sales, Mktg]       [CS, Support]        [Finance]
   dept metrics        dept metrics         dept metrics
```

---

## How to Use This Standard

1. **Read the Core Metrics first.** They are the numbers that define business health.

2. **Map your data sources.** For each metric, identify where the input data lives in your systems.

3. **Implement the canonical formulas as defined.** If your business needs a local variant, keep the canonical formula unchanged, document the variant beside it and record how your data differs in the adapter's field `transform` and `notes`.

4. **Start from the [metrics index](https://gaspwiki.com/v1/metrics).** The [Core Metrics](metrics/core.md) give the standard view of business health.

5. **Investigate with Departmental Metrics.** When a core number is off, drill into the department behind it.
