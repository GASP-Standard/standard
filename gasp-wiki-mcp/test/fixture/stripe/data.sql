-- The sample ledger: three months of nightly snapshots for five customers,
-- the rows the test loads into PGlite and derive_cel's SQL runs over. Each
-- block states the versions the nightly job would have seen (valid_from to
-- valid_to, inclusive) and expands them to one row per day, so the derived
-- events can be checked by eye against the versions. Postgres SQL (the test
-- runner); the tables are the ones schema.sql declares for Redshift.
--
-- The business starts billing on Stripe on 2026-01-01, so the ledger starts
-- with the business and derive_cel runs with first_snapshot: steps. The
-- stories, with the MRR each item carries while active:
--   cus_A (smb)         si_A1 Team monthly, 5 seats at $20 (100) from 01-01; 8 seats (160) from 02-10;
--                       moved to the 2026 Team price, $25 a seat (200), from 03-01
--   cus_B (mid_market)  si_B1 Pro yearly, 10 seats at $480 a year (400) from 01-01;
--                       si_B2 the Analytics add-on, $100 a month, from 03-05
--   cus_C (smb)         si_C1 Pro monthly, 2 seats at $49 (98) from 01-15, cancelled 02-20;
--                       back on si_C2 (a new subscription), 1 seat (49), from 03-25
--   cus_D (enterprise)  si_D1 Pro yearly, 20 seats (800), trialing from 01-20, active from 02-03;
--                       15 seats (600) from 03-15
--   cus_E (smb)         si_E1 Team monthly, 3 seats (60) from 02-01; past_due from 03-01 (still active);
--                       cancelled 03-20
-- Expected events: events.json. MRR on 2026-03-31: 1,349.

CREATE SCHEMA IF NOT EXISTS stripe_snapshots;
CREATE SCHEMA IF NOT EXISTS gasp;

CREATE TABLE stripe_snapshots.subscription_items (
  snapshot_date DATE NOT NULL,
  subscription_item_id VARCHAR(255) NOT NULL,
  subscription_id VARCHAR(255) NOT NULL,
  customer_id VARCHAR(255) NOT NULL,
  customer_segment VARCHAR(32),
  status VARCHAR(32) NOT NULL,
  price_id VARCHAR(255) NOT NULL,
  product_id VARCHAR(255) NOT NULL,
  unit_amount BIGINT,
  currency CHAR(3),
  recurring_interval VARCHAR(8),
  recurring_interval_count BIGINT,
  quantity BIGINT,
  start_date TIMESTAMP,
  canceled_at TIMESTAMP,
  PRIMARY KEY (snapshot_date, subscription_item_id)
);

INSERT INTO stripe_snapshots.subscription_items
SELECT d::date, v.item, v.sub, v.cus, v.seg, v.status, v.price, v.product, v.unit_amount, 'usd', v.interval, 1, v.qty, v.start_date::timestamp, v.canceled_at::timestamp
FROM (VALUES
  ('2026-01-01', '2026-02-09', 'si_A1', 'sub_A',  'cus_A', 'smb',        'active',   'price_team_m',    'prod_team',  2000,  'month', 5,  '2026-01-01', NULL),
  ('2026-02-10', '2026-02-28', 'si_A1', 'sub_A',  'cus_A', 'smb',        'active',   'price_team_m',    'prod_team',  2000,  'month', 8,  '2026-01-01', NULL),
  ('2026-03-01', '2026-03-31', 'si_A1', 'sub_A',  'cus_A', 'smb',        'active',   'price_team_m_26', 'prod_team',  2500,  'month', 8,  '2026-01-01', NULL),
  ('2026-01-01', '2026-03-31', 'si_B1', 'sub_B',  'cus_B', 'mid_market', 'active',   'price_pro_y',     'prod_pro',   48000, 'year',  10, '2026-01-01', NULL),
  ('2026-03-05', '2026-03-31', 'si_B2', 'sub_B',  'cus_B', 'mid_market', 'active',   'price_addon_m',   'prod_addon', 10000, 'month', 1,  '2026-01-01', NULL),
  ('2026-01-15', '2026-02-19', 'si_C1', 'sub_C',  'cus_C', 'smb',        'active',   'price_pro_m',     'prod_pro',   4900,  'month', 2,  '2026-01-15', NULL),
  ('2026-02-20', '2026-03-31', 'si_C1', 'sub_C',  'cus_C', 'smb',        'canceled', 'price_pro_m',     'prod_pro',   4900,  'month', 2,  '2026-01-15', '2026-02-20'),
  ('2026-03-25', '2026-03-31', 'si_C2', 'sub_C2', 'cus_C', 'smb',        'active',   'price_pro_m',     'prod_pro',   4900,  'month', 1,  '2026-03-25', NULL),
  ('2026-01-20', '2026-02-02', 'si_D1', 'sub_D',  'cus_D', 'enterprise', 'trialing', 'price_pro_y',     'prod_pro',   48000, 'year',  20, '2026-01-20', NULL),
  ('2026-02-03', '2026-03-14', 'si_D1', 'sub_D',  'cus_D', 'enterprise', 'active',   'price_pro_y',     'prod_pro',   48000, 'year',  20, '2026-01-20', NULL),
  ('2026-03-15', '2026-03-31', 'si_D1', 'sub_D',  'cus_D', 'enterprise', 'active',   'price_pro_y',     'prod_pro',   48000, 'year',  15, '2026-01-20', NULL),
  ('2026-02-01', '2026-02-28', 'si_E1', 'sub_E',  'cus_E', 'smb',        'active',   'price_team_m',    'prod_team',  2000,  'month', 3,  '2026-02-01', NULL),
  ('2026-03-01', '2026-03-19', 'si_E1', 'sub_E',  'cus_E', 'smb',        'past_due', 'price_team_m',    'prod_team',  2000,  'month', 3,  '2026-02-01', NULL),
  ('2026-03-20', '2026-03-31', 'si_E1', 'sub_E',  'cus_E', 'smb',        'canceled', 'price_team_m',    'prod_team',  2000,  'month', 3,  '2026-02-01', '2026-03-20')
) AS v (valid_from, valid_to, item, sub, cus, seg, status, price, product, unit_amount, interval, qty, start_date, canceled_at),
LATERAL generate_series(v.valid_from::date, v.valid_to::date, INTERVAL '1 day') AS d;

CREATE TABLE stripe_snapshots.customers (
  snapshot_date DATE NOT NULL,
  customer_id VARCHAR(255) NOT NULL,
  customer_status VARCHAR(16) NOT NULL,
  acquisition_date DATE,
  customer_segment VARCHAR(32),
  email VARCHAR(512),
  PRIMARY KEY (snapshot_date, customer_id)
);

INSERT INTO stripe_snapshots.customers
SELECT d::date, v.cus, v.status, v.acquired::date, v.seg, v.cus || '@example.com'
FROM (VALUES
  ('2026-01-01', '2026-03-31', 'cus_A', 'active',  '2026-01-01', 'smb'),
  ('2026-01-01', '2026-03-31', 'cus_B', 'active',  '2026-01-01', 'mid_market'),
  ('2026-01-15', '2026-02-19', 'cus_C', 'active',  '2026-01-15', 'smb'),
  ('2026-02-20', '2026-03-24', 'cus_C', 'churned', '2026-01-15', 'smb'),
  ('2026-03-25', '2026-03-31', 'cus_C', 'active',  '2026-01-15', 'smb'),
  ('2026-01-20', '2026-02-02', 'cus_D', 'trial',   NULL,         'enterprise'),
  ('2026-02-03', '2026-03-31', 'cus_D', 'active',  '2026-02-03', 'enterprise'),
  ('2026-02-01', '2026-03-19', 'cus_E', 'active',  '2026-02-01', 'smb'),
  ('2026-03-20', '2026-03-31', 'cus_E', 'churned', '2026-02-01', 'smb')
) AS v (valid_from, valid_to, cus, status, acquired, seg),
LATERAL generate_series(v.valid_from::date, v.valid_to::date, INTERVAL '1 day') AS d;

CREATE TABLE stripe_snapshots.invoices (
  snapshot_date DATE NOT NULL,
  id VARCHAR(255) NOT NULL,
  customer_id VARCHAR(255) NOT NULL,
  subscription_id VARCHAR(255),
  status VARCHAR(32),
  created TIMESTAMP NOT NULL,
  amount_due BIGINT,
  amount_paid BIGINT,
  amount_remaining BIGINT,
  currency CHAR(3),
  status_transitions_paid_at TIMESTAMP,
  PRIMARY KEY (snapshot_date, id)
);

INSERT INTO stripe_snapshots.invoices
SELECT d::date, v.id, v.cus, v.sub, v.status, v.created::timestamp, v.due, v.paid, v.remaining, 'usd', v.paid_at::timestamp
FROM (VALUES
  ('2026-01-01', '2026-03-31', 'in_A_0101', 'cus_A', 'sub_A', 'paid',          '2026-01-01', 10000,  10000,  0,    '2026-01-01'),
  ('2026-02-01', '2026-03-31', 'in_A_0201', 'cus_A', 'sub_A', 'paid',          '2026-02-01', 10000,  10000,  0,    '2026-02-01'),
  ('2026-03-01', '2026-03-31', 'in_A_0301', 'cus_A', 'sub_A', 'paid',          '2026-03-01', 20000,  20000,  0,    '2026-03-02'),
  ('2026-01-01', '2026-03-31', 'in_B_0101', 'cus_B', 'sub_B', 'paid',          '2026-01-01', 480000, 480000, 0,    '2026-01-04'),
  ('2026-03-05', '2026-03-31', 'in_B_0305', 'cus_B', 'sub_B', 'paid',          '2026-03-05', 10000,  10000,  0,    '2026-03-05'),
  ('2026-01-15', '2026-03-31', 'in_C_0115', 'cus_C', 'sub_C', 'paid',          '2026-01-15', 9800,   9800,   0,    '2026-01-15'),
  ('2026-03-25', '2026-03-31', 'in_C_0325', 'cus_C', 'sub_C2', 'paid',         '2026-03-25', 4900,   4900,   0,    '2026-03-25'),
  ('2026-02-03', '2026-03-31', 'in_D_0203', 'cus_D', 'sub_D', 'paid',          '2026-02-03', 960000, 960000, 0,    '2026-02-10'),
  ('2026-02-01', '2026-03-31', 'in_E_0201', 'cus_E', 'sub_E', 'paid',          '2026-02-01', 6000,   6000,   0,    '2026-02-01'),
  ('2026-03-01', '2026-03-19', 'in_E_0301', 'cus_E', 'sub_E', 'open',          '2026-03-01', 6000,   0,      6000, NULL),
  ('2026-03-20', '2026-03-31', 'in_E_0301', 'cus_E', 'sub_E', 'uncollectible', '2026-03-01', 6000,   0,      6000, NULL)
) AS v (valid_from, valid_to, id, cus, sub, status, created, due, paid, remaining, paid_at),
LATERAL generate_series(v.valid_from::date, v.valid_to::date, INTERVAL '1 day') AS d;

CREATE TABLE gasp.revenue_events (
  event_id VARCHAR(255) NOT NULL PRIMARY KEY,
  event_date DATE NOT NULL,
  customer_id VARCHAR(255) NOT NULL,
  subscription_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(16) NOT NULL,
  mrr_change NUMERIC(18, 2) NOT NULL,
  currency CHAR(3) NOT NULL,
  prior_mrr NUMERIC(18, 2) NOT NULL,
  new_mrr NUMERIC(18, 2) NOT NULL,
  expansion_classification VARCHAR(24),
  change_nature VARCHAR(20) NOT NULL,
  lifecycle_attribution VARCHAR(24) NOT NULL,
  segment VARCHAR(32)
);

CREATE TABLE gasp.period_spine (period_start DATE NOT NULL, period_end DATE NOT NULL);
INSERT INTO gasp.period_spine VALUES ('2026-01-01', '2026-01-31'), ('2026-02-01', '2026-02-28'), ('2026-03-01', '2026-03-31');
