# GASP accuracy benchmark, 2026-11-07

24 questions, one per Core metric with a canonical formula, each "What was <metric> for March 2026?" over the GASP synthetic SaaS warehouse (53 tables, PGlite). Ground truth: the canonical compiled SQL on the same data, which the test suite pins. A run is correct when its SQL returns one row and one column within 1e-6 relative of the truth. 5 runs per question per condition per model, effort medium, adaptive thinking, no fallbacks.

| Model | Condition | Correct | Scaled by 100 | Wrong value | Null | SQL error | Other |
|---|---|---|---|---|---|---|---|
| gasp-standard-mcp | layer | **100.0%** (24/24) | 0 | 0 | 0 | 0 | 0 |
| claude-sonnet-5-5 | raw | **56.7%** (68/120) | 0 | 36 | 13 | 3 | 0 |
| claude-sonnet-5-5 | gasp | **95.8%** (115/120) | 0 | 5 | 0 | 0 | 0 |
| claude-opus-5-5 | raw | **70.0%** (84/120) | 0 | 24 | 12 | 0 | 0 |
| claude-opus-5-5 | gasp | **100.0%** (120/120) | 0 | 0 | 0 | 0 | 0 |

## Per metric

| Metric | Truth | gasp-standard-mcp layer | claude-sonnet-5-5 raw | claude-sonnet-5-5 gasp | claude-opus-5-5 raw | claude-opus-5-5 gasp |
|---|---|---|---|---|---|---|
| MRR (Monthly Recurring Revenue) | 18400 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| ARR (Annual Recurring Revenue) | 220800 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| ARPA (Average Revenue Per Account) | 1226.6666666666667 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| MRR Growth Rate | 0.10843373493975904 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| New MRR | 2100 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Expansion MRR | 100 | 100.0% | 20.0% | 100.0% | 100.0% | 100.0% |
| Churned MRR | 0 | 100.0% | 80.0% | 100.0% | 100.0% | 100.0% |
| Contraction MRR | 400 | 100.0% | 40.0% | 100.0% | 100.0% | 100.0% |
| Reactivation MRR | 0 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Carry MRR | 16200 | 100.0% | 0.0% | 100.0% | 0.0% | 100.0% |
| Net New MRR | 1800 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Total Customers | 15 | 100.0% | 60.0% | 100.0% | 100.0% | 100.0% |
| New Customers | 2 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Churned Customers | 0 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Net Revenue Retention (NRR) | 0.9819277108433735 | 100.0% | 0.0% | 100.0% | 100.0% | 100.0% |
| Gross Revenue Retention (GRR) | 0.9759036144578314 | 100.0% | 80.0% | 100.0% | 100.0% | 100.0% |
| Logo Churn Rate (Customer Churn) | 0 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Revenue Churn Rate | 0.024096385542168676 | 100.0% | 80.0% | 100.0% | 80.0% | 100.0% |
| NPS (Net Promoter Score) | -25 | 100.0% | 0.0% | 100.0% | 0.0% | 100.0% |
| CAC (Customer Acquisition Cost) | 3000 | 100.0% | 0.0% | 100.0% | 0.0% | 100.0% |
| LTV (Customer Lifetime Value) | 47870.948012232424 | 100.0% | 0.0% | 100.0% | 0.0% | 100.0% |
| LTV:CAC Ratio | 15.956982670744141 | 100.0% | 0.0% | 100.0% | 0.0% | 100.0% |
| CAC Payback Period | 2.600742311770943 | 100.0% | 0.0% | 0.0% | 0.0% | 100.0% |
| Gross Margin | 0.9403669724770642 | 100.0% | 0.0% | 100.0% | 0.0% | 100.0% |

## Cost

480 model calls, 338,380 input tokens of which 3,072,106 read from cache, 252,490 output tokens.

## Method

Conditions: `raw` is the CREATE TABLE statements and the question, the text-to-SQL baseline; `gasp` adds the GASP definition of the metric (the formula in the standard's grammar, how to read the grammar, the fields and the table and column each maps to), the semantic layer as context; `layer` is the compiled SQL the GASP tools return for the question, run as is. The same system prompt in every model condition states the period convention, that ratios are decimals and how snapshot tables are read. SQL that is not a single SELECT is refused unrun. Every answer, its SQL and its category are in the JSON beside this file.
