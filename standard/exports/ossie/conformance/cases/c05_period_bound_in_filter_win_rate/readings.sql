-- The other readings of case c05_period_bound_in_filter_win_rate: what a query returns for gasp_win_rate when it reads the data another way.
-- Grade wrong is a mistake. Grade alternative is a reading other tools take and GASP does not.
-- A result that differs from expected.sql is graded against these rows (see Grading in ../../README.md).
-- Postgres dialect, over the tables in ../../data/.
SELECT grade, reading, value
FROM (
  -- period_on_snapshot_date_only: the opportunities as they stand at the period end with no bound on the close date, so the period reaches the dataset's time field alone and every deal ever closed is counted. Returns 0.526315789474.
  SELECT 'wrong' AS grade, 'period_on_snapshot_date_only' AS reading, CAST((SELECT value FROM (SELECT p.period_start, p.period_end, ((CAST((SELECT COUNT(opportunity_id) FROM gasp.opportunity WHERE snapshot_date = p.period_end AND (opportunity_stage = 'closed_won')) AS DOUBLE PRECISION) / NULLIF((SELECT COUNT(opportunity_id) FROM gasp.opportunity WHERE snapshot_date = p.period_end AND (opportunity_stage IN ('closed_won', 'closed_lost'))), 0))) AS value FROM gasp.period_spine p) AS s WHERE period_start = DATE '2026-01-01') AS DOUBLE PRECISION) AS value
) AS readings
ORDER BY reading;
