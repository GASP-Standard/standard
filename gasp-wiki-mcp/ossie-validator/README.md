# Vendored Apache Ossie validator

The upstream validator for Apache Ossie documents, copied unchanged so GASP exports can be checked offline and reproducibly.

- Source: https://github.com/apache/ossie at commit `2b1f9bf` (2026-10-12)
- Licence: Apache License 2.0 (`LICENSE`, `NOTICE` copied from the upstream root)
- Vendored files, same relative paths as upstream so the script finds its schemas:
  - `validation/validate.py`
  - `core-spec/ossie-schema.json`
  - `ontology/ontology.json`
  - `ontology/mapping.json`

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

The upstream validator checks document shape, the ontology's internal references and SQL syntax. It does not cross-check metrics, relationships or mappings against each other. `src/ossie/check.ts` (`checkExport`) does that.

## Refresh

1. Pull `apache/ossie` and note the new commit.
2. Copy the four files and `LICENSE` / `NOTICE` over the vendored ones.
3. Update the commit and date above, and `OSSIE_VERSION` in `src/ossie/types.ts` if the schema version moved.
4. Run `npm test` in `gasp-wiki-mcp` (`test/ossie-check.test.ts` runs the validator on the spike documents).
