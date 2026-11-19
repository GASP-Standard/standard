-- GASP conformance case c15_at_period_start_logo_churn_rate_four_weeks: the opening value of a period that begins on the day a customer starts, read from the snapshot dated on the first day of the period.
-- Metric gasp_logo_churn_rate (GASP formula: metric.churned_customers / metric.total_customers at period_start) for the period 2026-02-09 to 2026-03-08.
-- The subquery is the source of the staged dataset gasp_staged_gasp_logo_churn_rate in model.ossie.yaml,
-- compiled by GASP from the formula (Postgres dialect; the GASP extension on the dataset carries
-- Snowflake, BigQuery and Databricks). It reads the tables in ../../data/, including gasp.period_spine.
SELECT value
FROM (SELECT p.period_start, p.period_end, ((CAST(((SELECT COUNT(DISTINCT customer_id) FROM gasp.revenue_event WHERE event_date >= p.period_start AND event_date <= p.period_end AND event_type = 'churn')) AS DOUBLE PRECISION) / NULLIF(((SELECT COUNT(DISTINCT customer_id) FROM gasp.customer WHERE snapshot_date = p.period_start AND customer_status = 'active')), 0))) AS value FROM gasp.period_spine p) AS s
WHERE period_start = DATE '2026-02-09';
