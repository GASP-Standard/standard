-- Expected result of reference.postgres.sql for case c06_to_date_ticket_backlog, as standard SQL over literals.
-- A non-integer value is an approximate numeric literal; compare with a relative tolerance of 1e-9.
SELECT *
FROM (VALUES
  (7)
) AS expected (value);
