-- The reporting periods the staged sources compute for: one row per period. Every case uses the first half of 2026.
CREATE SCHEMA gasp;
CREATE TABLE gasp.period_spine (period_start DATE, period_end DATE);
INSERT INTO gasp.period_spine (period_start, period_end) VALUES (DATE '2026-01-01', DATE '2026-06-30');
