/**
 * The Snowflake compile target: a Cortex Analyst semantic model YAML plus a
 * SQL file of views (docs/compile-targets-spike.md).
 *
 * The YAML follows the shape the Apache Ossie Snowflake converter writes:
 * `tables[]` with a three-part `base_table`, a primary key and the fields
 * sorted into `time_dimensions`, `dimensions` and `facts`; `relationships[]`;
 * `metrics[]` over `<table>.<column>` with the logical table names. Cortex
 * Analyst reads it as is, and Snowflake loads it as a semantic view through
 * SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML.
 *
 * A base table is always a table or a view, never a query: every staged
 * dataset (and any company dataset whose source is a query) becomes a view in
 * `staged_views.sql`, whose body is the compiled Snowflake source, and the
 * YAML names the view. The same file declares the period spine table the
 * staged views read. Metric expressions come from the target model in the
 * Snowflake dialect, so a filtered aggregate is a CASE inside the aggregate.
 */
import { stringify } from "yaml";
import type { OssieDataType } from "../ossie/types.js";
import type { TargetField, TargetModel, TargetTable } from "./common.js";

export interface SnowflakeOptions {
  /** Prepended to a two-part source (a Cortex Analyst base table needs database.schema.table) */
  database?: string;
  /** Schema for the staged views; the schema of the first mapped table when omitted */
  stagedSchema?: string;
}

export const SNOWFLAKE_TYPE: Record<OssieDataType, string> = {
  String: "VARCHAR",
  Integer: "NUMBER(38,0)",
  Decimal: "NUMBER",
  Float: "FLOAT",
  Boolean: "BOOLEAN",
  Date: "DATE",
  Time: "TIME",
  DateTime: "TIMESTAMP_NTZ",
  DateTimeTz: "TIMESTAMP_TZ",
  Opaque: "VARCHAR",
};

const upper = (s: string | undefined): string | undefined => s?.toUpperCase();

interface BaseTable { database?: string; schema?: string; table: string }

/** The three-part name of a table: the source's parts, the database prepended to two, database and default schema to one. */
function baseTableOf(parts: string[], database: string | undefined, schema: string | undefined): BaseTable {
  const [a, b, c] = parts.length >= 3 ? parts.slice(-3) : parts.length === 2 ? [database, parts[0], parts[1]] : [database, schema, parts[0]];
  return { ...(a ? { database: upper(a) } : {}), ...(b ? { schema: upper(b) } : {}), table: upper(c)! };
}

const dotted = (b: BaseTable): string => [b.database, b.schema, b.table].filter(Boolean).join(".");

function entry(f: TargetField): Record<string, unknown> {
  return {
    name: f.name,
    expr: f.sql,
    ...(f.description ? { description: f.description } : {}),
    data_type: SNOWFLAKE_TYPE[f.datatype] ?? "VARCHAR",
    ...(f.enumValues?.length && f.role !== "time" ? { sample_values: f.enumValues } : {}),
  };
}

/** The view a query source becomes: a staged dataset under its own name, a company query under gasp_source_. */
const viewName = (t: TargetTable): string => (t.staged ? t.name : `gasp_source_${t.name}`);

export function writeSnowflake(tm: TargetModel, opts: SnowflakeOptions = {}): { files: Record<string, string>; notes: string[] } {
  const notes: string[] = [];
  const firstTable = tm.tables.find((t) => t.source.kind === "table" && !t.spine && !t.staged);
  const firstParts = firstTable?.source.kind === "table" ? firstTable.source.parts : [];
  const schema = opts.stagedSchema?.trim() || (firstParts.length >= 2 ? firstParts[firstParts.length - 2] : undefined);
  const database = opts.database?.trim() || (firstParts.length >= 3 ? firstParts[0] : undefined);

  const views: string[] = [];
  const missingDb: string[] = [];
  const tables = tm.tables.map((t) => {
    let base: BaseTable;
    if (t.source.kind === "table") {
      base = baseTableOf(t.source.parts, database, schema);
    } else {
      base = baseTableOf([viewName(t)], database, schema);
      const sql = t.source.sqlByDialect?.snowflake ?? t.source.sql;
      views.push(`-- ${t.staged ? `Staged dataset for ${t.staged.for} (${t.staged.reason}): one row per reporting period` : `${t.name}: the company's query source as a view`}\nCREATE OR REPLACE VIEW ${dotted(base)} AS\n${sql};`);
    }
    if (!base.database || !base.schema) missingDb.push(t.name);
    const by = (role: TargetField["role"] | Array<TargetField["role"]>) => t.fields.filter((f) => (Array.isArray(role) ? role : [role]).includes(f.role)).map(entry);
    const time = by("time");
    const dims = by(["key", "dimension"]);
    const facts = by("fact");
    return {
      name: t.name,
      base_table: base,
      ...(t.primaryKey.length ? { primary_key: { columns: t.primaryKey } } : {}),
      ...(t.description ? { description: t.description } : {}),
      ...(time.length ? { time_dimensions: time } : {}),
      ...(dims.length ? { dimensions: dims } : {}),
      ...(facts.length ? { facts } : {}),
    };
  });

  const relationships = tm.relationships.map((r) => ({
    name: r.name,
    left_table: r.from,
    right_table: r.to,
    relationship_columns: r.from_columns.map((c, i) => ({ left_column: c, right_column: r.to_columns[i] })),
    join_type: "left_outer",
    relationship_type: "many_to_one",
  }));
  const metrics = tm.metrics.map((m) => ({
    name: m.name,
    expr: m.sql,
    description: `${m.description ?? m.label} Canonical definition: ${m.url}`.trim(),
    ...(m.synonyms?.length ? { synonyms: m.synonyms } : {}),
  }));

  const doc = {
    name: tm.name,
    ...(tm.description ? { description: tm.description } : {}),
    tables,
    ...(relationships.length ? { relationships } : {}),
    metrics,
  };
  const files: Record<string, string> = { "semantic_model.yaml": stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false }) };

  const spine = tm.tables.find((t) => t.spine);
  if (views.length || spine) {
    const head = [
      "-- GASP compile target for Snowflake: the views the semantic model's staged tables read.",
      "-- Run this file before loading semantic_model.yaml. Each view's body is the GASP compiled query over your tables.",
    ];
    const spineBase = spine?.source.kind === "table" ? baseTableOf(spine.source.parts, database, schema) : undefined;
    const spineSql = spineBase
      ? [[
          "-- The period spine: one row per reporting period, which you fill. The staged views read it.",
          ...(spineBase.schema ? [`CREATE SCHEMA IF NOT EXISTS ${[spineBase.database, spineBase.schema].filter(Boolean).join(".")};`] : []),
          `CREATE TABLE IF NOT EXISTS ${dotted(spineBase)} (period_start DATE, period_end DATE);`,
        ].join("\n")]
      : [];
    files["staged_views.sql"] = [head.join("\n"), ...spineSql, ...views].join("\n\n") + "\n";
  }

  notes.push("semantic_model.yaml is a Snowflake Cortex Analyst semantic model; Cortex Analyst reads it as is. SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML loads it as a semantic view.");
  if (files["staged_views.sql"]) notes.push(`Run staged_views.sql first: it creates the period spine table (fill it with your reporting periods) and the ${views.length} view${views.length === 1 ? "" : "s"} the staged tables name${schema ? ` in schema ${upper(schema)}` : ""}.`);
  if (missingDb.length) notes.push(`${missingDb.length} table${missingDb.length === 1 ? " lacks" : "s lack"} a database or schema in base_table (${missingDb.slice(0, 5).join(", ")}${missingDb.length > 5 ? ", ..." : ""}); pass database${schema ? "" : " and staged_schema"} so every base table is database.schema.table.`);
  return { files, notes };
}
