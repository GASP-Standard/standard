# The GASP Standard

## The Unified SaaS Reporting Standard

**GAAP for SaaS.**

Just as Generally Accepted Accounting Principles standardized financial reporting for both management and investors, the GASP Standard establishes consensus definitions for SaaS metrics. Each metric gets one definition and one way to calculate it.

---

## Foundation

The GASP Standard provides canonical definitions for SaaS metrics across all departments, informed by industry best practices from sources like the [SaaS Metrics Standards Board](https://www.saasmetricsboard.com/), SaaS Capital, KeyBanc and others.

**The standard includes:**
- Core financial metrics (ARR, NRR, GRR, CAC, etc.) with precise formulas and benchmarks
- Operational metrics across all departments (Support, Engineering, Product, HR, etc.)
- Relationships between metrics showing cause and effect
- The One Page. A standard view of business health
- Practical implementation guidance

Where industry consensus exists, we follow it. Where gaps exist, we define using practitioner input and published research.

---

## The Problem

Every SaaS company measures "churn" differently. Ask five companies for their NRR and you'll get five different formulas. Boards, investors and operators spend meetings arguing about definitions when they could be discussing the numbers.

The GASP Standard writes down how the industry already measures performance: a consensus that exists in practice but had not been recorded in one place.

---

## What This Standard Provides

- **Canonical definitions** for every metric, from the ops review to the board room
- **Exact formulas** with a single calculation per metric
- **Industry benchmarks** for context
- **Relationships** between metrics, showing how they move together
- **The One Page**, the standard view of business health

It is opinionated by design. Adopt the definitions as written.

---

## From Ops Dashboard to Board Deck

Most SaaS metrics frameworks serve either operators or investors. The GASP Standard serves both. The dual-lens framework provides two forms for key metrics, Operating (O) and Market (M), computed from the same underlying data via the [Commercial Event Ledger](cel.md) and [Attribution Taxonomy Layer](atl.md).

- **O-form** metrics reflect the internal economic truth: what ops teams need to run the business
- **M-form** metrics match investor-comparable definitions: what boards and investors benchmark against peers

Both forms come from the same events, so nobody has to keep a spreadsheet reconciling the ops number with the board number.

---

## Scope

**This standard covers:** Subscription-based SaaS with recurring revenue. The universal building blocks that apply to all SaaS businesses.

**This standard does not cover:**
- **Pure consumption pricing**: metered revenue with no contracted commitment. MRR and ARR exclude usage fees that are not contractually guaranteed, while usage that meets or exceeds a contracted commitment counts as expansion (the ATL `usage_realisation` tag)
- **Implementation edge cases**: downstream concerns for individual businesses
- **Industry-specific variations**: vertical SaaS may have additional metrics

The goal is foundational metrics that any SaaS business can adopt. Daily is the atomic unit; weekly, monthly and annual views are derived.

---

## Principles

1. **Consensus over custom.** These definitions reflect industry standard practice. Your business is not special enough to need different definitions. Where you must deviate, record the variant in your adapter and leave the canonical formula as it is, so the two can be reconciled.

2. **Precision over flexibility.** Each metric has one canonical formula, never "it depends." Where a metric has Operating and Market forms, the standard declares both beside the canonical formula.

3. **Outcomes over activity.** We measure what matters to the business, not what's easy to track.

4. **Connection over isolation.** Metrics exist in relationship to each other. Understanding the system matters more than any single number.

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
| [The One Page](https://gaspwiki.com/v1/overview) | Standard view of business health |

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

## Metric Categories

| Category | What it covers |
|----------|----------------|
| Revenue | Money coming in: MRR, ARR, growth, expansion, contraction |
| Retention | Customers staying: churn, NRR, GRR |
| Acquisition | Customers arriving: CAC, conversion, pipeline |
| Engagement | Customers using: adoption, stickiness, health |
| Efficiency | Doing more with less: margins, payback, LTV:CAC |
| Operations | Running the business: support, uptime, delivery |
| People | The team: retention, engagement, capacity |

---

## Hierarchy

```
                    ┌─────────────────┐
                    │  Business Health │
                    │     (Score)      │
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

1. **Read the Core Metrics first.** Understand the numbers that define business health.

2. **Map your data sources.** For each metric, identify where the input data lives in your systems.

3. **Implement the canonical formulas as defined.** If your business needs a local variant, document it in your adapter and keep the canonical formula unchanged.

4. **Use the One Page.** It puts the Core Metrics side by side as the standard view of business health.

5. **Investigate with Departmental Metrics.** When something is off, drill into the relevant domain.
