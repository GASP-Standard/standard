-- Expected result of reference.postgres.sql for case c07_period_days_uptime, as standard SQL over literals.
-- A non-integer value is an approximate numeric literal; compare with a relative tolerance of 1e-9.
SELECT *
FROM (VALUES
  (9.997582872928177E-1)
) AS expected (value);
