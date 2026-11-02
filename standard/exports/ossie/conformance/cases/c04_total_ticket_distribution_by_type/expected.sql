-- Expected result of reference.postgres.sql for case c04_total_ticket_distribution_by_type, as standard SQL over literals.
-- A non-integer value is an approximate numeric literal; compare with a relative tolerance of 1e-9.
SELECT *
FROM (VALUES
  ('account', 9.677419354838709E-2),
  ('billing', 1.290322580645161E-1),
  ('bug', 2.580645161290323E-1),
  ('feature_request', 9.677419354838709E-2),
  ('how_to', 3.225806451612903E-1),
  ('other', 9.677419354838709E-2)
) AS expected (ticket_type, value);
