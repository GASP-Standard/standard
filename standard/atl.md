# Attribution Taxonomy Layer (ATL)

The tagging system that makes dual-lens metrics possible.

Every event in the [Commercial Event Ledger (CEL)](cel.md) is an atomic fact: something happened, to someone, on a date, for an amount. But the same event can mean different things depending on which lens you apply. A $500/mo expansion might be organic seat growth (operating signal) or it might include a cross-module upsell (market-comparable signal). The ATL classifies events so that downstream metrics can include or exclude based on governed rules.

ATL tags are not optional. Every CEL event must carry the tags appropriate to its event class. Without ATL, the CEL is just a ledger. With ATL, it becomes a semantic layer.

---

## Three Tag Dimensions

ATL defines three orthogonal tag dimensions. Each dimension answers a different question about a CEL event.

| Dimension | Question | Applies to |
|-----------|----------|------------|
| **Lifecycle Attribution** | Where is this customer in their journey? | All event classes |
| **Expansion Classification** | What kind of growth is this? | `Revenue_Event` (expansion/reactivation), `Amendment_Event` |
| **Cost Function Attribution** | What commercial function incurred this cost? | `Cost_Event` |

---

## Lifecycle Attribution

Every CEL event receives exactly one lifecycle tag. This is the primary dimension. It tells you *why* the event happened in the context of the customer relationship.

### Values

| Tag | Definition | Example |
|-----|-----------|---------|
| `acquisition` | First commercial engagement with a new customer. | New customer signs a $2,000/mo contract. |
| `activation` | Customer reaches first value milestone after acquisition. | Customer completes onboarding and goes live in production. |
| `retention` | Existing customer continues or renews without change. | Annual renewal at the same MRR. |
| `expansion` | Existing customer increases their commercial commitment. | Customer upgrades from Professional to Enterprise tier. |
| `reactivation` | Previously churned customer returns. | Customer who cancelled 6 months ago signs a new contract. |
| `servicing` | Ongoing delivery cost for an active customer. | Monthly infrastructure cost, support staffing. |

### Assignment Rules

1. A customer's first `Revenue_Event` is always `acquisition`.
2. `Lifecycle_State_Change` events with `state_category = activation` or `state_category = onboarding_complete` are `activation`.
3. `Revenue_Event` with `event_type = renewal` and zero MRR change is `retention`.
4. `Revenue_Event` with `event_type = expansion` is `expansion`.
5. `Revenue_Event` with `event_type = reactivation` is `reactivation`.
6. `Cost_Event` records for active customers with no change event are `servicing`.
7. When a single action generates multiple CEL events (e.g., a renewal with expansion), each event gets its own lifecycle tag. The renewal portion is `retention`; the expansion portion is `expansion`.

---

## Expansion Classification

Revenue growth and mid-term amendments are not all the same. A customer adding seats to the same product is fundamentally different from a customer buying a new module. This dimension captures that distinction.

Applies to: `Revenue_Event` where `event_type` is `expansion` or `reactivation`, plus every `Amendment_Event` record.

### Values

| Tag | Definition | Example |
|-----|-----------|---------|
| `same_product` | More of what the customer already has. Seat adds, tier upgrades within the same module. | 20 → 30 seats on the same Professional plan. |
| `new_module` | Customer purchases a distinct product module they did not have before. | Analytics customer adds the Automation module. |
| `new_buying_centre` | A different department or division within the same legal entity starts purchasing. | Engineering team adopts the product already used by Marketing. |
| `pricing_adjustment` | MRR change driven by pricing action, not usage or scope change. | Annual price increase of 5% on renewal. |
| `recontracting` | MRR change driven by contract restructuring (e.g., monthly → annual, co-terming). | Customer consolidates three monthly subscriptions into one annual contract. |
| `usage_realisation` | MRR change from usage commitments being met or exceeded. | Customer exceeds their committed API call volume, triggering overage billing. |

### Why This Matters

This is the dimension that makes NRR-O differ from NRR-M.

- **NRR-O (Operating)** focuses on organic, durable expansion: `same_product` and `usage_realisation`. These signal product-market fit and natural customer growth.
- **NRR-M (Market)** includes all expansion types because investor-comparable NRR counts everything that is not net-new logo acquisition.

Without expansion classification, you cannot separate organic growth signals from commercial motion signals. Both are valid. They answer different questions.

---

## Cost Function Attribution

Not all costs serve the same commercial purpose. S&M spend to acquire new logos is fundamentally different from implementation labour to onboard them. This dimension classifies costs by function.

Applies to: all `Cost_Event` records.

### Values

| Tag | Definition | Example |
|-----|-----------|---------|
| `gtm` | Go-to-market costs: demand generation, sales compensation, partner commissions. | $45,000 monthly marketing spend; $12,000 SDR compensation. |
| `implementation` | Costs to deploy and configure the product for a new customer. | 40 hours of solutions engineering at $150/hr. |
| `onboarding` | Costs to train and enable a new customer post-implementation. | CSM time for 90-day onboarding programme. |
| `infrastructure` | Hosting, compute, storage and third-party service costs (COGS). | AWS monthly bill; Datadog monitoring. |
| `support` | Reactive customer assistance: tickets, escalations, troubleshooting. | Support team salaries; helpdesk tooling. |
| `success_engineering` | Proactive customer engagement: health monitoring, adoption programmes, QBRs. | CS team salaries; Gainsight licensing. |
| `account_management` | Renewal and expansion selling to existing customers. | Account executive compensation for upsell quota. |
| `research_development` | Building the product. Not customer-attributable. | Engineering and product salaries; development tooling. |
| `general_administrative` | Running the company. Not customer-attributable. | Finance, legal, HR, facilities. |
| `services_delivery` | Delivering paid professional services. | Consultant time on a billable project. |
| `recruiting` | Hiring. | Agency fees; recruiter time. |
| `partner_program` | Running the partner programme. | Partner enablement, portal, marketing development funds. |
| `partner_commission` | Commissions paid to partners on sourced deals. | 15% referral fee on a closed deal. |

Every cost event carries one `cost_function` value (Rule 3), so the enum covers all costs, including those outside the customer lifecycle.

### Why This Matters

This is the dimension that makes CAC-O differ from CAC-M.

- **CAC-O (Operating)** includes all costs to make a customer productive: `gtm` + `implementation` + `onboarding`. This reflects the true economic cost of acquiring a revenue-generating customer.
- **CAC-M (Market)** includes only `gtm` costs, matching the S&M-based CAC that investors use for benchmarking.

Without cost function attribution, you cannot compute both perspectives from the same data. You end up maintaining two separate cost allocation models.

---

## Tagging Rules

Every CEL event must be tagged according to these rules. No exceptions.

### Rule 1: Every event gets a Lifecycle tag

All five event classes receive exactly one `lifecycle_attribution` tag.

### Rule 2: Revenue growth and amendments get an Expansion tag

`Revenue_Event` records where `event_type` is `expansion` or `reactivation`, plus every `Amendment_Event` record, receive exactly one `expansion_classification` tag.

### Rule 3: Cost events get a Cost Function tag

All `Cost_Event` records receive exactly one `cost_function` tag.

### Rule 4: Tags are mutually exclusive within a dimension

An event cannot have two lifecycle tags, two expansion tags or two cost function tags. If an action spans two categories, it must be recorded as two CEL events with separate tags.

### Rule 5: Tags are assigned at event creation

ATL tags are set when the CEL event is created and are immutable thereafter, consistent with the CEL's immutability principle. Corrections require new events.

---

## Example Tagged Events

These examples show CEL events with their ATL tags applied.

### 1. New Customer Acquisition

```json
{
  "event_class": "Revenue_Event",
  "event_id": "rev-001",
  "event_date": "2026-02-01",
  "customer_id": "cust-1042",
  "subscription_id": "sub-2001",
  "event_type": "new",
  "mrr_change": 500.00,
  "currency": "USD",
  "prior_mrr": 0.00,
  "new_mrr": 500.00,
  "lifecycle_attribution": "acquisition"
}
```

### 2. Organic Seat Expansion

```json
{
  "event_class": "Amendment_Event",
  "event_id": "amd-001",
  "event_date": "2026-02-10",
  "customer_id": "cust-0512",
  "subscription_id": "sub-0890",
  "amendment_type": "seat_change",
  "mrr_change": 500.00,
  "prior_quantity": 20,
  "new_quantity": 30,
  "lifecycle_attribution": "expansion",
  "expansion_classification": "same_product"
}
```

### 3. Cross-Module Upsell

```json
{
  "event_class": "Amendment_Event",
  "event_id": "amd-002",
  "event_date": "2026-03-01",
  "customer_id": "cust-0512",
  "subscription_id": "sub-0891",
  "amendment_type": "add_on",
  "mrr_change": 800.00,
  "lifecycle_attribution": "expansion",
  "expansion_classification": "new_module"
}
```

### 4. GTM Spend (Shared Cost)

```json
{
  "event_class": "Cost_Event",
  "event_id": "cost-002",
  "event_date": "2026-02-28",
  "cost_centre": "marketing",
  "cost": 45000.00,
  "currency": "USD",
  "cost_type": "services",
  "customer_id": null,
  "description": "February demand generation campaigns",
  "lifecycle_attribution": "acquisition",
  "cost_function": "gtm"
}
```

### 5. Onboarding Labour (Customer-Specific Cost)

```json
{
  "event_class": "Cost_Event",
  "event_id": "cost-001",
  "event_date": "2026-02-05",
  "cost_centre": "implementation",
  "cost": 6000.00,
  "currency": "USD",
  "cost_type": "personnel",
  "customer_id": "cust-1042",
  "description": "40 hrs implementation engineering @ $150/hr",
  "lifecycle_attribution": "activation",
  "cost_function": "implementation"
}
```

### 6. Retention Success Servicing

```json
{
  "event_class": "Cost_Event",
  "event_id": "cost-003",
  "event_date": "2026-02-12",
  "cost_centre": "customer_success",
  "cost": 2400.00,
  "currency": "USD",
  "cost_type": "personnel",
  "customer_id": "cust-0783",
  "description": "16 hrs success engineering for at-risk retention",
  "lifecycle_attribution": "servicing",
  "cost_function": "success_engineering"
}
```

---

## Example SQL

ATL tags live as columns on CEL event tables. Querying by ATL dimension is a simple `WHERE` clause.

### CAC-O (Operating): Full Acquisition Cost

CAC-O adds implementation and onboarding cost to GTM cost. This matches the `cac` operating form in `formulas.json`.

```sql
SELECT
    (SELECT SUM(cost)
     FROM cel_cost_events
     WHERE cost_function IN ('gtm', 'implementation', 'onboarding')
       AND event_date BETWEEN :period_start AND :period_end)
  / NULLIF((SELECT COUNT(DISTINCT customer_id)
            FROM cel_revenue_events
            WHERE event_type = 'new'
              AND event_date BETWEEN :period_start AND :period_end), 0) AS cac_o;
```

### CAC-M (Market): GTM-Only Acquisition Cost

```sql
SELECT
    (SELECT SUM(cost)
     FROM cel_cost_events
     WHERE cost_function = 'gtm'
       AND event_date BETWEEN :period_start AND :period_end)
  / NULLIF((SELECT COUNT(DISTINCT customer_id)
            FROM cel_revenue_events
            WHERE event_type = 'new'
              AND event_date BETWEEN :period_start AND :period_end), 0) AS cac_m;
```

### NRR-O (Operating): Organic Retention

```sql
SELECT
    SUM(CASE WHEN event_type IN ('expansion') AND expansion_classification IN ('same_product', 'usage_realisation')
             THEN mrr_change ELSE 0 END)
  + SUM(CASE WHEN event_type IN ('contraction', 'churn')
             THEN mrr_change ELSE 0 END)
  + SUM(CASE WHEN event_type = 'renewal' THEN new_mrr ELSE 0 END)
AS nrr_o_numerator
FROM cel_revenue_events
WHERE lifecycle_attribution IN ('retention', 'expansion')
  AND (expansion_classification IS NULL
       OR expansion_classification IN ('same_product', 'usage_realisation'))
  AND event_date BETWEEN '2025-03-01' AND '2026-02-28';
```

---

## How O/M Metrics Use ATL

ATL tags are the mechanism that distinguishes Operating (O) from Market (M) metric forms. O-form metrics reflect internal economic reality. What ops teams use to run the business. M-form metrics match investor-comparable definitions. What boards and investors benchmark against peers. The pattern is consistent:

| Metric | Operating (O) Includes | Market (M) Includes |
|--------|----------------------|-------------------|
| **CAC** | `cost_function` ∈ (gtm, implementation, onboarding) | `cost_function` = gtm |
| **NRR** | `expansion_classification` ∈ (same_product, usage_realisation) | All `expansion_classification` except net-new logos |
| **LTV** | Contribution margin (includes implementation, onboarding costs) | Gross margin (COGS only) |
| **Churn** | Revenue churn: MRR-weighted churned and contraction MRR | Logo-based: binary churned/active |
| **ARR** | Durable ARR: excludes recontracting, pricing_adjustment (trailing 12 months, customers active at period end) | Contracted ARR: all recurring revenue |
| **LTV:CAC** | LTV-O over CAC-O (contribution margin; gtm, implementation and onboarding cost) | LTV-M over CAC-M (gross margin; gtm cost only) |
| **CAC Payback** | CAC-O over ARPA × GM-O | CAC-M over ARPA × GM-M |

The full inclusion/exclusion rules for each dual-lens Core metric are specified as `ATL Inclusion` lines in the O/M subsections of [Core Metrics](metrics/core.md). Rule of 40 has no separate O/M form and needs none. The ATL dimensions defined here are the building blocks for those rules.

---

## Relationship to Existing Metrics

The current GASP Standard defines metrics with Include/Exclude lists (e.g., CAC includes S&M + implementation costs. NRR excludes reactivation from some calculations). These existing definitions are implicitly the Operating (O) perspective. They represent the economic truth that internal operators need.

ATL does not replace those definitions. It provides the tagging vocabulary that makes it possible to *also* compute the Market (M) perspective from the same underlying events and to formally reconcile the two via a Translation Bridge.
