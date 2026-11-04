-- The nightly job: the state of every subscription item, customer and invoice
-- on the day, appended to stripe_snapshots.* after each Stripe Data Pipeline
-- sync. Redshift SQL. Run once a day; CURRENT_DATE is the snapshot date.
--
-- The company's own choices are in this file, not in the mapping: the
-- customer segment comes from a `segment` key the company sets in Stripe
-- customer metadata, and a customer's status is read from its subscriptions
-- because Stripe has no customer status of its own.

INSERT INTO stripe_snapshots.subscription_items
SELECT CURRENT_DATE AS snapshot_date,
       si.id AS subscription_item_id,
       s.id AS subscription_id,
       s.customer_id,
       JSON_EXTRACT_PATH_TEXT(c.metadata, 'segment') AS customer_segment,
       s.status,
       p.id AS price_id,
       p.product_id,
       p.unit_amount,
       p.currency,
       p.recurring_interval,
       p.recurring_interval_count,
       si.quantity,
       s.start_date,
       s.canceled_at
FROM stripe.subscription_items si
JOIN stripe.subscriptions s ON s.id = si.subscription_id
JOIN stripe.prices p ON p.id = si.price_id
JOIN stripe.customers c ON c.id = s.customer_id
WHERE s.livemode AND p.type = 'recurring';

INSERT INTO stripe_snapshots.customers
SELECT CURRENT_DATE AS snapshot_date,
       c.id AS customer_id,
       CASE
         WHEN SUM(CASE WHEN s.status IN ('active', 'past_due', 'unpaid', 'paused') THEN 1 ELSE 0 END) > 0 THEN 'active'
         WHEN SUM(CASE WHEN s.status = 'trialing' THEN 1 ELSE 0 END) > 0 THEN 'trial'
         WHEN SUM(CASE WHEN s.status IN ('canceled', 'incomplete_expired') THEN 1 ELSE 0 END) > 0 THEN 'churned'
         ELSE 'trial'
       END AS customer_status,
       CAST(MIN(CASE WHEN s.status <> 'trialing' AND s.status <> 'incomplete' THEN s.start_date END) AS DATE) AS acquisition_date,
       JSON_EXTRACT_PATH_TEXT(c.metadata, 'segment') AS customer_segment,
       c.email
FROM stripe.customers c
LEFT JOIN stripe.subscriptions s ON s.customer_id = c.id AND s.livemode
WHERE c.livemode
GROUP BY c.id, c.metadata, c.email;

INSERT INTO stripe_snapshots.invoices
SELECT CURRENT_DATE AS snapshot_date,
       i.id, i.customer_id, i.subscription_id, i.status, i.created,
       i.amount_due, i.amount_paid, i.amount_remaining, i.currency,
       i.status_transitions_paid_at
FROM stripe.invoices i
WHERE i.livemode AND i.status <> 'draft';
