# The GASP Standard

## The Unified SaaS Reporting Standard

**GAAP for SaaS.**

Just as Generally Accepted Accounting Principles standardized financial reporting for both management and investors, the GASP Standard establishes consensus definitions for SaaS metrics. One set of definitions. One way to calculate. No ambiguity.

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

Every SaaS company measures "churn" differently. Ask five companies for their NRR and you'll get five different formulas. Boards, investors and operators waste time debating definitions instead of acting on insights.

The GASP Standard ends this. It codifies how the industry actually measures performance - the consensus that already exists but hasn't been written down.

---

## What This Standard Provides

- **Canonical definitions** for every metric. Ops through board room
- **Exact formulas** - no "it depends"
- **Industry benchmarks** for context
- **Relationships** between metrics - the system, not just the numbers
- **The One Page** - the standard view of business health

It is opinionated by design. These are not suggestions. This is the standard.

---

## From Ops Dashboard to Board Deck

Most SaaS metrics frameworks serve either operators or investors. The GASP Standard serves both. The dual-lens framework provides two forms for key metrics, Operating (O) and Market (M), computed from the same underlying data via the [Commercial Event Ledger](cel.md) and [Attribution Taxonomy Layer](atl.md).

- **O-form** metrics reflect the internal economic truth: what ops teams need to run the business
- **M-form** metrics match investor-comparable definitions: what boards and investors benchmark against peers

One set of data. Two perspectives. No reconciliation spreadsheet.

---

## Scope

**This standard covers:** Subscription-based SaaS with recurring revenue. The universal building blocks that apply to all SaaS businesses.

**This standard does not cover:**
- **Usage-based/consumption pricing** - Product-specific, cannot be universalized
- **Implementation edge cases** - Downstream concerns for individual businesses
- **Industry-specific variations** - Vertical SaaS may have additional metrics

The goal is foundational metrics that any SaaS business can adopt. Daily is the atomic unit; weekly, monthly and annual views are derived.

---

## Principles

1. **Consensus over custom.** These definitions reflect industry standard practice. Your business is not special enough to need different definitions. Where you must deviate, record the variant in your adapter and leave the canonical formula as it is, so the two can be reconciled.

2. **Precision over flexibility.** Each metric has one formula. Not "it depends."

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
| [Definitions](definitions.md) | Canonical definitions for all terms - the source of truth |
| [Relationships](relationships.md) | How metrics connect and influence each other |
| [The One Page](../wireframes/one-page.md) | Standard view of business health |

---

## Departments Covered

| Department | File | Focus |
|------------|------|-------|
| **Core** | [core.md](metrics/core.md) | MRR, ARR, NRR, CAC, LTV - the fundamentals |
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

3. **Implement exactly as defined.** Do not modify formulas. Do not add caveats.

4. **Use the One Page.** Let the standard surface what matters.

5. **Investigate with Departmental Metrics.** When something is off, drill into the relevant domain.
