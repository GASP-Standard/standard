-- GASP conformance case c10_distinct_pair_breadth_of_adoption: a count of distinct tuples (account and feature pairs).
-- Metric gasp_breadth_of_adoption (GASP formula: count_distinct(field.customer_id, field.feature_id) / metric.active_accounts) for the period 2026-01-01 to 2026-06-30.
-- The subquery is the source of the staged dataset gasp_staged_gasp_breadth_of_adoption in model.ossie.yaml,
-- compiled by GASP from the formula (Postgres dialect; the GASP extension on the dataset carries
-- Snowflake, BigQuery and Databricks). It reads the tables in ../../data/, including gasp.period_spine.
SELECT value
FROM (SELECT p.period_start, p.period_end, ((CAST((SELECT COUNT(*) FROM (SELECT DISTINCT customer_id, feature_id FROM gasp.product_event WHERE event_date >= p.period_start AND event_date <= p.period_end AND customer_id IS NOT NULL AND feature_id IS NOT NULL) _pairs) AS DOUBLE PRECISION) / NULLIF(((SELECT COUNT(DISTINCT customer_id) FROM gasp.product_event WHERE event_date >= p.period_start AND event_date <= p.period_end AND product_event_type = 'qualifying')), 0))) AS value FROM gasp.period_spine p) AS s
WHERE period_start = DATE '2026-01-01';
