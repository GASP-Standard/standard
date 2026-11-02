-- Expected result of reference.postgres.sql for case c03_at_period_start_logo_churn_rate, as standard SQL over literals.
-- A non-integer value is an approximate numeric literal; compare with a relative tolerance of 1e-9.
SELECT *
FROM (VALUES
  (2.5E-1)
) AS expected (value);
