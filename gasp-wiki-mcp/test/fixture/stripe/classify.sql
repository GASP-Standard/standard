-- Fills expansion_classification on the derived revenue events from the item
-- history, the step cel.md rule 6 leaves to the amendment records. Stripe has
-- no amendment stream, but the item snapshots on the event's day and the day
-- before say what moved: the quantity, the price or the item itself. Run after
-- the derivation has filled gasp.revenue_events. Redshift SQL; runs on
-- Postgres unchanged.
--
-- The company's reading of the ATL table (atl.md, "Expansion classification"):
--   quantity changed on the same price           -> same_product (seat adds and removals)
--   price changed within the same product        -> pricing_adjustment (Stripe prices are immutable, so a price rise is a new price id)
--   price changed to another product             -> new_module
--   an item added to a customer that already has an active item   -> new_module
--   a reactivation (the customer returns on a new item)           -> same_product when it is the product they had, else new_module
-- Churn and `new` events carry no classification (the ATL applies the tag to
-- expansion, contraction and reactivation). The usage realisation pairs arrive
-- tagged from the derivation and are left as they are.

UPDATE gasp.revenue_events
SET expansion_classification = x.classification
FROM (
  SELECT e.event_id,
         CASE
           WHEN prev.subscription_item_id IS NULL AND e.event_type = 'reactivation'
             AND EXISTS (SELECT 1 FROM stripe_snapshots.subscription_items h
                         WHERE h.customer_id = e.customer_id AND h.snapshot_date < e.event_date AND h.product_id = cur.product_id) THEN 'same_product'
           WHEN prev.subscription_item_id IS NULL THEN 'new_module'
           WHEN prev.price_id = cur.price_id THEN 'same_product'
           WHEN prev.product_id = cur.product_id THEN 'pricing_adjustment'
           ELSE 'new_module'
         END AS classification
  FROM gasp.revenue_events e
  JOIN stripe_snapshots.subscription_items cur
    ON cur.subscription_item_id = e.subscription_id AND cur.snapshot_date = e.event_date
  LEFT JOIN stripe_snapshots.subscription_items prev
    ON prev.subscription_item_id = e.subscription_id AND prev.snapshot_date = e.event_date - 1
  WHERE e.event_type IN ('expansion', 'contraction', 'reactivation')
    AND e.expansion_classification IS NULL
) x
WHERE gasp.revenue_events.event_id = x.event_id;
