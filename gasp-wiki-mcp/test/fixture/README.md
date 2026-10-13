# GASP test fixture

A small synthetic SaaS business that `test/execute.test.ts` loads into an in-process Postgres (PGlite) to run the compiled SQL templates. It is also the seed dataset for drift scoring in the Ossie interop spec.

## Shape

- Window: 2026-01-01 to 2026-06-30. Seed: `SEED = 20260101` (mulberry32).
- 20 customers. Twelve were acquired in 2025 and are active on 2026-01-01 (opening MRR 15,100); eight arrive during the window after a 14-day trial. Some expand, some contract, three churn (c03, c05, c08) and one reactivates (c05). MRR on 2026-06-30 is 24,200.
- 11 datasets, one table each (`TABLES` in `generate.ts`): `customer`, `subscription`, `opportunity`, `lead` and `user` are daily snapshots (a row per key per day, so every date can be a period boundary); `revenue_event`, `cost_event`, `product_event`, `survey_response` and `ticket` are events; `financials` has one row per month.
- Rows carry every ontology field of their dataset. The fields the tested metrics read come from explicit stories (`CUSTOMER_STORIES`, `DEALS`, `MONTHLY_COSTS`, `USERS`); the rest come from the seeded PRNG so every template has data to run on.
- Conventions that keep expected values easy to check by hand: revenue events fall on days 2 to 28; snapshot rows reflect the state at the end of the day; subscription `mrr` is the running sum of revenue-event `mrr_change` (churn and contraction negative); `customer_status` turns `churned` on the churn date; financials `revenue` is the MRR on the first of the month.
- Users follow patterns: daily, weekly (Wednesdays), monthly (the 10th), and a January signup cohort with activity on chosen day offsets for day-30 and week-8 retention.

## Adapter

`adapter.json` (schema 1.1) maps the fixture back to GASP with a table per dataset and one mapping per (field, dataset) pair. Fields on several datasets name their `dataset`. Some shared fields use a different column per table on purpose (`COLUMNS`: `snapshot_date` is `as_of_date` on customers and `snapshot_day` on subscriptions, `customer_id` is `account_ref` on revenue events), so a filler that resolves a placeholder against the wrong dataset fails. Regenerate it after changing `TABLES` or `COLUMNS`:

```bash
npx tsx test/fixture/generate.ts --adapter
```

`execute.test.ts` fails if the file is stale.

## Growing it

- More metrics: add the dataset to `TABLES` (and any renamed columns to `COLUMNS`), generate its rows in `generateFixture()`, regenerate the adapter. Templates whose datasets are all mapped run automatically.
- New hand-checked values: put the behaviour in a story rather than the PRNG, compute the expected value in the test with plain filters over `fixture.tables`, and pin a literal where the shape matters.
- Changing a story changes pinned values in "locks the fixture's shape"; update them deliberately.
