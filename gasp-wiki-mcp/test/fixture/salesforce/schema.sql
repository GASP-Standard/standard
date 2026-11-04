-- Salesforce as it lands in BigQuery through a Fivetran-style connector, and
-- the snapshot tables a company keeps on top of it. BigQuery DDL, the input to
-- profile_schema. Object and field names are Salesforce's standard ones in the
-- connector's spelling: tables and columns snake_cased (Opportunity.StageName
-- is opportunity.stage_name, Lead.IsConverted is lead.is_converted), the
-- record Id as `id`, lookups with their _id suffix (AccountId is account_id).
-- Picklist values are the ones Salesforce ships; most orgs rename them, which
-- is why every recode sits in the mapping (adapter.json) and not here.
--
-- Salesforce holds the current state of every record. OpportunityHistory and
-- OpportunityFieldHistory keep the stage changes, but the GASP opportunity and
-- lead datasets are snapshots (a row per record per day), so the nightly job
-- copies the state of each object into salesforce_snapshots.* once a day.
-- Campaign is a fact at its start date and reads from the landed table.
--
-- Only the columns the mapping reads are listed; the landed tables carry
-- every field of the object.

-- Landed by the connector (current state, updated on every sync).
CREATE TABLE salesforce.account (
  id STRING NOT NULL,
  name STRING,
  type STRING,
  industry STRING,
  number_of_employees INT64,
  billing_country STRING,
  owner_id STRING,
  created_date TIMESTAMP,
  last_modified_date TIMESTAMP,
  is_deleted BOOL
);

CREATE TABLE salesforce.opportunity (
  id STRING NOT NULL,
  account_id STRING,
  name STRING,
  stage_name STRING NOT NULL,
  amount NUMERIC,
  probability NUMERIC,
  close_date DATE NOT NULL,
  type STRING,
  lead_source STRING,
  forecast_category STRING,
  forecast_category_name STRING,
  is_closed BOOL,
  is_won BOOL,
  campaign_id STRING,
  owner_id STRING,
  created_date TIMESTAMP,
  last_stage_change_date TIMESTAMP,
  last_modified_date TIMESTAMP,
  is_deleted BOOL
);

CREATE TABLE salesforce.opportunity_history (
  id STRING NOT NULL,
  opportunity_id STRING NOT NULL,
  stage_name STRING,
  amount NUMERIC,
  probability NUMERIC,
  close_date DATE,
  forecast_category STRING,
  created_date TIMESTAMP
);

CREATE TABLE salesforce.lead (
  id STRING NOT NULL,
  company STRING,
  status STRING NOT NULL,
  lead_source STRING,
  is_converted BOOL,
  converted_date DATE,
  converted_account_id STRING,
  converted_opportunity_id STRING,
  owner_id STRING,
  created_date TIMESTAMP,
  last_modified_date TIMESTAMP,
  is_deleted BOOL
);

CREATE TABLE salesforce.contract (
  id STRING NOT NULL,
  account_id STRING NOT NULL,
  status STRING,
  start_date DATE,
  end_date DATE,
  contract_term INT64,
  activated_date TIMESTAMP,
  owner_id STRING,
  created_date TIMESTAMP
);

CREATE TABLE salesforce.campaign (
  id STRING NOT NULL,
  name STRING,
  type STRING,
  status STRING,
  start_date DATE,
  end_date DATE,
  budgeted_cost NUMERIC,
  actual_cost NUMERIC,
  expected_revenue NUMERIC,
  is_active BOOL,
  created_date TIMESTAMP
);

-- Kept by the company: the state of each object on the day.
CREATE TABLE salesforce_snapshots.account (
  snapshot_date DATE NOT NULL,
  id STRING NOT NULL,
  type STRING,
  industry STRING,
  number_of_employees INT64,
  owner_id STRING,
  created_date TIMESTAMP
);

CREATE TABLE salesforce_snapshots.opportunity (
  snapshot_date DATE NOT NULL,
  id STRING NOT NULL,
  account_id STRING,
  stage_name STRING NOT NULL,
  amount NUMERIC,
  probability NUMERIC,
  close_date DATE NOT NULL,
  type STRING,
  lead_source STRING,
  forecast_category STRING,
  is_closed BOOL,
  is_won BOOL,
  campaign_id STRING,
  owner_id STRING,
  created_date TIMESTAMP
);

CREATE TABLE salesforce_snapshots.lead (
  snapshot_date DATE NOT NULL,
  id STRING NOT NULL,
  status STRING NOT NULL,
  lead_source STRING,
  is_converted BOOL,
  converted_date DATE,
  converted_opportunity_id STRING,
  created_date TIMESTAMP
);
