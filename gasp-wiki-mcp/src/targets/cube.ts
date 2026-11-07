/**
 * The Cube compile target: a Cube data-model directory, one cube per dataset
 * and one view (docs/compile-targets-spike.md).
 *
 * The files follow the shape the Apache Ossie Cube converter writes:
 * `model/cubes/<table>.yml` holding one cube with its `sql_table` (or `sql`
 * for a staged dataset), its joins, a dimension per field and the GASP
 * metrics as measures; `model/views/<model>.yml` holding one view over the
 * cubes reachable from a base cube. Unlike the converter, a measure's SQL is
 * the target dialect's (a filter is a CASE inside the aggregate) and a staged
 * cube's `sql` is the compiled source in that dialect.
 *
 * A direct metric is a `type: number` measure on the cube of the first table
 * its expression reads. Its own columns become `{CUBE}.<column>`, or the
 * member reference `{CUBE.<field>}` when the field is a computed expression;
 * another cube's columns become member references `{<cube>.<field>}`, which
 * Cube reaches through the joins. A staged metric is a `type: sum` measure over
 * `{CUBE}.value` on its staged cube.
 */
import { stringify } from "yaml";
import type { OssieDataType } from "../ossie/types.js";
import { isIdentifier, slugName, type TargetField, type TargetMetric, type TargetModel, type TargetTable } from "./common.js";

export interface CubeOptions {
  /** A database, which Cube does not need: its connection names it */
  database?: string;
}

export const CUBE_TYPE: Record<OssieDataType, "string" | "number" | "time" | "boolean"> = {
  String: "string",
  Integer: "number",
  Decimal: "number",
  Float: "number",
  Boolean: "boolean",
  Date: "time",
  Time: "string",
  DateTime: "time",
  DateTimeTz: "time",
  Opaque: "string",
};

const yaml = (doc: unknown): string => stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false });

/** A field of `table` as written inside its own cube: the qualified column, or the member reference for a computed field. */
function own(t: TargetTable | undefined, name: string): string {
  const f = t?.fields.find((x) => x.name === name);
  if (!f) return `{CUBE}.${name}`;
  return isIdentifier(f.sql) && !f.sql.includes(".") ? `{CUBE}.${f.sql}` : `{CUBE.${f.name}}`;
}

/** A field of another cube: the member reference, or the raw column for a join on a plain column. */
function other(t: TargetTable | undefined, cube: string, name: string, forJoin = false): string {
  const f = t?.fields.find((x) => x.name === name);
  if (forJoin && (!f || (isIdentifier(f.sql) && !f.sql.includes(".")))) return `{${cube}}.${f?.sql ?? name}`;
  return `{${cube}.${name}}`;
}

/** Replace `<table>.<field>` outside string literals. */
function rewriteRefs(sql: string, replace: (table: string, field: string) => string | undefined): string {
  return sql.split(/('(?:[^']|'')*')/).map((part, i) => (i % 2 === 1 ? part : part.replace(/\b([A-Za-z_][\w$]*)\.([A-Za-z_][\w$]*)\b/g, (m, t: string, f: string) => replace(t, f) ?? m))).join("");
}

/** A direct metric's SQL as a measure of `home`. */
export function measureSql(m: TargetMetric, home: string, byName: Map<string, TargetTable>): string {
  return rewriteRefs(m.sql, (t, f) => {
    const table = byName.get(t);
    if (!table || !table.fields.some((x) => x.name === f)) return undefined;
    return t === home ? own(table, f) : other(table, t, f);
  });
}

function dimension(t: TargetTable, f: TargetField): Record<string, unknown> {
  return {
    name: f.name,
    sql: isIdentifier(f.sql) && !f.sql.includes(".") ? `{CUBE}.${f.sql}` : f.sql,
    type: CUBE_TYPE[f.datatype] ?? "string",
    ...(t.primaryKey.includes(f.name) ? { primary_key: true } : {}),
    ...(f.description ? { description: f.description } : {}),
  };
}

export function writeCube(tm: TargetModel, opts: CubeOptions = {}): { files: Record<string, string>; notes: string[] } {
  const notes: string[] = [];
  const byName = new Map(tm.tables.map((t) => [t.name, t]));
  const measures = new Map<string, Array<Record<string, unknown>>>();
  const crossCube: string[] = [];
  for (const m of tm.metrics) {
    const home = m.staged ?? m.datasets[0];
    if (!home || !byName.has(home)) continue;
    const meta = { gasp: { id: m.gaspId, url: m.url } };
    const description = m.description ?? m.label;
    const list = measures.get(home) ?? [];
    if (m.staged) list.push({ name: m.name, sql: "{CUBE}.value", type: "sum", description, meta });
    else {
      list.push({ name: m.name, sql: measureSql(m, home, byName), type: "number", description, meta });
      if (m.datasets.length > 1) crossCube.push(`${m.name} (${m.datasets.slice(1).join(", ")})`);
    }
    measures.set(home, list);
  }

  const files: Record<string, string> = {};
  let computed = 0;
  for (const t of tm.tables) {
    const joins = tm.relationships.filter((r) => r.from === t.name && byName.has(r.to)).map((r) => ({
      name: r.to,
      sql: r.from_columns.map((c, i) => `${own(t, c)} = ${other(byName.get(r.to), r.to, r.to_columns[i], true)}`).join(" AND "),
      relationship: "many_to_one",
    }));
    computed += t.fields.filter((f) => !isIdentifier(f.sql)).length;
    const source = t.source.kind === "table"
      ? { sql_table: t.source.parts.join(".") }
      : { sql: t.source.sqlByDialect?.[tm.dialect] ?? t.source.sql };
    const cube = {
      name: t.name,
      ...source,
      ...(t.description ? { description: t.description } : {}),
      ...(joins.length ? { joins } : {}),
      dimensions: t.fields.map((f) => dimension(t, f)),
      ...(measures.get(t.name)?.length ? { measures: measures.get(t.name) } : {}),
    };
    files[`model/cubes/${t.name}.yml`] = yaml({ cubes: [cube] });
  }

  // The view: depth first from the base cube along the declared joins.
  const base = byName.has("revenue_event") ? "revenue_event" : tm.tables.find((t) => !t.staged && !t.spine)?.name ?? tm.tables[0]?.name;
  const paths = new Map<string, string>();
  const walk = (name: string, path: string) => {
    if (paths.has(name)) return;
    paths.set(name, path);
    for (const r of tm.relationships) if (r.from === name && byName.has(r.to)) walk(r.to, `${path}.${r.to}`);
  };
  if (base) walk(base, base);
  const viewName = slugName(tm.name);
  files[`model/views/${viewName}.yml`] = yaml({
    views: [{
      name: viewName,
      ...(tm.description ? { description: tm.description } : {}),
      cubes: [...paths.entries()].map(([name, path]) => ({ join_path: path, includes: "*", ...(name === base ? {} : { prefix: true }) })),
    }],
  });

  const unreachable = tm.tables.filter((t) => !paths.has(t.name) && !t.staged && !t.spine).map((t) => t.name);
  const stagedCount = tm.tables.filter((t) => t.staged).length;
  notes.push(`The view ${viewName} starts at ${base} and reaches ${paths.size} cube${paths.size === 1 ? "" : "s"} along the joins.`);
  if (unreachable.length) notes.push(`Not reachable from ${base} along the joins, so left out of the view (query the cube directly): ${unreachable.join(", ")}.`);
  if (stagedCount) notes.push(`The ${stagedCount} staged cube${stagedCount === 1 ? " holds" : "s hold"} one row per reporting period and join nothing, so they sit outside the view; filter period_start to one period.`);
  if (crossCube.length) notes.push(`APPROXIMATED: ${crossCube.length} measure${crossCube.length === 1 ? " reads" : "s read"} another cube through the join path; check each against GASP's value before relying on it: ${crossCube.join("; ")}.`);
  if (computed) notes.push(`${computed} dimension${computed === 1 ? " is a computed expression" : "s are computed expressions"} written as in your model, unqualified; qualify the columns with {CUBE}. if a joined table carries a column of the same name.`);
  if (opts.database?.trim()) notes.push(`database ${opts.database.trim()} is not needed: Cube's data source connection names the database, so sql_table keeps your source as written.`);
  return { files, notes };
}
