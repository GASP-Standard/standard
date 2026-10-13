# GASP test fixture

A small synthetic SaaS business. `test/fixture-db.ts` loads it into an in-process Postgres (PGlite), where `test/execute.test.ts` runs the compiled SQL templates and `test/ossie-model.test.ts` runs the Ossie expressions and staged sources over `gasp.<dataset>` views of the same rows. It is also the seed dataset for drift scoring in the Ossie interop spec.

## Shape

- Window: 2026-01-01 to 2026-06-30. Seed: `SEED = 20260101` (mulberry32). Customer, subscription and opportunity snapshots reach back to 2025-06-01 so a one-year lag from June 2026 has rows.
- 20 customers. Twelve were acquired in 2025 and are active on 2026-01-01 (opening MRR 15,100); eight arrive during the window after a 14-day trial. Some expand, some contract, three churn (c03, c05, c08) and one reactivates (c05). MRR on 2026-06-30 is 24,200.
- c21 (`PRIOR_CUSTOMERS`) was active on 2025-06-30 and churned in November 2025, so lagged ARR has a value without moving the 2026 totals.
- Every ontology dataset, one table each (`TABLES` in `generate.ts`). `lifecycle_event` holds one Lifecycle_State_Change row per customer status transition in the revenue stories. Snapshot datasets have a row per key per day, so every date can be a period boundary; event datasets a row per event; fact datasets a row per key per month.
- Rows carry every ontology field of their dataset. The fields the tested metrics read come from explicit stories (`CUSTOMER_STORIES`, `DEALS`, `DEAL_TAGS`, `EXTRA_DEALS`, `RENEWALS`, `MONTHLY_COSTS`, `EXTRA_MONTHLY_COSTS`, `SERVICES_REVENUE`, `USERS`, `PROJECT_STORIES`, `PARTNER_STORIES`, `INCIDENTS`, plus the employee, requisition, time entry, onboarding and invoice loops); the rest come from the seeded PRNG so every template has data to run on. Foreign keys the PRNG fills (`partner_id`, `project_id` and so on) draw from the real ids. A post-pass sets `segment` from `customer_id` on the five datasets that carry it (`segmentOf()`: c01 smb, c02 mid_market, c03 enterprise and so on), so it draws nothing from the PRNG.
- Two PRNG streams: the first eleven datasets draw from `SEED`, everything added later (`generateExtensions()`) from `SEED + 1`, so growing the fixture does not reshuffle the original rows. Keep it that way: add new rows in `generateExtensions()`.
- Conventions that keep expected values easy to check by hand: revenue events fall on days 2 to 28; snapshot rows reflect the state at the end of the day; subscription `mrr` is the running sum of revenue-event `mrr_change` (churn and contraction negative); `customer_status` turns `churned` on the churn date; financials `revenue` is the MRR on the first of the month.
- Users follow patterns: daily, weekly (Wednesdays), monthly (the 10th) and a January signup cohort with activity on chosen day offsets for day-30 and week-8 retention. u29 is dormant until a reactivation event on 2026-06-17; u30 signs up on 2026-06-08 and is active only after the window, so June DAU, WAU and MAU are unchanged.
- June 2026 has something for every metric: three contracts end (c08 lapses, c11 renews by hand, c12 auto-renews), o08 is a partner-sourced win (p02), o07 a marketing-sourced win from paid ads, o15 a lost services deal, three projects complete, two incidents (one security), two employees leave, partner p09 churns.
- `execute.test.ts` runs every fully mapped template for June 2026 and fails if any returns NULL, so a new metric whose rows are missing fails until the fixture covers it.

## Adapter

`adapter.json` (schema 1.1) maps the fixture back to GASP with a table per dataset and one mapping per (field, dataset) pair. Fields on several datasets name their `dataset`. Some shared fields use a different column per table on purpose (`COLUMNS` has the full list; for example `snapshot_date` is `as_of_date` on customers, `snapshot_day` on subscriptions, `as_at` on employees and partners, `snap_date` on projects and onboardings and `as_of` on licenses and contacts; `customer_id` is `account_ref` on revenue events and `client_ref` on projects; `close_date` is `deal_closed_on` on projects and `closed_on` on deal registrations; `hours` is `hours_logged` on time entries), so a filler that resolves a placeholder against the wrong dataset fails. Regenerate it after changing `TABLES` or `COLUMNS`:

```bash
npx tsx test/fixture/generate.ts --adapter
```

`execute.test.ts` fails if the file is stale.

## Growing it

- A new ontology dataset: add it to `TABLES` (and any renamed columns to `COLUMNS`), generate its rows in `generateExtensions()` and regenerate the adapter. Templates whose datasets are all mapped run automatically.
- New hand-checked values: put the behaviour in a story rather than the PRNG, compute the expected value in the test with plain filters over `fixture.tables` and pin a literal where the shape matters.
- Changing a story changes pinned values in "locks the fixture's shape"; update them deliberately.
