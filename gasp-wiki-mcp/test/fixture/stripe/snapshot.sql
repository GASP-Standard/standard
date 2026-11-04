-- The nightly job: the state of every subscription item, customer and invoice
-- on the day, appended to stripe_snapshots.* after each Stripe Data Pipeline
-- sync, and a usage record for every metered line invoiced on the day.
-- Redshift SQL. Run once a day; CURRENT_DATE is the snapshot date.
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

-- The invoice with the service period and the amount of its licensed lines
-- (prorations left out: a seat change mid-period shows on the next period's
-- licensed line, cel.md "Deriving Revenue Events from an Invoice Ledger").
INSERT INTO stripe_snapshots.invoices
SELECT CURRENT_DATE AS snapshot_date,
       i.id, i.customer_id, i.subscription_id, i.status, i.created,
       i.amount_due, i.amount_paid, i.amount_remaining, i.currency,
       i.status_transitions_paid_at,
       CAST(MIN(l.period_start) AS DATE) AS licensed_period_start,
       CAST(MAX(l.period_end) AS DATE) AS licensed_period_end,
       SUM(l.amount) AS licensed_amount
FROM stripe.invoices i
LEFT JOIN stripe.invoice_line_items l
  ON l.invoice_id = i.id AND NOT l.proration
  AND l.price_id IN (SELECT id FROM stripe.prices WHERE recurring_usage_type = 'licensed')
WHERE i.livemode AND i.status <> 'draft'
GROUP BY i.id, i.customer_id, i.subscription_id, i.status, i.created,
         i.amount_due, i.amount_paid, i.amount_remaining, i.currency, i.status_transitions_paid_at;

-- One usage record per metered line invoiced today: the period the line
-- covers, the commitment (the MRR of the subscription's licensed items on the
-- period's last day, as the mapping computes it) and the usage (the commitment
-- plus the metered charge, which Stripe bills for the calls beyond the included
-- volume). A period whose usage stayed within the included volume has a
-- metered line of 0 and a record with usage_amount = committed_amount.
INSERT INTO stripe_snapshots.usage_records
SELECT CAST(l.period_start AS DATE) AS period_start,
       CAST(l.period_end AS DATE) AS period_end,
       l.subscription_item_id,
       l.subscription_id,
       i.customer_id,
       c.committed_amount,
       c.committed_amount + l.amount AS usage_amount,
       l.currency
FROM stripe.invoice_line_items l
JOIN stripe.invoices i ON i.id = l.invoice_id AND i.livemode AND i.status <> 'draft'
JOIN stripe.prices p ON p.id = l.price_id AND p.recurring_usage_type = 'metered'
JOIN (
  SELECT s.subscription_id, s.snapshot_date,
         SUM(s.unit_amount * s.quantity * (CASE s.recurring_interval WHEN 'month' THEN 1.0 WHEN 'year' THEN 1.0 / 12 WHEN 'week' THEN 52.0 / 12 WHEN 'day' THEN 365.0 / 12 END) / s.recurring_interval_count) AS committed_amount
  FROM stripe_snapshots.subscription_items s
  WHERE s.status IN ('active', 'past_due', 'unpaid') AND s.unit_amount IS NOT NULL
  GROUP BY s.subscription_id, s.snapshot_date
) c ON c.subscription_id = l.subscription_id AND c.snapshot_date = CAST(l.period_end AS DATE)
WHERE CAST(i.created AS DATE) = CURRENT_DATE;
