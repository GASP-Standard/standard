-- GASP conformance case c04_total_ticket_distribution_by_type: a share of the ungrouped total inside a breakdown.
-- Metric gasp_ticket_distribution_by_type (GASP formula: count_distinct(field.ticket_id) / total(metric.ticket_volume)) for the period 2026-01-01 to 2026-06-30.
-- The subquery is the source of the staged dataset gasp_staged_gasp_ticket_distribution_by_type in model.ossie.yaml,
-- compiled by GASP from the formula (Postgres dialect; the GASP extension on the dataset carries
-- Snowflake, BigQuery and Databricks). It reads the tables in ../../data/, including gasp.period_spine.
SELECT ticket_type, value
FROM (SELECT p.period_start, p.period_end, _d.ticket_type AS ticket_type, ((CAST((SELECT COUNT(DISTINCT ticket_id) FROM gasp.ticket WHERE created_at >= p.period_start AND created_at < (p.period_end + INTERVAL '1 day') AND ticket_type = _d.ticket_type) AS DOUBLE PRECISION) / NULLIF(((SELECT COUNT(DISTINCT ticket_id) FROM gasp.ticket WHERE created_at >= p.period_start AND created_at < (p.period_end + INTERVAL '1 day'))), 0))) AS value FROM gasp.period_spine p CROSS JOIN (SELECT 'how_to' AS ticket_type UNION ALL SELECT 'bug' AS ticket_type UNION ALL SELECT 'billing' AS ticket_type UNION ALL SELECT 'account' AS ticket_type UNION ALL SELECT 'feature_request' AS ticket_type UNION ALL SELECT 'other' AS ticket_type) _d) AS s
WHERE period_start = DATE '2026-01-01'
ORDER BY ticket_type;
