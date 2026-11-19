-- Expected result of reference.postgres.sql for case c13_snapshot_mrr_quarter, as standard SQL over literals.
-- A non-integer value is an approximate numeric literal; compare with a relative tolerance of 1e-9.
SELECT *
FROM (VALUES
  (24200)
) AS expected (value);
