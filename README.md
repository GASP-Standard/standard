# GASP Standard

**Generally Accepted SaaS Principles.** An open standard for SaaS metrics: 300 metric definitions across 13 departments, a glossary, a canonical formula for every metric in a small tested grammar, one field vocabulary across 47 datasets, a relationship graph, and an MCP server that gives AI agents the whole thing as structured tools.

The standard is published at **https://gaspwiki.com**. This repository holds its source and the tooling that compiles it.

## What is here

| Path | What it is | Licence |
| --- | --- | --- |
| `standard/` | The canon. Metric definitions per department (`metrics/*.md`), the glossary (`definitions.md`), the Commercial Event Ledger (`cel.md`) and Attribution Taxonomy Layer (`atl.md`), the ontology (`ontology.json`: 251 fields, 47 datasets, entities, concepts), the canonical formulas (`formulas.json`), the signal taxonomy, the adapter schema and the relationship graph (`relationships.json`) | CC BY 4.0 (`standard/LICENSE`) |
| `standard/exports/` | Generated from the canon by `npm run derive`: the Neo4j Cypher export, the adapter template and the Apache Ossie (incubating) ontology, reference semantic model and mapping | CC BY 4.0 |
| `gasp-wiki-mcp/` | The MCP server, published on npm as [`gasp-standard-mcp`](https://www.npmjs.com/package/gasp-standard-mcp). Parser, formula grammar, SQL compiler, graph traversal, Ossie exporters and the test suite, which executes every compiled formula against a seeded dataset in an in-process Postgres | Apache 2.0 (`LICENSE`) |
| `docs/` | Decision documents and the Ossie interoperability spike | CC BY 4.0 |
| `DECISIONS.md` | Architecture decision records, newest first | CC BY 4.0 |
| `GASP × Apache Ossie Interop Spec v0.3.md` | How GASP is published as Apache Ossie files and what it proposes upstream | CC BY 4.0 |

## Use it

**Read the standard:** https://gaspwiki.com/v1/overview, or the per-department files under `standard/metrics/`.

**Give it to an agent:** the MCP server exposes twelve tools (metric lookup, canonical formulas, data requirements, SQL generation from your adapter, adapter validation, graph traversal).

```json
{ "mcpServers": { "gasp": { "command": "npx", "args": ["-y", "gasp-standard-mcp"] } } }
```

**Map your warehouse:** `standard/gasp-adapter-schema.json` describes the adapter file; a template with every field is at `standard/exports/gasp-adapter-template.json`. The `validate_adapter` and `generate_query` tools do the rest.

**Load it into a semantic layer:** `standard/exports/ossie/` holds the Apache Ossie ontology, semantic model and mapping, validated against the upstream schema. See `docs/ossie-spike.md` for what the files contain and how the formulas were compiled.

**Load the graph:** `standard/exports/gasp-knowledge-graph.cypher` imports into Neo4j.

## Work on it

```bash
cd gasp-wiki-mcp
npm ci
npm run build
npm test            # parser, compiler, every formula executed on PGlite, Ossie export
npm run derive      # regenerate standard/exports and the derived parts of ontology.json after editing the canon
```

The formula grammar is documented at the top of `gasp-wiki-mcp/src/formula.ts`. Every formula in `standard/formulas.json` must parse, resolve against the ontology and compile; the tests enforce it.

## About this repository

This is a read-only mirror of the public parts of the GASP monorepo, updated on every change. The website's source stays private. Issues and discussions are welcome here; changes to the standard are made upstream and appear here with the next push. See `MIRROR` for the source commit.

GASP is maintained by [403page labs](https://403.ie).
