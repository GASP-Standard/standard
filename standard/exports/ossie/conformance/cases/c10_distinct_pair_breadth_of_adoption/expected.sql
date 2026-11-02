-- Expected result of reference.postgres.sql for case c10_distinct_pair_breadth_of_adoption, as standard SQL over literals.
-- A non-integer value is an approximate numeric literal; compare with a relative tolerance of 1e-9.
SELECT *
FROM (VALUES
  (4.785714285714286E+0)
) AS expected (value);
