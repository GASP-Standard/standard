-- Expected result of reference.postgres.sql for case c09_window_dau_mau, as standard SQL over literals.
-- A non-integer value is an approximate numeric literal; compare with a relative tolerance of 1e-9.
SELECT *
FROM (VALUES
  (2.380952380952381E-1)
) AS expected (value);
