-- GASP conformance case c07_period_days_uptime: the number of days in the reporting period as a value.
-- Metric gasp_uptime (GASP formula: 1 - sum(field.downtime_minutes) / (period_days * 1440)) for the period 2026-01-01 to 2026-06-30.
-- The subquery is the source of the staged dataset gasp_staged_gasp_uptime in model.ossie.yaml,
-- compiled by GASP from the formula (Postgres dialect; the GASP extension on the dataset carries
-- Snowflake, BigQuery and Databricks). It reads the tables in ../../data/, including gasp.period_spine.
SELECT value
FROM (SELECT p.period_start, p.period_end, ((1 - (CAST((SELECT SUM(downtime_minutes) FROM gasp.service_metrics WHERE period_start >= p.period_start AND period_start <= p.period_end) AS DOUBLE PRECISION) / NULLIF(((p.period_end - p.period_start + 1) * 1440), 0)))) AS value FROM gasp.period_spine p) AS s
WHERE period_start = DATE '2026-01-01';
