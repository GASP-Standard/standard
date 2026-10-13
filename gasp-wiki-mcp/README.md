# gasp-standard-mcp

MCP server for the [GASP Standard](https://gaspwiki.com), the Generally Accepted SaaS Principles standard for metric definitions, formulas, benchmarks and relationships.

Works with Claude Code, Claude Desktop, or any [MCP](https://modelcontextprotocol.io/)-compatible client.

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
| `lookup_metric` | Full metric details: definition, formula, benchmarks, entity, common mistakes, sources and page URL. Matches exactly (name with or without its abbreviation, abbreviation, alias, slug or graph label) and suggests close names instead of guessing. Falls back to glossary terms when no metric matches |
| `lookup_definition` | Glossary term lookup (e.g. Signal Type, Sensitivity Tier, Access Scope, Metric Owner, CEL): full definition, section, canonical or reference link and page URL. Matches exactly and suggests close terms instead of guessing |
| `list_metrics` | List all metrics, optionally filtered by department and/or signal type |
| `get_formula` | Canonical formula in the GASP formula grammar, with unit, O/M forms, variants, inputs with polarity, raw fields and the datasets they live in. Metrics that cannot be computed carry the reason |
| `get_relationships` | Upstream/downstream relationships for metrics, entities or concepts. 21 relationship types across signal, lifecycle, ownership, interaction and financial flow categories |
| `get_data_requirements` | Data requirements for implementing a metric: fields, types, grain, source and example SQL |
| `search` | Full-text search across metrics, definitions and data requirements. Metric and definition hits include their gaspwiki.com URL |
| `generate_query` | Compile warehouse-specific SQL from the metric's canonical formula and an adapter mapping. One scalar subquery per aggregate, each reading the table mapped for its dataset, with `:period_start` and `:period_end` parameters. Unmapped fields stay as `{{field@dataset}}` placeholders. Matches the metric exactly and suggests close names instead of guessing |
| `validate_adapter` | Validate a GASP adapter mapping file (schema 1.1). Reports schema-level problems, unknown fields and datasets, dataset table conflicts, enum fields mapped without a transform and covered metrics without an owner. Computes coverage per metric against the exact field and dataset pairs its compiled SQL reads (full, partial or none) and ranks the highest-value next pairs to map |
| `infer_drivers` | Diagnose what could explain an observed metric movement: ranked upstream candidates with paths and per-step edge classifications |
| `explain_path` | Enumerate edge chains between two metrics, with classification (metric_signal / structural / lifecycle / behavioral / assignment / generative) per step |
| `coverage_gap` | Audit a metric set: identify one-hop upstream/downstream metrics not in the set, plus any disconnected metrics |

The traversal tools (`infer_drivers`, `explain_path`, `coverage_gap`) return *structure* (paths, classifications, attenuation scores), not numeric forecasts. They serve diagnosis, exploration and coverage-audit workflows respectively and compose: use `infer_drivers` to pick candidates, `explain_path` to scrutinise a chain, then `coverage_gap` to check whether the candidate is being measured. For counterfactual "what if" simulation, use the [TWIN Modifier](https://gaspwiki.com/v1/twin-modifier).

## Data

Version 1.12.0.

- 300 metrics across 13 departments
- 92 glossary definitions (80 SaaS domain + 12 GASP framework)
- 82 relationship nodes (60 metrics + 15 entities + 7 concepts), 172 edges
- 21 relationship types: metric signal (drives, reduces, predicts, component, measures), entity lifecycle (converts_to, parent_of, belongs_to), entity ownership (owns, grants, priced_by), entity interactions (manages, serves, engages_via, submits, represented_by, sources), entity financial flows (generates, produces, contributes_to, incurs)
- 270 data requirements, one per metric with a formula, compiled from the formula at load time: fields with types, datasets, grain and a compiled example query
- 270 query templates, one per metric with a formula, compiled from the formulas by the same step (no hand-written SQL). Every field placeholder names the dataset it is read from (`{{customer_status@customer}}`), so `generate_query` resolves per-dataset adapter mappings by tag, including inside cohort subqueries. The grammar's `window(expr, n unit)` gives DAU, WAU and MAU their 1, 7 and 30 day windows and `all_time(expr)` lets retention numerators read past the period end; intervals are emitted in units Postgres accepts
- The test suite executes every compiled template against a seeded fixture in an in-process Postgres (PGlite) and checks ten metrics against independently computed values
- Apache Ossie (incubating) export, written by `npm run derive` to `standard/exports/ossie/` and served at https://gaspwiki.com/downloads/ossie/: `gasp.ontology.yaml` (every dataset and GASP concept as an entity type, every field as a value type or relationship, enum values as constraints), `gasp.semantic_model.yaml` (the 47 datasets with `OSSIE_SQL_2026` field expressions, 40 foreign-key relationships and every canonical formula as a metric: 164 direct expressions, 138 staged through per-period datasets that carry the compiled SQL, O/M forms and variants as separate metrics with the form in `custom_extensions`), `gasp.mapping.yaml` (the ontology mapped onto the model) and `coverage.json` (how each formula was exported and why). All three documents pass the upstream validator, vendored at `ossie-validator/`, plus GASP's own cross-reference checks (`src/ossie/check.ts`), which catch what the upstream validator does not
- 15 business entities (Customer, Subscription, License, Lead, Opportunity, User, Ticket, Employee, Invoice, Partner, Project, Plan, Product, Campaign and Contact)
- 7 business concepts (Revenue, Bookings, COGS, Cohort, Pipeline, Segment and TCV)
- 251 canonical fields across 47 datasets (event, snapshot and fact tables with date and key fields, entities, CEL class and activation rules). Enum fields declare their allowed values
- 59 structured formulas with decomposed inputs (metric refs + field refs)
- Canonical formulas for every metric in the GASP formula grammar (`standard/formulas.json`): 289 entries covering all 300 metrics (270 with formulas, 19 marked not computable with a reason, 2 department-qualified ids for shared headings), with units, O/M forms for ARR, NRR, CAC, LTV and Gross Margin (a form can reference another metric's form, `metric.gross_margin.O`) and variants such as Adjusted NRR (served by `get_formula` and compiled by `generate_query` and `get_data_requirements`)
- Access control classifications for every graph metric (sensitivity tier + access scope)
- CEL `change_nature` field for revenue quality analysis (Adjusted NRR/GRR)
- Per-department cross-references (e.g. NRR under Customer Success, Gross Margin under Finance) now resolve to the full canonical content via slug lookup
- Every metric and definition result carries its gaspwiki.com page URL; definitions keep their full body and reference links
- Access classifications, structured formulas and entity mappings resolve for every graph metric, including cross-reference records (e.g. NRR under Customer Success, CAC under Marketing)
- Adapter schema 1.1 (`standard/gasp-adapter-schema.json`): a `datasets` map, per-dataset mappings (a mapping names its `dataset`), informational fields and `$schema`. `npm run derive` writes a ready template to `standard/exports/gasp-adapter-template.json` (served at https://gaspwiki.com/downloads/gasp-adapter-template.json) and the tests validate it against the canonical schema, which the website serves at https://gaspwiki.com/schemas/gasp-adapter-v1.json
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

**Diagnosis, exploration and coverage** (new in 1.9.0)
- "ARR is down this month. What could explain it?" (`infer_drivers`)
- "How does Health Score eventually affect NRR?" (`explain_path`)
- "We track ARR, NRR, GRR, CAC and CAC Payback. What important metrics are we missing?" (`coverage_gap`)
- "Why might NRR be slipping? Trace the path back through Health Score." (composes `infer_drivers` and `explain_path`)

## License

Apache-2.0. Source: https://github.com/GASP-Standard/standard (the standard itself is CC BY 4.0, see `standard/LICENSE` there).
