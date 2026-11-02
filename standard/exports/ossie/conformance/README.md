# GASP conformance set for Apache Ossie

Generated from the GASP Standard by `npm run conformance` in `gasp-wiki-mcp`. Do not edit; edit `/standard/` or the fixture and re-run.

One case per construct the portable expression language (`OSSIE_SQL_2026`) cannot state yet. The GASP export stages 11 kinds of formula through a per-period dataset whose source is compiled SQL (`coverage.json` beside the Ossie files lists every staged entry and its reason); this directory holds one worked case for each reason, with an executed answer, so a proposal that adds the construct to the language can be tested against it.

## Layout

| Path | Contents |
| --- | --- |
| `data/period_spine.sql` | The schema and the one reporting period (2026-01-01 to 2026-06-30) |
| `data/<dataset>.sql` | One GASP dataset as `CREATE TABLE` + `INSERT`, columns named by GASP field id, rows from the GASP test fixture |
| `cases/<case>/model.ossie.yaml` | A complete Ossie semantic model: the datasets the case reads, the staged dataset and the metric |
| `cases/<case>/reference.postgres.sql` | The staged dataset's source for the period, as a query over `data/` (Postgres dialect) |
| `cases/<case>/expected.sql` | The expected result as a `VALUES` list in standard SQL, in the shape of `compliance/query` upstream |
| `manifest.json` | Every case with its reason, formula, datasets, columns and expected rows |

A case passes when an implementation loads `data/period_spine.sql` and the `data/<dataset>.sql` files the case names, loads `model.ossie.yaml`, evaluates the metric for the period and returns the rows of `expected.sql` (columns by position, exact numerics equal, approximate numerics within a relative 1e-9). `reference.postgres.sql` is the non-normative derivation: run it on Postgres over the same data and it returns `expected.sql`. The test suite does exactly that on PGlite for every case.

## Cases

| Case | Reason | Construct | GASP formula |
| --- | --- | --- | --- |
| `c01_cohort_nrr` | cohort | a cohort fixed at the opening of the period and followed through its events (Net Revenue Retention) | `(metric.mrr at period_start + metric.expansion_mrr - metric.contraction_mrr - metric.churned_mrr) / metric.mrr at period_start over cohort(field.customer_id, period_start)` |
| `c02_lag_mrr_growth_rate` | lag | the same aggregate one period earlier (period-over-period growth) | `(metric.mrr - lag(metric.mrr, 1 month)) / lag(metric.mrr, 1 month)` |
| `c03_at_period_start_logo_churn_rate` | at period_start | a snapshot read at the opening of the period beside events inside it | `metric.churned_customers / metric.total_customers at period_start` |
| `c04_total_ticket_distribution_by_type` | total | a share of the ungrouped total inside a breakdown | `count_distinct(field.ticket_id) / total(metric.ticket_volume)` |
| `c05_period_bound_in_filter_win_rate` | period bound in filter | the reporting period bound to a field other than the dataset's time field (opportunities by close date on a snapshot) | `count(field.opportunity_id where field.opportunity_stage = 'closed_won' and in_period(field.close_date)) / count(field.opportunity_id where field.opportunity_stage in ('closed_won', 'closed_lost') and in_period(field.close_date))` |
| `c06_to_date_ticket_backlog` | to_date | an aggregate cumulative from the start of history to the period end | `count_distinct(field.ticket_id where field.ticket_status in ('open', 'pending')) at period_end` |
| `c07_period_days_uptime` | period_days | the number of days in the reporting period as a value | `1 - sum(field.downtime_minutes) / (period_days * 1440)` |
| `c08_bucket_aging_buckets` | bucket | a dimension defined by ranges over a per-row expression | `sum(field.outstanding_amount) / total(sum(field.outstanding_amount))` |
| `c09_window_dau_mau` | window | trailing windows of different lengths ending at the period end (one day over thirty) | `metric.daily_active_users_dau / metric.monthly_active_users_mau` |
| `c10_distinct_pair_breadth_of_adoption` | distinct pair | a count of distinct tuples (account and feature pairs) | `count_distinct(field.customer_id, field.feature_id) / metric.active_accounts` |
| `c11_all_time_user_retention_day_n` | all_time | an unbounded range beside a bounded one (users who signed up in the period, active any time after) | `all_time(count_distinct(field.user_id where field.product_event_type = 'qualifying' and in_period(field.signup_date) and (field.event_date - field.signup_date) = 30)) / count_distinct(field.user_id where in_period(field.signup_date))` |

## Data

The rows come from the deterministic GASP fixture (`gasp-wiki-mcp/test/fixture/generate.ts`, seed 20260101, about twenty customers over 2026-01-01 to 2026-06-30 with snapshot history from 2025-06-01). A snapshot dataset is sliced to month-end rows where that reproduces the full result; every slice was verified against the full fixture when it was written.

| Dataset | Rows | Slice |
| --- | --- | --- |
| `customer` | 365 | snapshot rows on month starts, month ends and the period bounds shifted back by one, three, six and twelve months |
| `invoice` | 328 | snapshot rows on month starts, month ends and the period bounds shifted back by one, three, six and twelve months |
| `opportunity` | 218 | snapshot rows on month starts, month ends and the period bounds shifted back by one, three, six and twelve months |
| `product_event` | 2977 | rows dated from 2025-12-01 |
| `revenue_event` | 26 | rows dated from 2025-12-01 |
| `service_metrics` | 18 | rows dated from 2025-12-01 |
| `subscription` | 341 | snapshot rows on month starts, month ends and the period bounds shifted back by one, three, six and twelve months |
| `ticket` | 31 | rows dated from 2025-12-01 |
| `user` | 399 | snapshot rows on month starts, month ends and the period bounds shifted back by one, three, six and twelve months |
