# GASP × Apache Ossie: Native Spec v0.3

Oct 12, 2026 · Gareth O'Shea

## TL;DR

GASP becomes the first Ossie-native domain standard. A company points GASP at its warehouse, or at the Ossie model it already has, and comes out with one GASP mapping, a ranked fix list and a published Ossie model with canonical SaaS metrics in it. Every file the customer receives is plain Apache Ossie (incubating). GASP extends Ossie only where the spec cannot yet express SaaS metrics, and every extension is paired with an upstream proposal that would retire it.

Today the [Ossie ecosystem page](https://ossie.apache.org/ecosystem/) lists 60+ organizations, and every detailed entry is a tool: converters, engines, BI imports. None ships domain content. That is the gap GASP fills.

**Done looks like:**

- A GASP Ossie ontology document, generated from `/standard/` and validated against the Ossie schema in CI
- One mapping format: an Ossie `ontology_mappings` document. Customers without an Ossie model get one generated from a profile of their warehouse
- A SaaS reference model merged into `apache/ossie/examples/`, next to the existing TPC-DS model
- A GASP card on the Ossie ecosystem page, described as Ossie-native
- A runnable demo: a public Snowflake or Databricks Ossie example mapped to GASP, scored for drift and executed by an existing Ossie engine
- Upstream proposals that retire GASP extensions, at least one under discussion in a working group

## Background

Ossie and GASP sit at different layers, so the fit is additive. Ossie says how a semantic model is written down; GASP says what a SaaS company's metrics mean.

|  | Apache Ossie (incubating) | GASP |
| --- | --- | --- |
| What it is | Vendor-neutral spec for semantic models and ontology | Canonical SaaS metric standard |
| Core objects | Datasets, fields, FK relationships, metrics, `ai_context`, `custom_extensions` | 300 metrics, 93 definitions, 263 canonical fields in 51 datasets, 28 entities, 7 concepts, 22 source categories |
| Expressions | SQL strings per dialect (ANSI, Snowflake, BigQuery, Databricks, MDX, Tableau, MAQL) | GASP formula grammar (warehouse-agnostic) plus 269 query templates compiled from the formulas |
| Ontology | Separate doc: `EntityType` / `ValueType` concepts, relationships with roles, `verbalizes`, mappings to semantic models | `ontology.json` plus a relationship graph of 95 nodes and 183 edges across 21 edge types |
| Spec version | 0.1.1 released; 0.2.0.dev0 in development | v1 |
| Governance | ASF Incubator: public lists, discussion-and-vote, three working groups (Metric Language, Catalog, Ontology) | One maintainer (Gareth O'Shea) |
| License | Apache 2.0 | Content CC BY 4.0, code Apache 2.0 |

Momentum on the Ossie side is real. The project reports 100+ commits and 35 merged PRs from Snowflake, Dremio, Salesforce, Databricks, dbt Labs, RelationalAI, GoodData and Honeydew, and growth from 17 launch partners to 50+ organizations ([announcement](https://ossie.apache.org/updates/ossie-enters-apache-incubator/)). Snowflake imports and exports Ossie YAML natively, and an Iqea DuckDB extension executes Ossie models directly ([ecosystem](https://ossie.apache.org/ecosystem/)).

GASP already has the pieces a domain package needs: canonical definitions, an adapter that maps warehouse columns to canonical fields, and an MCP server that exposes formulas, data requirements, SQL generation and graph reasoning ([tools](https://gaspwiki.com/v1/tools)). What it lacks is a home format that other tools already read. Ossie is that format.

## Readiness review: what GASP does today

GASP today serves a company that already has a clean, modelled warehouse and wants consistent definitions. It does not yet serve the target persona: a company that knows its data isn't ready for LLMs and doesn't know what to do. This review checked the published site and the code of `gasp-standard-mcp` v1.11.0.

| Capability the persona needs | Status today | Evidence |
| --- | --- | --- |
| A target shape for clean data | Strong | CEL defines five immutable event classes; ATL defines strict tagging rules |
| Canonical definitions agents can read | Strong | 300 metrics, 93 definitions, 12 MCP tools |
| Machine-readable formulas | Strong | `standard/formulas.json` in the GASP formula grammar: all 300 metrics covered (273 formulas, 15 marked not computable with reasons), parsed and resolved by the test suite |
| Starting from raw data | Missing | The MCP has no warehouse access and returns SQL only |
| Coverage assessment | Good | `validate_adapter` (adapter schema 1.1) checks schema validity, unknown fields and datasets, table conflicts and enum fields without a transform, and scores coverage per metric against the fields its formula needs. No value-distribution, key or freshness checks yet |
| Ownership enforced | Strong | `validate_adapter` flags every covered metric that has no owner in `metricOwners` |
| Definition drift | Pattern only | "Board deck audit" is an agent pattern; no tool computes drift |
| Metrics computed from CEL | Partial | The 273 query templates are compiled from formulas and read the CEL event datasets (51 datasets, each with its CEL class) wherever the formula does. Metrics whose formulas use snapshot or fact datasets still read those tables |
| Raw source to CEL mappings | Missing | CEL is source-agnostic by design; no Stripe, Chargebee or Salesforce mappings exist |
| Correct multi-table SQL | Strong | `generate_query` compiles one scalar subquery per aggregate, each from the table mapped to that field's dataset |
| A prioritised fix plan | Partial | `validate_adapter` ranks the highest-value next fields to map by the metrics each unlocks. No effort weighting, checks or fix list for data quality yet |

**Raw material for readiness checks already exists.** CEL rows carry a built-in invariant (`prior_mrr + mrr_change = new_mrr`). ATL requires exactly one tag per dimension per event. The Core O/M bridges carry explicit reconciliation formulas, such as CAC-O = CAC-M + implementation and onboarding cost per customer. All of these compile to SQL tests.

**Consistency fixes before any public push**

- The source repository is private, so the "Code under Apache 2.0" link returns 404 and the npm package declares no repository. An open-source claim to the Ossie community needs a public repo.
- Site counts are derived from the data build and guarded by tests (fixed 2026-10-12).
- Depth is uneven: 273 of 300 metrics have data requirements (compiled from formulas), 11 have common-mistakes notes and Core O/M inclusion rules are marked as planned.
- The field vocabulary needed reconciling before the ontology document is published, because Ossie `ValueType` concepts make the vocabulary public. It had near-duplicates, fields that were really metrics (`arr`, `cac`, `ltv`) and CEL field names that differed from ontology field names. Canon decisions made 2026-10-12 settled the naming, and the canonical ids now live in `ontology.json` `fields`: CEL names win (`customer_id`, `event_type`, `cost` with `cost_function` and `cost_type`, `contract_event_type`, `amendment_type`) and ATL values are lowercase snake_case.

## Goals, non-goals and success metrics

The goal is to be the SaaS answer inside Ossie, measured by merges and listings, not by our own claims.

**Goals**

1. A company with messy data can go from "we don't know" to a ranked fix list in one agent session, and to an Ossie-native model without hiring a semantic-layer specialist.
2. Every file a customer receives from GASP is valid Ossie, with no lossy conversion step.
3. Any Ossie model, from any vendor, can be mapped to GASP and scored for coverage and definition drift.
4. Every GASP extension has a named upstream proposal that would retire it.
5. Existing v1 adapters keep working, read as input and converted on load.

**Non-goals**

- Forcing the metric canon into Ossie before the spec can hold it. Blobs in `custom_extensions` that other tools ignore would be native in name only.
- Pushing GASP's opinions into Ossie core. The canon stays GASP's; only format gaps go upstream.
- Usage-based pricing metrics, which GASP itself scopes out.

**Success metrics**

| Metric | Target | How we measure |
| --- | --- | --- |
| GASP ontology validates against the Ossie ontology schema | Every build | CI |
| Metrics with a canonical formula or a stated `notComputable` reason | 300 of 300 (met 2026-10-12) | `formulas.json` coverage test |
| Reference model in `apache/ossie/examples` | 1 | PR merged |
| Ecosystem card live | 1 | Listed on ossie.apache.org/ecosystem |
| Vendor Ossie exports mapped to GASP natively | 2+ (Snowflake, Databricks) | CI fixtures |
| Ossie tools shown running a GASP-mapped model | 3+ | Recorded demos |
| Upstream proposals opened | 4 | GitHub Discussions + dev@ thread |
| GASP extension keys retired by upstream merges | 1 within 12 months | Extension schema changelog |
| Design partners taken from L0 to L3 on real messy data (after launch) | 3 | Readiness reports |
| Time from first session to ranked fix list | Under 1 day | Design-partner logs |

## Architecture

`/standard/` stays the hand-edited source of truth. Everything the customer and the Ossie community see is generated from it and validated against Ossie's own schema (in CI once CI is set up).

| Layer | Hand-edited | Generated | Format |
| --- | --- | --- | --- |
| Canon | `ontology.json`, `formulas.json`, metric markdown | | GASP |
| GASP ontology | | `gasp-saas.ontology.yaml` | Ossie ontology |
| Customer mapping | Decisions only (owners, currency, identity) | Everything else, from profile or existing Ossie model | Ossie `ontology_mappings` |
| Customer model | | Compiled metrics and staged datasets added to their model | Ossie semantic model |
| Extension data | | `custom_extensions` under `vendor_name: GASP` | Ossie, plus a published JSON Schema |

**Why generated, not hand-edited Ossie.** The Ossie ontology spec is `0.2.0.dev0` and may change. Generating the Ossie files keeps spec churn inside one exporter and its golden-file tests, instead of breaking the authoring flow for 300 metrics. GASP data that Ossie cannot hold yet (metric-to-metric edges, access classifications, temporal semantics) stays in one place rather than splitting across two sources. The published files are fully native either way. Revisit when the ontology spec reaches 1.0.

## The pipeline

One pipeline, five readiness levels. Each step writes a file the next step reads, so a company can stop anywhere and still have something useful. Agents draft; people make the judgement calls; generated checks decide when something is ready.

| Level | Step | What happens | Output (Ossie-native) | MCP tool |
| --- | --- | --- | --- | --- |
| L0 Unknown | | Nothing run yet | | |
| L1 Profiled | Profile | Read schemas and aggregate statistics through the customer's warehouse MCP, or from a schema dump: keys, null rates, date ranges, distinct values. A company with an existing Ossie model skips straight to Map | A minimal Ossie semantic model (datasets, fields, keys) | `profile_schema` |
| L2 Mapped | Map | Columns matched to GASP fields by name, type and value patterns, each with a confidence score | Draft GASP mapping | `propose_mapping` |
| | Decide | Questions an agent cannot answer go to named people: which system owns customer identity, which currency is reporting currency, what date marks churn | Decisions with owners, stored in the mapping | `record_decision` |
| L3 Clean core | Build CEL | Source templates (Stripe, Chargebee, Salesforce, HubSpot first) generate dbt models from raw tables to CEL events with ATL tags | dbt project, delivered as a pull request | `generate_cel_models` |
| | Check | Tests compiled from GASP's own rules run against CEL | Pass/fail per check, per metric | `generate_checks` |
| | Plan | Failing checks ranked by how many metrics each fix unlocks, Core first, weighted by effort | Ranked fix list | `plan_fixes` |
| L4 LLM-ready | Publish | Canonical metrics compiled into the customer's model; coverage, checks and drift re-run on a schedule | Published Ossie model, readiness report | `compile_metrics`, `score_drift`, `readiness_report` |

### One mapping format

The v1 adapter and the Ossie mapping merge into one format: an Ossie mapping document (`ontology/mapping.json` in the Ossie repo). A mapping is its own file that references one ontology and one semantic model by name, each with an optional `iri` saying where to resolve it from. The Profile step means every customer has an Ossie semantic model to map from, whether they exported it from Snowflake or GASP generated it from their schema. v1 adapters are accepted as input and converted on load, so nothing breaks and no separate migrator is needed. Embedding mappings inside the ontology document (`ontology_mappings`) is deprecated upstream; the exporter writes that form only while converters still need it.

| Adapter v1 | GASP mapping (Ossie) | Notes |
| --- | --- | --- |
| `warehouseRef` table | The customer's `datasets[]` | From their Ossie export or the profile |
| `gaspField` to column | `link_mappings` on GASP relationships, e.g. Subscription on Date carries Mrr | `expression` holds the column or computed value; a snapshot field is a two-level tree (key, date, value) |
| `transform` (`{{value}} / 100`) | The mapping's `expression` | Portable SQL (`OSSIE_SQL_2026`) |
| Entity identity (`customer_id`) | `object_mappings` with `referent_mappings` on the concept's `identify_by` relationship | |
| Keys and joins | The customer's `primary_key` and `relationships` | |
| `metricOwners`, field `owner`, `notes`, decisions | `custom_extensions`, `vendor_name: GASP` | No core slot yet |

**Worked example.** `docs/ossie-spike/` holds a hand-written ontology, semantic model and mapping for the NRR subset. All three pass the upstream validator; `docs/ossie-spike.md` records what it does and does not check (2026-10-13).

**Imports.** Because the mapping document references the GASP ontology by `name` and `iri`, the customer file no longer carries a copy of it. What remains for proposal P4 is catalog resolution by name and converter support for standalone mapping documents, which upstream says is not yet available.

**Validation.** `validate_adapter` becomes `validate_mapping`: Ossie schema validity first, then GASP's own cross-reference checks (the upstream validator does not confirm that a mapping's concepts and relationships exist in the ontology, or that a metric's dataset and field references exist), then coverage computed from the concept mappings, then field types and recommended owners.

### Metric compiler

The compiler reads `standard/formulas.json` and the customer's mapping, and emits Ossie `metrics[]` into the customer's model. It only emits metrics whose fields are all mapped; the rest go into the coverage report. Generated metrics carry a `gasp_` prefix so they never collide with the customer's own, and O/M forms compile to separate metrics (`gasp_nrr_o`, `gasp_nrr_m`).

Canonical formulas are written in the GASP formula grammar: arithmetic over `metric.` refs, aggregates over `field.` refs with `where` filters, `at period_start|period_end` snapshots, `lag()` and `over cohort()`. Ratios are unscaled with a separate `unit`. Every formula is parsed, resolved against the ontology and checked for cycles by the test suite.

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

Formulas that use `cohort` or `lag` compile to a plain aggregate over a staged dataset (`gasp_account_cohorts` here), which every Ossie engine can run today. An Ossie dataset's `source` may be a query, so the staged table's SQL travels inside the model. `OSSIE_SQL_2026` is the only dialect whose semantics Ossie defines; the compiler emits it first and warehouse dialects beside it. The grammar marks those metrics automatically, which makes them the exact test set for proposal P2.

### Drift scoring

1. Validate the input with the upstream Ossie validator.
2. Match the customer's metrics to GASP metrics by name, `ai_context.synonyms` and `description`; exact matches auto-accept, fuzzy ones go to review.
3. Run each matched pair (the customer's expression and the compiled canonical one) against the seeded synthetic SaaS dataset and compare the numbers. Where they differ, report the likely cause from the parsed canonical formula: numerator, denominator, filter, snapshot point or cohort.
4. Return coverage plus drift as one report: "your NRR reads 112%, canonical reads 104%, because expansion from accounts acquired during the period is included".

Comparing results rather than SQL text avoids having to prove two differently written queries equivalent, and gives a clearer demo.

### Readiness checks

Generated from rules GASP already has:

- CEL row identity: `prior_mrr + mrr_change = new_mrr` on every revenue and amendment event
- MRR continuity: each customer's ending MRR for a month equals the next month's starting MRR
- Unique, immutable `event_id`; corrections appear as adjustment events, never edits
- ATL completeness: exactly one lifecycle tag per event, one expansion tag where required, one cost function tag per cost event
- Identity reconciliation: every billing customer resolves to one CRM account, and the reverse
- O/M bridges: each Core bridge reconciles, e.g. CAC-O = CAC-M + implementation and onboarding cost per customer
- Freshness: latest event date per source is within the agreed sync window

### Changes to existing tooling

- Done: query templates and data requirements are compiled from `formulas.json` at load time, and the formulas read CEL event datasets directly. Remaining: move the snapshot and fact datasets onto CEL events
- Done: `generate_query` resolves a table per dataset, with one scalar subquery per aggregate
- Done: `validate_adapter` checks field and dataset names, enum transforms and metric owners. Remaining: value-distribution, key and freshness checks
- Done: `structuredFormulas`, `entityMappings` and field metric counts are derived from `formulas.json` by `npm run derive` and tested current
- Done (2026-10-13): the Ossie ontology, reference semantic model and mapping are written by `npm run derive` from `/standard/` (`gasp-wiki-mcp/src/ossie/`), validated by the vendored upstream validator and by GASP's own cross-reference checks. Every formula is a direct `OSSIE_SQL_2026` metric or a staged per-period dataset; `coverage.json` says which and why. Remaining: per-dialect staged sources; the P0 pull request; CI

**Safety.** Profiling reads schemas and aggregates only, never row-level customer data. Queries run with the invoking user's identity, as the governance framework already requires. Generated dbt code arrives as a pull request for a person to review.

## The GASP extension, designed to shrink

What Ossie cannot yet hold travels in `custom_extensions` under `vendor_name: GASP`, governed by a published JSON Schema. Every key has an exit: an upstream proposal that would move it into core, or an explicit decision that it is GASP-specific and stays. Shrinking this table is the measurable proof that GASP is Ossie-native, not Ossie-wrapped.

**Schema:** planned at `https://gaspwiki.com/schemas/gasp-ossie-extension-v1.json` (not yet published), versioned independently of the mapping.

| Level | Key | Content | Exit |
| --- | --- | --- | --- |
| Metric | Canonical formula over concepts | The GASP grammar expression before any warehouse exists | P3 (concept-level metrics) |
| Model | `metric_edges[]` | `{from, to, type, classification}` for `DRIVES`, `REDUCES`, `PREDICTS`, `COMPONENT_OF` | P1 (metric relationships) |
| Model | `gasp_version`, `ontology_version` | Which GASP release produced the file | Stays; provenance |
| Model | `metric_owners[]`, `decisions[]` | Who resolves definition disputes; recorded mapping decisions | Catalog WG candidate |
| Metric | `gasp_id`, `department`, `signal_type`, `layer`, `unit` | GASP taxonomy | Stays; GASP-specific |
| Metric | `form` | `O` (operating) or `M` (market); one Ossie metric per form | Stays; GASP-specific |
| Metric | `sensitivity`, `access_scope` | From the GASP governance framework | Catalog WG candidate |
| Field | `source_category`, `owner`, `notes` | Lineage and accountability | Catalog WG candidate |
| Field | `change_nature` | CEL permanence flag, where mapped | Stays; GASP-specific |

**Rules**

- Never duplicate core: if Ossie has a slot (description, synonyms, datatype), use it, not the extension.
- Consumers that ignore the extension still get a correct, runnable model.
- Every key that later lands upstream is deprecated in the extension with a pointer to the core field.

**What does not fit the Ossie ontology yet**

- **Metric edges** (`DRIVES`, `REDUCES`, `PREDICTS`, `COMPONENT_OF`). Ossie metrics are not ontology concepts, so there is nowhere to hang "Logo Churn reduces NRR". Modelling metrics as fake entity types would validate but mislead other tools. Extension now, proposal P1.
- **Financial flows** (`GENERATES`, `PRODUCES`, `CONTRIBUTES_TO`, `INCURS`) link entities to metrics such as Revenue or Pipeline. Where the target is a real business object (Invoice) it maps; where it is a metric, it waits for P1.
- **Source category lineage** (`SOURCED_FROM`) belongs to the Catalog working group's scope. Extension.

Everything else in the entity layer maps directly: entities to `EntityType` concepts, canonical fields to `ValueType` concepts with relationships from the entity, entity edges (`OWNS`, `GRANTS`, `CONVERTS_TO`, `PARENT_OF`, `PRICED_BY` and others) to `relationships[]` with `roles`, `multiplicity` and `verbalizes`, and segments to `extends` subtypes.

## Hard metrics and upstream proposals

Ossie metrics are single aggregate SQL expressions. That suits ARR or win rate, but not cohort or period-over-period metrics like NRR, GRR, LTV or CAC Payback. Locally, staged datasets solve it now (see the metric compiler). Upstream, these proposals retire the workarounds, in order of ease:

| ID | Proposal | Where it goes | Retires | Why GASP is credible here |
| --- | --- | --- | --- | --- |
| P0 | Add `REDSHIFT` and `POSTGRES` to the dialect enum | Small PR | ANSI_SQL fallback for Redshift customers | Low-risk first contribution; builds reviewer trust |
| P1 | Metric relationships: typed edges between metrics (drives, reduces, predicts, component of) | Ontology WG, via GitHub Discussions | `metric_edges[]` | 172 production edges; `infer_drivers` and `explain_path` as the consuming use case |
| P2 | Period-over-period and cohort metrics | Metric Language WG's work on advanced metric logic and windowing | Staged datasets | Every GASP formula using `cohort` or `lag` is a conformance test with a canonical answer |
| P3 | Concept-level metrics: a metric defined against ontology concepts, resolved to SQL through any model's ontology mapping | Ontology and Metric Language WGs jointly | Metric compiler and the canonical-formula extension | 300 warehouse-agnostic definitions in a tested grammar; the clearest case for why a domain standard needs this |
| P4 | Catalog resolution of `ontology_ref` by name and version, and converter support for standalone mapping documents | Ontology WG | Embedded-mapping fallback | The 0.2.0.dev0 mapping document already references the ontology by name and `iri`; what is missing is tooling that resolves it |

P3 is the big one. It lets a standard like GASP live entirely inside Ossie, and it benefits any future vertical (healthcare, retail, fintech), which makes it an easier sell than a SaaS-only change. The GASP formula grammar is a working prototype of what P3 would need to express.

Ossie's roadmap lists an expression language, advanced metric logic and windowing functions as priorities ([announcement](https://ossie.apache.org/updates/ossie-enters-apache-incubator/)). P2 should be framed as test cases for that work, not a competing design. A precedent for proposal format is the open proposal on reified relationships ([discussion #277](https://github.com/apache/ossie/discussions/277)): problem, gap, proposed syntax, schema change, worked example, validation tests.

## Credibility and adoption playbook

Logos come from three places, in rising order of value: our card on Ossie's page, other tools running our model, and merges in the Apache repo.

**1. Earn the Apache-repo merges (highest credibility)**

- Publish the standard and the MCP server through the public mirror `GASP-Standard/standard` (the monorepo with the site code stays private; a workflow mirrors the public paths on every push) and link it from gaspwiki.com and the npm package's `repository` field. History audited for secrets on 2026-10-13.
- Sign the ASF ICLA for every contributor before the first PR; add Apache license headers.
- Open with P0 (dialect enum). A small merged PR makes reviewers know the name before the big one.
- Post an intro in GitHub Discussions and on dev@ before submitting the reference model. Decisions there go through open discussion and vote, so surprise PRs stall.
- Contribute a compact SaaS reference model and ontology example under Apache 2.0. Keep the full 300-metric canon in GASP's repo, linked, so no CC BY content needs to enter the Apache tree.
- Join the Ontology and Metric Language working groups and show up to their meetings, not just their issues.

**2. Get our card on the ecosystem page**

Listing is a pull request to `apache/ossie-website` with a logo and a description. Ours:

- **SaaS ontology:** the first Ossie-native domain standard; entities, relationships and canonical metrics
- **Map any Ossie model to GASP:** one mapping, then coverage and definition drift in one call
- **GASP MCP:** one-line install; agents read canonical definitions and map models

Wait until the reference model PR is at least open, so the card links to real files.

**3. Get other tools running GASP (the logos that sell)**

The best targets are Ossie consumers with no content of their own, because a SaaS demo model solves their cold-start problem:

| Target | Why they'd say yes | Demo |
| --- | --- | --- |
| Iqea `duckdb-ossie` | Executes Ossie directly; has an MCP server example | GASP model + synthetic SaaS data, runnable in DuckDB in one command |
| Snowflake | Native Ossie import to Semantic Views | GASP model imported as a Semantic View, queried for NRR |
| Golden Analytics, Saiku, Veezoo, Datus | Import Ossie for AI-assisted analysis | GASP model loaded; one dashboard each |
| Hex, Sigma, Omni, Lightdash | SaaS-heavy customer bases, listed participants | Board-pack dashboard from the GASP model |

Ship one synthetic SaaS dataset (seeded, ~1,000 accounts, 24 months of CEL events) so every demo uses the same numbers, drift scoring has a common baseline and outputs can be checked against GASP's canonical answers.

**4. Make claims that survive scrutiny**

- Say "works with Apache Ossie (incubating)", not "Ossie-certified". ASF doesn't certify; follow its [trademark policy](https://www.apache.org/foundation/marks/) and use the full name on first mention.
- Show a partner logo only for a round-trip that passes in our CI or a demo the partner has seen.
- Publish a conformance badge driven by Ossie's own `validation/` tooling plus GASP's cross-reference checks: "Validates against Apache Ossie 0.x". The upstream validator checks document shape, ontology references and SQL syntax only (`docs/ossie-spike.md`), so the badge names both.

**5. Launch**

One coordinated week: reference model merged, ecosystem card live, a gaspwiki.com "GASP for Ossie" page, a blog post with the DuckDB demo and the drift report run on a public Snowflake or Databricks example, and a talk slot at an Ossie community meeting.

## Roadmap

About 16 weeks to launch, with community engagement from week 1 so upstream reviewers know us before the reference model PR lands. Each gate must pass before the next phase starts. Upstream review time is outside our control, so launch week moves with the reference model merge, not the calendar.

| Phase | Weeks | Work | Gate |
| --- | --- | --- | --- |
| 0. Hygiene | 1–2 | Done: MCP deploy prepared (1.11.1 built and dry-run clean), field vocabulary reconciled. Published 2026-10-13 (npm 1.12.0, push, deploy, secrets audit). Remaining: the public mirror repository and its token | Mirror public and linked from gaspwiki.com and npm |
| 1. Canon | 2–6 | Formulas, field vocabulary and enum values are done (288 formula entries, 263 fields, 51 datasets, CEL names adopted). Spike and exporters done 2026-10-13 (`docs/ossie-spike.md`, `gasp-wiki-mcp/src/ossie/`, output at `/downloads/ossie/`). Remaining: raw-source mappings; synthetic dataset growth; P0 PR and community intro; CI | Ontology, model and mapping pass the upstream validator and GASP's own checks, in CI once CI exists |
| 2. Native model | 6–10 | Mapping format and `validate_mapping`; metric compiler and staged datasets; reference model PR; DuckDB demo | Reference model PR open; compiled Core runs in DuckDB |
| 3. Drift and on-ramp | 10–16 | Drift scorer; profiler; CEL source templates (Stripe, Salesforce first); readiness checks and fix plan; P1 to P4 drafted | Drift report on a public vendor example; synthetic data reaches L4 |
| Launch | 16+ | Ecosystem card, "GASP for Ossie" page, blog, community talk | Reference model merged |
| Prove | after launch | Three design partners on real messy data | One partner at L3 |

Design partners move after launch so the launch depends on our own work, not on partner recruitment or how messy their data turns out to be. Partner failures become new checks or templates, not one-off fixes.

## Risks, open questions and references

**Risks**

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Spec churn: the ontology spec is 0.2.0.dev0 and may change | Generated files break between releases | Ossie files are generated, so churn lands in one exporter; pin the schema by commit; golden-file tests per version; attend the Ontology WG |
| Ontology mapping semantics are thinly documented | We build on a misreading | Confirm the mapping example with the Ontology WG before building tooling |
| No cross-document imports | Bundled copies of the GASP ontology drift | Bundler pins the GASP version; P4 removes the need |
| "Opinionated by design" reads as one vendor setting the standard | Maintainers resist | Contribute format gaps and examples upstream; keep the canon in GASP's repo |
| Single-company project inside an ASF community | Seen as marketing | Contribute review time and small fixes, not just our own PRs |
| Licence mismatch: GASP content is CC BY 4.0 | Content blocked from the Apache tree | Contribute a small Apache 2.0 example; confirm ASF third-party licence policy before any content moves |
| P1 to P4 rejected or slow | Extension and tooling stay longer | The native layer stands on its own; proposals are upside, not a dependency |
| Partner logo used without a working demo | Credibility damage | Logo shown only with CI or a partner-seen demo |
| Formula coverage stalls on metrics needing fields that don't exist | Compiler and drift cover Core only | Field additions proposed and reviewed centrally; `notComputable` with a reason is an acceptable outcome |
| Design partners' data is messier than CEL templates expect | Partners stall below L3 | Start templates with Stripe and Salesforce; treat every partner failure as a new check or template |

**Resolved since v0.2**

- Formulas are now stored as structured expressions in a tested grammar (`standard/formulas.json`), so the compiler can automate fully for any metric with a formula.
- O-form and M-form compile to separate Ossie metrics; the form travels in the extension.
- `gasp-ossie` is TypeScript, to reuse the MCP server's loader, parser and formula grammar. Comparing drift by results removes the need for a Python SQL parser.
- v1 adapters are read and converted on load indefinitely, so there is no retirement date.

**Open questions**

- Who represents GASP in the Ontology and Metric Language working groups? Proposals P1 to P4 need a named champion.
- Do we collect MCP telemetry? If not, adoption metrics need another source.
- Resolved 2026-10-12: CEL names win (`mrr_start`, `event_type`, `customer_id`). Remaining question: which Ossie `ValueType` names the exporter derives from them.

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
