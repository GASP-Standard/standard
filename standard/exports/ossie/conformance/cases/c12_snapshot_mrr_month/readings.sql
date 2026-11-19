-- The other readings of case c12_snapshot_mrr_month: what a query returns for gasp_mrr when it reads the data another way.
-- Grade wrong is a mistake. Grade alternative is a reading other tools take and GASP does not.
-- A result that differs from expected.sql is graded against these rows (see Grading in ../../README.md).
-- Postgres dialect, over the tables in ../../data/.
SELECT grade, reading, value
FROM (
  -- summed_over_every_date: the sum taken over every snapshot date in the period, so each subscription is added once per day. Returns 695900.
  SELECT 'wrong' AS grade, 'summed_over_every_date' AS reading, CAST((COALESCE((SELECT SUM(subscription.mrr) FILTER (WHERE subscription.subscription_status = 'active') FROM gasp.subscription WHERE snapshot_date >= DATE '2026-06-01' AND snapshot_date <= DATE '2026-06-30'), 0)) AS DOUBLE PRECISION) AS value
  UNION ALL
  -- opening_value: the sum on the first snapshot date of the period, where the formula reads the last. Returns 21800.
  SELECT 'wrong' AS grade, 'opening_value' AS reading, CAST((COALESCE((SELECT SUM(subscription.mrr) FILTER (WHERE subscription.subscription_status = 'active') FROM gasp.subscription WHERE snapshot_date = DATE '2026-06-01'), 0)) AS DOUBLE PRECISION) AS value
) AS readings
ORDER BY reading;
