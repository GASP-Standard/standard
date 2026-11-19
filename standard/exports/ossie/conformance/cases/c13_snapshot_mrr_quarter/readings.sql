-- The other readings of case c13_snapshot_mrr_quarter: what a query returns for gasp_mrr when it reads the data another way.
-- Grade wrong is a mistake. Grade alternative is a reading other tools take and GASP does not.
-- A result that differs from expected.sql is graded against these rows (see Grading in ../../README.md).
-- Postgres dialect, over the tables in ../../data/.
SELECT grade, reading, value
FROM (
  -- month_ends_summed: the closing value of each month in the period added together, where the formula reads the closing value of the last. Returns 64800.
  SELECT 'wrong' AS grade, 'month_ends_summed' AS reading, CAST((COALESCE((SELECT SUM(subscription.mrr) FILTER (WHERE subscription.subscription_status = 'active') FROM gasp.subscription WHERE snapshot_date IN (DATE '2026-04-30', DATE '2026-05-31', DATE '2026-06-30')), 0)) AS DOUBLE PRECISION) AS value
  UNION ALL
  -- opening_value: the sum on the first snapshot date of the period, where the formula reads the last. Returns 18400.
  SELECT 'wrong' AS grade, 'opening_value' AS reading, CAST((COALESCE((SELECT SUM(subscription.mrr) FILTER (WHERE subscription.subscription_status = 'active') FROM gasp.subscription WHERE snapshot_date = DATE '2026-04-01'), 0)) AS DOUBLE PRECISION) AS value
) AS readings
ORDER BY reading;
