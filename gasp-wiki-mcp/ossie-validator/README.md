# Vendored Apache Ossie validator

The upstream validator for Apache Ossie documents and the upstream SQL test runner `ost`, copied unchanged so GASP exports can be checked and the conformance cases run offline and reproducibly.

- Source: https://github.com/apache/ossie at commit `7fb92a7` (2026-11-25), schema version `0.3.0.dev0`
- Licence: Apache License 2.0 (`LICENSE`, `NOTICE` copied from the upstream root)
- Vendored files, same relative paths as upstream so the script finds its schemas:
  - `validation/validate.py`
  - `core-spec/ossie-schema.json`
  - `ontology/ontology.json`
  - `ontology/mapping.json`
  - `python/src/ossie/_loading.py` (the duplicate-key YAML loader the script imports from the checkout layout)
  - `core-spec/grammar/OssieExpression.g4` (the ANTLR 4 grammar for OSSIE_SQL_2026 expressions)
  - `compliance/expressions/valid.txt` and `invalid.txt` (the grammar's fixtures, one expression per line)
  - `ost/` (the SQL test runner: `pyproject.toml`, `uv.lock`, `README.md`, `docs/ost.md` and `src/ossie_ost/`, without its tests)
  - `python/pyproject.toml`, `python/README.md`, `python/src/ossie/__init__.py` and `models.py` (the `apache-ossie` package `ost` installs from `../python`, without its tests)

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

Since apache/ossie #697 the script takes `--vendor NAME` and hands the `data` object of every `nonportable_extensions` entry with that `vendor_name` to the checker installed under the entry point group `ossie.vendor_validators`. GASP's checker is the Python package in `../gasp-ossie-validator/`, which validates each payload against the GASP extension schema by the site it sits on; `--with` installs it for the run. Naming a vendor with no installed checker is an error. Since #759 the hook also hands a checker the object the entry sits on (`site.node`) and takes a finding as a string or as a dict with a severity, so a checker can warn. GASP's checker reads the site's kind and returns strings, each an error.

The upstream validator checks document shape, unique names, the ontology's internal references, SQL syntax, the model's own references (a metric or relationship naming a dataset or field the model lacks) and the mapping against the ontology and model its `iri`s point at. At this pin the schemas require `version: 0.3.0.dev0` and `nonportable_extensions` with `data` as an object (apache/ossie #691 and #522; a date, a timestamp or a non-finite float under `data` is a schema error, and the file is read as YAML 1.1, so `ossieYaml` quotes every string that loader would read as something else), and the validator warns when a metric's dialect entries disagree on the datasets they read or its SQL is impure (#634). A `primary_key`, a `unique_keys` entry or an ontology list that names the same thing twice is a schema error (#705), a SQL statement used as an expression is an error (#647), as are an `INTERVAL` literal, an empty `IN` list, an alias and a bare `DISTINCT` in one (#777). An aggregate function with no `OVER` clause in a field's `OSSIE_SQL_2026` expression is an error (#792); GASP's fields hold none. The script declares `sqlglot>=30.29.0` (#793, which GASP's report in #767 led to) and `uv run` installs the latest release for it. On a sqlglot older than 30.19.0 it warns once and leaves SQL expressions unchecked (#780). The loader keeps the precedence of a YAML sequence merge (`<<: [a, b]`) on PyYAML 6.0.4 (#782); GASP's files hold no merge key. The core checks run on a semantic model embedded in a mapping (#760) and a dataset-scoped metric may evaluate a measure of its source with `AGG(source.measure)` (#726), which GASP does not write. The mapping's iris are relative, so validate it from a directory holding all three files. `src/ossie/check.ts` (`checkExport`) runs GASP's cross-reference checks beside it (see the table in `docs/ossie-spike.md` for what each one catches).

Two changes to the script arrived with the `7fb92a7` pin. A message names a function as the expression wrote it and a window function with no `OVER` clause is an error (#800); GASP's expressions hold none. `--report` prints a portability report for a semantic model after its result (#799): how many fields and metrics have `OSSIE_SQL_2026` as their most portable form and how much of the document sits under `nonportable_extensions`, by site and vendor. On the GASP reference model it counts every field and every metric under `OSSIE_SQL_2026` and every extension entry under the vendor GASP.

## The ost runner

`ost/` is the upstream test runner for SQL over a semantic model (`ost/docs/ost.md` is the format). A script creates tables, loads a model with `modelFile` and asks for a metric with `executeExpand`, which expands `AGG(metric)` through the view expander into DuckDB SQL and runs it. The expected output sits under each command and a run passes when the runner writes the same text. At this pin the expander reads a dataset whose `source` is a query (#812, opened from GASP's report in #811), so every GASP conformance model runs as published.

```bash
cd standard/exports/ossie/conformance
uv run --project ../../../../gasp-wiki-mcp/ossie-validator/ost ost -d . --output-dir /tmp/gasp-ost cases/c07_period_days_uptime/case.ost
```

Keep `--output-dir` when running inside this repository: without it the runner writes the regenerated script under `target/ost/` in the conformance set, where `npm run conformance:check` reports it as a file that should not be there.

`uv` builds the environment from `ost/uv.lock` into `ost/.venv` (git-ignored) on the first run; it needs Python 3.11 or later, which `uv` fetches when the machine has none. From TypeScript use `runOst(dir, scripts, outputDir)` in `src/ossie/ost.ts`. `npm run conformance` writes each `cases/<case>/case.ost` with it and `test/ossie-conformance.test.ts` holds the runner to reproducing every script byte for byte.

One defect at this pin shapes the scripts. `set("doubleDigits", n)` with n of seven or more prints a zero as `0E-7` (`round_double` in `ost/src/ossie_ost/runner.py` takes the text of a quantized decimal, which Python writes in scientific notation for a zero with that exponent). The conformance scripts round to six digits, the most that prints every value in plain notation.

## The expression grammar

`core-spec/grammar/OssieExpression.g4` covers expressions only and is stricter than the validator, which parses with sqlglot. `test/ossie-grammar.test.ts` parses every expression in the published models with it, and every reference the published mappings make.

The parser is generated on each run the way upstream's tests generate it (`core-spec/grammar/tests/conftest.py` there, `test/ossie-grammar.py` here): the ANTLR 4.13.2 tool under Java 11 or later, the jar fetched from Maven Central on first use and checked against the SHA-256 upstream pins, the Python runtime under `uv`. The jar is kept in `node_modules/.cache/antlr/` and nothing generated is committed. A download Maven Central refuses for now (a 429, a 5xx or no connection) is tried again three times, and the two test workflows keep the jar between runs with a cache step keyed on `test/ossie-grammar.py`. The tests skip when `uv` or Java is missing.

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
2. Copy the eight files, the `ost/` and `python/` files listed above and `LICENSE` / `NOTICE` over the vendored ones (`git archive <commit> | tar -x` into an empty directory gives a tree with no `__pycache__` or `.venv` to leave behind). If upstream's `core-spec/grammar/tests/conftest.py` moved its ANTLR version or SHA-256, move both in `test/ossie-grammar.py` and the runtime version in `test/ossie-grammar.test.ts`.
3. Update the commit and date above, and `OSSIE_VERSION` in `src/ossie/types.ts` if the schema version moved.
4. Run `npm run conformance` in `gasp-wiki-mcp`, which runs every case script through the new runner and rewrites the expected output where the expander's SQL moved. Read the diff: an expansion may change, a result table may not.
5. Run `npm test` in `gasp-wiki-mcp` (`test/ossie-check.test.ts` runs the validator on the spike documents, `test/ossie-vendor.test.ts` every export with `--vendor GASP`, `test/ossie-grammar.test.ts` the grammar over every published expression and `test/ossie-conformance.test.ts` the conformance scripts through `ost`).
