-- GASP conformance case c05_period_bound_in_filter_win_rate: the reporting period bound to a field other than the dataset's time field (opportunities by close date on a snapshot).
-- Metric gasp_win_rate (GASP formula: count(field.opportunity_id where field.opportunity_stage = 'closed_won' and in_period(field.close_date)) / count(field.opportunity_id where field.opportunity_stage in ('closed_won', 'closed_lost') and in_period(field.close_date))) for the period 2026-01-01 to 2026-06-30.
-- The subquery is the source of the staged dataset gasp_staged_gasp_win_rate in model.ossie.yaml,
-- compiled by GASP from the formula (Postgres dialect; the GASP extension on the dataset carries
-- Snowflake, BigQuery and Databricks). It reads the tables in ../../data/, including gasp.period_spine.
SELECT value
FROM (SELECT p.period_start, p.period_end, ((CAST((SELECT COUNT(opportunity_id) FROM gasp.opportunity WHERE snapshot_date = p.period_end AND (opportunity_stage = 'closed_won' AND (close_date >= p.period_start AND close_date <= p.period_end))) AS DOUBLE PRECISION) / NULLIF((SELECT COUNT(opportunity_id) FROM gasp.opportunity WHERE snapshot_date = p.period_end AND (opportunity_stage IN ('closed_won', 'closed_lost') AND (close_date >= p.period_start AND close_date <= p.period_end))), 0))) AS value FROM gasp.period_spine p) AS s
WHERE period_start = DATE '2026-01-01';
