-- The other readings of case c03_at_period_start_logo_churn_rate: what a query returns for gasp_logo_churn_rate when it reads the data another way.
-- Grade wrong is a mistake. Grade alternative is a reading other tools take and GASP does not.
-- A result that differs from expected.sql is graded against these rows (see Grading in ../../README.md).
-- Postgres dialect, over the tables in ../../data/.
SELECT grade, reading, value
FROM (
  -- closing_value: the customers active on the last day of the period as the denominator, where the formula reads the first day. Returns 0.166666666667.
  SELECT 'wrong' AS grade, 'closing_value' AS reading, CAST((SELECT value FROM (SELECT p.period_start, p.period_end, ((CAST(((SELECT COUNT(DISTINCT customer_id) FROM gasp.revenue_event WHERE event_date >= p.period_start AND event_date <= p.period_end AND event_type = 'churn')) AS DOUBLE PRECISION) / NULLIF(((SELECT COUNT(DISTINCT customer_id) FROM gasp.customer WHERE snapshot_date = p.period_end AND customer_status = 'active')), 0))) AS value FROM gasp.period_spine p) AS s WHERE period_start = DATE '2026-01-01') AS DOUBLE PRECISION) AS value
) AS readings
ORDER BY reading;
