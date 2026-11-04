# Salesforce worked example

A company that runs sales in Salesforce, lands the objects in BigQuery through a Fivetran-style connector and wants the GASP pipeline and funnel metrics over them. Written from Salesforce's public object reference; nothing here was checked against an org, and no Salesforce name enters the standard or the code (`DECISIONS.md`, 2026-11-03). It is a worked example beside Acme and a readiness fixture: `test/vendor-fixtures.test.ts` validates it, compiles its metrics and checks in BigQuery and reads its readiness level, which is 2. A CRM alone maps no revenue event, so the example stops there on purpose: the billing system has to join it before the Core metrics and level 3 are in reach.

## Files

| File | What it is |
|---|---|
| `schema.sql` | BigQuery DDL: the landed objects (`salesforce.*`: Account, Opportunity, OpportunityHistory, Lead, Contract, Campaign, the columns used) and the three nightly snapshot tables (`salesforce_snapshots.*`). The input to `profile_schema`. |
| `adapter.json` | The GASP mapping (adapter v1.1, warehouse `bigquery`): `opportunity`, `lead` and `customer` over the snapshots, `campaign` over the landed table. Every picklist is recoded by a transform. |

There is no sample data: the test compiles rather than runs, and BigQuery SQL does not run on the Postgres engine the suite uses.

## What Salesforce gives you and what it does not

Salesforce holds the current state of every record and keeps the stage changes of an opportunity in OpportunityHistory. The GASP `opportunity` and `lead` datasets are snapshots, a row per record per day, so the company copies the state of each object nightly into `salesforce_snapshots.*`; the campaign is a fact at its start date and reads from the landed table.

The mapping's recodes, each from Salesforce's shipped picklist values, which most orgs rename:

- **Stage.** The default sales process (Prospecting to Closed Lost) onto GASP's six stages. An org with its own stages replaces the `CASE`; the test of a good recode is that every stage lands on one GASP value and nothing lands on `NULL`.
- **Forecast category.** `BestCase` is `best_case`; `Omitted` has no GASP value, since an omitted opportunity is out of the forecast.
- **Probability** is stored as a percentage and divided by 100.
- **Lead source** feeds three fields: `channel` (Web is organic search, Advertisement is paid ads, Trade Show is events, the referral sources are referral), `marketing_source` (marketing, sales or partner) and `partner_sourced` (true for Partner Referral). `marketing_influenced` reads the primary campaign source; CampaignInfluence would give every touch.
- **Lead status.** Open is `lead`, Working is `mql`, Closed - Converted is `opportunity`, Closed - Not Converted is `disqualified`. The default statuses have no SQL step and no MQL or SQL dates; an org that qualifies leads in two stages adds its own status and the custom date fields, which are left unmapped here.
- **Customer.** The Account is the customer. Its Type says who is a customer (`Customer - Direct` and `Customer - Channel` are `active`, `Prospect` is `trial`) but not who has churned; the billing system's customer snapshot replaces this mapping once it is joined. The segment comes from `NumberOfEmployees` (under 100 is smb, under 1,000 is mid-market), and the creation date stands in for the acquisition date.
- **Campaign.** `ActualCost` is the ad spend, booked to the period the campaign starts in; the Type picklist is recoded to the GASP channel.
- **Contract** is in the DDL and not in the mapping: the GASP `contract_event` carries ACV and TCV, which Salesforce's Contract lacks. The profiler sees the table; the mapping leaves it for the Decide step.

## What the test shows

1. `validate_mapping`: the adapter passes the schema and covers 19 metrics fully, among them Win Rate, Pipeline Value, Average Deal Size, Lead-to-Opportunity Rate and Sales Cycle Length.
2. `generate_query`: Win Rate and Pipeline Value compile in BigQuery with every field mapped and none of the Postgres-only constructs the dialect table forbids.
3. `generate_checks`: the checks compile in BigQuery (freshness per dataset with `DATE_DIFF`); nothing reads a revenue event, so the CEL and ATL checks do not apply.
4. `profile_schema` reads the DDL to nine tables with no question, and `propose_mapping` lists the opportunity and lead snapshots, and Contract as a `contract_event`, as candidates for the Decide step: snake-cased Salesforce columns share few names with the GASP fields, so a person accepts the tables and the recodes above do the rest.
5. `readiness_report`: level 2, and the first thing level 3 needs is the `revenue_event` dataset, which the billing system supplies (the Stripe example beside this one shows how).

The object and field names come from the Salesforce Object Reference (https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/) for Account, Opportunity, OpportunityHistory, Lead, Contract and Campaign, in the snake_case spelling a connector lands them in.
