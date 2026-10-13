# Ossie spike: does the mapping format do what the interop spec assumes?

Date: 2026-10-13. Against `apache/ossie` main at `2b1f9bf` (2026-10-12). Spec under test: the interop spec at v0.3, now `docs/ossie-interop-spec.md` (v0.4).

Method: hand-write a subset of the GASP ontology, a semantic model with the datasets Net Revenue Retention (NRR) reads plus one staged cohort dataset and a mapping between them. Run all three through Ossie's own validator. Then break the files on purpose ten ways and see what the validator catches. The three files are in `gasp-wiki-mcp/test/fixture/ossie-spike/` (the fixture `test/ossie-check.test.ts` probes) and pass as written.

## Verdict

The plan holds, with three corrections to the spec and one lowered expectation.

1. **The mapping format moved.** The spec was written against embedded `ontology_mappings` inside the ontology document. That form is now deprecated. A mapping is its own document (`ontology/mapping.json`) with an `ontology_ref` and a `semantic_model_ref`, each naming the referenced document and optionally giving an `iri` to resolve it from. The `gasp-wiki-mcp/test/fixture/ossie-spike/gasp.mapping.yaml` file shows the shape.
2. **The "no imports" gap is mostly closed.** Because a mapping document references the GASP ontology by name and location, a customer's file no longer needs a bundled copy of it. Proposal P4 (ontology imports) shrinks to "catalog resolution by name", which the spec text already anticipates. The spec's bundler is no longer needed for the customer mapping. One caveat from the upstream text: parser and converter support for standalone mapping documents "is not yet available", so tools that consume mappings today still want the embedded form. The exporter should be able to write both until that lands.
3. **The portable dialect is `OSSIE_SQL_2026`, not `ANSI_SQL`.** The dialect enum now has twelve values. `OSSIE_SQL_2026` is the only one whose semantics the spec defines (`core-spec/expression_language.md`, status Proposed Final). Everything else is opaque to Ossie and may be ignored by implementations. The compiler should emit `OSSIE_SQL_2026` first and warehouse dialects beside it. `POSTGRES` and `REDSHIFT` are still absent, so proposal P0 stands.
4. **"Validates against the Ossie schema" is a weak gate.** See the probe table. The validator checks document shape, the ontology's internal references and SQL syntax. It does not check that a metric's `dataset.field` references exist, that a relationship's columns exist, that a mapping's concepts or relationships exist in the ontology it references, or that an expression stays inside the portable subset (a scalar subquery passes). The exporter needs its own cross-reference checks and the conformance badge wording should say what was checked.

## What the validator catches

| Breakage | Caught |
| --- | --- |
| Ontology: a role played by an undeclared concept | Yes |
| Ontology: `identify_by` naming an unknown relationship | Yes |
| Ontology: garbage text in `derived_by` | No. Ontology expressions are not parsed |
| Semantic model: metric expression with broken SQL | Yes, by sqlglot |
| Semantic model: metric referencing a dataset that does not exist | No |
| Semantic model: metric written as a scalar subquery, which the expression language forbids | No |
| Semantic model: broken SQL in a dataset `source` query | No |
| Semantic model: relationship `from_columns` naming a field that does not exist | No |
| Mapping: `concept` not in the referenced ontology | No |
| Mapping: `relationship` not declared on the concept | No |

The validator runs locally with `uv run validation/validate.py [--schema ontology/ontology.json | ontology/mapping.json] <file>`; the script declares its own dependencies.

## What this means for each piece of the plan

**Ontology exporter.** GASP entities become `EntityType` concepts with an `identify_by` relationship on their key field. GASP fields become either `ValueType` concepts (one per distinct field, extending the built-in type) or relationships on the entity. Enum values go in a `requires` constraint on the value type, which is how the upstream flights example does it. Snapshot fields need a date role: `Subscription.mrr_on(Date, Mrr)` rather than `Subscription.mrr`, because a snapshot carries one value per day. The exporter's output needs GASP's own reference checks on top of the upstream validator (now `gasp-wiki-mcp/src/ossie/check.ts`).

**Semantic model and metrics.** Ossie metrics are aggregate expressions over `dataset.field` references with no `WHERE`, no subqueries and no notion of a reporting period. Filters inside an aggregate are written as `SUM(CASE WHEN ... THEN ... ELSE 0 END)`, which maps directly from a GASP `where` clause. Period bounds are not part of a metric at all: the query layer filters the dataset's time field. Two GASP constructs do not translate:

- `at period_end` on a snapshot. There is no way to say "the rows on the last day of the period". Options: a dataset whose `source` query keeps only period-end rows, or a date-grain dimension and the convention that the consumer picks one day. The spike uses the staged dataset route.
- `over cohort(...)` and `lag(...)`. These compile to a staged dataset, as the spec says. The useful discovery: a dataset's `source` may be a query, so the staged table's SQL can live inside the Ossie file (`gasp_account_cohorts` in the spike) rather than in a separate dbt model. Whether a given engine materialises a query source is the engine's business.

With the staged dataset in place, NRR-O and NRR-M are each one line: `SUM(gasp_account_cohorts.mrr_end) / SUM(gasp_account_cohorts.mrr_start)`. The form travels in `custom_extensions` under `vendor_name: GASP`, as the spec proposed. The two forms differ in how the staged table counts expansion, so the staged dataset is per form, or carries both end columns.

**Mapping and `validate_mapping`.** The v1 adapter maps one GASP field to one column per dataset. The Ossie mapping does the same thing through `link_mappings`, with the entity's key as the root `object_mapping` and one child per field. A snapshot field needs a two-level tree (key, then date, then value). The conversion from a v1 adapter is mechanical. GASP has to compute coverage itself, since the validator does not cross-check the mapping against the ontology.

**Ontology expressions.** Relationships can carry `derived_by` aggregate expressions (`Mrr == SUM[Subscription.mrr_on(Date, Mrr) WHERE ... GROUP BY Customer, Date]`). Upstream defers the expression language for the ontology layer to a separate proposal and the validator does not parse it, so GASP waits before building on it. It is the natural home for proposal P3 (concept-level metrics) and worth raising in the Ontology working group with GASP formulas as the worked examples.

## Since the spike

Written 2026-10-13, after the exporters and the compiler dialects shipped the same day. The findings above stand; three things changed around them.

- **Dialect sources live in a custom extension.** A dataset `source` is one string with no dialect (`Dataset.source` in `core-spec/ossie-schema.json`, "database.schema.table or query"), while metric and field expressions carry a `dialects` array. A staged dataset's source is a compiled query and warehouses spell date arithmetic, the double cast and percentiles differently (`gasp-wiki-mcp/src/dialect.ts`). The exporter keeps the Postgres query in `source` (it also runs on Redshift) and puts the Snowflake, BigQuery and Databricks versions in the staged dataset's GASP `custom_extensions` under `sources`, keyed by Ossie dialect name. A `dialects` form for `source`, matching expressions, would let a consumer pick its own without reading a vendor extension. It is a candidate for the upstream proposals.
- **Breakdowns can be bucketed or reached through a key.** A bucketed breakdown groups by a `CASE` over a per-row expression (Aging Buckets over invoice age), which no Ossie dimension expresses, so the export stages it with the reason `bucket`. A breakdown whose label lives on another dataset (MRR by plan name, read from `plan` through `plan_id`) stays direct where the expression allows: the metric's description tells the consumer to join on the key through the model's relationship and group on the label; a staged version carries both the key and the label column.
- **Timestamp period bounds were fixed.** Every period filter on a timestamp-dated dataset used `<= period_end`, which is midnight at the start of the last day, so the compiled SQL dropped rows later that day in every dialect. The compiler now emits `>= period_start` and `< period_end + 1 day` on timestamp columns for the period, window, to_date and point bounds. The staged sources in the Ossie model changed with it. The executed fixture tests prove the fix with two rows on the last day of June.

## Changes made to the spec

- "One mapping format" now describes the standalone mapping document and points at the spike files.
- The "no imports" gap and P4 are reworded: the mapping document references the ontology; what remains is catalog resolution and converter support.
- The compiler emits `OSSIE_SQL_2026` first.
- The conformance badge and the phase 1 gate say what the upstream validator checks and that GASP's own cross-reference checks run beside it.

## Open questions for the working groups

1. Snapshot semantics: is a query `source` the intended way to carry a derived dataset, or should it be a materialisation hint in `custom_extensions`?
2. Standalone mapping documents: timeline for parser and converter support, so the exporter can drop the embedded form.
3. Ontology expression language: proposal status and whether a domain standard's metric definitions are a welcome test set.
