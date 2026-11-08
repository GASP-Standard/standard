-- GASP conformance case c09_window_dau_mau: trailing windows of different lengths ending at the period end (one day over thirty).
-- Metric gasp_dau_mau (GASP formula: metric.daily_active_users_dau / metric.monthly_active_users_mau) for the period 2026-01-01 to 2026-06-30.
-- The subquery is the source of the staged dataset gasp_staged_gasp_dau_mau in model.ossie.yaml,
-- compiled by GASP from the formula (Postgres dialect; the GASP extension on the dataset carries
-- Snowflake, BigQuery and Databricks). It reads the tables in ../../data/, including gasp.period_spine.
SELECT value
FROM (SELECT p.period_start, p.period_end, ((CAST(((SELECT COUNT(DISTINCT user_id) FROM gasp.product_event WHERE event_date >= ((p.period_end + INTERVAL '1 day') - INTERVAL '1 day') AND event_date <= p.period_end AND product_event_type = 'qualifying')) AS DOUBLE PRECISION) / NULLIF(((SELECT COUNT(DISTINCT user_id) FROM gasp.product_event WHERE event_date >= ((p.period_end + INTERVAL '1 day') - INTERVAL '30 day') AND event_date <= p.period_end AND product_event_type = 'qualifying')), 0))) AS value FROM gasp.period_spine p) AS s
WHERE period_start = DATE '2026-01-01';
