-- Expected result of reference.postgres.sql for case c02_lag_mrr_growth_rate, as standard SQL over literals.
-- A non-integer value is an approximate numeric literal; compare with a relative tolerance of 1e-9.
SELECT *
FROM (VALUES
  (1.100917431192661E-1)
) AS expected (value);
