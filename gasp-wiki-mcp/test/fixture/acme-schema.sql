-- Acme SaaS's billing schema as a Snowflake DDL dump, the input to profile_schema.
-- The four tables are the ones acme-adapter.json maps (billing.subscriptions,
-- billing.mrr_movements, billing.customers, billing.invoices) under the same
-- column names, each column on the table of the GASP dataset the adapter
-- resolves it to, so the profile and the proposed mapping can be checked
-- against the adapter. Planted:
-- subscriptions declares a composite PRIMARY KEY; customers declares none and
-- is keyed by name (customer_id with snapshot_date); mrr_movements declares an
-- inline key and REFERENCES; plan_prices has no date column (a reference
-- table) and a VARIANT column (no Ossie datatype); usage_daily has no column
-- named after the table and two key-like columns, so its key is a question.
CREATE TABLE billing.subscriptions (
  subscription_id VARCHAR(32) NOT NULL,
  snapshot_date DATE NOT NULL,
  customer_id VARCHAR(32) NOT NULL,
  plan_code VARCHAR(16),
  mrr_cents NUMBER(18, 0),
  subscription_status VARCHAR(16),
  contract_start DATE,
  contract_end DATE,
  renewal_trigger_date DATE,
  renewal_complete_date DATE,
  renewal_amount NUMBER(18, 2),
  renewed BOOLEAN,
  auto_renewed BOOLEAN,
  renewal_notified_on_time BOOLEAN,
  mrr_start NUMBER(18, 2),
  mrr_end NUMBER(18, 2),
  updated_at TIMESTAMP_NTZ,
  PRIMARY KEY (subscription_id, snapshot_date)
);

CREATE TABLE billing.mrr_movements (
  event_id VARCHAR(32) PRIMARY KEY,
  event_date DATE NOT NULL,
  customer_id VARCHAR(32) NOT NULL REFERENCES billing.customers (customer_id),
  subscription_id VARCHAR(32),
  movement_type VARCHAR(16) NOT NULL,
  mrr_change NUMBER(18, 2) NOT NULL,
  currency CHAR(3),
  change_nature VARCHAR(20),
  expansion_classification VARCHAR(24),
  lifecycle_attribution VARCHAR(24),
  prior_mrr NUMBER(18, 2),
  new_mrr NUMBER(18, 2),
  loaded_at TIMESTAMP_TZ
);

CREATE TABLE billing.customers (
  customer_id VARCHAR(32) NOT NULL,
  snapshot_date DATE NOT NULL,
  customer_status VARCHAR(16),
  segment VARCHAR(16),
  acquisition_date DATE
);

CREATE TABLE billing.invoices (
  invoice_id VARCHAR(32) NOT NULL,
  snapshot_date DATE NOT NULL,
  customer_id VARCHAR(32) NOT NULL,
  invoice_date DATE,
  invoice_amount NUMBER(18, 2),
  outstanding_amount NUMBER(18, 2),
  payment_date DATE,
  payment_method VARCHAR(16),
  payment_status VARCHAR(16),
  currency CHAR(3),
  invoice_corrected BOOLEAN,
  invoice_disputed BOOLEAN,
  billing_trigger_date DATE,
  credit_memo_count INTEGER
);

CREATE TABLE billing.plan_prices (
  plan_code VARCHAR(16) NOT NULL,
  price_cents NUMBER(18, 0),
  price_tiers VARIANT
);

CREATE TABLE analytics.usage_daily (
  account_id VARCHAR(32) NOT NULL,
  workspace_id VARCHAR(32) NOT NULL,
  day DATE NOT NULL,
  active_seats INTEGER,
  api_calls INTEGER
);
