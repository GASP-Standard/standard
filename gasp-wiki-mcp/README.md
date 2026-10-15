# gasp-standard-mcp

MCP server for the [GASP Standard](https://gaspwiki.com), the Generally Accepted SaaS Principles standard for metric definitions, formulas, benchmarks and relationships.

Works with Claude Code, Claude Desktop or any [MCP](https://modelcontextprotocol.io/)-compatible client. The package bundles a copy of the standard, so it runs offline. I maintain the standard and this server together. Each release carries the standard as it stood on the day I published it.

## Install

### Claude Code (one command)

```bash
claude mcp add gasp-standard -- npx -y gasp-standard-mcp
```

### Manual config

Add to your project `.mcp.json` or `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "gasp-standard": {
      "command": "npx",
      "args": ["-y", "gasp-standard-mcp"]
    }
  }
}
```

Restart your MCP client after adding the config.

## Tools

| Tool | Description |
|------|-------------|
| `lookup_metric` | Full record for one metric: department, category, signal type, definition, formulas as written, the canonical formula with unit, forms, variants and breakdowns, benchmarks, validation rules, common mistakes, sources, aliases, the entities it measures, operating and market forms, the recommended sensitivity tier and access scope and the page URL. Matches exactly, ignoring case: formula id, graph node id, name with or without its abbreviation, abbreviation, graph label, alias or slug, with the full record preferred over a cross-reference stub. A name two departments define (Activation Rate) lists each candidate with department, formula id and URL; prefix the department ("Product Activation Rate") or pass the formula id. A glossary term returns its definition and a miss returns close names (misspellings included) |
| `lookup_definition` | Glossary term lookup (e.g. Signal Type, Sensitivity Tier, Access Scope, Metric Owner, CEL): full definition, section, canonical or reference link, where it is used and page URL. Matches the term, its slug or either part of "Term (Abbreviation)" exactly; a metric name points to `lookup_metric` and a miss returns close terms |
| `list_metrics` | Metric names grouped by department and category, optionally filtered by department (case-insensitive, spaces or hyphens; an unknown name returns close names and the department list) and signal type (`outcome`, `leading`, `efficiency`, `operational`, primary or secondary). The Core tier is the Core department |
| `get_formula` | Canonical formula in the GASP formula grammar, with unit, O/M forms, named variants, breakdowns (field, bucket and total mode), notes, input metrics with role and polarity, the fields and datasets the formula and each form read and the enum filters each form applies (CAC-O reads `cost_function in (gtm, implementation, onboarding)`, CAC-M `cost_function = gtm`), then the formula as written in the standard. Metrics that cannot be computed carry the reason |
| `get_relationships` | One node of the relationship graph (metric, entity or concept) with its direct edges: upstream, measured by, downstream and measures. 21 relationship types across signal, lifecycle, ownership, interaction and financial flow categories. Metric names resolve as in `lookup_metric`, ambiguity included; a metric outside the graph says so. An entity also lists every metric whose formula reads its datasets (from `entityMappings`), with department and URL |
| `get_data_requirements` | Data requirements for one metric, a department or every metric with a formula: per metric, each field and dataset pair with its type, the staged flag, source, grain, frequency, page URL and example SQL. The metric resolves exactly as in `lookup_metric`; `department` lists a department or picks between metrics sharing a name. Optional `breakdown` names a breakdown the metric declares (`by_plan` on MRR) and returns that breakdown's requirement: the dimension among the fields and example SQL with one row per value; an unknown name lists the declared ones. Optional `dialect` (`postgres` by default and for Redshift, `snowflake`, `bigquery`, `databricks`) writes the example SQL for that warehouse |
| `search` | Whole-word phrase search across metrics (names, aliases, definitions, formulas, fields, categories, departments) and glossary terms (terms, definitions, sections); the last word may take a plural or verb ending. Up to 10 results, one per metric or term, ranked name, alias and term first, then words within them, then definitions, then formulas and fields, each with what matched and its gaspwiki.com URL. A query that matches nothing returns up to 6 close names as "Did you mean" |
| `generate_query` | Compile warehouse SQL from the metric's canonical formula and an adapter. One scalar subquery per aggregate, each reading the table mapped for its dataset, with `:period_start` and `:period_end` date parameters (both inclusive). Unmapped pairs stay as `{{field@dataset}}` placeholders and are listed with any dataset lacking a table and any mapping conflict. Optional `breakdown` names a breakdown the metric declares (`by_plan` on MRR) and returns one row per value; an unknown name lists the declared ones. Optional `dialect` (`postgres`, `snowflake`, `bigquery`, `databricks`; `postgres` also covers Redshift) picks the SQL syntax for date arithmetic, casts and percentiles; without it the adapter's `warehouse` decides when it names one of them, else postgres. The output says which dialect it used |
| `validate_adapter` | Validate a GASP adapter. Applies the bundled adapter JSON Schema (draft 2020-12, versions 1.0 and 1.1) first and lists each violation with its JSON path, then reports unknown fields and datasets, fields mapped to a dataset that does not carry them, bare column names on fields that live on several datasets, dataset table conflicts, enum fields mapped without a transform, covered metrics without an owner and owners naming unknown metrics. Scores every metric with a formula against the exact field and dataset pairs its compiled SQL reads (full, partial with the missing pairs or none) and ranks up to 15 unmapped pairs by how many partially covered metrics need them |
| `infer_drivers` | Diagnose what could explain an observed metric movement: up to 25 upstream candidates ranked by attenuation score, each with its implied direction and path. Direction flips across `reduces` edges and negative-polarity inputs; a baseline input (MRR read at period start by NRR) is listed but not walked through. Metric nodes only; `maxDepth` 1 to 8 (default 6) |
| `explain_path` | Up to 5 forward edge chains from one graph node to another, shortest first, with edge type, classification (metric_signal / structural / lifecycle / behavioral / assignment / generative), attenuation and direction flips per step and the target's end direction per path. A baseline edge can only start a path |
| `coverage_gap` | Audit a metric set: metrics with a direct edge into or out of it that it leaves out, plus graph metrics with no path to or from it. Inputs that are ambiguous, outside the graph or not metrics are listed as unresolved with the reason |

The traversal tools (`infer_drivers`, `explain_path`, `coverage_gap`) return paths, edge classifications and attenuation scores. A score says how strongly the graph connects two metrics, never how far one will move. The tools chain: `infer_drivers` picks candidates, `explain_path` shows the chain behind one and `coverage_gap` checks whether you measure it. For "what if" simulation, use the [TWIN Modifier](https://gaspwiki.com/v1/twin-modifier).

## Data

Version 1.16.0.

- 306 metrics across 13 departments
- 94 glossary definitions (81 SaaS domain + 13 GASP framework)
- 100 relationship nodes (65 metrics + 28 entities + 7 concepts), 200 edges
- 21 relationship types: metric signal (drives, reduces, predicts, component, measures), entity lifecycle (converts_to, parent_of, belongs_to), entity ownership (owns, grants, priced_by), entity interactions (manages, serves, engages_via, submits, represented_by, sources), entity financial flows (generates, produces, contributes_to, incurs)
- 279 data requirements, one per metric with a formula, compiled from the formula at load time: fields with types, datasets, grain and a compiled example query
- 279 query templates, one per metric with a formula, compiled by the same step. None of the SQL is hand-written. Every field placeholder names the dataset it is read from (`{{customer_status@customer}}`), so `generate_query` resolves per-dataset adapter mappings by tag, inside cohort subqueries too. The grammar's `window(expr, n unit)` gives Daily, Weekly and Monthly Active Users (DAU, WAU, MAU) their 1, 7 and 30 day windows. `all_time(expr)` lets retention numerators read past the period end. A multi-argument `count_distinct` counts distinct tuples (Breadth of Adoption counts account and feature pairs). A formula with a `breakdown` field compiles to one row per value of that field, with `total(expr)` reading the whole population for shares of total (Ticket Distribution by Type, CAC by Channel)
- The test suite executes every compiled template against a seeded fixture in an in-process Postgres (PGlite) and checks 25 metrics against independently computed values
- Apache Ossie (incubating) export, written by `npm run derive` to `standard/exports/ossie/` and served at https://gaspwiki.com/downloads/ossie/: `gasp.ontology.yaml` (every dataset and GASP concept as an entity type, every field as a value type or relationship, enum values as constraints), `gasp.semantic_model.yaml` (every dataset with `OSSIE_SQL_2026` field expressions, the foreign-key relationships between them and every canonical formula as a metric, either a direct expression or staged through a per-period dataset that carries the compiled SQL; O/M forms and variants are separate metrics with the form in `custom_extensions`), `gasp.mapping.yaml` (the ontology mapped onto the model) and `coverage.json` (how each formula was exported and why). All three documents pass the upstream validator (vendored at `ossie-validator/`) and GASP's own cross-reference checks in `src/ossie/check.ts`, which cover references the upstream validator leaves alone
- 28 business entities (Customer, Subscription, License, Lead, Opportunity, User, Ticket, Employee, Invoice, Partner, Project, Plan, Product, Campaign, Contact, Incident, Deployment, Release, Issue, Vulnerability, Feature, Requisition, Project Milestone, Deliverable, Quote, Order, Knowledge Article and Deal Registration). Every dataset with its own identity maps to an entity; ledger and period-level facts (cost events, financials, forecasts, web traffic) stay entity-free
- 7 business concepts (Revenue, Bookings, COGS, Cohort, Pipeline, Segment and TCV)
- 268 canonical fields across 52 datasets (event, snapshot and fact tables with date and key fields, entities, CEL class and activation rules). Enum fields declare their allowed values
- 65 structured formulas with decomposed inputs (metric refs + field refs, with baseline inputs marked)
- Canonical formulas for every metric in the GASP formula grammar (`standard/formulas.json`): 294 entries covering all 306 metrics (279 with formulas, 15 marked not computable with a reason, 2 department-qualified ids for shared headings), with units, O/M forms for ARR, NRR, CAC, LTV, LTV:CAC, CAC Payback and Gross Margin (a form can reference another metric's form, `metric.gross_margin.O`) and variants such as Adjusted NRR (served by `get_formula` and compiled by `generate_query` and `get_data_requirements`)
- Access control classifications for every graph metric (sensitivity tier + access scope)
- CEL `change_nature` field for revenue quality analysis (Adjusted NRR/GRR) and `segment` on revenue, contract and amendment events, so MRR, retention and churn metrics break down by customer segment
- Per-department cross-references (NRR under Customer Success, CAC under Marketing) resolve to the full canonical record, with its access classification, structured formula and entity mappings
- Every metric and definition result carries its gaspwiki.com page URL; definitions keep their full body and reference links
- Adapter schema 1.1 (`standard/gasp-adapter-schema.json`, JSON Schema draft 2020-12, served at https://gaspwiki.com/schemas/gasp-adapter-v1.json): a `datasets` map, per-dataset mappings (a mapping names its `dataset`), informational fields and `$schema`. The schema travels in the bundled data as `adapterSchema` and `validate_adapter` applies it with Ajv, so validation works offline. `npm run derive` writes a ready template to `standard/exports/gasp-adapter-template.json` (served at https://gaspwiki.com/downloads/gasp-adapter-template.json) and the tests validate it against the schema
- Sources: the canonical [GASP Standard](https://gaspwiki.com) files

## Examples

Once installed, ask your AI assistant:

**Definitions and structure**
- "What is NRR?"
- "How do I calculate CAC Payback?"
- "What drives ARR?"
- "How does Customer relate to Subscription?"
- "What sensitivity tier is CAC classified as?"
- "What does confidential mean in GASP?"
- "How does Plan relate to Subscription?"
- "Which campaigns source leads into the pipeline?"
- "List all marketing metrics"
- "What data do I need to implement ARR tracking?"
- "Search for churn"

**Diagnosis, exploration and coverage**
- "ARR is down this month. What could explain it?" (`infer_drivers`)
- "How does Health Score eventually affect NRR?" (`explain_path`)
- "We track ARR, NRR, GRR, CAC and CAC Payback. What important metrics are we missing?" (`coverage_gap`)
- "Why might NRR be slipping? Trace the path back through Health Score." (composes `infer_drivers` and `explain_path`)

## License

Apache-2.0. Source: https://github.com/GASP-Standard/standard (the standard itself is CC BY 4.0, see `standard/LICENSE` there).
