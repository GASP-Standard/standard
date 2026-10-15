# Changelog

Changes to the GASP Standard and to the `gasp-standard-mcp` package, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package follows [semver](https://semver.org/). Changes to the standard's content are listed under the package version that first shipped them, since the package bundles the standard. `DECISIONS.md` has the reasoning behind each rule.

## [1.16.0] - 2026-10-15

### Added
- Five metrics (306 in all). Core: Reactivation MRR (`reactivation_mrr`, the CEL `reactivation` event as the fifth MRR movement), Total Customers (`total_customers`), New Customers (`new_customers`) and Churned Customers (`churned_customers`), each with a `by_segment` breakdown. Product: Trial-to-Paid Conversion Rate (`trial_to_paid_conversion_rate`), counting trials by the date they ended, with a `by_start_date` variant. All five are graph nodes with access classifications; New Customers drives New MRR, Churned Customers drives Churned MRR and Trial-to-Paid drives New Customers.
- A `trial` dataset with `trial_id`, `trial_start_date`, `trial_end_date` and `trial_status` (active, converted, expired, cancelled); `customer_id` sits on it (268 fields, 52 datasets). A Trial glossary entry (94 definitions).
- A curated `marketing_cac drives cac` edge in `relationships.json`. `infer_drivers` on CAC now names Marketing CAC, and the TWIN Modifier walks the graph edge in place of its own. 100 nodes, 200 edges.

### Changed
- Net New MRR is `new + expansion + reactivation - churned - contraction`. The formula had left reactivation out, so carry MRR plus the movements only reached ending MRR when reactivation was zero; the definition ("after accounting for all movements") already said what the formula now computes. Under `GOVERNANCE.md` a changed numerator is a breaking change: an implementation that followed the old formula now reports a different number when it has reactivation events. `DECISIONS.md` for 2026-10-14 has the reasoning.
- ARPA divides by `metric.total_customers`, CAC (base, O and M forms) by `metric.new_customers` and Logo Churn Rate is `metric.churned_customers / metric.total_customers at period_start`. Every number is unchanged; the graph gains the component edges the formulas implied. The temporal semantic for the movements is "Revenue Components (New, Expansion, Reactivation, Contraction, Churn)", and the counts carry "Customer Count" and "Customer Movements (New, Churned)".
- The fixture has a trial table (one converted trial per customer, six lost trials) and the execute test pins the five new metrics and the Net New MRR reconciliation for June 2026 (25 pinned metrics).

## [1.15.0] - 2026-10-14

### Changed
- Four metrics are renamed so that every metric in the standard has a name of its own. Support's Escalation Rate is Ticket Escalation Rate (`ticket_escalation_rate`), Professional Services' Escalation Rate is Project Escalation Rate (`project_escalation_rate`), Professional Services' Milestone Completion Rate is Project Milestone Completion Rate (`project_milestone_completion_rate`) and Onboarding's Milestone Completion Rate is Onboarding Milestone Completion Rate (its id `onboarding_milestone_completion_rate` is unchanged). Definitions, formulas and populations are as they were. The old page URLs redirect to the new pages. This is a breaking change to the canon under `GOVERNANCE.md` (a slug and three formula ids change); the reasoning is in `DECISIONS.md` for 2026-10-14. An adapter or query that names one of the old ids needs the new one.
- The escalation benchmarks in `validationRules` were keyed by the shared slug and so applied to both Escalation Rate metrics; they now apply to Ticket Escalation Rate only.
- "Escalation Rate" and "Milestone Completion Rate" no longer return candidates from `lookup_metric`: each resolves by close-name suggestion to the two qualified names. "Activation Rate" and "Error Rate" still return candidates, because Product's "Error Rate (User-Facing)" and Onboarding's "Onboarding-to-Active Rate (Activation Rate)" carry those names as qualifiers.

## [1.14.2] - 2026-10-14

### Changed
- Every tool description, argument description and fixed reply was checked against what the tool does and rewritten where it was wrong, stale or understated: the exact-match rules and the candidates reply in `lookup_metric`, the breakdown kinds and the not-computable reason in `get_formula`, the lowercase edge types `get_relationships` actually emits (it never printed `COMPONENT_OF`), the four modes of `get_data_requirements`, the whole-word matcher and ranking in `search`, the inclusive period dates in `generate_query`, the full check list in `validate_adapter`, the baseline-input stop and direction flips in `infer_drivers` and `explain_path`, and the definitions behind `coverage_gap`. The README tool table matches.
- `get_relationships` prints the page URL of the node and of every neighbour (metric nodes to their metric page, entities and concepts to their glossary page), so no tool names a metric without its URL.
- `list_metrics` counts a metric cross-referenced from another department once (NRR under Core and Customer Success is one metric, two listings).
- A glossary term passed to `get_formula`, `get_data_requirements` or `generate_query` is named as one with a pointer to `lookup_definition` instead of a "Did you mean" dead end. A graph name with no close match says to use `search` and `lookup_metric` instead of stopping at "No graph node is named".
- `coverage_gap` says why an input was unresolved (no match, an entity, outside the graph); `explain_path` explains what the end direction means and what to try when no path is found; entities and concepts in `get_relationships` get entity wording rather than "leaf metric".

## [1.14.1] - 2026-10-14

### Changed
- Tool descriptions and output headers use colons in place of em dashes (`# NRR: relationships`, `# Coverage gap: 3 metrics`, `## Path 1: 4 steps`), as does the Cypher export header.
- The Operational signal type description drops its Oxford comma (`taxonomy.json`).
- The "Key metrics at this level" lines in `definitions.md` name the standard's own metrics (Logo Churn Rate, License Utilization, Revenue Churn Rate) in place of informal names.
- `overview.md` lists the CEL, ATL, signal type taxonomy, `formulas.json` and `ontology.json` among the standard's documents, describes the formulas as a compiled grammar with declared breakdowns, and tells adopters to document a local variant beside the canonical formula and record the data difference in the adapter's field `transform` and `notes`. `relationships.md` writes LTV over Revenue Churn Rate and gains a "Reading the Map" section on edge types, the no-two-way-edges rule and why baseline inputs end driver traversal.

## [1.14.0] - 2026-10-13

Includes everything listed under 1.13.0, which was prepared but not published.

### Added
- Accounts Receivable Balance (RevOps): outstanding amounts on open invoices at period end, with a breakdown by payment status. The standard has 301 metrics.
- Compiler dialects. `generate_query` and `get_data_requirements` take `dialect` (`postgres`, which also covers Redshift, `snowflake`, `bigquery` or `databricks`). `generate_query` picks it from the adapter's `warehouse` when you leave it out and says which one it used.
- The Apache Ossie export carries staged sources in all four dialects.
- Breakdowns can reach a label through a key: MRR by plan returns plan names and License Utilization by product returns product names, with the id beside each.
- Bucketed breakdowns over a computed expression. Aging Buckets is one breakdown over invoice age with four buckets, replacing four variant formulas.
- `get_data_requirements` takes a `breakdown` argument, like `generate_query`.
- `segment` is a dimension field on revenue, contract and amendment events and on the customer and subscription snapshots. MRR, ARR, NRR, GRR, logo and revenue churn, the four MRR movements, ARPA and the health metrics break down by segment.
- Share-of-total breakdowns can be declared (`{ "field": ..., "total": true }`): CAC and Opex Ratio by cost centre.
- New breakdowns by payment status (Billings, Billing Disputes) and lead stage (Leads). 40 named breakdowns in all.
- `application_date` on the employee snapshot, read by Time to Hire (application to start). `marketplace` is a `channel` value, read by Marketplace Revenue.
- `GOVERNANCE.md`, `CONTRIBUTING.md` and this changelog in the public repository.

### Changed
- Headcount by Department is retired as a page. Total Headcount carries the department breakdown and the old URL redirects to it.
- The `tier` field is retired. Use `plan_id` for pricing tier and `segment` for customer segment.
- The prose of about forty metrics now matches its canonical formula where the two had drifted (populations, periods, bases), and the framework documents say which events carry `expansion_classification` (expansion, contraction and reactivation) and that the canonical CAC, ARR, LTV, LTV:CAC, CAC Payback and Gross Margin equal their Market forms.

### Fixed
- Period filters on timestamp columns dropped rows dated on the last day of the period after midnight, in every dialect. The upper bound is now the start of the following day. Mean Time to Resolve (MTTR) and incident counts on the test fixture moved as a result.

## [1.13.0] - Unreleased (ships in 1.14.0)

### Added
- License Utilization (Customer Success): seats assigned over seats purchased on active licences, with a breakdown by product.
- Contact, plan, product and licence datasets. Contact Coverage and Executive Sponsor Coverage count engaged contacts from the contact table.
- Health Score is computable as the portfolio average of the customer success platform's composite score. `customer-success.md` publishes a reference weighting as a starting point.
- Named breakdowns on a formula entry, plus the grammar functions `count_distinct(a, b)` for distinct pairs and `total(expr)` for shares of a whole. CAC by Channel, Ticket Distribution by Type, Source of Hire, Payment Method Distribution and Partner Tier Distribution are computable. `generate_query` takes a `breakdown` name.
- LTV:CAC and CAC Payback carry Operating and Market forms. `get_formula` prints the enum filters each form applies.
- `validate_adapter` applies the bundled adapter JSON Schema and flags fields mapped to a dataset that does not carry them.
- Entity nodes list every metric whose formula reads their datasets.

### Changed
- Thirteen datasets promoted to entities: 28 entities, 95 graph nodes.
- `channel` and `marketing_channel` are one field. `registration_stage` is folded into `opportunity_stage`.
- `infer_drivers` and `explain_path` stop at baseline inputs (a metric read at period start or lagged), so NRR no longer lists new business among its drivers. Edges from a lower-is-better metric are typed `reduces`.
- An ambiguous name returns the candidates. Search matches whole words, returns one result per metric and offers "Did you mean" when nothing matches.
- Adapters that mapped `engaged_contact_count` or `has_exec_sponsor` get "unknown field" and should map a contact table.

### Fixed
- Canon corrections from the October audit recheck, among them the ARR-O block, the GRR method, Pipeline Coverage (unweighted), Sales Cycle (mean, median shown beside it) and the partner activation and churn populations.

## [1.12.0] - 2026-10-13

### Added
- Apache Ossie (incubating) export in `standard/exports/ossie/`: an ontology, a reference semantic model with every computable formula as a direct expression or a staged per-period dataset, a mapping and a coverage report, all passing the upstream validator.
- Grammar: `window(expr, n unit)` for rolling windows, `all_time(expr)` for retention numerators and `metric.<id>.O` / `.M` references to another metric's form.
- Attribution Taxonomy Layer (ATL) tags encoded in the formulas: NRR-O, NRR-M, ARR-O and LTV-O read the classifications the dual-lens rules describe.
- `validationRules` benchmark ranges shown in results.

### Changed
- Query placeholders name their dataset (`{{field@dataset}}`), so adapters that map a field differently per dataset fill correctly.
- `resolveMetric` accepts a name without its abbreviation and any graph label. Graph tools resolve nodes by exact match only.
- Four backward driver edges removed so no two metrics drive each other (172 edges).

### Fixed
- DAU, WAU, MAU, their ratios, week-8 and day-30 retention and the Magic Number computed over the wrong window.
- COUNT over COUNT returned integer division. Numerators are cast to double.
- 34 templates kept placeholders after `generate_query` reported them mapped.

## [1.11.0] - 2026-10-12

1.11.1 was built but not published; its fixes ship in 1.12.0.

### Added
- Canonical formulas for every metric in a small tested grammar (`standard/formulas.json`), or the reason a metric cannot be computed.
- One field vocabulary of 251 fields over 47 datasets, with CEL names and declared enum values.
- Query templates and data requirements compiled from the formulas instead of written by hand.

### Changed
- Lookups match exactly and suggest close names. No tool returns a substring guess.
- `validate_adapter` reports coverage against the fields each formula reads.
- Gross Margin's cost of goods sold is infrastructure only, so canonical Gross Margin equals its Market form. Deferred Revenue, Burn Rate and MTTR definitions corrected.

## [1.10.0] - 2026-09-28

### Added
- Every metric and definition result carries its gaspwiki.com URL.
- `lookup_definition` for glossary terms.
- Access classifications resolve for cross-reference records (NRR under Customer Success).

## [1.9.0] - 2026-05-10

### Added
- `infer_drivers`, `explain_path` and `coverage_gap`: graph traversal over the ontology for diagnosing a metric movement, tracing a chain between two metrics and auditing a metric set.
- `inverse` flag on edges.

## Earlier

- 1.0.0 to 1.8.0 (February to May 2026): the MCP server on npm with metric and glossary lookup, formulas, relationships and search; the ontology layer (entities, concepts, fields and source categories, business model edges, the adapter schema and `validate_adapter`, structured formulas, temporal semantics, validation rules and `generate_query`); the signal type taxonomy; the dual-lens framework (the Commercial Event Ledger (CEL), the ATL and Operating and Market forms).
