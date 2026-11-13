"""GASP's vendor validator for Apache Ossie documents.

`validation/validate.py --vendor GASP` (apache/ossie #697) hands this module the
`data` object of every `nonportable_extensions` entry whose `vendor_name` is
`GASP`, with the site it sits on. `check` validates the object against the
definition the GASP extension schema gives that site: the semantic model, a
dataset, a metric or the mapping. GASP defines no extension on a field or a
relationship, so a GASP payload there is reported.

The schema beside this file is a copy of `standard/gasp-ossie-extension-v1.json`,
written by `npm run derive` in `gasp-wiki-mcp`. The messages read like the ones
`checkExport` in `gasp-wiki-mcp/src/ossie/check.ts` writes for the same payload.
"""

from __future__ import annotations

import json
from functools import cache
from importlib.resources import files
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

SCHEMA_FILE = "gasp-ossie-extension-v1.json"

# Site kind (validate.py's ExtensionSite.kind) to the schema definition for it.
PLACEMENTS = {
    "model": "ModelExtension",
    "dataset": "DatasetExtension",
    "metric": "MetricExtension",
    "mapping": "MappingExtension",
}


@cache
def schema() -> dict[str, Any]:
    """The GASP extension schema this package was built with."""
    return json.loads(files(__package__).joinpath(SCHEMA_FILE).read_text(encoding="utf-8"))


@cache
def _validator(definition: str) -> Draft202012Validator:
    # One definition as the root, with the shared definitions beside it so the
    # `#/$defs/...` references inside it resolve without the schema's $id.
    return Draft202012Validator({"$ref": f"#/$defs/{definition}", "$defs": schema()["$defs"]})


def _type_names(expected: Any) -> str:
    return ",".join(expected) if isinstance(expected, list) else str(expected)


def _messages(error: ValidationError) -> list[str]:
    """One line per finding: the JSON pointer into the payload, then what is wrong."""
    path = "/" + "/".join(str(part) for part in error.absolute_path)
    keyword, expected = error.validator, error.validator_value
    if keyword == "additionalProperties":
        properties = error.schema.get("properties", {})
        extra = sorted(key for key in error.instance if key not in properties)
        return [f"`{path}` must NOT have additional properties: `{key}`" for key in extra]
    if keyword == "required":
        missing = [key for key in expected if key not in error.instance]
        return [f"`{path}` must have required property '{key}'" for key in missing]
    if keyword == "dependentRequired":
        return [
            f"`{path}` must have {'property' if len(missing) == 1 else 'properties'} {', '.join(missing)} "
            f"when property {key} is present"
            for key, needed in expected.items()
            if key in error.instance and (missing := [k for k in needed if k not in error.instance])
        ]
    if keyword == "type":
        return [f"`{path}` must be {_type_names(expected)}"]
    if keyword == "enum":
        allowed = ", ".join(json.dumps(value) for value in expected)
        return [f"`{path}` must be equal to one of the allowed values: {allowed}"]
    if keyword == "const":
        return [f"`{path}` must be equal to constant {json.dumps(expected)}"]
    if keyword == "pattern":
        return [f'`{path}` must match pattern "{expected}"']
    if keyword in ("minimum", "maximum"):
        return [f"`{path}` must be {'>=' if keyword == 'minimum' else '<='} {expected}"]
    if keyword in ("anyOf", "oneOf"):
        return [f"`{path}` must match a schema in {keyword}"]
    message = error.message
    return [f"`{path}` {message if len(message) <= 200 else message[:197] + '...'}"]


def check(payload: dict[str, Any], site: Any) -> list[str]:
    """The findings on one GASP payload; empty when it matches its site's definition.

    `site` is validate.py's ExtensionSite: `kind` is one of model, dataset, field,
    metric, relationship or mapping. The caller names the site in front of each
    message, so the messages say only what is wrong inside the payload.
    """
    kind = getattr(site, "kind", None)
    definition = PLACEMENTS.get(kind)
    if definition is None:
        return [
            f"GASP defines no extension on a {kind}; its payloads sit on the semantic model, "
            "a dataset, a metric or the mapping"
        ]
    errors = sorted(_validator(definition).iter_errors(payload), key=lambda e: [str(p) for p in e.absolute_path])
    # jsonschema raises one error per missing key; each lists them all here, so keep the first of each line.
    return list(dict.fromkeys(message for error in errors for message in _messages(error)))
