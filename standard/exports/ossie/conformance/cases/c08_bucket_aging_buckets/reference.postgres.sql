-- GASP conformance case c08_bucket_aging_buckets: a dimension defined by ranges over a per-row expression.
-- Metric gasp_aging_buckets (GASP formula: sum(field.outstanding_amount) / total(sum(field.outstanding_amount))) for the period 2026-01-01 to 2026-06-30.
-- The subquery is the source of the staged dataset gasp_staged_gasp_aging_buckets in model.ossie.yaml,
-- compiled by GASP from the formula (Postgres dialect; the GASP extension on the dataset carries
-- Snowflake, BigQuery and Databricks). It reads the tables in ../../data/, including gasp.period_spine.
SELECT bucket, value
FROM (SELECT p.period_start, p.period_end, _d.bucket AS bucket, ((CAST((SELECT SUM(outstanding_amount) FROM gasp.invoice WHERE snapshot_date = p.period_end AND CASE WHEN (snapshot_date - invoice_date) BETWEEN 0 AND 30 THEN 'current' WHEN (snapshot_date - invoice_date) BETWEEN 31 AND 60 THEN 'days_31_60' WHEN (snapshot_date - invoice_date) BETWEEN 61 AND 90 THEN 'days_61_90' WHEN (snapshot_date - invoice_date) >= 91 THEN 'days_90_plus' END = _d.bucket) AS DOUBLE PRECISION) / NULLIF((SELECT SUM(outstanding_amount) FROM gasp.invoice WHERE snapshot_date = p.period_end), 0))) AS value FROM gasp.period_spine p CROSS JOIN (SELECT 'current' AS bucket UNION ALL SELECT 'days_31_60' AS bucket UNION ALL SELECT 'days_61_90' AS bucket UNION ALL SELECT 'days_90_plus' AS bucket) _d) AS s
WHERE period_start = DATE '2026-01-01'
ORDER BY bucket;
