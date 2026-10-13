# Ossie spike: does the mapping format do what the interop spec assumes?

Date: 2026-10-13. Against `apache/ossie` main at `2b1f9bf` (2026-10-12). Spec under test: `GASP × Apache Ossie Interop Spec v0.3.md`.

Method: hand-write a subset of the GASP ontology, a semantic model with the datasets Net Revenue Retention (NRR) reads plus one staged cohort dataset, and a mapping between them. Run all three through Ossie's own validator. Then break each file on purpose ten ways and see what the validator catches. The three files are in `gasp-wiki-mcp/test/fixture/ossie-spike/` (the fixture `test/ossie-check.test.ts` probes) and pass as written.

## Verdict

The plan holds, with three corrections to the spec and one lowered expectation.

1. **The mapping format moved.** The spec was written against embedded `ontology_mappings` inside the ontology document. That form is now deprecated. A mapping is its own document (`ontology/mapping.json`) with an `ontology_ref` and a `semantic_model_ref`, each naming the referenced document and optionally giving an `iri` to resolve it from. The `gasp-wiki-mcp/test/fixture/ossie-spike/gasp.mapping.yaml` file shows the shape.
2. **The "no imports" gap is mostly closed.** Because a mapping document references the GASP ontology by name and location, a customer's file no longer needs a bundled copy of it. Proposal P4 (ontology imports) shrinks to "catalog resolution by name", which the spec text already anticipates. The spec's bundler is no longer needed for the customer mapping. One caveat from the upstream text: parser and converter support for standalone mapping documents "is not yet available", so tools that consume mappings today still want the embedded form. The exporter should be able to write both until that lands.
3. **The portable dialect is `OSSIE_SQL_2026`, not `ANSI_SQL`.** The dialect enum now has twelve values. `OSSIE_SQL_2026` is the only one whose semantics the spec defines (`core-spec/expression_language.md`, status Proposed Final). Everything else is opaque to Ossie and may be ignored by implementations. The compiler should emit `OSSIE_SQL_2026` first and warehouse dialects beside it. `POSTGRES` and `REDSHIFT` are still absent, so proposal P0 stands.
4. **"Validates against the Ossie schema" is a weak gate.** See the probe table. The validator checks document shape, the ontology's internal references and SQL syntax. It does not check that a metric's `dataset.field` references exist, that a relationship's columns exist, that a mapping's concepts or relationships exist in the ontology it references, or that an expression stays inside the portable subset (a scalar subquery passes). Our exporter needs its own cross-reference checks, and the conformance badge wording should say what was checked.

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

**Ontology exporter.** Straightforward. GASP entities become `EntityType` concepts with an `identify_by` relationship on their key field. GASP fields become either `ValueType` concepts (one per distinct field, extending the built-in type) or relationships on the entity. Enum values go in a `requires` constraint on the value type, which is how the upstream flights example does it. Snapshot fields need a date role: `Subscription.mrr_on(Date, Mrr)` rather than `Subscription.mrr`, because a snapshot carries one value per day. Exporter output needs our own reference checks on top of the upstream validator.

**Semantic model and metrics.** Ossie metrics are aggregate expressions over `dataset.field` references with no `WHERE`, no subqueries and no notion of a reporting period. Filters inside an aggregate are written as `SUM(CASE WHEN ... THEN ... ELSE 0 END)`, which maps directly from a GASP `where` clause. Period bounds are not part of a metric at all: the query layer filters the dataset's time field. Two GASP constructs do not translate:

- `at period_end` on a snapshot. There is no way to say "the rows on the last day of the period". Options: a dataset whose `source` query keeps only period-end rows, or a date-grain dimension and the convention that the consumer picks one day. The spike uses the staged dataset route.
- `over cohort(...)` and `lag(...)`. These compile to a staged dataset, as the spec says. The useful discovery is that a dataset's `source` may be a query, so the staged table's SQL can live inside the Ossie file (`gasp_account_cohorts` in the spike) rather than in a separate dbt model. Whether a given engine materialises a query source is the engine's business.

With the staged dataset in place, NRR-O and NRR-M are each one line: `SUM(gasp_account_cohorts.mrr_end) / SUM(gasp_account_cohorts.mrr_start)`. The form travels in `custom_extensions` under `vendor_name: GASP`, exactly as the spec proposed. The two forms differ in how the staged table counts expansion, so the staged dataset is per form, or carries both end columns.

**Mapping and `validate_mapping`.** The v1 adapter maps one GASP field to one column per dataset. The Ossie mapping does the same thing through `link_mappings`, with the entity's key as the root `object_mapping` and one child per field. A snapshot field needs a two-level tree (key, then date, then value). The conversion from a v1 adapter is mechanical. Coverage must be computed by us, since the validator does not cross-check the mapping against the ontology.

**Ontology expressions.** Relationships can carry `derived_by` aggregate expressions (`Mrr == SUM[Subscription.mrr_on(Date, Mrr) WHERE ... GROUP BY Customer, Date]`). The expression language for the ontology layer is explicitly deferred to a separate proposal and the validator does not parse it, so this is not something to build on yet. It is the natural home for proposal P3 (concept-level metrics) and worth raising in the Ontology working group with GASP formulas as the worked examples.

## Changes made to the spec

- "One mapping format" now describes the standalone mapping document and points at the spike files.
- The "no imports" gap and P4 are reworded: the mapping document references the ontology; what remains is catalog resolution and converter support.
- The compiler emits `OSSIE_SQL_2026` first.
- The conformance badge and the phase 1 gate say what the upstream validator checks, and that GASP's own cross-reference checks run beside it.

## Open questions for the working groups

1. Snapshot semantics: is a query `source` the intended way to carry a derived dataset, or should it be a materialisation hint in `custom_extensions`?
2. Standalone mapping documents: timeline for parser and converter support, so the exporter can drop the embedded form.
3. Ontology expression language: proposal status, and whether a domain standard's metric definitions are a welcome test set.
