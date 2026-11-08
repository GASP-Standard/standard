-- Stripe as it lands in Redshift through Stripe Data Pipeline, and the five
-- tables a company keeps on top of it. Redshift DDL, the input to
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
-- SQL fills from the subscription item snapshots and the usage records (or,
-- for a company that keeps no item snapshots, from the invoices).
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
  recurring_usage_type VARCHAR(16),
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

-- One line per charge on an invoice: a licensed price's charge for the period
-- it pays for (billed in advance), a metered price's charge for the usage of
-- the period just ended (billed in arrears), a proration or a one-off.
CREATE TABLE stripe.invoice_line_items (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  invoice_id VARCHAR(255) NOT NULL REFERENCES stripe.invoices (id),
  subscription_id VARCHAR(255),
  subscription_item_id VARCHAR(255),
  price_id VARCHAR(255) REFERENCES stripe.prices (id),
  period_start TIMESTAMP,
  period_end TIMESTAMP,
  amount BIGINT,
  quantity BIGINT,
  currency CHAR(3),
  proration BOOLEAN,
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

-- One row per invoice per day, the invoice's state on the day, with the
-- service period and the amount of its licensed lines (the recurring charge
-- the GASP invoice derivation reads; null on an invoice with no licensed line).
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
  licensed_period_start DATE,
  licensed_period_end DATE,
  licensed_amount BIGINT,
  PRIMARY KEY (snapshot_date, id)
);

-- One row per metered subscription item per billing period, written when the
-- period's usage is invoiced: the commitment is the MRR of the subscription's
-- licensed items on the period's last day, and the usage is that commitment
-- plus what the metered line billed beyond the included volume. The GASP
-- usage_record dataset.
CREATE TABLE stripe_snapshots.usage_records (
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  subscription_item_id VARCHAR(255) NOT NULL,
  subscription_id VARCHAR(255) NOT NULL,
  customer_id VARCHAR(255) NOT NULL,
  committed_amount BIGINT NOT NULL,
  usage_amount BIGINT NOT NULL,
  currency CHAR(3),
  PRIMARY KEY (period_start, subscription_item_id)
);

-- Kept by the company: Stripe's billing credits ledger. Credit grants and
-- credit balance transactions are Billing API objects (Billing.CreditGrant,
-- Billing.CreditBalanceTransaction, API version 2024-10-28); this example does
-- not assume Data Pipeline lands them, so the nightly job copies each new
-- transaction from the API (List credit balance transactions, per customer)
-- with its grant's category and expiry. Stripe's ledger is immutable and
-- append-only, so the table is too. A transaction is a credit
-- (credits_granted, credits_application_invoice_voided) or a debit
-- (credits_applied, credits_expired, credits_voided); it carries the amount
-- and no running balance. Credits apply to metered prices only.
CREATE TABLE stripe_snapshots.credit_balance_transactions (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  customer_id VARCHAR(255) NOT NULL,
  credit_grant_id VARCHAR(255) NOT NULL,
  effective_at TIMESTAMP NOT NULL,
  type VARCHAR(8) NOT NULL,
  credit_type VARCHAR(48),
  debit_type VARCHAR(48),
  amount BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  grant_category VARCHAR(16) NOT NULL,
  grant_expires_at TIMESTAMP
);

-- Written by the SQL derive_cel returns for adapter.json (see README.md), then
-- classify.sql fills expansion_classification from the item history on the
-- events the derivation left untagged (the usage events arrive tagged).
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
