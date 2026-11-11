# Vendored Apache Ossie validator

The upstream validator for Apache Ossie documents, copied unchanged so GASP exports can be checked offline and reproducibly.

- Source: https://github.com/apache/ossie at commit `ec1d089` (2026-11-11), schema version `0.3.0.dev0`
- Licence: Apache License 2.0 (`LICENSE`, `NOTICE` copied from the upstream root)
- Vendored files, same relative paths as upstream so the script finds its schemas:
  - `validation/validate.py`
  - `core-spec/ossie-schema.json`
  - `ontology/ontology.json`
  - `ontology/mapping.json`
  - `python/src/ossie/_loading.py` (the duplicate-key YAML loader the script imports from the checkout layout)

Nothing here is edited. The directory is outside the npm tarball (`package.json` `files` lists only `build/**` entries and the data bundle).

## Run

The script declares its own dependencies in a PEP 723 header, so `uv` is the only requirement. Run from this directory. With the upstream layout kept, the default schema (`core-spec/ossie-schema.json`) resolves without `OSSIE_SCHEMA`.

```bash
cd gasp-wiki-mcp/ossie-validator
uv run validation/validate.py path/to/semantic_model.yaml
uv run validation/validate.py --schema ontology/ontology.json path/to/ontology.yaml
uv run validation/validate.py --schema ontology/mapping.json path/to/mapping.yaml
```

Exit status is non-zero when a file fails. From TypeScript use `validateUpstream(file, "model" | "ontology" | "mapping")` in `src/ossie/validate.ts`, which skips cleanly when `uv` is not installed.

The upstream validator checks document shape, unique names, the ontology's internal references, SQL syntax, the model's own references (a metric or relationship naming a dataset or field the model lacks) and the mapping against the ontology and model its `iri`s point at. At this pin the schemas require `version: 0.3.0.dev0` and `nonportable_extensions` with `data` as an object (apache/ossie #691 and #522; a date, a timestamp or a non-finite float under `data` is a schema error, and the file is read as YAML 1.1, so `ossieYaml` quotes every string that loader would read as something else), and the validator warns when a metric's dialect entries disagree on the datasets they read or its SQL is impure (#634). The mapping's iris are relative, so validate it from a directory holding all three files. `src/ossie/check.ts` (`checkExport`) runs GASP's cross-reference checks beside it (see the table in `docs/ossie-spike.md` for what each one catches).

## Refresh

1. Pull `apache/ossie` and note the new commit.
2. Copy the five files and `LICENSE` / `NOTICE` over the vendored ones.
3. Update the commit and date above, and `OSSIE_VERSION` in `src/ossie/types.ts` if the schema version moved.
4. Run `npm test` in `gasp-wiki-mcp` (`test/ossie-check.test.ts` runs the validator on the spike documents).
