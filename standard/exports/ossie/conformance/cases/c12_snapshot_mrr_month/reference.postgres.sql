-- GASP conformance case c12_snapshot_mrr_month: a sum over a snapshot dataset for a month, read on the last snapshot date of the month.
-- Metric gasp_mrr (GASP formula: sum(field.mrr where field.subscription_status = 'active') at period_end) for the period 2026-06-01 to 2026-06-30.
-- The metric is a direct OSSIE_SQL_2026 expression in model.ossie.yaml. Each aggregate is evaluated over its
-- dataset's rows on the last snapshot date of the period, the one reading GASP takes. Nothing in the expression
-- says so, and readings.sql holds what the other readings return. It reads the tables in ../../data/.
SELECT (COALESCE((SELECT SUM(subscription.mrr) FILTER (WHERE subscription.subscription_status = 'active') FROM gasp.subscription WHERE snapshot_date = DATE '2026-06-30'), 0)) AS value;
