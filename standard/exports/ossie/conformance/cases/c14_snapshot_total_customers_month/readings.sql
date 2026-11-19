-- The other readings of case c14_snapshot_total_customers_month: what a query returns for gasp_total_customers when it reads the data another way.
-- Grade wrong is a mistake. Grade alternative is a reading other tools take and GASP does not.
-- A result that differs from expected.sql is graded against these rows (see Grading in ../../README.md).
-- Postgres dialect, over the tables in ../../data/.
SELECT grade, reading, value
FROM (
  -- distinct_over_every_date: the distinct count taken over every snapshot date in the period, so a customer active on any day of it is counted, one who left before the last day included. Returns 19.
  SELECT 'wrong' AS grade, 'distinct_over_every_date' AS reading, CAST(((SELECT COUNT(DISTINCT customer.customer_id) FILTER (WHERE customer.customer_status = 'active') FROM gasp.customer WHERE snapshot_date >= DATE '2026-06-01' AND snapshot_date <= DATE '2026-06-30')) AS DOUBLE PRECISION) AS value
  UNION ALL
  -- rows_over_every_date: the active rows on every snapshot date in the period counted without DISTINCT, which gives customer days. Returns 525.
  SELECT 'wrong' AS grade, 'rows_over_every_date' AS reading, CAST(((SELECT COUNT(customer.customer_id) FILTER (WHERE customer.customer_status = 'active') FROM gasp.customer WHERE snapshot_date >= DATE '2026-06-01' AND snapshot_date <= DATE '2026-06-30')) AS DOUBLE PRECISION) AS value
  UNION ALL
  -- opening_value: the count on the first snapshot date of the period, where the formula reads the last. Returns 16.
  SELECT 'wrong' AS grade, 'opening_value' AS reading, CAST(((SELECT COUNT(DISTINCT customer.customer_id) FILTER (WHERE customer.customer_status = 'active') FROM gasp.customer WHERE snapshot_date = DATE '2026-06-01')) AS DOUBLE PRECISION) AS value
) AS readings
ORDER BY reading;
