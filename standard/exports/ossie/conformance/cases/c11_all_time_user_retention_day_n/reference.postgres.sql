-- GASP conformance case c11_all_time_user_retention_day_n: an unbounded range beside a bounded one (users who signed up in the period, active any time after).
-- Metric gasp_user_retention_day_n (GASP formula: all_time(count_distinct(field.user_id where field.product_event_type = 'qualifying' and in_period(field.signup_date) and (field.event_date - field.signup_date) = 30)) / count_distinct(field.user_id where in_period(field.signup_date))) for the period 2026-01-01 to 2026-06-30.
-- The subquery is the source of the staged dataset gasp_staged_gasp_user_retention_day_n in model.ossie.yaml,
-- compiled by GASP from the formula (Postgres dialect; the GASP extension on the dataset carries
-- Snowflake, BigQuery and Databricks). It reads the tables in ../../data/, including gasp.period_spine.
SELECT value
FROM (SELECT p.period_start, p.period_end, ((CAST((SELECT COUNT(DISTINCT user_id) FROM gasp.product_event WHERE ((product_event_type = 'qualifying' AND (signup_date >= p.period_start AND signup_date <= p.period_end)) AND (event_date - signup_date) = 30)) AS DOUBLE PRECISION) / NULLIF((SELECT COUNT(DISTINCT user_id) FROM gasp.user WHERE snapshot_date = p.period_end AND (signup_date >= p.period_start AND signup_date <= p.period_end)), 0))) AS value FROM gasp.period_spine p) AS s
WHERE period_start = DATE '2026-01-01';
