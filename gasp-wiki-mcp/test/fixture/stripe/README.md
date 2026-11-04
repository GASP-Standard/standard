# Stripe worked example

A company that bills on Stripe, lands the Stripe tables in Redshift through Stripe Data Pipeline and wants the GASP Core metrics over them. Written from Stripe's public API reference and the Data Pipeline and Sigma schema documentation; nothing here was checked against a Stripe account, and no Stripe name enters the standard or the code (`DECISIONS.md`, 2026-11-03). It is a worked example beside Acme and a readiness fixture: `test/vendor-fixtures.test.ts` takes it from a validated mapping to readiness level 4 on PGlite.

## Files

| File | What it is |
|---|---|
| `schema.sql` | Redshift DDL: the Stripe tables as Data Pipeline lands them (`stripe.*`, the columns used), the three nightly snapshot tables the company keeps (`stripe_snapshots.*`), the table `derive_cel`'s SQL fills (`gasp.revenue_events`) and the period spine. The input to `profile_schema`. |
| `snapshot.sql` | The nightly job: the joined state of every subscription item, customer and invoice appended with the day's date. The company's choices live here: the customer segment read from a `segment` key in customer metadata, the customer status read from the subscriptions. |
| `adapter.json` | The GASP mapping (adapter v1.1, warehouse `redshift`): the `subscription`, `customer` and `invoice` datasets over the snapshots and `revenue_event` over the derived table. Every Stripe-shaped value is turned into a GASP one by a transform, listed below. |
| `data.sql` | Three months of nightly snapshots for five customers, stated as the versions the job would have seen and expanded to one row per day. Postgres, for the test; the tables are the Redshift ones. |
| `events.json` | The twelve `Revenue_Event` rows `derive_cel` gives over `data.sql`, with the classification `classify.sql` adds. |
| `classify.sql` | Fills `expansion_classification` from the item history, the step `cel.md` rule 6 leaves to the amendment records. |
| `metrics.yaml` | The company's own metrics for `score_drift`: two that agree with GASP, one that leaves reactivation out of Net New MRR and one that goes to review. |

## What Stripe gives you and what it does not

Stripe holds the current state of every object. A subscription whose quantity changed last month shows the new quantity, and a cancelled subscription shows `canceled` with a `canceled_at`; nothing shows what the MRR was on a given day. The GASP `subscription` dataset is a snapshot, a row per subscription per day, so the first thing the company builds is the ledger: the nightly copy in `snapshot.sql`. The business in the sample started billing on Stripe on the first day of the ledger, so `derive_cel` runs with `first_snapshot: steps`; a company that moved to Stripe with customers already paying runs it with the default and treats the first day as the opening balance (`cel.md`, rule 3).

The mapping's transforms, each a choice a reader may make differently:

- **Item grain.** A Stripe subscription holds one `subscription_item` per price, each with its own quantity. The item is the subscription GASP sees (`subscription_id` is `subscription_item_id`); the Stripe subscription's status is carried on every item. A seat change on an item is an expansion or a contraction of that item, an add-on is a new item and so a new GASP subscription for the same customer, and `derive_cel` types both from the customer's MRR, as rule 5 says.
- **MRR from the price.** `unit_amount` is in the smallest currency unit per interval. MRR is `unit_amount * quantity / 100` normalised to a month: divided by 12 for a yearly price, by `recurring_interval_count` for a price billed every n intervals. Tiered and metered prices are not covered; their MRR is what was invoiced and belongs to the usage derivation, which is still to come.
- **Status.** `active`, `past_due` and `unpaid` are `active` (Stripe keeps billing; the risk shows on the invoices). `paused` is `paused`, `canceled` is `cancelled`, `incomplete_expired` is `expired`. `trialing` and `incomplete` have no GASP subscription status and contribute no MRR; a trial that converts produces a `new` event on the day it becomes `active` (cus_D on 2026-02-03).
- **Customer status** is not a Stripe field. The nightly job derives it from the customer's subscriptions, and the mapping reads the derived column, because the customer identity checks compare it inside a correlated subquery where a transform cannot stand.
- **Invoices.** `amount_due` and `amount_remaining` divided by 100, `status` recoded (`open` is `unpaid`, `uncollectible` is `written_off`, `void` has no GASP status), `status_transitions_paid_at` as the payment date, the currency upper-cased.

## The sample and its events

`data.sql` states each item's versions; the stories are in its header. `derive_cel` over it gives the twelve events in `events.json`, in the derivation's order: five `new` (two on the first day, one a converted trial), three expansions (seats added, a price rise on an immutable Stripe price, an add-on), one contraction, two churns and one reactivation on a new subscription id. The customer's MRR chains through its events, so `prior_mrr + mrr_change = new_mrr` holds on every row. MRR on 2026-03-31 is 1,349.

The derivation leaves `expansion_classification` empty, and the ATL check names every expansion, contraction and reactivation until it is filled. `classify.sql` fills it from the item snapshots on the event's day and the day before: a quantity change on the same price is `same_product`, a new price within the same product is `pricing_adjustment` (Stripe prices are immutable, so a price rise is a new price id), a new product is `new_module`, and a reactivation is `same_product` when the customer returns on a product they had. That is one company's reading of the ATL table; another may call a tier change `new_module`.

## What the test shows

1. `validate_mapping`: the adapter passes the schema and covers 24 metrics fully, 18 of them Core.
2. `derive_cel`: the SQL compiles with every field mapped and, run on the sample, gives the events in `events.json`.
3. `generate_checks`: 15 of the 32 checks run over this mapping (the rest need the cost, contract and amendment datasets, or `mrr_start`); before `classify.sql` the expansion tag check fails on the five tagged events, after it every check passes (the revenue event freshness window is a week, since five customers do not move every day).
4. `readiness_report`: level 2 from the adapter alone, level 2 with the check rows before classification (the failing check names the Core metrics it protects), level 3 after it, level 4 with the model `compile_model` returns.
5. `score_drift` on `metrics.yaml`: `mrr` and `churned_mrr` agree with the canonical definitions (the `COALESCE` on `churned_mrr` is what makes a month with no churn a 0 rather than a NULL, the difference Acme's `cancelled_mrr` plants); `net_new_mrr`, the four movements a billing dashboard shows, differs in the month a customer returns because GASP's Net New MRR counts reactivation; `paying_customers` has no GASP name and goes to review.

The Stripe object and field names come from https://docs.stripe.com/api (Customers, Subscriptions, Subscription Items, Prices, Invoices) and the Sigma and Data Pipeline schema reference, which flattens nested fields with an underscore and suffixes object references with `_id`.
