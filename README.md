# GASP Standard

**Generally Accepted SaaS Principles.** An open standard for SaaS metrics: 306 metrics across 13 departments, 94 glossary definitions, a canonical formula for every computable metric in a small tested grammar, one vocabulary of 268 fields across 52 datasets, a relationship graph of 100 nodes and 200 edges plus an MCP server that gives AI agents all of it as structured tools.

The standard is published at **https://gaspwiki.com**. This repository holds its source and the tooling that compiles it. It works with Apache Ossie (incubating): `npm run derive` writes the standard out as Ossie files, which pass the upstream validator.

## What is here

| Path | What it is | Licence |
| --- | --- | --- |
| `standard/` | The canon. Metric definitions per department (`metrics/*.md`), the glossary (`definitions.md`), the Commercial Event Ledger (`cel.md`) and Attribution Taxonomy Layer (`atl.md`), the ontology (`ontology.json`: fields, datasets, 28 entities and 7 concepts), the formulas (`formulas.json`: 289 entries, 274 computable and 15 with the reason they are not), the signal taxonomy, the adapter schema and the relationship graph (`relationships.json`) | CC BY 4.0 (`standard/LICENSE`) |
| `standard/exports/` | Generated from the canon by `npm run derive`: the Neo4j Cypher export, the adapter template and the Apache Ossie ontology, reference semantic model and mapping | CC BY 4.0 |
| `gasp-wiki-mcp/` | The MCP server, published on npm as [`gasp-standard-mcp`](https://www.npmjs.com/package/gasp-standard-mcp). The parser, formula grammar, SQL compiler, graph traversal, Ossie exporters and the test suite, which runs every compiled formula against a seeded dataset in an in-process Postgres | Apache 2.0 (`LICENSE`) |
| `docs/` | Decision documents, the Ossie spike findings and the Ossie interop spec (`docs/ossie-interop-spec.md`) | CC BY 4.0 |
| `DECISIONS.md` | Architecture decision records, newest first | CC BY 4.0 |
| `GOVERNANCE.md` | Who maintains the standard, how changes are decided, what counts as a breaking change and what happens if the maintainer stops | |
| `CONTRIBUTING.md` | How to propose a change and what the tests require | |
| `CHANGELOG.md` | What changed in each release of the MCP package and the standard it bundles | |

## Use it

**Read the standard** at https://gaspwiki.com/v1/overview, or in the per-department files under `standard/metrics/`.

**Give it to an agent.** The MCP server has twelve tools: metric and glossary lookup, canonical formulas, data requirements, SQL generation from your adapter for Postgres, Snowflake, BigQuery or Databricks, adapter validation and three graph traversal tools.

```json
{ "mcpServers": { "gasp": { "command": "npx", "args": ["-y", "gasp-standard-mcp"] } } }
```

**Map your warehouse.** `standard/gasp-adapter-schema.json` describes the adapter file and `standard/exports/gasp-adapter-template.json` lists every field to fill in. `validate_adapter` checks a mapping and `generate_query` compiles a metric against it.

**Load it into a semantic layer.** `standard/exports/ossie/` holds the Apache Ossie ontology, semantic model and mapping. `docs/ossie-spike.md` explains what the files contain and how the formulas were compiled into them.

**Load the graph.** `standard/exports/gasp-knowledge-graph.cypher` imports into Neo4j.

## Work on it

```bash
cd gasp-wiki-mcp
npm ci
npm run build
npm test            # parser, compiler, every formula executed on PGlite, Ossie export
npm run derive      # regenerate standard/exports and the derived parts of ontology.json after editing the canon
```

The formula grammar is documented at the top of `gasp-wiki-mcp/src/formula.ts`. Every formula in `standard/formulas.json` has to parse, resolve against the ontology and compile; the tests check each one. `CONTRIBUTING.md` lists the rest of the rules.

## About this repository

GASP is written and maintained by Gareth O'Shea. Contributions are welcome: issues for proposals and questions, pull requests for wording, examples and tooling.

This repository is a read-only mirror of the public parts of the GASP working repository, updated on every change there. The website's source stays private. Pull requests opened here are reviewed here and applied upstream by the maintainer. The change appears here with the next mirror push. `MIRROR` names the source commit.
