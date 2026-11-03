-- GASP conformance case c02_lag_mrr_growth_rate: the same aggregate one period earlier (period-over-period growth).
-- Metric gasp_mrr_growth_rate (GASP formula: (metric.mrr - lag(metric.mrr, 1 month)) / lag(metric.mrr, 1 month)) for the period 2026-01-01 to 2026-06-30.
-- The subquery is the source of the staged dataset gasp_staged_gasp_mrr_growth_rate in model.ossie.yaml,
-- compiled by GASP from the formula (Postgres dialect; the GASP extension on the dataset carries
-- Snowflake, BigQuery and Databricks). It reads the tables in ../../data/, including gasp.period_spine.
SELECT value
FROM (SELECT p.period_start, p.period_end, ((CAST((((SELECT COALESCE(SUM(mrr), 0) FROM gasp.subscription WHERE snapshot_date = p.period_end AND subscription_status = 'active')) - ((SELECT COALESCE(SUM(mrr), 0) FROM gasp.subscription WHERE snapshot_date = (p.period_end - INTERVAL '1 month') AND subscription_status = 'active'))) AS DOUBLE PRECISION) / NULLIF(((SELECT COALESCE(SUM(mrr), 0) FROM gasp.subscription WHERE snapshot_date = (p.period_end - INTERVAL '1 month') AND subscription_status = 'active')), 0))) AS value FROM gasp.period_spine p) AS s
WHERE period_start = DATE '2026-01-01';
