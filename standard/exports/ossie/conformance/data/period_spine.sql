-- The reporting periods the staged sources compute for: one row per period. A case reads the row for its own period.
CREATE SCHEMA gasp;
CREATE TABLE gasp.period_spine (period_start DATE, period_end DATE);
INSERT INTO gasp.period_spine (period_start, period_end) VALUES (DATE '2026-01-01', DATE '2026-06-30'), (DATE '2026-02-09', DATE '2026-03-08');
