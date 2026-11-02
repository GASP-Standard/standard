-- Expected result of reference.postgres.sql for case c08_bucket_aging_buckets, as standard SQL over literals.
-- A non-integer value is an approximate numeric literal; compare with a relative tolerance of 1e-9.
SELECT *
FROM (VALUES
  ('current', 1),
  ('days_31_60', 0),
  ('days_61_90', 0),
  ('days_90_plus', 0)
) AS expected (bucket, value);
