-- Expected result of reference.postgres.sql for case c11_all_time_user_retention_day_n, as standard SQL over literals.
-- A non-integer value is an approximate numeric literal; compare with a relative tolerance of 1e-9.
SELECT *
FROM (VALUES
  (7.142857142857143E-1)
) AS expected (value);
