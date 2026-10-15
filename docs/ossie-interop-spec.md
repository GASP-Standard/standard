# GASP × Apache Ossie: Native Spec v0.4

Oct 13, 2026 · Gareth O'Shea

v0.4 replaces v0.3 (Oct 12). Phases 0 and 1 are done: the standard is public, the Ossie files are generated and pass the upstream validator in CI and the compiler has a dialect layer. The plan is written as mine, an individual contributor's, because that is who will be on the Ossie lists.

## TL;DR

GASP aims to be the first Ossie-native domain standard. A company points GASP at its warehouse (or at the Ossie model it already has) and comes away with one GASP mapping, a ranked fix list and a published Ossie model with canonical SaaS metrics in it. Every file the company receives is plain Apache Ossie (incubating). GASP extends Ossie only where the spec cannot yet express SaaS metrics. Each extension is paired with an upstream proposal that would retire it.

The [Ossie ecosystem page](https://ossie.apache.org/ecosystem/) lists 60+ organizations. Every detailed entry is a tool (converters, engines, BI imports) and none ships domain content, which is what GASP is.

**Done looks like:**

- A GASP Ossie ontology document, generated from `/standard/` and validated against the Ossie schema in CI (done 2026-10-13)
- One mapping format: an Ossie mapping document. Companies without an Ossie model get one generated from a profile of their warehouse
- A SaaS reference model merged into `apache/ossie/examples/`, next to the existing TPC-DS model
- A GASP card on the Ossie ecosystem page, described as Ossie-native
- A runnable demo: a public Snowflake or Databricks Ossie example mapped to GASP, scored for drift and executed by an existing Ossie engine
- Upstream proposals that retire GASP extensions, at least one under discussion in a working group

## Background

Ossie and GASP sit at different layers, so the fit is additive. Ossie says how a semantic model is written down; GASP says what a SaaS company's metrics mean.

|  | Apache Ossie (incubating) | GASP |
| --- | --- | --- |
| What it is | Vendor-neutral spec for semantic models and ontology | Canonical SaaS metric standard |
| Core objects | Datasets, fields, FK relationships, metrics, `ai_context`, `custom_extensions` | 306 metrics, 94 definitions, 268 canonical fields in 52 datasets, 28 entities, 7 concepts, 22 source categories |
| Expressions | SQL strings per dialect (ANSI, `OSSIE_SQL_2026`, Snowflake, BigQuery, Databricks, MDX, Tableau, MAQL and others) | GASP formula grammar (warehouse-agnostic), compiled to SQL for Postgres (which also runs on Redshift), Snowflake, BigQuery and Databricks |
| Ontology | Separate doc: `EntityType` / `ValueType` concepts, relationships with roles, `verbalizes`, mappings to semantic models | `ontology.json` plus a relationship graph of 100 nodes and 200 edges across 21 edge types |
| Spec version | 0.1.1 released; 0.2.0.dev0 in development | v1 |
| Governance | ASF Incubator: public lists, discussion-and-vote, three working groups (Metric Language, Catalog, Ontology) | One maintainer (Gareth O'Shea). `GOVERNANCE.md` in the public repository says how changes are decided, what counts as a breaking change and how a second maintainer is added |
| License | Apache 2.0 | Content CC BY 4.0, code Apache 2.0 |

The Ossie project reports 100+ commits and 35 merged PRs from Snowflake, Dremio, Salesforce, Databricks, dbt Labs, RelationalAI, GoodData and Honeydew, with growth from 17 launch partners to 50+ organizations ([announcement](https://ossie.apache.org/updates/ossie-enters-apache-incubator/)). Snowflake imports and exports Ossie YAML natively; an Iqea DuckDB extension executes Ossie models directly ([ecosystem](https://ossie.apache.org/ecosystem/)).

GASP has the pieces a domain package needs: canonical definitions, an adapter that maps warehouse columns to canonical fields and an MCP server that exposes formulas, data requirements, SQL generation and graph reasoning ([tools](https://gaspwiki.com/v1/tools)). Until phase 1 it had no home format that other tools read. Ossie gives it one.

## Readiness review: what GASP does today

GASP serves a company that already has a clean, modelled warehouse and wants consistent definitions. The target persona is a company that knows its data is not ready for LLMs and does not know where to start. GASP does not serve that company yet. This review checked the published site and the code of `gasp-standard-mcp` 1.14.0.

| Capability the persona needs | Status today | Evidence |
| --- | --- | --- |
| A target shape for clean data | Strong | CEL defines five immutable event classes; ATL defines strict tagging rules |
| Canonical definitions agents can read | Strong | 306 metrics, 94 definitions, 12 MCP tools |
| Machine-readable formulas | Strong | `standard/formulas.json` in the GASP formula grammar: all 306 metrics covered (279 formulas, 15 marked not computable with reasons). The test suite parses and resolves every formula and executes every compiled template against a seeded Postgres fixture |
| Starting from raw data | Missing | The MCP has no warehouse access and returns SQL only |
| Coverage assessment | Good | `validate_adapter` (adapter schema 1.1) checks schema validity, unknown fields and datasets, table conflicts and enum fields without a transform. It scores coverage per metric against the fields its formula needs. Value-distribution, key and freshness checks are still to come |
| Ownership enforced | Strong | `validate_adapter` flags every covered metric that has no owner in `metricOwners` |
| Definition drift | Pattern only | "Board deck audit" is an agent pattern; no tool computes drift |
| Metrics computed from CEL | Partial | The 279 query templates are compiled from formulas and read the CEL event datasets (51 datasets, each with its CEL class) wherever the formula does. Metrics whose formulas use snapshot or fact datasets still read those tables |
| Raw source to CEL mappings | Missing | CEL is source-agnostic by design; no Stripe, Chargebee or Salesforce mappings exist |
| Correct multi-table SQL | Strong | `generate_query` compiles one scalar subquery per aggregate, each from the table mapped to that field's dataset, in the dialect the adapter's `warehouse` names |
| A prioritised fix plan | Partial | `validate_adapter` ranks the next fields to map by the metrics each unlocks. No effort weighting, checks or fix list for data quality yet |

**Raw material for readiness checks already exists.** CEL rows carry a built-in invariant (`prior_mrr + mrr_change = new_mrr`). ATL requires exactly one tag per dimension per event. The Core O/M bridges carry explicit reconciliation formulas, such as CAC-O = CAC-M + implementation and onboarding cost per customer. All of these compile to SQL tests.

**Consistency fixes before the introduction**

- Public source: done 2026-10-13. The standard and the MCP server are mirrored to `GASP-Standard/standard`; the npm package's `repository` field points there.
- Site counts come from the data build and are guarded by tests (2026-10-12). This document's counts are guarded the same way.
- Depth is uneven: 279 of 306 metrics have data requirements (compiled from formulas) and only a handful carry common-mistakes notes.
- The field vocabulary was reconciled before the ontology document was published, because Ossie `ValueType` concepts make the vocabulary public. Canon decisions on 2026-10-12 settled the naming in `ontology.json` `fields`: CEL names win (`customer_id`, `event_type`, `cost` with `cost_function` and `cost_type`, `contract_event_type`, `amendment_type`) and ATL values are lowercase snake_case.

## Goals, non-goals and success metrics

The goal is to be the SaaS answer inside Ossie, measured by merges and listings upstream rather than by what gaspwiki.com says.

**Goals**

1. A company with messy data can go from "we don't know" to a ranked fix list in one agent session and to an Ossie-native model without hiring a semantic-layer specialist.
2. Every file a company receives from GASP is valid Ossie, with no lossy conversion step.
3. Any Ossie model, from any vendor, can be mapped to GASP and scored for coverage and definition drift.
4. Every GASP extension has a named upstream proposal that would retire it.
5. Existing v1 adapters keep working, read as input and converted on load.

**Non-goals**

- Forcing the metric canon into Ossie before the spec can hold it. Blobs in `custom_extensions` that other tools ignore would be native in name only.
- Pushing GASP's opinions into Ossie core. The canon stays GASP's; only format gaps go upstream.
- Usage-based pricing metrics, which GASP itself scopes out.

**Success metrics**

| Metric | Target | How it is measured |
| --- | --- | --- |
| GASP ontology validates against the Ossie ontology schema | Every build (met 2026-10-13) | CI on both repositories |
| Metrics with a canonical formula or a stated `notComputable` reason | All (met 2026-10-12, held since) | `formulas.json` coverage test |
| Reference model in `apache/ossie/examples` | 1 | PR merged |
| Ecosystem card live | 1 | Listed on ossie.apache.org/ecosystem |
| Vendor Ossie exports mapped to GASP natively | 2+ (Snowflake, Databricks) | CI fixtures |
| Ossie tools shown running a GASP-mapped model | 3+ | Recorded demos |
| Upstream proposals opened | 4 | GitHub Discussions + dev@ thread |
| GASP extension keys retired by upstream merges | 1 within 12 months | Extension schema changelog |
| Design partners taken from L0 to L3 on real messy data (after launch) | 3 | Readiness reports |
| Time from first session to ranked fix list | Under 1 day | Design-partner logs |

## Architecture

`/standard/` stays the hand-edited source of truth. Everything a company or the Ossie community sees is generated from it and validated against Ossie's own schema in CI.

| Layer | Hand-edited | Generated | Format |
| --- | --- | --- | --- |
| Canon | `ontology.json`, `formulas.json`, metric markdown | | GASP |
| GASP ontology | | `standard/exports/ossie/gasp.ontology.yaml` | Ossie ontology |
| Reference model | | `standard/exports/ossie/gasp.semantic_model.yaml`, `gasp.mapping.yaml`, `coverage.json` | Ossie semantic model and mapping |
| Company mapping | Decisions only (owners, currency, identity) | Everything else, from a profile or an existing Ossie model | Ossie mapping document |
| Company model | | Compiled metrics and staged datasets added to their model | Ossie semantic model |
| Extension data | | `custom_extensions` under `vendor_name: GASP` | Ossie, plus a published JSON Schema |

**Why generated rather than hand-edited Ossie.** The Ossie ontology spec is `0.2.0.dev0` and may change. Generating the Ossie files keeps spec churn inside one exporter and its tests, so the authoring flow for 301 metrics is untouched when the spec moves. GASP data that Ossie cannot hold yet (metric-to-metric edges, access classifications, temporal semantics) stays in one place rather than splitting across two sources. The published files are fully native either way. Revisit when the ontology spec reaches 1.0.

## The pipeline

One pipeline, five readiness levels. Each step writes a file the next step reads, so a company can stop anywhere and still have something useful. Agents draft, people make the judgement calls and generated checks decide when something is ready.

| Level | Step | What happens | Output (Ossie-native) | MCP tool |
| --- | --- | --- | --- | --- |
| L0 Unknown | | Nothing run yet | | |
| L1 Profiled | Profile | Read schemas and aggregate statistics through the company's warehouse MCP, or from a schema dump: keys, null rates, date ranges, distinct values. A company with an existing Ossie model skips straight to Map | A minimal Ossie semantic model (datasets, fields, keys) | `profile_schema` |
| L2 Mapped | Map | Columns matched to GASP fields by name, type and value patterns, each with a confidence score | Draft GASP mapping | `propose_mapping` |
| | Decide | Questions an agent cannot answer go to named people: which system owns customer identity, which currency is reporting currency, what date marks churn | Decisions with owners, stored in the mapping | `record_decision` |
| L3 Clean core | Build CEL | Source templates (Stripe, Chargebee, Salesforce, HubSpot first) generate dbt models from raw tables to CEL events with ATL tags | dbt project, delivered as a pull request | `generate_cel_models` |
| | Check | Tests compiled from GASP's own rules run against CEL | Pass/fail per check, per metric | `generate_checks` |
| | Plan | Failing checks ranked by how many metrics each fix unlocks, Core first, weighted by effort | Ranked fix list | `plan_fixes` |
| L4 LLM-ready | Publish | Canonical metrics compiled into the company's model; coverage, checks and drift re-run on a schedule | Published Ossie model, readiness report | `compile_metrics`, `score_drift`, `readiness_report` |

### One mapping format

The v1 adapter and the Ossie mapping merge into one format: an Ossie mapping document (`ontology/mapping.json` in the Ossie repo). A mapping is its own file that references one ontology and one semantic model by name, each with an optional `iri` saying where to resolve it from. The Profile step means every company has an Ossie semantic model to map from, whether they exported it from Snowflake or GASP generated it from their schema. v1 adapters are accepted as input and converted on load, so existing adapters keep working without a separate migrator. Upstream has deprecated embedding mappings inside the ontology document (`ontology_mappings`); the exporter writes that form only while converters still need it.

| Adapter v1 | GASP mapping (Ossie) | Notes |
| --- | --- | --- |
| `warehouseRef` table | The company's `datasets[]` | From their Ossie export or the profile |
| `gaspField` to column | `link_mappings` on GASP relationships, e.g. Subscription on Date carries Mrr | `expression` holds the column or computed value; a snapshot field is a two-level tree (key, date, value) |
| `transform` (`{{value}} / 100`) | The mapping's `expression` | Portable SQL (`OSSIE_SQL_2026`) |
| Entity identity (`customer_id`) | `object_mappings` with `referent_mappings` on the concept's `identify_by` relationship | |
| Keys and joins | The company's `primary_key` and `relationships` | |
| `metricOwners`, field `owner`, `notes`, decisions | `custom_extensions`, `vendor_name: GASP` | No core slot yet |

**Worked example.** `gasp-wiki-mcp/test/fixture/ossie-spike/` holds the hand-written ontology, semantic model and mapping for the NRR subset from the spike; `standard/exports/ossie/` holds the generated files for the whole standard. All of them pass the upstream validator; `docs/ossie-spike.md` records what it checks and what it misses.

**Imports.** Because the mapping document references the GASP ontology by `name` and `iri`, a company's file no longer carries a copy of it. What remains for proposal P4 is catalog resolution by name and converter support for standalone mapping documents, which upstream says is not yet available.

**Validation.** `validate_adapter` becomes `validate_mapping`: Ossie schema validity first, then GASP's own cross-reference checks (the upstream validator does not confirm that a mapping's concepts and relationships exist in the ontology, or that a metric's dataset and field references exist; `gasp-wiki-mcp/src/ossie/check.ts` does), then coverage computed from the concept mappings, then field types and recommended owners.

### Metric compiler

The compiler reads `standard/formulas.json` and the company's mapping and emits Ossie `metrics[]` into the company's model. It emits only metrics whose fields are all mapped; the rest go into the coverage report. Generated metrics carry a `gasp_` prefix so they never collide with the company's own. O/M forms compile to separate metrics (`gasp_nrr_o`, `gasp_nrr_m`).

Canonical formulas are written in the GASP formula grammar: arithmetic over `metric.` refs, aggregates over `field.` refs with `where` filters, `at period_start|period_end` snapshots, `lag()`, `over cohort()`, windows and breakdowns. Ratios are unscaled with a separate `unit`. The test suite parses every formula, resolves it against the ontology and checks for cycles.

```text
nrr = (metric.mrr at period_start + metric.expansion_mrr
       - metric.contraction_mrr - metric.churned_mrr)
      / metric.mrr at period_start
      over cohort(field.customer_id, period_start)
```

**Compiler output for NRR** (illustrative)

```yaml
metrics:
  - name: gasp_nrr_o
    description: Net Revenue Retention (operating form), GASP canonical definition
    expression:
      dialects:
        - dialect: OSSIE_SQL_2026
          expression: SUM(gasp_account_cohorts.mrr_end) / SUM(gasp_account_cohorts.mrr_start)
    ai_context:
      synonyms: ["net dollar retention", "NDR"]
      instructions: "Canonical definition: https://gaspwiki.com/v1/metrics/core#net-revenue-retention-nrr"
    custom_extensions:
      - vendor_name: GASP
        data: '{"gasp_id":"nrr","gasp_version":"1","form":"O","unit":"percent"}'
```

Formulas that use `cohort` or `lag`, or that need the reporting period inside a filter, compile to a plain aggregate over a staged dataset (`gasp_account_cohorts` here) that every Ossie engine can run today. An Ossie dataset's `source` may be a query, so the staged table's SQL travels inside the model. `OSSIE_SQL_2026` is the only dialect whose semantics Ossie defines, so direct metrics are emitted in it. `Dataset.source` is a single string with no dialect, so a staged dataset's `source` holds the Postgres query and its GASP extension carries the Snowflake, BigQuery and Databricks versions. The reference model's `coverage.json` records which metrics are direct and which are staged, with the reason for each. The staged set is the test set for proposal P2.

### Drift scoring

1. Validate the input with the upstream Ossie validator.
2. Match the company's metrics to GASP metrics by name, `ai_context.synonyms` and `description`; exact matches auto-accept, fuzzy ones go to review.
3. Run each matched pair (the company's expression and the compiled canonical one) against the seeded synthetic SaaS dataset and compare the numbers. Where they differ, report the likely cause from the parsed canonical formula: numerator, denominator, filter, snapshot point or cohort.
4. Return coverage plus drift as one report: "your NRR reads 112%, canonical reads 104%, because expansion from accounts acquired during the period is included".

Comparing results rather than SQL text avoids having to prove two differently written queries equivalent and makes a clearer demo.

### Readiness checks

Generated from rules GASP already has:

- CEL row identity: `prior_mrr + mrr_change = new_mrr` on every revenue and amendment event
- MRR continuity: each customer's ending MRR for a month equals the next month's starting MRR
- Unique, immutable `event_id`; corrections appear as adjustment events and the original row stays
- ATL completeness: exactly one lifecycle tag per event, one expansion tag where required, one cost function tag per cost event
- Identity reconciliation: every billing customer resolves to one CRM account and the reverse
- O/M bridges: each Core bridge reconciles, e.g. CAC-O = CAC-M + implementation and onboarding cost per customer
- Freshness: latest event date per source is within the agreed sync window

### Changes to existing tooling

- Done: query templates and data requirements are compiled from `formulas.json` at load time and the formulas read CEL event datasets directly. Remaining: move the snapshot and fact datasets onto CEL events
- Done: `generate_query` resolves a table per dataset, with one scalar subquery per aggregate
- Done: `validate_adapter` checks field and dataset names, enum transforms and metric owners. Remaining: value-distribution, key and freshness checks
- Done: `structuredFormulas`, `entityMappings` and field metric counts are derived from `formulas.json` by `npm run derive` and tested current
- Done (2026-10-13): `npm run derive` writes the Ossie ontology, reference semantic model and mapping from `/standard/` (`gasp-wiki-mcp/src/ossie/`). The vendored upstream validator and GASP's own cross-reference checks run on them in CI. Every formula is a direct `OSSIE_SQL_2026` metric or a staged per-period dataset; `coverage.json` says which and why
- Done (2026-10-13): the compiler takes a dialect (`gasp-wiki-mcp/src/dialect.ts`): Postgres by default (Redshift reads the same SQL), Snowflake, BigQuery and Databricks. `generate_query` picks it from the adapter's `warehouse` and staged Ossie datasets carry all four sources
- Done (2026-10-13): breakdowns by field, by a label reached through a key (MRR by plan name) and by bucketed expression (Aging Buckets) compile to one row per value

**Safety.** Profiling reads schemas and aggregates only, never row-level company data. Queries run with the invoking user's identity, as the governance framework already requires. Generated dbt code arrives as a pull request for a person to review.

## The GASP extension, designed to shrink

What Ossie cannot yet hold travels in `custom_extensions` under `vendor_name: GASP`, governed by a published JSON Schema. Every key has an exit: an upstream proposal that would move it into core, or an explicit decision that it is GASP-specific and stays. The size of this table is the measure of how native GASP is.

**Schema:** planned at `https://gaspwiki.com/schemas/gasp-ossie-extension-v1.json` (not yet published), versioned independently of the mapping.

| Level | Key | Content | Exit |
| --- | --- | --- | --- |
| Metric | Canonical formula over concepts | The GASP grammar expression before any warehouse exists | P3 (concept-level metrics) |
| Model | `metric_edges[]` | `{from, to, type, classification}` for `DRIVES`, `REDUCES`, `PREDICTS`, `COMPONENT_OF` | P1 (metric relationships) |
| Model | `gasp_version`, `ontology_version` | Which GASP release produced the file | Stays; provenance |
| Model | `metric_owners[]`, `decisions[]` | Who resolves definition disputes; recorded mapping decisions | Catalog WG candidate |
| Dataset | `sources` | A staged dataset's compiled query per warehouse dialect, keyed by Ossie dialect name | A `dialects` form for `Dataset.source`, matching expressions (question for the Metric Language WG) |
| Metric | `gasp_id`, `department`, `signal_type`, `layer`, `unit` | GASP taxonomy | Stays; GASP-specific |
| Metric | `form` | `O` (operating) or `M` (market); one Ossie metric per form | Stays; GASP-specific |
| Metric | `gasp_breakdown` | The field a direct metric is grouped by | Stays until Ossie metrics can declare a grouping |
| Metric | `sensitivity`, `access_scope` | From the GASP governance framework | Catalog WG candidate |
| Field | `source_category`, `owner`, `notes` | Lineage and accountability | Catalog WG candidate |
| Field | `change_nature` | CEL permanence flag, where mapped | Stays; GASP-specific |

**Rules**

- Use core wherever Ossie has a slot (description, synonyms, datatype); the extension holds only what core cannot.
- Consumers that ignore the extension still get a correct, runnable model.
- Every key that later lands upstream is deprecated in the extension with a pointer to the core field.

**What does not fit the Ossie ontology yet**

- **Metric edges** (`DRIVES`, `REDUCES`, `PREDICTS`, `COMPONENT_OF`). Ossie metrics are not ontology concepts, so there is nowhere to hang "Logo Churn reduces NRR". Modelling metrics as fake entity types would validate but mislead other tools. Extension now, proposal P1.
- **Financial flows** (`GENERATES`, `PRODUCES`, `CONTRIBUTES_TO`, `INCURS`) link entities to metrics such as Revenue or Pipeline. Where the target is a real business object (Invoice) it maps; where it is a metric, it waits for P1.
- **Source category lineage** (`SOURCED_FROM`) belongs to the Catalog working group's scope. Extension.

Everything else in the entity layer maps directly: entities to `EntityType` concepts, canonical fields to `ValueType` concepts with relationships from the entity, entity edges (`OWNS`, `GRANTS`, `CONVERTS_TO`, `PARENT_OF`, `PRICED_BY` and others) to `relationships[]` with `roles`, `multiplicity` and `verbalizes`. Segments map to `extends` subtypes.

## Hard metrics and upstream proposals

Ossie metrics are single aggregate SQL expressions. That suits ARR or win rate. Cohort and period-over-period metrics like NRR, GRR, LTV and CAC Payback need more. So do metrics whose filters name the reporting period. Staged datasets cover them locally today (see the metric compiler). Upstream, these proposals would retire the workarounds, in order of ease:

| ID | Proposal | Where it goes | Retires | Why GASP is credible here |
| --- | --- | --- | --- | --- |
| P0 | Add `POSTGRES` and `REDSHIFT` to the dialect enum | Small PR | Postgres sources held in `source` with no dialect label | The compiler already emits Postgres SQL that runs on Redshift; this PR is the two enum values. A low-risk first contribution |
| P1 | Metric relationships: typed edges between metrics (drives, reduces, predicts, component of) | Ontology WG, via GitHub Discussions | `metric_edges[]` | The GASP graph's metric edges, with `infer_drivers` and `explain_path` as the consuming use case |
| P2 | Period-over-period and cohort metrics | Metric Language WG's work on advanced metric logic and windowing | Staged datasets | Every staged GASP formula is a conformance test with a canonical answer, executed in the GASP test suite |
| P3 | Concept-level metrics: a metric defined against ontology concepts, resolved to SQL through any model's ontology mapping | Ontology and Metric Language WGs jointly | Metric compiler and the canonical-formula extension | 274 warehouse-agnostic formulas in a tested grammar; the clearest case for why a domain standard needs this |
| P4 | Catalog resolution of `ontology_ref` by name and version plus converter support for standalone mapping documents | Ontology WG | Embedded-mapping fallback | The 0.2.0.dev0 mapping document already references the ontology by name and `iri`; the missing piece is tooling that resolves it |

P3 is the largest. It would let a standard like GASP live entirely inside Ossie. Because it benefits any future vertical (healthcare, retail, fintech), it is an easier sell than a SaaS-only change. The GASP formula grammar is a working prototype of what P3 would need to express.

Ossie's roadmap lists an expression language, advanced metric logic and windowing functions as priorities ([announcement](https://ossie.apache.org/updates/ossie-enters-apache-incubator/)). P2 should arrive as test cases for that work rather than as a competing design. The open proposal on reified relationships ([discussion #277](https://github.com/apache/ossie/discussions/277)) is a model for the format: problem, gap, proposed syntax, schema change, worked example, validation tests.

## Credibility and adoption playbook

This is one person's plan for earning a place in an Apache community. Credibility comes from three places, in rising order of value: a GASP card on Ossie's ecosystem page, then other tools running the GASP model, then merges in the Apache repository.

**1. Earn merges in the Apache repository (highest credibility)**

- Done 2026-10-13: the standard and the MCP server are public through the read-only mirror `GASP-Standard/standard` (the monorepo with the site code stays private and a workflow mirrors the public paths on every push), linked from gaspwiki.com and the npm package's `repository` field. History audited for secrets the same day. The mirror carries `GOVERNANCE.md` and `CONTRIBUTING.md`.
- Sign the ASF ICLA before the first PR; add Apache license headers to anything contributed.
- Open with P0 (two dialect enum values). A small merged PR means reviewers know the name before the larger one arrives.
- Post an introduction in GitHub Discussions and on dev@ before submitting the reference model, written as the person who built GASP. Decisions there go through open discussion and vote. A PR that arrives without that conversation tends to stall.
- Contribute a compact SaaS reference model and ontology example under Apache 2.0. Keep the full canon in GASP's repository, linked, so no CC BY content needs to enter the Apache tree.
- Join the Ontology and Metric Language working groups and attend their meetings as well as their issue threads.

**2. A card on the ecosystem page**

Listing is a pull request to `apache/ossie-website` with a logo and a description. The draft:

- **SaaS ontology:** the first Ossie-native domain standard; entities, relationships and canonical metrics
- **Map any Ossie model to GASP:** one mapping, then coverage and definition drift in one call
- **GASP MCP:** one-line install; agents read canonical definitions and map models

Wait until the reference model PR is at least open, so the card links to real files.

**3. Other tools running GASP**

The best targets are Ossie consumers with no content of their own, because a SaaS demo model solves their cold-start problem:

| Target | Why they'd say yes | Demo |
| --- | --- | --- |
| Iqea `duckdb-ossie` | Executes Ossie directly; has an MCP server example | GASP model + synthetic SaaS data, runnable in DuckDB in one command |
| Snowflake | Native Ossie import to Semantic Views | GASP model imported as a Semantic View, queried for NRR |
| Golden Analytics, Saiku, Veezoo, Datus | Import Ossie for AI-assisted analysis | GASP model loaded; one dashboard each |
| Hex, Sigma, Omni, Lightdash | SaaS-heavy customer bases, listed participants | Board-pack dashboard from the GASP model |

Ship one synthetic SaaS dataset (seeded, ~1,000 accounts, 24 months of CEL events) so every demo uses the same numbers, drift scoring has a common baseline and outputs can be checked against GASP's canonical answers. The test fixture in `gasp-wiki-mcp/test/fixture/` is the seed for it.

**4. Claims that survive scrutiny**

- Say "works with Apache Ossie (incubating)". ASF does not certify, so "Ossie-certified" is unavailable; follow its [trademark policy](https://www.apache.org/foundation/marks/) and use the full name on first mention.
- Name a tool as running GASP only for a round trip that passes in GASP's CI or a demo the tool's maintainers have seen.
- Publish a conformance badge driven by Ossie's own `validation/` tooling plus GASP's cross-reference checks: "Validates against Apache Ossie 0.x". The upstream validator checks document shape, ontology references and SQL syntax only (`docs/ossie-spike.md`), so the badge names both.

**5. Launch**

One coordinated week: reference model merged, ecosystem card live, a gaspwiki.com "GASP for Ossie" page, a blog post with the DuckDB demo and the drift report run on a public Snowflake or Databricks example plus a talk slot at an Ossie community meeting.

## Roadmap

About 16 weeks to launch from 2026-10-12, with community engagement from the introduction onward so upstream reviewers know the project before the reference model PR lands. Each gate must pass before the next phase starts. Upstream review time sets the pace, so launch week moves with the reference model merge rather than the calendar.

| Phase | Weeks | Work | Gate |
| --- | --- | --- | --- |
| 0. Hygiene | 1 to 2 | Done 2026-10-13: field vocabulary reconciled, npm 1.12.0 published, site deployed, secrets audit, public mirror with governance documents | Mirror public and linked from gaspwiki.com and npm (met) |
| 1. Canon | 2 to 6 | Done 2026-10-13: formulas, field vocabulary and enum values (294 formula entries, 268 fields, 52 datasets, CEL names adopted); spike and exporters (`docs/ossie-spike.md`, `gasp-wiki-mcp/src/ossie/`, output at `/downloads/ossie/`); dialect layer; CI | Ontology, model and mapping pass the upstream validator and GASP's own checks in CI (met) |
| 2. Native model | 6 to 10 | Introduction on the Ossie lists and P0 PR; mapping format and `validate_mapping`; metric compiler into a company's model; reference model PR; DuckDB demo; synthetic dataset grown from the test fixture | Reference model PR open; compiled Core runs in DuckDB |
| 3. Drift and on-ramp | 10 to 16 | Drift scorer; profiler; raw-source mappings and CEL source templates (Stripe, Salesforce first); readiness checks and fix plan; P1 to P4 drafted | Drift report on a public vendor example; synthetic data reaches L4 |
| Launch | 16+ | Ecosystem card, "GASP for Ossie" page, blog, community talk | Reference model merged |
| Prove | after launch | Three design partners on real messy data | One partner at L3 |

Design partners come after launch so the launch depends only on work in this repository and upstream review. Partner failures become new checks or templates rather than one-off fixes.

## Risks, open questions and references

**Risks**

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Spec churn: the ontology spec is 0.2.0.dev0 and may change | Generated files break between releases | Ossie files are generated, so churn lands in one exporter; the validator is vendored and pinned by commit; attend the Ontology WG |
| Ontology mapping semantics are thinly documented | The exporter builds on a misreading | Confirm the mapping example with the Ontology WG before building more tooling on it |
| No cross-document imports | Bundled copies of the GASP ontology drift | Mapping documents reference the ontology by name and `iri`; P4 adds the resolver |
| "Opinionated by design" reads as one author setting the standard | Maintainers resist | Contribute format gaps and examples upstream; keep the canon in GASP's repository |
| Single-maintainer project inside an ASF community | Seen as self-promotion, or as fragile if the maintainer stops | `GOVERNANCE.md` says how a second maintainer is added and what happens if the maintainer is unavailable; contribute review time and small fixes to other people's work |
| Licence mismatch: GASP content is CC BY 4.0 | Content blocked from the Apache tree | Contribute a small Apache 2.0 example; confirm ASF third-party licence policy before any content moves |
| P1 to P4 rejected or slow | Extension and tooling stay longer | The native layer stands on its own; proposals are upside rather than a dependency |
| A tool named without a working demo | Credibility damage | Name a tool only with CI or a demo its maintainers have seen |
| Formula coverage stalls on metrics needing fields that do not exist | Compiler and drift cover Core only | Field additions proposed and reviewed centrally; `notComputable` with a reason is an acceptable outcome |
| Design partners' data is messier than CEL templates expect | Partners stall below L3 | Start templates with Stripe and Salesforce; treat every partner failure as a new check or template |

**Resolved since v0.3**

- The standard is public through the mirror, with governance and contribution documents.
- Phase 1 shipped: the ontology, reference model and mapping are generated, pass the upstream validator and GASP's checks in CI on both repositories.
- The compiler has dialects (Postgres, Snowflake, BigQuery, Databricks), so P0 asks only for the two enum values.
- Breakdowns are part of the grammar, including labels reached through a key and bucketed expressions.
- Who represents GASP in the working groups: the author, as an individual contributor.

**Resolved since v0.2**

- Formulas are stored as structured expressions in a tested grammar (`standard/formulas.json`), so the compiler can automate fully for any metric with a formula.
- O-form and M-form compile to separate Ossie metrics; the form travels in the extension.
- The exporter is TypeScript, reusing the MCP server's loader, parser and formula grammar. Comparing drift by results removes the need for a Python SQL parser.
- v1 adapters are read and converted on load indefinitely, so there is no retirement date.

**Open questions**

- MCP telemetry: the server collects none, so adoption metrics need another source (npm downloads, mirror activity, the ecosystem listing).
- Resolved 2026-10-12: CEL names win (`mrr_start`, `event_type`, `customer_id`). Remaining question: which Ossie `ValueType` names the exporter derives from them.
- The questions for the working groups are listed in `docs/ossie-spike.md` and in the introduction plan in `TODO.md`.

**References**

- [Apache Ossie core spec](https://raw.githubusercontent.com/open-semantic-interchange/OSI/main/core-spec/spec.md) (confirm whether this has moved to `apache/ossie`)
- [Apache Ossie ontology schema](https://raw.githubusercontent.com/apache/ossie/main/ontology/ontology.json)
- [Ossie incubator announcement](https://ossie.apache.org/updates/ossie-enters-apache-incubator/)
- [Ossie ecosystem page](https://ossie.apache.org/ecosystem/)
- [Ossie discussion #277: reified relationships proposal](https://github.com/apache/ossie/discussions/277)
- [Ossie PR #113: datatype field](https://github.com/apache/ossie/pull/113)
- [GASP overview](https://gaspwiki.com/v1/overview)
- [GASP adapter spec](https://gaspwiki.com/v1/adapter)
- [GASP AI tools and knowledge graph](https://gaspwiki.com/v1/tools)
