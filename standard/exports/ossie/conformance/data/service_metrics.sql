-- GASP dataset service_metrics (fact; Service reliability). rows dated from 2025-12-01
-- Generated from the GASP test fixture (gasp-wiki-mcp/test/fixture/generate.ts, seed 20260101) by npm run conformance.
CREATE TABLE gasp.service_metrics (
  downtime_minutes INTEGER,
  error_count INTEGER,
  period_start DATE,
  request_count INTEGER,
  response_time_ms INTEGER,
  service_id VARCHAR(1000),
  sla_met BOOLEAN,
  utilization DECIMAL(18, 6)
);
INSERT INTO gasp.service_metrics (downtime_minutes, error_count, period_start, request_count, response_time_ms, service_id, sla_met, utilization) VALUES
  (12, 1048, DATE '2026-01-01', 1048452, 131, 'svc_api', FALSE, 0.498),
  (0, 2050, DATE '2026-01-01', 1025054, 211, 'svc_web', TRUE, 0.643),
  (0, 2979, DATE '2026-01-01', 993111, 251, 'svc_worker', TRUE, 0.693),
  (0, 965, DATE '2026-02-01', 964780, 121, 'svc_api', TRUE, 0.519),
  (0, 1891, DATE '2026-02-01', 945590, 213, 'svc_web', TRUE, 0.646),
  (0, 3194, DATE '2026-02-01', 1064583, 233, 'svc_worker', TRUE, 0.722),
  (0, 910, DATE '2026-03-01', 910113, 140, 'svc_api', TRUE, 0.543),
  (0, 1899, DATE '2026-03-01', 949743, 176, 'svc_web', TRUE, 0.556),
  (22, 2788, DATE '2026-03-01', 929415, 254, 'svc_worker', FALSE, 0.715),
  (0, 1092, DATE '2026-04-01', 1091972, 159, 'svc_api', TRUE, 0.475),
  (17, 1839, DATE '2026-04-01', 919545, 168, 'svc_web', FALSE, 0.565),
  (0, 2932, DATE '2026-04-01', 977433, 234, 'svc_worker', TRUE, 0.707),
  (12, 1087, DATE '2026-05-01', 1086590, 161, 'svc_api', FALSE, 0.533),
  (0, 1849, DATE '2026-05-01', 924662, 178, 'svc_web', TRUE, 0.597),
  (0, 3287, DATE '2026-05-01', 1095805, 203, 'svc_worker', TRUE, 0.706),
  (0, 917, DATE '2026-06-01', 917192, 130, 'svc_api', TRUE, 0.46),
  (0, 1825, DATE '2026-06-01', 912316, 219, 'svc_web', TRUE, 0.639),
  (0, 3010, DATE '2026-06-01', 1003264, 232, 'svc_worker', TRUE, 0.674);
