-- Expected result of reference.postgres.sql for case c12_snapshot_mrr_month, as standard SQL over literals.
-- A non-integer value is an approximate numeric literal; compare with a relative tolerance of 1e-9.
SELECT *
FROM (VALUES
  (24200)
) AS expected (value);
