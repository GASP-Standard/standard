-- Expected result of reference.postgres.sql for case c05_period_bound_in_filter_win_rate, as standard SQL over literals.
-- A non-integer value is an approximate numeric literal; compare with a relative tolerance of 1e-9.
SELECT *
FROM (VALUES
  (5E-1)
) AS expected (value);
