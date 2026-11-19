-- Expected result of reference.postgres.sql for case c15_at_period_start_logo_churn_rate_four_weeks, as standard SQL over literals.
-- A non-integer value is an approximate numeric literal; compare with a relative tolerance of 1e-9.
SELECT *
FROM (VALUES
  (7.142857142857142E-2)
) AS expected (value);
