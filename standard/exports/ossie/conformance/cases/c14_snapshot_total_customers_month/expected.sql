-- Expected result of reference.postgres.sql for case c14_snapshot_total_customers_month, as standard SQL over literals.
-- A non-integer value is an approximate numeric literal; compare with a relative tolerance of 1e-9.
SELECT *
FROM (VALUES
  (18)
) AS expected (value);
