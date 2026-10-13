# Commercial Event Ledger (CEL)

The single source of truth for all metric computation in the GASP Standard.

Every metric in this standard (revenue, retention, efficiency, operational) derives from atomic commercial events. The CEL is the governed layer where those events live. If an event is not in the CEL, it does not exist for metric purposes. If a metric cannot be traced to CEL events, it is not a governed metric.

---

## Why the CEL Exists

SaaS companies typically compute metrics from derived tables: MRR snapshots, billing system exports, CRM rollups. These derived sources introduce drift. Two teams querying the same concept from different derived tables get different numbers. The CEL eliminates this by establishing a single event-level layer from which all metrics are computed.

The CEL is not a product. It is a conceptual standard for how commercial events should be captured, stored and governed. Implement it in your warehouse, your lakehouse or your operational database. The schema is the contract.

---

## Design Principles

1. **Immutable events.** Once recorded, a CEL event is never modified. Corrections are new events (e.g., a `Revenue_Event` of type `adjustment`). This preserves auditability and enables point-in-time reconstruction.

2. **No derived data upstream.** The CEL contains atomic facts. MRR, ARR, NRR and every other metric are computed *from* CEL events, never stored *in* the CEL. Derived values live downstream.

3. **Daily atomic grain.** Every event has a date. The day is the smallest unit. Weekly, monthly, quarterly and annual views are aggregations of daily events.

4. **One event, one truth.** Each commercial event is recorded once. If a subscription renewal generates both a `Revenue_Event` and a `Contract_Event`, those are two distinct events. Not one event with two types.

5. **Source-system agnostic.** The CEL defines *what* to capture, not *where* it comes from. Events may originate in billing systems, CRMs, HRIS or manual entries. The CEL schema is the normalization layer.

---

## Event Classes

The CEL defines five event classes. Every commercial event in a subscription SaaS business falls into one of these.

### Revenue_Event

A change in recurring revenue. This is the primary input for MRR, ARR, NRR, GRR and revenue churn metrics.

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | `string` | Unique identifier |
| `event_date` | `date` | Date the event occurred |
| `customer_id` | `string` | [Customer](definitions.md#customer-account-organization) identifier |
| `subscription_id` | `string` | [Subscription](definitions.md#subscription-contract-agreement) identifier |
| `event_type` | `enum` | `new`, `expansion`, `contraction`, `churn`, `reactivation`, `renewal` |
| `mrr_change` | `decimal` | Change in MRR (positive for new/expansion/reactivation, negative for contraction/churn) |
| `currency` | `string` | ISO 4217 currency code |
| `prior_mrr` | `decimal` | MRR before this event |
| `new_mrr` | `decimal` | MRR after this event |
| `expansion_classification` | `enum` (expansion and contraction only) | `same_product`, `new_module`, `new_buying_centre`, `pricing_adjustment`, `recontracting`, `usage_realisation`. See [ATL](atl.md#expansion-classification). The NRR and ARR forms read it. |
| `change_nature` | `enum` (optional) | `permanent` (default), `temporary`, `scheduled_reversal`. See [Change Nature](#change-nature). |

---

### Cost_Event

An incurred cost attributable to a commercial function. Primary input for CAC, Gross Margin, LTV and efficiency metrics.

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | `string` | Unique identifier |
| `event_date` | `date` | Date the cost was incurred |
| `cost_centre` | `enum` | Department or team: `marketing`, `sales`, `customer_success`, `support`, `engineering`, `product`, `finance`, `people`, `services`, `partnerships`, `general` |
| `cost` | `decimal` | Cost amount |
| `currency` | `string` | ISO 4217 currency code |
| `cost_type` | `enum` | Nature of the cost: `personnel`, `software`, `services`, `infrastructure`, `other` |
| `cost_function` | `enum` | Purpose of the cost (the ATL cost function tag): `gtm`, `implementation`, `onboarding`, `infrastructure`, `support`, `success_engineering`, `account_management`, `research_development`, `general_administrative`, `services_delivery`, `recruiting`, `partner_program`, `partner_commission` |
| `customer_id` | `string` (nullable) | Customer if directly attributable; null for shared costs |
| `description` | `string` | Human-readable description |

---

### Contract_Event

A contractual milestone. Primary input for bookings, renewal rate and contract-level metrics.

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | `string` | Unique identifier |
| `event_date` | `date` | Date of contractual action |
| `customer_id` | `string` | [Customer](definitions.md#customer-account-organization) identifier |
| `subscription_id` | `string` | [Subscription](definitions.md#subscription-contract-agreement) identifier |
| `contract_event_type` | `enum` | `new_contract`, `renewal`, `amendment`, `cancellation` |
| `contract_start` | `date` | Contract start date |
| `contract_end` | `date` | Contract end date |
| `tcv` | `decimal` | Total contract value |
| `acv` | `decimal` | Annual contract value |
| `currency` | `string` | ISO 4217 currency code |

---

### Amendment_Event

A mid-term change to an existing subscription. Distinct from `Contract_Event` because amendments happen *during* a contract term, not at boundaries. Primary input for expansion/contraction classification.

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | `string` | Unique identifier |
| `event_date` | `date` | Date of amendment |
| `customer_id` | `string` | [Customer](definitions.md#customer-account-organization) identifier |
| `subscription_id` | `string` | [Subscription](definitions.md#subscription-contract-agreement) identifier |
| `amendment_type` | `enum` | `upgrade`, `downgrade`, `add_on`, `cross_sell`, `seat_change`, `pricing_change` |
| `mrr_change` | `decimal` | Change in MRR resulting from amendment |
| `prior_plan` | `string` | Plan/tier before amendment |
| `new_plan` | `string` | Plan/tier after amendment |
| `prior_quantity` | `integer` (nullable) | Seat/unit count before (if applicable) |
| `new_quantity` | `integer` (nullable) | Seat/unit count after (if applicable) |
| `change_nature` | `enum` (optional) | `permanent` (default), `temporary`, `scheduled_reversal`. See [Change Nature](#change-nature). |

---

### Lifecycle_State_Change

A change in customer lifecycle status. Primary input for health scores, onboarding metrics and churn prediction.

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | `string` | Unique identifier |
| `event_date` | `date` | Date of state change |
| `customer_id` | `string` | [Customer](definitions.md#customer-account-organization) identifier |
| `prior_state` | `string` | Previous lifecycle state |
| `new_state` | `string` | New lifecycle state |
| `state_category` | `enum` | `activation`, `onboarding_complete`, `healthy`, `at_risk`, `churned`, `reactivated` |
| `trigger` | `string` | What caused the state change (e.g., "health score drop below 40", "90-day inactivity") |

### Pairing rule: amendments that change MRR

Any `Amendment_Event` that changes MRR also writes a `Revenue_Event` carrying the `mrr_change`, the `event_type` (`expansion` or `contraction`) and the `expansion_classification`. The amendment row keeps the contract detail (plan, quantity, amendment type). The two are distinct facts about one commercial action, so NRR, ARR and the other revenue metrics read `Revenue_Event` and still see mid-term expansion such as seat adds and `new_module` upsells.

---

## Example Events

These worked examples show how real-world commercial actions map to CEL events.

### 1. Subscription Activation

A new customer signs up for a $500/mo plan.

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
  "new_mrr": 500.00
}
```

### 2. Usage Commit Realisation

An existing customer's usage commitment triggers an additional $200/mo.

```json
{
  "event_class": "Revenue_Event",
  "event_id": "rev-002",
  "event_date": "2026-02-15",
  "customer_id": "cust-0783",
  "subscription_id": "sub-1450",
  "event_type": "expansion",
  "mrr_change": 200.00,
  "currency": "USD",
  "prior_mrr": 1000.00,
  "new_mrr": 1200.00
}
```

### 3. Mid-Term Expansion (Seat Add)

Customer adds 10 seats at $50/seat/mo mid-contract.

```json
{
  "event_class": "Amendment_Event",
  "event_id": "amd-001",
  "event_date": "2026-02-10",
  "customer_id": "cust-0512",
  "subscription_id": "sub-0890",
  "amendment_type": "seat_change",
  "mrr_change": 500.00,
  "prior_plan": "Professional",
  "new_plan": "Professional",
  "prior_quantity": 20,
  "new_quantity": 30
}
```

The paired `Revenue_Event` carries the revenue effect:

```json
{
  "event_class": "Revenue_Event",
  "event_id": "rev-020",
  "event_date": "2026-02-10",
  "customer_id": "cust-0512",
  "subscription_id": "sub-0890",
  "event_type": "expansion",
  "expansion_classification": "same_product",
  "mrr_change": 500.00,
  "currency": "USD",
  "prior_mrr": 1000.00,
  "new_mrr": 1500.00
}
```

### 4. Cross-Module Expansion

Customer on the Analytics module purchases the Automation module.

```json
{
  "event_class": "Amendment_Event",
  "event_id": "amd-002",
  "event_date": "2026-03-01",
  "customer_id": "cust-0512",
  "subscription_id": "sub-0891",
  "amendment_type": "add_on",
  "mrr_change": 800.00,
  "prior_plan": "Analytics Pro",
  "new_plan": "Analytics Pro + Automation",
  "prior_quantity": null,
  "new_quantity": null
}
```

The paired `Revenue_Event` carries the revenue effect:

```json
{
  "event_class": "Revenue_Event",
  "event_id": "rev-021",
  "event_date": "2026-03-01",
  "customer_id": "cust-0512",
  "subscription_id": "sub-0891",
  "event_type": "expansion",
  "expansion_classification": "new_module",
  "mrr_change": 800.00,
  "currency": "USD",
  "prior_mrr": 2000.00,
  "new_mrr": 2800.00
}
```

### 5. Reactivation

A previously churned customer returns with a new subscription.

```json
{
  "event_class": "Revenue_Event",
  "event_id": "rev-003",
  "event_date": "2026-02-20",
  "customer_id": "cust-0291",
  "subscription_id": "sub-2050",
  "event_type": "reactivation",
  "mrr_change": 750.00,
  "currency": "USD",
  "prior_mrr": 0.00,
  "new_mrr": 750.00
}
```

### 6. Onboarding Engineering Cost

Implementation team spends 40 hours onboarding a new enterprise customer.

```json
{
  "event_class": "Cost_Event",
  "event_id": "cost-001",
  "event_date": "2026-02-05",
  "cost_centre": "services",
  "cost": 6000.00,
  "currency": "USD",
  "cost_type": "personnel",
  "cost_function": "implementation",
  "customer_id": "cust-1042",
  "description": "40 hrs implementation engineering @ $150/hr"
}
```

### 7. GTM Spend (Shared)

Marketing spend on demand generation. Not attributable to a single customer.

```json
{
  "event_class": "Cost_Event",
  "event_id": "cost-002",
  "event_date": "2026-02-28",
  "cost_centre": "marketing",
  "cost": 45000.00,
  "currency": "USD",
  "cost_type": "services",
  "cost_function": "gtm",
  "customer_id": null,
  "description": "February demand generation campaigns"
}
```

### 8. Retention Success Servicing

CS team effort to retain an at-risk account.

```json
{
  "event_class": "Cost_Event",
  "event_id": "cost-003",
  "event_date": "2026-02-12",
  "cost_centre": "customer_success",
  "cost": 2400.00,
  "currency": "USD",
  "cost_type": "personnel",
  "cost_function": "success_engineering",
  "customer_id": "cust-0783",
  "description": "16 hrs success engineering for at-risk retention"
}
```

### 9. Contract Renewal

Customer renews for another 12-month term.

```json
{
  "event_class": "Contract_Event",
  "event_id": "con-001",
  "event_date": "2026-03-01",
  "customer_id": "cust-0350",
  "subscription_id": "sub-0670",
  "contract_event_type": "renewal",
  "contract_start": "2026-03-01",
  "contract_end": "2027-02-28",
  "tcv": 24000.00,
  "acv": 24000.00,
  "currency": "USD"
}
```

### 10. Health Score Drop

Customer's health score deteriorates, triggering an at-risk state.

```json
{
  "event_class": "Lifecycle_State_Change",
  "event_id": "lsc-001",
  "event_date": "2026-02-18",
  "customer_id": "cust-0783",
  "prior_state": "healthy",
  "new_state": "at_risk",
  "state_category": "at_risk",
  "trigger": "Health score dropped from 72 to 35"
}
```

---

## Example SQL

A minimal warehouse implementation. This is illustrative, not normative. Adapt to your warehouse dialect and tooling.

### Schema

```sql
CREATE TABLE cel_revenue_events (
    event_id        VARCHAR(64) PRIMARY KEY,
    event_date      DATE NOT NULL,
    customer_id     VARCHAR(64) NOT NULL,
    subscription_id VARCHAR(64) NOT NULL,
    event_type      VARCHAR(20) NOT NULL,  -- new, expansion, contraction, churn, reactivation, renewal
    mrr_change      DECIMAL(12,2) NOT NULL,
    currency        CHAR(3) NOT NULL DEFAULT 'USD',
    prior_mrr       DECIMAL(12,2) NOT NULL,
    new_mrr         DECIMAL(12,2) NOT NULL,
    change_nature   VARCHAR(20) DEFAULT 'permanent',  -- permanent, temporary, scheduled_reversal
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cel_cost_events (
    event_id        VARCHAR(64) PRIMARY KEY,
    event_date      DATE NOT NULL,
    cost_centre     VARCHAR(32) NOT NULL,
    cost            DECIMAL(12,2) NOT NULL,
    currency        CHAR(3) NOT NULL DEFAULT 'USD',
    cost_type       VARCHAR(20) NOT NULL,
    cost_function   VARCHAR(32) NOT NULL,  -- ATL cost function tag
    customer_id     VARCHAR(64),
    description     TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Querying: MRR at End of Month

```sql
SELECT
    DATE_TRUNC('month', event_date) AS month,
    SUM(mrr_change) AS net_mrr_change
FROM cel_revenue_events
WHERE event_date <= '2026-02-28'
GROUP BY 1
ORDER BY 1;
```

### Querying: New MRR in February

```sql
SELECT SUM(mrr_change) AS new_mrr
FROM cel_revenue_events
WHERE event_type = 'new'
  AND event_date BETWEEN '2026-02-01' AND '2026-02-28';
```

---

## Change Nature

An optional field on `Revenue_Event` and `Amendment_Event` that captures the intent behind a revenue movement. This field does not alter how events are classified or how metrics are calculated. It provides structured metadata that enables downstream analysis of revenue quality.

### Values

| Value | Meaning | Example |
|-------|---------|---------|
| `permanent` | The change reflects a durable shift in the customer relationship. This is the default when the field is omitted. | Customer upgrades from Starter to Pro. |
| `temporary` | The change is expected to reverse within a defined period. The underlying subscription relationship has not structurally changed. | Customer purchases a 3-month add-on for a seasonal campaign. |
| `scheduled_reversal` | This event reverses a prior `temporary` event. It should be paired with the original event for analysis. | The 3-month add-on expires and MRR returns to its prior level. |

### Design Principles

1. **No metric redefinition.** MRR, ARR and NRR calculations are unchanged. A `temporary` expansion still counts as expansion in the standard metrics. The field enables a second analytical lens, not a replacement.

2. **Default is permanent.** If `change_nature` is omitted the event is treated as permanent. Teams adopt this field incrementally by tagging only the events where temporality matters.

3. **No subjective judgment.** The values describe contractual or operational facts, not interpretations. A temporary upgrade is temporary because the contract says so, not because someone thinks it might reverse.

### Example: Temporary Upgrade and Reversal

A customer on a $1,000/mo plan purchases a 3-month analytics add-on for $600/mo.

**Month 1: Upgrade**

```json
{
  "event_class": "Revenue_Event",
  "event_id": "rev-010",
  "event_date": "2026-04-01",
  "customer_id": "cust-0512",
  "subscription_id": "sub-0890",
  "event_type": "expansion",
  "mrr_change": 600.00,
  "currency": "USD",
  "prior_mrr": 1000.00,
  "new_mrr": 1600.00,
  "change_nature": "temporary"
}
```

**Month 4: Add-on expires**

```json
{
  "event_class": "Revenue_Event",
  "event_id": "rev-011",
  "event_date": "2026-07-01",
  "customer_id": "cust-0512",
  "subscription_id": "sub-0890",
  "event_type": "contraction",
  "mrr_change": -600.00,
  "currency": "USD",
  "prior_mrr": 1600.00,
  "new_mrr": 1000.00,
  "change_nature": "scheduled_reversal"
}
```

Under standard GASP metrics this produces +$600 expansion in April and -$600 contraction in July. Both are mechanically correct. The `change_nature` field allows downstream analysis to separate this expected reversal from true contraction that signals customer health risk.

### Adjusted NRR

Teams that adopt `change_nature` can compute an adjusted NRR that excludes temporary movements. This is not a replacement for standard NRR. It is a complementary metric for internal revenue quality analysis.

```
Adjusted NRR = (Beginning MRR + Permanent Expansion - Permanent Contraction - Churn) / Beginning MRR x 100
```

Where:
- **Permanent Expansion** = expansion events where `change_nature` is `permanent` or omitted
- **Permanent Contraction** = contraction events where `change_nature` is `permanent` or omitted

The standard NRR (reported to investors and boards) includes all movements regardless of `change_nature`. Adjusted NRR is an internal signal. Both are computed from the same CEL events.

### SQL: Adjusted vs. Standard NRR

```sql
-- Beginning MRR is the sum of all movements before the period; the cohort is
-- the customers with MRR at that point. :period_start and :period_end bound
-- the trailing twelve months.
WITH cohort AS (
    SELECT customer_id, SUM(mrr_change) AS beginning_mrr
    FROM cel_revenue_events
    WHERE event_date < :period_start
    GROUP BY customer_id
    HAVING SUM(mrr_change) > 0
),
movements AS (
    SELECT e.event_type, e.mrr_change, COALESCE(e.change_nature, 'permanent') AS change_nature
    FROM cel_revenue_events e
    JOIN cohort c ON c.customer_id = e.customer_id
    WHERE e.event_date >= :period_start AND e.event_date <= :period_end
)
SELECT
  -- Standard NRR (all movements)
  ((SELECT SUM(beginning_mrr) FROM cohort)
    + SUM(CASE WHEN event_type IN ('expansion', 'contraction', 'churn') THEN mrr_change ELSE 0 END))
  / (SELECT SUM(beginning_mrr) FROM cohort) AS nrr_standard,
  -- Adjusted NRR (permanent movements only)
  ((SELECT SUM(beginning_mrr) FROM cohort)
    + SUM(CASE WHEN event_type IN ('expansion', 'contraction', 'churn') AND change_nature = 'permanent' THEN mrr_change ELSE 0 END))
  / (SELECT SUM(beginning_mrr) FROM cohort) AS nrr_adjusted
FROM movements;
```

---

## Relationship to Existing Data Model

The GASP Standard defines a three-level entity hierarchy in [Definitions](definitions.md#foundational-entities):

| Entity | CEL Relationship |
|--------|-----------------|
| **Customer** | `customer_id` on all event classes. A customer churns when their last active subscription generates a churn `Revenue_Event`. |
| **Subscription** | `subscription_id` on `Revenue_Event`, `Contract_Event` and `Amendment_Event`. MRR lives here. |
| **License** | Not directly in the CEL. Licenses are derived from subscriptions. Seat counts appear on `Amendment_Event` as `prior_quantity` / `new_quantity`. |

The CEL does not replace the entity model. It records *events that happen to* entities. The entity model defines the nouns; the CEL defines the verbs.

---

## Scope Boundaries

**The CEL covers:**
- All recurring revenue changes (new, expansion, contraction, churn, reactivation, renewal)
- Costs attributable to commercial functions (S&M, COGS, implementation, support)
- Contractual milestones (new, renewal, amendment, cancellation)
- Mid-term subscription changes
- Customer lifecycle state transitions

**The CEL does not cover:**
- Product usage events (page views, feature clicks, API calls). These belong in a product analytics layer
- GAAP revenue recognition events. These belong in the accounting ledger
- HR events (hiring, termination). Unless directly costed as `Cost_Event`
- Infrastructure events (deployments, incidents). These belong in engineering observability

The CEL is scoped to the same domain as the rest of the GASP Standard: subscription-based SaaS with recurring revenue. Usage-based pricing, marketplace transactions and services-only revenue are out of scope.

---

## What Comes Next

The CEL provides the atomic events. The [Attribution Taxonomy Layer (ATL)](atl.md) provides the tags that make dual-lens metrics possible by classifying each event by lifecycle stage, expansion type and cost function. Together, CEL + ATL form the foundation for Operating (O) and Market (M) metric forms. Ops teams get their internal economic truth and boards get the investor-comparable numbers, computed from the same events.
