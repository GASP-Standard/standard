# Commercial Event Ledger (CEL)

The event layer behind the commercial metrics of the GASP Standard.

Every revenue, retention and cost metric in this standard derives from atomic commercial events. The CEL is the governed layer where those events live: if a commercial event is not in the CEL, it does not exist for metric purposes. Operational metrics (support, engineering, product usage, people) read the other datasets declared in `ontology.json`, such as tickets, incidents and product events, which sit outside the CEL (see [Scope Boundaries](#scope-boundaries)).

---

## Why the CEL Exists

SaaS companies typically compute metrics from derived tables: MRR snapshots, billing system exports, CRM rollups. These derived sources drift: two teams querying MRR from different derived tables get different numbers. The CEL removes the drift by computing every commercial metric from one event-level layer.

The CEL is a conceptual standard for how commercial events are captured, stored and governed, which you implement in your warehouse, your lakehouse or your operational database. The schema is the contract.

---

## Design Principles

1. **Immutable events.** Once recorded, a CEL event is never modified. Corrections are new events (e.g., a `Revenue_Event` of type `adjustment`). This preserves auditability and enables point-in-time reconstruction.

2. **No derived data upstream.** The CEL contains atomic facts. MRR, ARR, NRR and every other metric are computed *from* CEL events, never stored *in* the CEL. Derived values live downstream.

3. **Daily atomic grain.** Every event has a date. The day is the smallest unit. Weekly, monthly, quarterly and annual views are aggregations of daily events.

4. **One event, one truth.** Each commercial event is recorded once. If a subscription renewal generates both a `Revenue_Event` and a `Contract_Event`, those are two distinct events rather than one event with two types.

5. **Source-system agnostic.** The CEL defines *what* to capture, not *where* it comes from. Events may originate in billing systems, CRMs, HRIS or manual entries. The CEL schema is the normalization layer.

---

## Event Classes

The CEL defines six event classes. Every commercial event in a SaaS business sold by subscription, by consumption or by both falls into one of these.

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
| `expansion_classification` | `enum` (expansion, contraction and reactivation only) | `same_product`, `new_module`, `new_buying_centre`, `pricing_adjustment`, `recontracting`, `usage_realisation`. See [ATL](atl.md#expansion-classification). The NRR and ARR forms read it. |
| `change_nature` | `enum` (optional) | `permanent` (default), `temporary`, `scheduled_reversal`. See [Change Nature](#change-nature). |
| `segment` | `string` | Segment the customer was in when the event occurred. A customer that moves segment keeps its history as it was. See [Segment on events](#segment-on-events). |

---

### Cost_Event

An incurred cost, tagged with the function it serves. Primary input for CAC, Gross Margin, LTV and efficiency metrics.

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
| `partner_id` | `string` (nullable) | Partner identifier; null on costs not attributable to a partner |
| `project_id` | `string` (nullable) | Services project identifier; null on costs not attributable to a project |
| `lifecycle_attribution` | `enum` | ATL lifecycle tag: `acquisition`, `activation`, `retention`, `expansion`, `reactivation`, `servicing`. See [ATL](atl.md#lifecycle-attribution). |
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
| `segment` | `string` | Segment the customer was in when the event occurred. A customer that moves segment keeps its history as it was. See [Segment on events](#segment-on-events). |

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
| `segment` | `string` | Segment the customer was in when the event occurred. A customer that moves segment keeps its history as it was. See [Segment on events](#segment-on-events). |

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

---

### Credit_Event

A movement on a prepaid credit balance, or consumption billed with no balance behind it. Primary input for Consumption Revenue, Usage Run-Rate, Prepaid Credit Balance and Credit Breakage.

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | `string` | Unique identifier |
| `event_date` | `date` | Date the event occurred: the day or the billing period end the source records, never a single product usage event |
| `customer_id` | `string` | [Customer](definitions.md#customer-account-organization) identifier |
| `subscription_id` | `string` | [Subscription](definitions.md#subscription-contract-agreement) or commitment the balance belongs to |
| `credit_event_type` | `enum` | `purchase` (a prepaid commitment or block of credits paid for, a rollover grant included), `consumption` (usage drawn down or billed), `expiry` (unused balance forfeited at its expiry date), `adjustment` (promotional grants, refunds, reversals, corrections) |
| `credit_amount` | `decimal` | Signed amount in currency at the contract's rates: positive for `purchase` and a granting `adjustment`, negative for `consumption`, `expiry` and a reducing `adjustment`. The sign convention mirrors `mrr_change` |
| `consumption_basis` | `enum` (consumption only) | `committed` (drawn from a prepaid balance), `overage` (above an exhausted or per-period commitment), `on_demand` (no commitment) |
| `credit_balance_before` | `decimal` (optional) | The customer's prepaid balance before the event; equal to `credit_balance_after` on `overage` and `on_demand` consumption, which draw no balance |
| `credit_balance_after` | `decimal` (optional) | The customer's prepaid balance after the event. Where both balances are mapped, `credit_balance_before + credit_amount = credit_balance_after` on every row that moves the balance |
| `expires_on` | `date` (purchase only) | When the granted balance expires; empty when it does not |
| `currency` | `string` | ISO 4217 currency code |
| `segment` | `string` | Segment the customer was in when the event occurred. See [Segment on events](#segment-on-events). |

The balances are optional because several billing systems carry the signed amount alone and leave the balance to a sum; the metrics read `credit_amount` either way. The ledger is kept at customer and subscription level, so the source system decides which grant a consumption draws first.

**Rollover.** A balance that rolls over into a new term has no `expiry` event. The new term's grant is a `purchase` carrying the new `expires_on`, and the rolled-over amount is carried by that grant rather than bought again.

**What stays out.** Usage quantities in product units (the CEL carries currency), rated usage lines (the billing system keeps those) and GAAP journal entries. A `Credit_Event` is the commercial fact that a balance was bought, consumed or forfeited; the entry that recognises it as revenue stays in the accounting ledger.

### Pairing rule: amendments that change MRR

Any `Amendment_Event` that changes MRR also writes a `Revenue_Event` carrying the `mrr_change`, the `event_type` (`expansion` or `contraction`) and the `expansion_classification`. The amendment row keeps the contract detail (plan, quantity, amendment type). The two are distinct facts about one commercial action, so NRR, ARR and the other revenue metrics read `Revenue_Event` and still see mid-term expansion such as seat adds and `new_module` upsells.

### Segment on events

`segment` is a dimension for slicing metrics, not an ATL tag: it says which kind of customer an event belongs to, not what the event means. It is denormalised onto `Revenue_Event`, `Contract_Event`, `Amendment_Event` and `Credit_Event` on purpose, as of the event date, so NRR, churn and the MRR movements group by segment without a join and a customer that moves from SMB to Mid-Market keeps its earlier events in SMB. The customer and subscription snapshots carry the current value on each snapshot date. Pricing tier is the plan (`plan_id`), not the segment.

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

### 11. Prepaid Credit Drawdown

A customer on a $120,000 annual prepaid commitment consumes $9,400 of it in March. The purchase was recorded as its own `Credit_Event` when the commitment was paid for.

```json
{
  "event_class": "Credit_Event",
  "event_id": "cre-001",
  "event_date": "2026-03-31",
  "customer_id": "cust-0921",
  "subscription_id": "sub-1730",
  "credit_event_type": "consumption",
  "credit_amount": -9400.00,
  "consumption_basis": "committed",
  "credit_balance_before": 101200.00,
  "credit_balance_after": 91800.00,
  "currency": "USD",
  "segment": "Enterprise"
}
```

---

## Example SQL

A minimal warehouse implementation, illustrative rather than normative, so adapt it to your warehouse dialect and tooling. The MCP server's `generate_query` and `get_data_requirements` tools compile the canonical formulas to SQL in several warehouse dialects.

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

An optional field on `Revenue_Event` and `Amendment_Event` that captures the intent behind a revenue movement. Events keep their classification and metrics keep their calculation; the field adds structured metadata for analysing revenue quality downstream.

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

Teams that adopt `change_nature` can compute an adjusted NRR that excludes temporary movements. It sits beside standard NRR as an internal measure of revenue quality.

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

## Deriving Revenue Events from a Subscription Ledger

Most billing systems hold subscriptions, not events: one record per subscription whose plan, quantity, MRR and status change over time, kept as periodic snapshots or as a version history. The CEL needs the movements between those states. This section defines how to derive `Revenue_Event` rows from such a ledger. The rules are the same for every source system, in keeping with design principle 5: a billing system appears only in the mapping that names its tables and columns, never in the rules.

Where a billing system records amendments as events of its own, those are the better source: they carry the amendment type, the quantities and the date the change was agreed, and the [pairing rule](#pairing-rule-amendments-that-change-mrr) applies. The derivation below is for the common case where no such stream exists. Two further sources feed the same rules: an [invoice ledger](#deriving-revenue-events-from-an-invoice-ledger), for a billing system that keeps invoices but no subscription history, and [usage records](#deriving-usage-realisation), for the usage a customer realises beyond a commitment.

### Input

The GASP `subscription` dataset: `subscription_id`, `customer_id`, `snapshot_date`, `mrr`, `subscription_status` and `segment`. A snapshot table has one row per subscription per snapshot date at any cadence. A version history (one row per change, valid from a date) is the same thing with `snapshot_date` as the date each version took effect.

### Rules

1. **MRR on a snapshot.** A subscription's MRR on a snapshot is its `mrr`, to the cent and 0 when null, when `subscription_status` is `active`, else 0. A paused, cancelled or expired subscription contributes nothing. A customer's MRR is the sum over its subscriptions, and a total within half a cent of zero is zero.
2. **Steps.** A step is a snapshot whose MRR differs from the same subscription's previous snapshot, in `snapshot_date` order. A subscription's first snapshot is a step from 0. The ledger holds one row per subscription per snapshot date and keeps a row for a cancelled or expired subscription: a subscription that stops appearing has no step and produces no event.
3. **Opening balances.** Rows on the ledger's first snapshot date are opening balances. They seed each customer's MRR and produce no event, and a customer that churned before that date comes back as `new`, since the ledger cannot know otherwise. If the ledger begins after the oldest subscription, its first date is the day from which events are trusted. A ledger that begins with the business has no opening balances: say so, and every first row is a step from 0.
4. **One event per step.** The event is dated the snapshot that first shows the change. `mrr_change` is the subscription's change. `prior_mrr` and `new_mrr` are the customer's MRR before and after the step, chained through the customer's steps in `snapshot_date` order, increases before decreases and then `subscription_id`, so `prior_mrr + mrr_change = new_mrr` holds on every row and the rows of one date add up to the customer's net movement.
5. **Event type**, from the customer's MRR at the start and the end of the step's date. An increase on a date the customer started at 0 is `new`, or `reactivation` when the customer had MRR on an earlier date. A decrease on a date the customer ends at 0 is `churn`. Any other increase is `expansion` and any other decrease `contraction`. So a plan swap onto a new subscription id is an expansion and a contraction, and two subscriptions cancelled on one date are two churns. A `renewal` changes no MRR and is not derived from the ledger; it comes from `Contract_Event` or the subscription's renewal fields.
6. **Tags and defaults.** `lifecycle_attribution` follows the [ATL assignment rules](atl.md#assignment-rules) for the event type: `new` is `acquisition`, `expansion` is `expansion`, `reactivation` is `reactivation`, `contraction` and `churn` are `retention`. `change_nature` is `permanent`. `segment` is the snapshot's. `currency` is the ledger's currency, supplied as a parameter because the `subscription` dataset carries none. `expansion_classification` is empty: the ledger shows that MRR moved, not whether the customer bought seats, a module or a price rise, and the Operating forms of ARR and NRR read that tag. Until the tag is filled from the amendment records, an ATL completeness check flags every derived expansion, contraction and reactivation.
7. **Identity.** `event_id` is `<subscription_id>:<snapshot_date>`, a colon and the date in ISO 8601 form, so re-running the derivation over a longer ledger produces the same ids for the same events. The [usage realisation](#deriving-usage-realisation) events put `usage` between the two, `<subscription_id>:usage:<date>`, so a ledger step and a usage event on one day keep distinct ids.

### Cadence

The ledger's cadence is the grain of the events. Daily snapshots show every movement on its day. Month-end snapshots net the movements inside a month into one event dated the month end, and a churn followed by a reactivation inside one interval leaves no event at all. Net New MRR and ending MRR by month are unaffected by that netting. The split into expansion, contraction, churn and reactivation moves when movements inside one interval offset each other, as do event dates and anything counted at a finer grain. Snapshot at the finest cadence the source allows.

### Reference SQL

The derivation over the GASP field names, as the MCP server's `derive_cel` compiles it over a mapping. `'USD'` stands for the ledger's currency. Window functions and `||` run on Postgres, Redshift, Snowflake, BigQuery and Databricks; the text casts and the date shift are the constructs the dialects spell differently. The `kind` column is `ledger` on every row here; the usage derivation below adds its two kinds to the same chain. The test suite runs this over the standard's synthetic dataset and checks that it reproduces every generated movement (renewals and events before the first snapshot excluded), agrees with the compiled MRR movement metrics in every month and types a plan swap, a double cancellation and a two-subscription acquisition on one date as the rules say.

```sql
WITH ledger AS (
  SELECT subscription_id AS subscription_id,
         customer_id AS customer_id,
         snapshot_date AS snapshot_date,
         segment AS segment,
         CASE WHEN subscription_status = 'active' THEN ROUND(COALESCE(mrr, 0), 2) ELSE 0 END AS mrr
  FROM subscription
  WHERE snapshot_date IS NOT NULL
),
steps AS (
  SELECT subscription_id, customer_id, snapshot_date, segment, mrr,
         COALESCE(LAG(mrr) OVER (PARTITION BY subscription_id ORDER BY snapshot_date), 0) AS prior_sub_mrr,
         CASE WHEN snapshot_date = MIN(snapshot_date) OVER () THEN 1 ELSE 0 END AS opening
  FROM ledger
),
changes AS (
  SELECT subscription_id, customer_id, snapshot_date, segment, opening,
         mrr - prior_sub_mrr AS mrr_change, 'ledger' AS kind
  FROM steps
  WHERE mrr <> prior_sub_mrr
),
day_changes AS (
  SELECT customer_id, snapshot_date, SUM(mrr_change) AS day_change
  FROM changes
  GROUP BY customer_id, snapshot_date
),
days AS (
  SELECT customer_id, snapshot_date, day_change,
         SUM(day_change) OVER (PARTITION BY customer_id ORDER BY snapshot_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS day_end
  FROM day_changes
),
day_state AS (
  SELECT customer_id, snapshot_date, day_end - day_change AS day_start, day_end,
         COALESCE(MAX(CASE WHEN day_end > 0.005 THEN 1 ELSE 0 END) OVER (PARTITION BY customer_id ORDER BY snapshot_date ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS active_before
  FROM days
),
chained AS (
  SELECT c.subscription_id, c.customer_id, c.snapshot_date, c.segment, c.opening, c.mrr_change, c.kind,
         COALESCE(SUM(c.mrr_change) OVER (PARTITION BY c.customer_id ORDER BY c.snapshot_date, CASE WHEN c.mrr_change > 0 THEN 0 ELSE 1 END, c.subscription_id, c.kind ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prior_mrr,
         SUM(c.mrr_change) OVER (PARTITION BY c.customer_id ORDER BY c.snapshot_date, CASE WHEN c.mrr_change > 0 THEN 0 ELSE 1 END, c.subscription_id, c.kind ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS new_mrr,
         s.day_start, s.day_end, s.active_before
  FROM changes c
  JOIN day_state s ON s.customer_id = c.customer_id AND s.snapshot_date = c.snapshot_date
),
typed AS (
  SELECT subscription_id, customer_id, snapshot_date, segment, opening, mrr_change, prior_mrr, new_mrr, kind,
         CASE
           WHEN kind = 'usage' THEN 'expansion'
           WHEN kind = 'usage_reversal' THEN 'contraction'
           WHEN mrr_change > 0 AND ABS(day_start) < 0.005 AND active_before = 1 THEN 'reactivation'
           WHEN mrr_change > 0 AND ABS(day_start) < 0.005 THEN 'new'
           WHEN mrr_change < 0 AND ABS(day_end) < 0.005 THEN 'churn'
           WHEN mrr_change > 0 THEN 'expansion'
           ELSE 'contraction'
         END AS event_type
  FROM chained
)
SELECT CAST(subscription_id AS VARCHAR) || CASE WHEN kind = 'ledger' THEN ':' ELSE ':usage:' END || CAST(snapshot_date AS VARCHAR) AS event_id,
       snapshot_date AS event_date,
       customer_id,
       subscription_id,
       event_type,
       mrr_change,
       'USD' AS currency,
       prior_mrr,
       new_mrr,
       CASE WHEN kind = 'ledger' THEN CAST(NULL AS VARCHAR) ELSE 'usage_realisation' END AS expansion_classification,
       CASE kind WHEN 'usage' THEN 'temporary' WHEN 'usage_reversal' THEN 'scheduled_reversal' ELSE 'permanent' END AS change_nature,
       CASE event_type
         WHEN 'new' THEN 'acquisition'
         WHEN 'expansion' THEN 'expansion'
         WHEN 'reactivation' THEN 'reactivation'
         ELSE 'retention'
       END AS lifecycle_attribution,
       segment
FROM typed
WHERE opening = 0
ORDER BY snapshot_date, customer_id, CASE WHEN mrr_change > 0 THEN 0 ELSE 1 END, subscription_id, kind
```

---

## Deriving Revenue Events from an Invoice Ledger

Some billing systems keep no subscription history: what they keep is the invoices. An invoice ledger is a subscription ledger with one row per service period, and the [rules above](#rules) apply to it once the invoices are read that way. This section defines the reading. It is the second choice: where a subscription ledger or an amendment stream exists, use that.

### Input

The GASP `invoice` dataset: `invoice_id`, `subscription_id`, `customer_id`, `snapshot_date`, `service_period_start`, `service_period_end` and `recurring_amount`. `recurring_amount` is the recurring part of the invoice as billed for the service period: subscription charges only, with one-off charges, usage billed beyond a commitment, credits and tax excluded. The service period is the days the recurring charge pays for, both ends inclusive. An invoice with no subscription or no service period (a one-off charge, a usage overage billed on its own) is not recurring and produces no event.

### Rules

1. **One row per invoice.** An invoice is read at its latest snapshot, so a correction replaces the earlier reading rather than adding to it.
2. **MRR of an invoice.** The recurring amount divided by the months the service period covers: the nearest whole number of months when the period is a fortnight or more (so a calendar month is one month whether it has 28 or 31 days, a quarter three and a year twelve), else the fraction of a month, with a month being 365.25 / 12 days. A prorated invoice for part of a period is approximate by this rule; where the billing system records the full-period rate beside the prorated charge, map `recurring_amount` to the rate.
3. **The ledger.** A subscription's ledger dates are the first day of each of its service periods and the day after the last day of each, and its MRR on a date is the sum of the MRR of its invoices whose service period covers that date. So a date with no covering invoice carries 0: the subscription has lapsed. The invoice dataset carries no segment and the rows carry none.
4. **The horizon.** The latest service period start on the ledger is the horizon, and no date after it is read. A subscription whose last invoice is still current therefore produces no churn, and a subscription whose last period ended before the horizon churns the day after it ended. The horizon moves forward with each billing run and the derivation picks the churn up then.
5. **Then the subscription rules.** Steps, opening balances, chaining, event types, tags and identity follow [rules 2 to 7](#rules) above. Rows on the ledger's first date (the earliest service period start) are opening balances by default; say `steps` when the invoices begin with the business. Each movement is dated the service period that first bills it: a change agreed mid-period shows on the next period's start unless a prorated invoice was issued for the remainder, which shows it on that invoice's start.

### Reference SQL

The `ledger` common table expression of the invoice source, over the GASP field names. The rest of the query is the [subscription derivation](#reference-sql) from `steps` on, unchanged. `derive_cel` emits the whole query with `source: invoice`. The test suite runs it over the synthetic dataset's monthly invoices and checks that every change in a customer's MRR on the first of a month comes back as an event dated that day, that a lapsed subscription churns the day after its last period and that a current one does not, and that a one-off invoice adds nothing.

```sql
invoices AS (
  SELECT invoice_id, subscription_id, customer_id, service_period_start, service_period_end, recurring_amount
  FROM (
    SELECT invoice_id AS invoice_id,
           subscription_id AS subscription_id,
           customer_id AS customer_id,
           service_period_start AS service_period_start,
           service_period_end AS service_period_end,
           recurring_amount AS recurring_amount,
           ROW_NUMBER() OVER (PARTITION BY invoice_id ORDER BY snapshot_date DESC) AS latest
    FROM invoice
    WHERE subscription_id IS NOT NULL AND service_period_start IS NOT NULL AND service_period_end IS NOT NULL
  ) i
  WHERE latest = 1
),
periods AS (
  SELECT invoice_id, subscription_id, customer_id, service_period_start, service_period_end,
         ROUND(COALESCE(recurring_amount, 0) / (CASE WHEN ROUND(months) < 1 THEN months ELSE ROUND(months) END), 2) AS mrr
  FROM (
    SELECT i.*, (service_period_end - service_period_start + 1) * 12.0 / 365.25 AS months FROM invoices i
  ) m
),
boundaries AS (
  SELECT subscription_id, customer_id, service_period_start AS snapshot_date FROM periods
  UNION
  SELECT subscription_id, customer_id, CAST((service_period_end + INTERVAL '1 day') AS DATE) FROM periods
),
horizon AS (
  SELECT MAX(service_period_start) AS latest FROM periods
),
ledger AS (
  SELECT b.subscription_id, b.customer_id, b.snapshot_date,
         CAST(NULL AS VARCHAR) AS segment,
         ROUND(COALESCE(SUM(p.mrr), 0), 2) AS mrr
  FROM boundaries b
  LEFT JOIN periods p ON p.subscription_id = b.subscription_id AND p.service_period_start <= b.snapshot_date AND b.snapshot_date <= p.service_period_end
  WHERE b.snapshot_date <= (SELECT latest FROM horizon)
  GROUP BY b.subscription_id, b.customer_id, b.snapshot_date
)
```

---

## Deriving Usage Realisation

A customer on a usage commitment pays for what it committed to whether or not it uses it, and for what it uses beyond that. The commitment is in the subscription's MRR and the ledger derivations above carry it. The usage beyond it is the `usage_realisation` expansion the [ATL](atl.md#expansion-classification) names, and this section defines how it is derived. Usage that stays within the commitment is no event: the committed revenue was recognised when the commitment was made.

### Input

The GASP `usage_record` dataset: `subscription_id`, `customer_id`, `period_start`, `period_end`, `committed_amount` and `usage_amount`, one row per subscription per usage period. `committed_amount` is the recurring charge the customer committed to for the period, at the price it is billed at, and `usage_amount` the charge for the usage recorded in the period at the contract's rates, before the commitment is applied. The part of `usage_amount` above `committed_amount` is what the period bills as overage.

### Rules

1. **Overage.** A period realises usage when `usage_amount` exceeds `committed_amount`. The overage is the difference, divided by the months the period covers by the [invoice rule](#rules-1) for months, so it is stated as MRR.
2. **A pair of events.** Each such period adds two `Revenue_Event` rows to the ledger's events. The realisation is an `expansion` dated the period's last day, when the overage is known, for the overage, tagged `expansion_classification` `usage_realisation`, `lifecycle_attribution` `expansion` and `change_nature` `temporary`: the contract bills it for that period only. Its reversal is a `contraction` dated the next day for the same amount, tagged `usage_realisation`, `retention` and `change_nature` `scheduled_reversal`, as the [change nature](#change-nature) rules pair them. Both are known on the period's last day, so the reversal exists as soon as the realisation does.
3. **Chaining.** The pairs are steps in the customer's MRR like the ledger's own, chained with them in date order, so `prior_mrr + mrr_change = new_mrr` holds across both and the customer's MRR at a period end includes the usage realised in it. A realisation is an expansion and a reversal a contraction whatever the customer's other MRR on the day, so a reversal on the day a subscription churns is not a second churn.
4. **What the records do not say.** Usage that repeats every period is still temporary each time: the values describe the contract, not a judgement. A commitment raised to cover the usage shows on the subscription or invoice ledger as a permanent expansion, and from then on the usage within it is no event. The usage records carry no segment. The `usage_record` dataset's currency is the ledger's. Identity is `<subscription_id>:usage:<date>`.

### Reference SQL

The two common table expressions the usage records add, over the GASP field names. `usage_changes` is appended to the subscription derivation's `changes` with `UNION ALL`, and its `kind` sets the event type, the tags and the identity in the final `SELECT` above. `derive_cel` emits the whole query when the mapping covers `usage_record`. The test suite runs it over the synthetic dataset's usage records and checks that every month over the commitment gives its pair, dated the month's last day and the first of the next, that the pairs chain with the ledger's steps, and that the months within the commitment give nothing.

```sql
usage_periods AS (
  SELECT subscription_id, customer_id, period_end,
         ROUND(overage / (CASE WHEN ROUND(months) < 1 THEN months ELSE ROUND(months) END), 2) AS overage
  FROM (
    SELECT subscription_id AS subscription_id,
           customer_id AS customer_id,
           period_end AS period_end,
           usage_amount - committed_amount AS overage,
           (period_end - period_start + 1) * 12.0 / 365.25 AS months
    FROM usage_record
    WHERE period_start IS NOT NULL AND period_end IS NOT NULL
      AND usage_amount > committed_amount
  ) u
),
usage_changes AS (
  SELECT subscription_id, customer_id, period_end AS snapshot_date, CAST(NULL AS VARCHAR) AS segment, 0 AS opening, overage AS mrr_change, 'usage' AS kind
  FROM usage_periods WHERE overage >= 0.01
  UNION ALL
  SELECT subscription_id, customer_id, CAST((period_end + INTERVAL '1 day') AS DATE), CAST(NULL AS VARCHAR), 0, -overage, 'usage_reversal'
  FROM usage_periods WHERE overage >= 0.01
)
```

---

## Deriving Credit Events

The [Credit_Event](#credit_event) ledger and the usage records describe the same overage from two sides. A billing system that keeps a credit ledger records the usage billed beyond a commitment as `consumption` with basis `overage`; a billing system that keeps usage records states the commitment and the usage beside it. This section defines how each gives what the other would: the usage realisation pair from the credit ledger, and the consumption events from the usage records. One of the two is read, so the overage is never counted twice.

### Realisation from the Credit Ledger

#### Input

The GASP `credit_event` dataset: `subscription_id`, `customer_id`, `event_date`, `credit_event_type`, `consumption_basis` and `credit_amount`. Only `consumption` rows with basis `overage` are read. Consumption drawn from a prepaid balance (basis `committed`) is already in the subscription's MRR through the commitment, and pay-as-you-go consumption (basis `on_demand`) has no commitment to exceed, so neither realises usage.

#### Rules

1. **Overage per month.** A subscription's `consumption` events with basis `overage` in a calendar month sum to that month's realised usage: the sum of their `credit_amount`, negated, since consumption is negative.
2. **The pair.** Each month with an overage of a cent or more adds the pair the [usage realisation rules](#deriving-usage-realisation) define: an `expansion` dated the month's last day and its `scheduled_reversal` dated the next day, tagged `usage_realisation`, chained with the ledger's steps, identity `<subscription_id>:usage:<date>`. The pair is the same whichever way the commitment was billed: realised usage above a commitment is expansion, ratable or drawn down.
3. **One source.** Where the usage records are mapped they are the source, and the credit ledger's overage is not derived again: `derive_cel` reads the `usage_record` dataset when the mapping covers it and the `credit_event` dataset otherwise.

#### Reference SQL

The two common table expressions the credit ledger adds in place of the usage records', over the GASP field names. They end in the same `usage_changes`, so the final `SELECT` of the [subscription derivation](#reference-sql) types, tags and identifies the pairs exactly as it does the usage records'. The test suite runs it over the synthetic dataset's credit events and checks that it gives the pairs the usage records give for the same customers, row for row, and nothing for drawdown and pay-as-you-go consumption.

```sql
usage_periods AS (
  SELECT subscription_id, customer_id, period_end,
         ROUND(SUM(overage), 2) AS overage
  FROM (
    SELECT subscription_id AS subscription_id,
           customer_id AS customer_id,
           CAST(DATE_TRUNC('month', event_date) + INTERVAL '1 month' - INTERVAL '1 day' AS DATE) AS period_end,
           -(credit_amount) AS overage
    FROM credit_event
    WHERE subscription_id IS NOT NULL AND event_date IS NOT NULL
      AND credit_event_type = 'consumption' AND consumption_basis = 'overage'
  ) c
  GROUP BY subscription_id, customer_id, period_end
),
usage_changes AS (
  SELECT subscription_id, customer_id, period_end AS snapshot_date, CAST(NULL AS VARCHAR) AS segment, 0 AS opening, overage AS mrr_change, 'usage' AS kind
  FROM usage_periods WHERE overage >= 0.01
  UNION ALL
  SELECT subscription_id, customer_id, CAST((period_end + INTERVAL '1 day') AS DATE), CAST(NULL AS VARCHAR), 0, -overage, 'usage_reversal'
  FROM usage_periods WHERE overage >= 0.01
)
```

### Consumption Events from Usage Records

#### Input

The GASP `usage_record` dataset, as [above](#deriving-usage-realisation): `subscription_id`, `customer_id`, `period_end`, `committed_amount` and `usage_amount`. This is for a company with usage records and no credit ledger, so that Consumption Revenue and Usage Run-Rate exist for its ratable customers.

#### Rules

1. **One event per period over the commitment.** Each period whose `usage_amount` exceeds its `committed_amount` by a cent or more gives one `Credit_Event`: `credit_event_type` `consumption`, `consumption_basis` `overage`, dated the period's last day, identity `<subscription_id>:overage:<period_end>`.
2. **The amount as billed.** `credit_amount` is the overage the period bills, negated: `-(usage_amount - committed_amount)`. It is the whole period's charge, not stated as MRR; the realisation pair states it as MRR.
3. **What the records do not say.** Usage within a ratable commitment is no event: the commitment is in the subscription's MRR. The records hold no prepaid balance, so `credit_balance_before`, `credit_balance_after` and `expires_on` are empty, and they carry no segment. A prepaid balance, its purchases, its committed drawdowns and its expiries come from the billing system's credit ledger.
4. **No second realisation.** The usage records stay the source of the realisation pair, so the events written here are not read back by the rules above.

#### Reference SQL

The whole query, over the GASP field names. `derive_cel` emits it with `target: credit_event`. The test suite runs it over the synthetic dataset's usage records and checks that every month over the commitment gives one event for its overage, with the balances empty, and that the months within the commitment give nothing.

```sql
WITH overage_periods AS (
  SELECT subscription_id AS subscription_id,
         customer_id AS customer_id,
         period_end AS period_end,
         ROUND(usage_amount - committed_amount, 2) AS overage
  FROM usage_record
  WHERE period_end IS NOT NULL
    AND usage_amount > committed_amount
)
SELECT CAST(subscription_id AS VARCHAR) || ':overage:' || CAST(period_end AS VARCHAR) AS event_id,
       period_end AS event_date,
       customer_id,
       subscription_id,
       'consumption' AS credit_event_type,
       -overage AS credit_amount,
       'overage' AS consumption_basis,
       CAST(NULL AS DECIMAL(18, 2)) AS credit_balance_before,
       CAST(NULL AS DECIMAL(18, 2)) AS credit_balance_after,
       CAST(NULL AS DATE) AS expires_on,
       'USD' AS currency,
       CAST(NULL AS VARCHAR) AS segment
FROM overage_periods
WHERE overage >= 0.01
ORDER BY period_end, customer_id, subscription_id
```

---

## Relationship to Existing Data Model

The GASP Standard defines a three-level entity hierarchy in [Definitions](definitions.md#foundational-entities):

| Entity | CEL Relationship |
|--------|-----------------|
| **Customer** | `customer_id` on all event classes. A customer churns when their last active subscription generates a churn `Revenue_Event`. |
| **Subscription** | `subscription_id` on `Revenue_Event`, `Contract_Event`, `Amendment_Event` and `Credit_Event`. MRR lives here, and so does a prepaid credit balance: a `Credit_Event` names the subscription or commitment its balance belongs to. |
| **License** | Not directly in the CEL. Licenses are derived from subscriptions. Seat counts appear on `Amendment_Event` as `prior_quantity` / `new_quantity`. |

The CEL sits beside the entity model and records *events that happen to* entities. The entity model defines the nouns; the CEL defines the verbs.

---

## Scope Boundaries

**The CEL covers:**
- All recurring revenue changes (new, expansion, contraction, churn, reactivation, renewal)
- Costs, tagged by function (S&M, COGS, implementation, support, R&D, G&A)
- Contractual milestones (new, renewal, amendment, cancellation)
- Mid-term subscription changes
- Customer lifecycle state transitions
- Prepaid commitments and credit blocks, their consumption and their expiry
- Consumption billed on demand, with no commitment behind it

**The CEL does not cover:**
- Product usage events (page views, feature clicks, API calls). These belong in a product analytics layer
- GAAP revenue recognition events. The credit ledger records the commercial fact; the journal entry that recognises it stays in the accounting ledger
- HR events (hiring, termination), unless directly costed as a `Cost_Event`
- Infrastructure events (deployments, incidents). These belong in engineering observability

The CEL is scoped to the same domain as the rest of the GASP Standard: SaaS sold by subscription, by consumption or by both. Consumption with or without a contracted commitment is covered through `Credit_Event`. MRR and ARR still exclude uncommitted usage, which [Consumption Revenue](metrics/finance.md#consumption-revenue) and [Usage Run-Rate](metrics/finance.md#usage-run-rate) report. Usage that exceeds a contracted commitment is also a `Revenue_Event` tagged `usage_realisation`, derived as [Deriving Usage Realisation](#deriving-usage-realisation) says. Marketplace transactions and services-only revenue are out of scope.

---

## What Comes Next

The CEL provides the atomic events. The [Attribution Taxonomy Layer (ATL)](atl.md) provides the tags that make dual-lens metrics possible by classifying each event by lifecycle stage, expansion type and cost function. Together they supply the inputs for the Operating (O) and Market (M) forms declared in [Core Metrics](metrics/core.md), so ops teams get their internal economic truth and boards get the investor-comparable numbers from the same events.
