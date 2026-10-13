# Changelog

Changes to the GASP Standard and to the `gasp-standard-mcp` package, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package follows [semver](https://semver.org/). Changes to the standard's content are listed under the package version that first shipped them, since the package bundles the standard. `DECISIONS.md` has the reasoning behind each rule.

## [1.14.0] - Unreleased

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

### Changed
- Headcount by Department is retired as a page. Total Headcount carries the department breakdown and the old URL redirects to it.
- The `tier` field is retired. Use `plan_id` for pricing tier and `segment` for customer segment.

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
