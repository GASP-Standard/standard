-- Stripe as it lands in Redshift through Stripe Data Pipeline, and the three
-- snapshot tables a company keeps on top of it. Redshift DDL, the input to
-- profile_schema. Column names follow the Stripe API reference as Data
-- Pipeline and Sigma flatten them: nested fields join with an underscore
-- (recurring.interval is recurring_interval, status_transitions.paid_at is
-- status_transitions_paid_at) and object references take an _id suffix
-- (subscription_items.price is price_id). Amounts are integers in the smallest
-- currency unit; currencies are lower case; times are UTC timestamps.
--
-- Stripe holds the current state of every object. A subscription whose
-- quantity changed last month shows the new quantity and nothing else, so no
-- landed table is a ledger. The nightly job in snapshot.sql copies the joined
-- state into stripe_snapshots.* once a day, and those tables are what the GASP
-- mapping (adapter.json) reads. gasp.revenue_events is the table derive_cel's
-- SQL fills from the subscription item snapshots.
--
-- Only the columns the snapshots and the mapping read are listed; the landed
-- tables carry many more.

-- Landed by Stripe Data Pipeline (current state, replaced on every sync).
CREATE TABLE stripe.customers (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  created TIMESTAMP NOT NULL,
  email VARCHAR(512),
  name VARCHAR(512),
  currency CHAR(3),
  delinquent BOOLEAN,
  metadata VARCHAR(65535),
  livemode BOOLEAN
);

CREATE TABLE stripe.subscriptions (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  customer_id VARCHAR(255) NOT NULL REFERENCES stripe.customers (id),
  status VARCHAR(32) NOT NULL,
  created TIMESTAMP NOT NULL,
  start_date TIMESTAMP,
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN,
  canceled_at TIMESTAMP,
  ended_at TIMESTAMP,
  trial_start TIMESTAMP,
  trial_end TIMESTAMP,
  collection_method VARCHAR(32),
  currency CHAR(3),
  livemode BOOLEAN
);

CREATE TABLE stripe.subscription_items (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  subscription_id VARCHAR(255) NOT NULL REFERENCES stripe.subscriptions (id),
  price_id VARCHAR(255) NOT NULL REFERENCES stripe.prices (id),
  quantity BIGINT,
  created TIMESTAMP NOT NULL
);

CREATE TABLE stripe.prices (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  product_id VARCHAR(255) NOT NULL,
  active BOOLEAN,
  currency CHAR(3),
  unit_amount BIGINT,
  unit_amount_decimal VARCHAR(64),
  type VARCHAR(16),
  recurring_interval VARCHAR(8),
  recurring_interval_count BIGINT,
  billing_scheme VARCHAR(16),
  nickname VARCHAR(255),
  livemode BOOLEAN
);

CREATE TABLE stripe.invoices (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  customer_id VARCHAR(255) NOT NULL REFERENCES stripe.customers (id),
  subscription_id VARCHAR(255),
  number VARCHAR(255),
  status VARCHAR(32),
  created TIMESTAMP NOT NULL,
  due_date TIMESTAMP,
  period_start TIMESTAMP,
  period_end TIMESTAMP,
  amount_due BIGINT,
  amount_paid BIGINT,
  amount_remaining BIGINT,
  currency CHAR(3),
  paid BOOLEAN,
  status_transitions_paid_at TIMESTAMP,
  collection_method VARCHAR(32),
  livemode BOOLEAN
);

-- Kept by the company: one row per subscription item per day (snapshot.sql).
-- This is the GASP subscription dataset at item grain: the item is the
-- subscription GASP sees, its MRR comes from the price and the quantity, and
-- the subscription's status is carried on every item.
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

-- One row per customer per day. Stripe has no customer status: the job
-- derives it from the customer's subscriptions on the day (active when any
-- subscription is active, past_due or unpaid; trial when the only
-- subscriptions are trialing; churned once every subscription has ended).
CREATE TABLE stripe_snapshots.customers (
  snapshot_date DATE NOT NULL,
  customer_id VARCHAR(255) NOT NULL,
  customer_status VARCHAR(16) NOT NULL,
  acquisition_date DATE,
  customer_segment VARCHAR(32),
  email VARCHAR(512),
  PRIMARY KEY (snapshot_date, customer_id)
);

-- One row per invoice per day, the invoice's state on the day.
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

-- Written by the SQL derive_cel returns for adapter.json (see README.md), then
-- classify.sql fills expansion_classification from the item history.
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

-- The period spine compile_model and the range checks read: one row per
-- reporting period.
CREATE TABLE gasp.period_spine (
  period_start DATE NOT NULL,
  period_end DATE NOT NULL
);
