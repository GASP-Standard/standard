# GASP conformance set for Apache Ossie

Generated from the GASP Standard by `npm run conformance` in `gasp-wiki-mcp`. Do not edit; edit `/standard/` or the fixture and re-run.

This directory holds two groups of case.

11 cases cover the constructs the portable expression language (`OSSIE_SQL_2026`) cannot state yet. The GASP export stages 11 kinds of formula through a dataset whose source is compiled SQL, one row per period holding the value or, for the retention metrics over a cohort of customers, one row per customer per period that the expression sums (`coverage.json` beside the Ossie files lists every staged entry and its reason); there is one worked case for each reason, with an executed answer, so a proposal that adds the construct to the language can be tested against it.

4 cases cover which rows of a snapshot dataset a reporting period reads. A snapshot dataset holds one row per entity per `snapshot_date`. 3 of them take a direct expression whose GASP formula ends `at period_end`, which the Ossie expression has no place to say. The expression validates and runs, and a query that sums it across dates returns a number with no error. 1 takes the opening value of a period that begins on the day a customer starts, where the snapshot dated on the first day and the last snapshot before it differ. On the calendar months of the fixture those two agree. Each of these cases carries the expected value and the value every other listed reading returns (Grading, below).

## Layout

| Path | Contents |
| --- | --- |
| `data/period_spine.sql` | The schema and the reporting periods the staged sources compute for (2026-01-01 to 2026-06-30; 2026-02-09 to 2026-03-08) |
| `data/<dataset>.sql` | One GASP dataset as `CREATE TABLE` + `INSERT`, columns named by GASP field id, rows from the GASP test fixture |
| `cases/<case>/model.ossie.yaml` | A complete Ossie semantic model: the datasets the case reads, the staged dataset where the case has one and the metric, declared under the dataset it reads |
| `cases/<case>/reference.postgres.sql` | The staged dataset's source read for the period, or the direct expression read on the period's last snapshot date, as a query over `data/` (Postgres dialect) |
| `cases/<case>/expected.sql` | The expected result as a `VALUES` list in standard SQL |
| `cases/<case>/readings.sql` | On the cases listed under Grading: one row per named mistake or alternative reading with the value it returns (Postgres dialect) |
| `manifest.json` | Every case with its reason, formula, period, datasets, columns, expected rows and readings |

A case passes when an implementation loads `data/period_spine.sql` and the `data/<dataset>.sql` files the case names, loads `model.ossie.yaml`, evaluates the metric for the case's period and returns the rows of `expected.sql` (columns by position, exact numerics equal, approximate numerics within a relative 1e-9). `reference.postgres.sql` is the non-normative derivation: run it on Postgres over the same data and it returns `expected.sql`. The test suite does exactly that on PGlite for every case.

## Cases

| Case | Reason | Period | Construct | GASP formula |
| --- | --- | --- | --- | --- |
| `c01_cohort_nrr` | cohort | 2026-01-01 to 2026-06-30 | a cohort fixed at the opening of the period and followed through its events (Net Revenue Retention) | `(metric.mrr at period_start + metric.expansion_mrr - metric.contraction_mrr - metric.churned_mrr) / metric.mrr at period_start over cohort(field.customer_id, period_start)` |
| `c02_lag_mrr_growth_rate` | lag | 2026-01-01 to 2026-06-30 | the same aggregate one period earlier (period-over-period growth) | `(metric.mrr - lag(metric.mrr, 1 month)) / lag(metric.mrr, 1 month)` |
| `c03_at_period_start_logo_churn_rate` | at period_start | 2026-01-01 to 2026-06-30 | a snapshot read at the opening of the period beside events inside it | `metric.churned_customers / metric.total_customers at period_start over cohort(field.customer_id, period_start)` |
| `c04_total_ticket_distribution_by_type` | total | 2026-01-01 to 2026-06-30 | a share of the ungrouped total inside a breakdown | `count_distinct(field.ticket_id) / total(metric.ticket_volume)` |
| `c05_period_bound_in_filter_win_rate` | period bound in filter | 2026-01-01 to 2026-06-30 | the reporting period bound to a field other than the dataset's time field (opportunities by close date on a snapshot) | `count(field.opportunity_id where field.opportunity_stage = 'closed_won' and in_period(field.close_date)) / count(field.opportunity_id where field.opportunity_stage in ('closed_won', 'closed_lost') and in_period(field.close_date))` |
| `c06_to_date_ticket_backlog` | to_date | 2026-01-01 to 2026-06-30 | an aggregate cumulative from the start of history to the period end | `count_distinct(field.ticket_id where field.ticket_status in ('open', 'pending')) at period_end` |
| `c07_period_days_uptime` | period_days | 2026-01-01 to 2026-06-30 | the number of days in the reporting period as a value | `1 - sum(field.downtime_minutes) / (period_days * 1440)` |
| `c08_bucket_aging_buckets` | bucket | 2026-01-01 to 2026-06-30 | a dimension defined by ranges over a per-row expression | `sum(field.outstanding_amount) / total(sum(field.outstanding_amount))` |
| `c09_window_dau_mau` | window | 2026-01-01 to 2026-06-30 | trailing windows of different lengths ending at the period end (one day over thirty) | `metric.daily_active_users_dau / metric.monthly_active_users_mau` |
| `c10_distinct_pair_breadth_of_adoption` | distinct pair | 2026-01-01 to 2026-06-30 | a count of distinct tuples (account and feature pairs) | `count_distinct(field.customer_id, field.feature_id) / metric.active_accounts` |
| `c11_all_time_user_retention_day_n` | all_time | 2026-01-01 to 2026-06-30 | an unbounded range beside a bounded one (users who signed up in the period, active any time after) | `all_time(count_distinct(field.user_id where field.product_event_type = 'qualifying' and in_period(field.signup_date) and (field.event_date - field.signup_date) = 30)) / count_distinct(field.user_id where in_period(field.signup_date))` |
| `c12_snapshot_mrr_month` | snapshot | 2026-06-01 to 2026-06-30 | a sum over a snapshot dataset for a month, read on the last snapshot date of the month | `sum(field.mrr where field.subscription_status = 'active') at period_end` |
| `c13_snapshot_mrr_quarter` | snapshot | 2026-04-01 to 2026-06-30 | a sum over a snapshot dataset for a quarter, read on the last snapshot date of the quarter | `sum(field.mrr where field.subscription_status = 'active') at period_end` |
| `c14_snapshot_total_customers_month` | snapshot | 2026-06-01 to 2026-06-30 | a distinct count over a snapshot dataset for a month, read on the last snapshot date of the month | `count_distinct(field.customer_id where field.customer_status = 'active') at period_end` |
| `c15_at_period_start_logo_churn_rate_four_weeks` | at period_start | 2026-02-09 to 2026-03-08 | the opening value of a period that begins on the day a customer starts, read from the snapshot dated on the first day of the period | `metric.churned_customers / metric.total_customers at period_start over cohort(field.customer_id, period_start)` |

## Grading

A result has one of four grades.

| Grade | Result |
| --- | --- |
| right | The rows of `expected.sql`. |
| alternative | A value listed with grade `alternative`: a reading other tools take and GASP does not. Report it by name. |
| wrong | Any other value. When it equals a value listed with grade `wrong`, the mistake is the one named there. |
| failed | No value: the implementation rejects the model or the query, or the query errors. |

Failed is kept apart from wrong because every wrong value listed here comes from a query that runs without an error or a warning. An implementation that refuses a query it cannot evaluate over a snapshot has returned no wrong number.

The values below were computed by running each reading on the data, as `readings.sql` in the case directory does. A wrong value that is not listed is still wrong.

| Case | Grade | Reading | Value | What the query did |
| --- | --- | --- | --- | --- |
| `c03_at_period_start_logo_churn_rate` | right | | 0.25 | a snapshot read at the opening of the period beside events inside it |
| | wrong | `closing_value` | 0.166666666667 | the customers active on the last day of the period as the denominator, where the formula reads the first day |
| `c05_period_bound_in_filter_win_rate` | right | | 0.5 | the reporting period bound to a field other than the dataset's time field (opportunities by close date on a snapshot) |
| | wrong | `period_on_snapshot_date_only` | 0.526315789474 | the opportunities as they stand at the period end with no bound on the close date, so the period reaches the dataset's time field alone and every deal ever closed is counted |
| `c12_snapshot_mrr_month` | right | | 24200 | a sum over a snapshot dataset for a month, read on the last snapshot date of the month |
| | wrong | `summed_over_every_date` | 695900 | the sum taken over every snapshot date in the period, so each subscription is added once per day |
| | wrong | `opening_value` | 21800 | the sum on the first snapshot date of the period, where the formula reads the last |
| `c13_snapshot_mrr_quarter` | right | | 24200 | a sum over a snapshot dataset for a quarter, read on the last snapshot date of the quarter |
| | wrong | `month_ends_summed` | 64800 | the closing value of each month in the period added together, where the formula reads the closing value of the last |
| | wrong | `opening_value` | 18400 | the sum on the first snapshot date of the period, where the formula reads the last |
| `c14_snapshot_total_customers_month` | right | | 18 | a distinct count over a snapshot dataset for a month, read on the last snapshot date of the month |
| | wrong | `distinct_over_every_date` | 19 | the distinct count taken over every snapshot date in the period, so a customer active on any day of it is counted, one who left before the last day included |
| | wrong | `rows_over_every_date` | 525 | the active rows on every snapshot date in the period counted without DISTINCT, which gives customer days |
| | wrong | `opening_value` | 16 | the count on the first snapshot date of the period, where the formula reads the last |
| `c15_at_period_start_logo_churn_rate_four_weeks` | right | | 0.0714285714286 | the opening value of a period that begins on the day a customer starts, read from the snapshot dated on the first day of the period |
| | alternative | `prior_period_close` | 0.0769230769231 | the opening value read from the last snapshot date before the period (the prior period's close), which leaves out the customer who starts on the first day |

## Data

The rows come from the deterministic GASP fixture (`gasp-wiki-mcp/test/fixture/generate.ts`, seed 20260101, about twenty customers over 2026-01-01 to 2026-06-30 with snapshot history from 2025-06-01). A snapshot dataset is sliced to month-end rows where that reproduces the full result, plus the bounds of a period off the calendar month and every date of a period a listed reading sums across; every slice was verified against the full fixture when it was written, the expected rows and the reading values alike.

| Dataset | Rows | Slice |
| --- | --- | --- |
| `customer` | 999 | snapshot rows on month starts, month ends and the period bounds shifted back by one, three, six and twelve months; on 2026-02-08, 2026-02-09, 2026-03-08, which a case off the calendar month reads; on every date from 2026-06-01 to 2026-06-30, which a listed reading sums across |
| `invoice` | 328 | snapshot rows on month starts, month ends and the period bounds shifted back by one, three, six and twelve months |
| `opportunity` | 218 | snapshot rows on month starts, month ends and the period bounds shifted back by one, three, six and twelve months |
| `product_event` | 2977 | rows dated from 2025-12-01 |
| `revenue_event` | 26 | rows dated from 2025-12-01 |
| `service_metrics` | 18 | rows dated from 2025-12-01 |
| `subscription` | 914 | snapshot rows on month starts, month ends and the period bounds shifted back by one, three, six and twelve months; on every date from 2026-06-01 to 2026-06-30, which a listed reading sums across |
| `ticket` | 31 | rows dated from 2025-12-01 |
| `user` | 399 | snapshot rows on month starts, month ends and the period bounds shifted back by one, three, six and twelve months |
