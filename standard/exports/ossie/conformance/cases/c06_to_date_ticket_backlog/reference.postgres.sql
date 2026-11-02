-- GASP conformance case c06_to_date_ticket_backlog: an aggregate cumulative from the start of history to the period end.
-- Metric gasp_ticket_backlog (GASP formula: count_distinct(field.ticket_id where field.ticket_status in ('open', 'pending')) at period_end) for the period 2026-01-01 to 2026-06-30.
-- The subquery is the source of the staged dataset gasp_staged_gasp_ticket_backlog in model.ossie.yaml,
-- compiled by GASP from the formula (Postgres dialect; the GASP extension on the dataset carries
-- Snowflake, BigQuery and Databricks). It reads the tables in ../../data/, including gasp.period_spine.
SELECT value
FROM (SELECT p.period_start, p.period_end, ((SELECT COUNT(DISTINCT ticket_id) FROM gasp.ticket WHERE created_at < (p.period_end + INTERVAL '1 day') AND ticket_status IN ('open', 'pending'))) AS value FROM gasp.period_spine p) AS s
WHERE period_start = DATE '2026-01-01';
