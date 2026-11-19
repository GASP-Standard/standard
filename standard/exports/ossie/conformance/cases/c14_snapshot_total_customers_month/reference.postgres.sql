-- GASP conformance case c14_snapshot_total_customers_month: a distinct count over a snapshot dataset for a month, read on the last snapshot date of the month.
-- Metric gasp_total_customers (GASP formula: count_distinct(field.customer_id where field.customer_status = 'active') at period_end) for the period 2026-06-01 to 2026-06-30.
-- The metric is a direct OSSIE_SQL_2026 expression in model.ossie.yaml. Each aggregate is evaluated over its
-- dataset's rows on the last snapshot date of the period, the one reading GASP takes. Nothing in the expression
-- says so, and readings.sql holds what the other readings return. It reads the tables in ../../data/.
SELECT ((SELECT COUNT(DISTINCT customer.customer_id) FILTER (WHERE customer.customer_status = 'active') FROM gasp.customer WHERE snapshot_date = DATE '2026-06-30')) AS value;
