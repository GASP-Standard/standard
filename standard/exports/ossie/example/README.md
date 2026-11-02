# GASP SaaS core: an Apache Ossie example

Generated from the GASP Standard (https://gaspwiki.com) by `npm run derive` in `gasp-wiki-mcp`. Do not edit; edit `/standard/` and re-run.

The Core department of the GASP Standard (Generally Accepted SaaS Principles) as three Apache Ossie (incubating) documents, in the layout of the upstream `examples/flights.*` set: an ontology, a semantic model and the mapping between them. It is the compact form of the full export beside it, cut to the 6 datasets the 40 Core metric entries read, and is the draft of the example GASP proposes to contribute to `apache/ossie/examples/`.

| File | Contents |
| --- | --- |
| `gasp_saas.ontology.yaml` | 6 entity types (one per dataset), their relationships and 46 value types with enum constraints |
| `gasp_saas.semantic_model.yaml` | 6 datasets (revenue_event, cost_event, customer, subscription, survey_response, financials), 5 relationships, 16 staged datasets and 39 metrics |
| `gasp_saas.mapping.yaml` | The ontology mapped onto the model, by name and relative IRI |

Every metric is an `OSSIE_SQL_2026` expression where the language can state it; a metric that needs a cohort, a prior period, an opening snapshot or a period bound on a non-time field is staged through a per-period dataset whose source is the compiled SQL (see `../coverage.json` for the reason per entry and `../conformance/` for one executed case per reason). Physical sources are `gasp.<dataset>` with columns named by GASP field id; an adopter's mapping replaces both.

## Metrics

| Metric | GASP formula |
| --- | --- |
| ARR / MRR | `sum(field.mrr where field.subscription_status = 'active') at period_end` |
| ARR (Annual Recurring Revenue) | `metric.mrr * 12` |
| ARR (Annual Recurring Revenue) (Operating form) | `(metric.mrr - window(sum(field.mrr_change where field.expansion_classification in ('pricing_adjustment', 'recontracting')), 12 month)) * 12 over cohort(field.customer_id, period_end)` |
| ARR (Annual Recurring Revenue) (Market form) | `metric.mrr * 12` |
| ARPA (Average Revenue Per Account) | `metric.mrr / metric.total_customers` |
| Total Customers | `count_distinct(field.customer_id where field.customer_status = 'active') at period_end` |
| New Customers | `count_distinct(field.customer_id where field.event_type = 'new')` |
| Churned Customers | `count_distinct(field.customer_id where field.event_type = 'churn')` |
| MRR Growth Rate | `(metric.mrr - lag(metric.mrr, 1 month)) / lag(metric.mrr, 1 month)` |
| New MRR | `sum(field.mrr_change where field.event_type = 'new')` |
| Expansion MRR | `sum(field.mrr_change where field.event_type = 'expansion')` |
| Churned MRR | `-sum(field.mrr_change where field.event_type = 'churn')` |
| Contraction MRR | `-sum(field.mrr_change where field.event_type = 'contraction')` |
| Reactivation MRR | `sum(field.mrr_change where field.event_type = 'reactivation')` |
| Carry MRR | `metric.mrr at period_start - metric.churned_mrr - metric.contraction_mrr` |
| Net New MRR | `metric.new_mrr + metric.expansion_mrr + metric.reactivation_mrr - metric.churned_mrr - metric.contraction_mrr` |
| Bundle Pricing and MRR Allocation | `An allocation method applied when recording item-level MRR (Item SSP / sum of SSPs x bundle price), not a reported metric.` |
| Net Revenue Retention (NRR) | `(metric.mrr at period_start + metric.expansion_mrr - metric.contraction_mrr - metric.churned_mrr) / metric.mrr at period_start over cohort(field.customer_id, period_start)` |
| Net Revenue Retention (NRR) (Operating form) | `(metric.mrr at period_start + sum(field.mrr_change where field.event_type = 'expansion' and field.expansion_classification in ('same_product', 'usage_realisation')) - metric.contraction_mrr - metric.churned_mrr) / metric.mrr at period_start over cohort(field.customer_id, period_start)` |
| Net Revenue Retention (NRR) (Market form) | `(metric.mrr at period_start + sum(field.mrr_change where field.event_type in ('expansion', 'reactivation') and field.expansion_classification in ('same_product', 'new_module', 'new_buying_centre', 'pricing_adjustment', 'recontracting', 'usage_realisation')) - metric.contraction_mrr - metric.churned_mrr) / metric.mrr at period_start over cohort(field.customer_id, period_start)` |
| Gross Revenue Retention (GRR) | `(metric.mrr at period_start - metric.contraction_mrr - metric.churned_mrr) / metric.mrr at period_start over cohort(field.customer_id, period_start)` |
| Logo Churn Rate (Customer Churn) | `metric.churned_customers / metric.total_customers at period_start` |
| Revenue Churn Rate | `(metric.churned_mrr + metric.contraction_mrr) / metric.mrr at period_start` |
| NPS (Net Promoter Score) | `(count(field.nps_score where field.survey_type = 'customer' and field.nps_score >= 9) - count(field.nps_score where field.survey_type = 'customer' and field.nps_score <= 6)) / count(field.nps_score where field.survey_type = 'customer') * 100` |
| Customer Acquisition Cost (CAC) | `sum(field.cost where field.cost_function = 'gtm') / metric.new_customers` |
| Customer Acquisition Cost (CAC) (Operating form) | `(sum(field.cost where field.cost_function = 'gtm') + sum(field.cost where field.cost_function in ('implementation', 'onboarding'))) / metric.new_customers` |
| Customer Acquisition Cost (CAC) (Market form) | `sum(field.cost where field.cost_function = 'gtm') / metric.new_customers` |
| LTV (Customer Lifetime Value) | `metric.arpa * metric.gross_margin / metric.revenue_churn_rate` |
| LTV (Customer Lifetime Value) (Operating form) | `metric.arpa * metric.gross_margin.O / metric.revenue_churn_rate` |
| LTV (Customer Lifetime Value) (Market form) | `metric.arpa * metric.gross_margin / metric.revenue_churn_rate` |
| LTV:CAC Ratio | `metric.ltv / metric.cac` |
| LTV:CAC Ratio (Operating form) | `metric.ltv.O / metric.cac.O` |
| LTV:CAC Ratio (Market form) | `metric.ltv.M / metric.cac.M` |
| CAC Payback Period | `metric.cac / (metric.arpa * metric.gross_margin)` |
| CAC Payback Period (Operating form) | `metric.cac.O / (metric.arpa * metric.gross_margin.O)` |
| CAC Payback Period (Market form) | `metric.cac.M / (metric.arpa * metric.gross_margin.M)` |
| Gross Margin | `(sum(field.revenue) - sum(field.cost where field.cost_function = 'infrastructure')) / sum(field.revenue)` |
| Gross Margin (Operating form) | `(sum(field.revenue) - sum(field.cost where field.cost_function = 'infrastructure') - sum(field.cost where field.cost_function in ('support', 'success_engineering', 'implementation', 'onboarding'))) / sum(field.revenue)` |
| Gross Margin (Market form) | `(sum(field.revenue) - sum(field.cost where field.cost_function = 'infrastructure')) / sum(field.revenue)` |
| Rule of 40 | `(metric.arr - lag(metric.arr, 1 year)) / lag(metric.arr, 1 year) + metric.ebitda_margin` |

## Running it

`demo/` runs the model on a standard SQL engine. `demo/data.sql` creates the 6 tables under `gasp.<dataset>` with the fixture rows the metrics need, plus `gasp.period_spine` holding the reporting period (2026-01-01 to 2026-06-30); `demo/metrics.sql` returns one row per metric, each direct metric as its expression with every aggregate evaluated over its dataset's rows for the period and each staged metric as its staged dataset's row; `demo/expected.sql` is the result as a VALUES list. On DuckDB, the engine the upstream query compliance suite uses:

```bash
cat demo/data.sql demo/metrics.sql | duckdb
```

or without the CLI, `uv run --with duckdb python -c "import duckdb; c = duckdb.connect(); c.execute(open('demo/data.sql').read()); print(c.sql(open('demo/metrics.sql').read()))"`. The same scripts run on Postgres. The GASP test suite checks the DuckDB result against `expected.sql` on every build, and the expected values against the GASP compiled SQL on the full fixture.

## Validating

From a clone of apache/ossie, with the three files in one directory:

```bash
uv run validation/validate.py gasp_saas.semantic_model.yaml
uv run validation/validate.py gasp_saas.ontology.yaml --schema ontology/ontology.json
uv run validation/validate.py gasp_saas.mapping.yaml --schema ontology/mapping.json
```

The GASP test suite runs the same three commands on every build.
