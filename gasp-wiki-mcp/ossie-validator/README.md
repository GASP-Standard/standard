# Vendored Apache Ossie validator

The upstream validator for Apache Ossie documents, copied unchanged so GASP exports can be checked offline and reproducibly.

- Source: https://github.com/apache/ossie at commit `344259a` (2026-11-19), schema version `0.3.0.dev0`
- Licence: Apache License 2.0 (`LICENSE`, `NOTICE` copied from the upstream root)
- Vendored files, same relative paths as upstream so the script finds its schemas:
  - `validation/validate.py`
  - `core-spec/ossie-schema.json`
  - `ontology/ontology.json`
  - `ontology/mapping.json`
  - `python/src/ossie/_loading.py` (the duplicate-key YAML loader the script imports from the checkout layout)
  - `core-spec/grammar/OssieExpression.g4` (the ANTLR 4 grammar for OSSIE_SQL_2026 expressions)
  - `compliance/expressions/valid.txt` and `invalid.txt` (the grammar's fixtures, one expression per line)

Nothing here is edited. The directory is outside the npm tarball (`package.json` `files` lists only `build/**` entries and the data bundle).

## Run

The script declares its own dependencies in a PEP 723 header, so `uv` is the only requirement. Run from this directory. With the upstream layout kept, the default schema (`core-spec/ossie-schema.json`) resolves without `OSSIE_SCHEMA`.

```bash
cd gasp-wiki-mcp/ossie-validator
uv run validation/validate.py path/to/semantic_model.yaml
uv run validation/validate.py --schema ontology/ontology.json path/to/ontology.yaml
uv run validation/validate.py --schema ontology/mapping.json path/to/mapping.yaml
uv run --with ../gasp-ossie-validator validation/validate.py --vendor GASP path/to/semantic_model.yaml
```

Exit status is non-zero when a file fails. From TypeScript use `validateUpstream(file, "model" | "ontology" | "mapping")` in `src/ossie/validate.ts`, which skips cleanly when `uv` is not installed; it takes one file or several and `{ vendor: true }` adds the vendor run below.

Since apache/ossie #697 the script takes `--vendor NAME` and hands the `data` object of every `nonportable_extensions` entry with that `vendor_name` to the checker installed under the entry point group `ossie.vendor_validators`. GASP's checker is the Python package in `../gasp-ossie-validator/`, which validates each payload against the GASP extension schema by the site it sits on; `--with` installs it for the run. Naming a vendor with no installed checker is an error.

The upstream validator checks document shape, unique names, the ontology's internal references, SQL syntax, the model's own references (a metric or relationship naming a dataset or field the model lacks) and the mapping against the ontology and model its `iri`s point at. At this pin the schemas require `version: 0.3.0.dev0` and `nonportable_extensions` with `data` as an object (apache/ossie #691 and #522; a date, a timestamp or a non-finite float under `data` is a schema error, and the file is read as YAML 1.1, so `ossieYaml` quotes every string that loader would read as something else), and the validator warns when a metric's dialect entries disagree on the datasets they read or its SQL is impure (#634). A `primary_key`, a `unique_keys` entry or an ontology list that names the same thing twice is a schema error (#705), a SQL statement used as an expression is an error (#647) and the core checks run on a semantic model embedded in a mapping (#760). The mapping's iris are relative, so validate it from a directory holding all three files. `src/ossie/check.ts` (`checkExport`) runs GASP's cross-reference checks beside it (see the table in `docs/ossie-spike.md` for what each one catches).

## The expression grammar

`core-spec/grammar/OssieExpression.g4` covers expressions only and is stricter than the validator, which parses with sqlglot. `test/ossie-grammar.test.ts` parses every expression in the published models with it, and every reference the published mappings make.

The parser is generated on each run the way upstream's tests generate it (`core-spec/grammar/tests/conftest.py` there, `test/ossie-grammar.py` here): the ANTLR 4.13.2 tool under Java 11 or later, the jar fetched from Maven Central on first use and checked against the SHA-256 upstream pins, the Python runtime under `uv`. The jar is kept in `node_modules/.cache/antlr/` and nothing generated is committed. The tests skip when `uv` or Java is missing.

```bash
cd gasp-wiki-mcp
echo '["SUM(subscription.mrr) FILTER (WHERE subscription.subscription_status = '"'"'active'"'"')"]' | \
  uv run --no-project --with antlr4-python3-runtime==4.13.2 python test/ossie-grammar.py \
  ossie-validator/core-spec/grammar/OssieExpression.g4 node_modules/.cache/antlr
```

The output is a JSON list with the syntax errors of each expression, empty when it parses.

At this pin `ORDER` is a keyword of the grammar, so `order.order_id`, a reference into the GASP dataset named `order`, does not parse. The validator reads it and the specification's own example is `SUM(order.sales)`. apache/ossie #719 (open) lists `ORDER` among the words usable as names; the test pins the exception until the pin moves past it.

## Refresh

1. Pull `apache/ossie` and note the new commit.
2. Copy the eight files and `LICENSE` / `NOTICE` over the vendored ones. If upstream's `core-spec/grammar/tests/conftest.py` moved its ANTLR version or SHA-256, move both in `test/ossie-grammar.py` and the runtime version in `test/ossie-grammar.test.ts`.
3. Update the commit and date above, and `OSSIE_VERSION` in `src/ossie/types.ts` if the schema version moved.
4. Run `npm test` in `gasp-wiki-mcp` (`test/ossie-check.test.ts` runs the validator on the spike documents, `test/ossie-vendor.test.ts` every export with `--vendor GASP` and `test/ossie-grammar.test.ts` the grammar over every published expression).
