# Contributing

Corrections, proposals and tooling fixes are welcome. `GOVERNANCE.md` explains how they are decided.

## This repository is a mirror

This repository is assembled from a private working repository on every change, so nothing merges here directly. Open issues and pull requests here as usual. The maintainer reviews them here, applies an accepted pull request upstream with your authorship kept and closes it when the change appears in the next mirror push.

## Proposing a change

**Issue first** for anything that changes a definition, a formula, a benchmark or the ontology. Say which metrics it affects, what the standard says now, what it should say and the source you are relying on: an accounting standard, a published benchmark report with its date, a vendor's documented calculation. A disagreement about what a metric should mean is settled in the issue before anyone writes the change.

**Pull request directly** for wording, examples, typos, broken links, tests and tooling.

## Where things live

- Metric definitions: `standard/metrics/<department>.md`
- Glossary: `standard/definitions.md`
- Formulas: `standard/formulas.json`, written in the grammar documented at the top of `gasp-wiki-mcp/src/formula.ts`
- Fields and datasets: `standard/ontology.json`
- Relationship graph: `standard/relationships.json` (the `component` and `measures` edges are derived; `drives`, `reduces`, `predicts` and the entity edges are curated)
- Everything under `standard/exports/` is generated. Edit the sources and regenerate.

## What the tests require

```bash
cd gasp-wiki-mcp
npm ci
npm run build
npm run derive      # after editing formulas.json, ontology.json or relationships.json
npm test
```

`npm run derive` rewrites everything that restates the formulas: the structured formulas, entity mappings and field usage counts in `ontology.json`, the derived graph edges and the files in `standard/exports/`. The `derived` test fails if you skip it. CI runs `npm run derive:check` and `npm test` on every pull request.

The formula tests enforce these rules:

- A `field.` reference must exist in `ontology.json` and sit inside an aggregate. A `metric.` reference sits outside aggregates.
- Every field inside one aggregate must live on the same dataset.
- A string literal compared to an enum field must be one of that field's declared `values`.
- Every field in the ontology must be read by at least one formula, apart from keys, dates, CEL ledger fields and dimensions. Any other field that nothing reads is a mapping obligation for adopters with no metric behind it.
- Every metric has a formula with a unit or a `notComputable` reason. Ratios are unscaled and the unit says what they are.
- A breakdown names an existing field. Every aggregate it groups reads a dataset that carries that field.

If a formula needs a field that does not exist, add it to `ontology.json` with its `datasets`, `sources` and (for enum fields) `values`, then run `npm run derive`. A formula that reads an undeclared field fails the tests.

## Writing rules for the standard

- No em dashes. Use a full stop, a comma or a restructured sentence.
- No Oxford commas.
- Prefer positive framing to negation: "agents query the twin" over "agents never query source systems".
- Call it the GASP Standard.
- Write a metric's full name and abbreviation on first reference, then the abbreviation: Net Revenue Retention (NRR), then NRR.

## Licences

Everything in `standard/`, `docs/`, `DECISIONS.md` and the interop spec is licensed under CC BY 4.0 (`standard/LICENSE`). The code in `gasp-wiki-mcp/` is licensed under Apache 2.0 (`LICENSE`). By opening a pull request you agree that your contribution is licensed under the licence of the files it changes.
