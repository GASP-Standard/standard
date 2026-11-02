-- Expected result of reference.postgres.sql for case c01_cohort_nrr, as standard SQL over literals.
-- A non-integer value is an approximate numeric literal; compare with a relative tolerance of 1e-9.
SELECT *
FROM (VALUES
  (9.867549668874173E-1)
) AS expected (value);
