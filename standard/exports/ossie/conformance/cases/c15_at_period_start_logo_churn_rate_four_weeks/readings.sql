-- The other readings of case c15_at_period_start_logo_churn_rate_four_weeks: what a query returns for gasp_logo_churn_rate when it reads the data another way.
-- Grade wrong is a mistake. Grade alternative is a reading other tools take and GASP does not.
-- A result that differs from expected.sql is graded against these rows (see Grading in ../../README.md).
-- Postgres dialect, over the tables in ../../data/.
SELECT grade, reading, value
FROM (
  -- prior_period_close: the opening value read from the last snapshot date before the period (the prior period's close), which leaves out the customer who starts on the first day. Returns 0.0769230769231.
  SELECT 'alternative' AS grade, 'prior_period_close' AS reading, CAST((SELECT value FROM (SELECT p.period_start, p.period_end, ((CAST(((SELECT COUNT(DISTINCT customer_id) FROM gasp.revenue_event WHERE event_date >= p.period_start AND event_date <= p.period_end AND event_type = 'churn' AND customer_id IN (SELECT customer_id FROM gasp.customer WHERE snapshot_date = (p.period_start - INTERVAL '1' DAY) AND customer_status = 'active'))) AS DOUBLE PRECISION) / NULLIF(((SELECT COUNT(DISTINCT customer_id) FROM gasp.customer WHERE snapshot_date = (p.period_start - INTERVAL '1' DAY) AND customer_status = 'active' AND customer_id IN (SELECT customer_id FROM gasp.customer WHERE snapshot_date = (p.period_start - INTERVAL '1' DAY) AND customer_status = 'active'))), 0))) AS value FROM gasp.period_spine p) AS s WHERE period_start = DATE '2026-02-09') AS DOUBLE PRECISION) AS value
) AS readings
ORDER BY reading;
