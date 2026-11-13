# gasp-ossie-validator

The GASP Standard's vendor validator for [Apache Ossie](https://github.com/apache/ossie) (incubating) documents.

Every Ossie document GASP writes carries `nonportable_extensions` entries with `vendor_name: GASP`. The upstream validator checks that each entry's `data` is an object and leaves its contents to the vendor. Named with `--vendor GASP`, it hands each GASP payload to this package, which validates it against the published GASP extension schema, [`gasp-ossie-extension-v1.json`](https://gaspwiki.com/schemas/gasp-ossie-extension-v1.json), by the site the payload sits on.

| Site | Schema definition |
|---|---|
| The semantic model | `ModelExtension` |
| A dataset | `DatasetExtension` |
| A metric | `MetricExtension` |
| The mapping | `MappingExtension` |
| A field or a relationship | none: GASP defines no extension there, so a GASP payload is reported |

## Run

The validator is `validation/validate.py` in a clone of apache/ossie at or after commit `b47f6ea` (2026-11-12, #697). From a clone of [GASP-Standard/standard](https://github.com/GASP-Standard/standard), the vendored copy in `gasp-wiki-mcp/ossie-validator/` works the same way:

```bash
cd gasp-wiki-mcp/ossie-validator
uv run --with ../gasp-ossie-validator validation/validate.py --vendor GASP path/to/semantic_model.yaml
uv run --with ../gasp-ossie-validator validation/validate.py --vendor GASP --schema ontology/mapping.json path/to/mapping.yaml
```

A finding is an error, named by vendor and site:

```
[Vendor GASP] Dataset 'revenue_event' in model 'GASP reference model': `/` must NOT have additional properties: `colour`
```

The vendor checks run on a document that passed the Ossie schema and the validator's other checks. An ontology document carries no extensions, so there is nothing to hand over.

## How it is wired

`pyproject.toml` registers `gasp_ossie_validator:check` under the entry point group `ossie.vendor_validators` with the name `GASP`, the token GASP uses as `vendor_name`. `check(payload, site)` returns one message per finding: a JSON pointer into the payload and what is wrong there. The messages read like the ones the TypeScript check in `gasp-wiki-mcp/src/ossie/check.ts` writes for the same payload, which `validate_mapping` and `compile_model` report.

The schema inside the package is a copy of `standard/gasp-ossie-extension-v1.json`, written by `npm run derive` in `gasp-wiki-mcp`; `npm run derive:check` fails when the two differ. `gasp-wiki-mcp/test/ossie-vendor.test.ts` runs every GASP export through the vendored validator with `--vendor GASP` and checks that planted bad payloads are named at their sites.

The package is unpublished: install it from this directory. It sits outside the `gasp-standard-mcp` npm tarball.

## Licence

Apache License 2.0, as the rest of `gasp-wiki-mcp`.
