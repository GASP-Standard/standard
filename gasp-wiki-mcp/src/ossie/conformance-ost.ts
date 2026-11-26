/**
 * A conformance case as a script for `ost`, the Apache Ossie SQL test runner
 * (apache/ossie `ost/`, format in `ost/docs/ost.md`): the form upstream's own
 * compliance/query cases take. The script creates the tables the case reads,
 * loads the model beside it with `modelFile` and asks for the metric through
 * `executeExpand`, which expands `AGG(metric)` with the upstream view expander
 * into DuckDB SQL and runs it. A direct case then asks for each reading that
 * keeps the model's expression, labelled with its grade.
 *
 * The commands are written here. The expected output under each command (the
 * expansion and the result table) is written by `ost` itself, since the
 * expansion is that tool's text: the runner (scripts/ossie-conformance.ts)
 * takes it from an `ost` run when `uv` is on PATH and keeps the committed
 * output otherwise, and in both cases `ostProblems` holds each table to the
 * values computed on PGlite. A script therefore splits into parts (`ostParts`),
 * each ending with one `executeExpand` command, with one output after each.
 *
 * The tables are inline because `ost` has no command that runs a SQL file. This
 * module is pure.
 */
import type { ConformanceCase, Grade } from "./conformance.js";

/** The script's file name in a case directory, beside the model it loads. */
export const OST_FILE = "case.ost";

/**
 * Digits after the point `ost` writes a double with, so a result does not turn
 * on the last bit of a division. Six is the most the runner at `7fb92a7` writes
 * every value with: from seven it prints a zero as `0E-7` (Python's text for a
 * zero decimal with that exponent).
 */
export const OST_DOUBLE_DIGITS = 6;

/** One `executeExpand` command of a case script: the expected value, or a reading the model can be asked for. */
export interface OstQuery {
  grade: "right" | Grade;
  /** The reading's name; absent on the expected value. */
  reading?: string;
  /** The comment above the command. */
  comment: string;
  sql: string[];
}

/** The dataset of the case's model that declares its metric. */
function homeDataset(c: ConformanceCase): string {
  const home = c.model.datasets.filter((d) => d.metrics?.some((m) => m.name === c.metric));
  if (home.length !== 1) throw new Error(`Conformance case ${c.id}: ${c.metric} is declared under ${home.length} datasets, and the ost script asks for it of one`);
  return home[0].name;
}

/** The queries a case script runs: the metric for the period, then each reading with a filter of its own. */
export function ostQueries(c: ConformanceCase): OstQuery[] {
  const relation = `${c.model.name}.${homeDataset(c)}`;
  const select = `SELECT ${[...c.dimensions, `AGG(${c.metric}) AS value`].join(", ")}`;
  const group = c.dimensions.length ? [`GROUP BY ${c.dimensions.join(", ")}`, `ORDER BY ${c.dimensions.join(", ")}`] : [];
  const query = (where: string): string[] => [select, `FROM ${relation}`, `WHERE ${where}`, ...group];
  const right = c.kind === "direct"
    ? `Grade right. ${c.metric} for the period, read on the last snapshot date of the period as the formula says (at period_end).`
    : `Grade right. ${c.metric} for the period: ${c.cohortTable ? "the rows of the staged dataset for the period, which the metric's expression sums" : "the row of the staged dataset for the period"}.`;
  return [
    { grade: "right", comment: right, sql: query(c.where) },
    ...c.readings.filter((r) => r.where).map((r): OstQuery => ({ grade: r.grade, reading: r.name, comment: `Grade ${r.grade}, reading ${r.name}: ${r.description}.`, sql: query(r.where!) })),
  ];
}

/** A comment wrapped at about 100 columns, one `# ` line each. */
function comment(text: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > 98) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.map((l) => `# ${l}`);
}

/** A data script's statements with its header comments as ost comments. */
function inlineData(sql: string): string[] {
  return sql.split("\n").filter((l) => l.trim()).map((l) => (l.startsWith("--") ? `# ${l.replace(/^--\s*/, "")}` : l));
}

/**
 * The script of a case as parts: the text up to and including each
 * `executeExpand` command. `ost` writes the output of a command directly under
 * it, so the script is each part followed by its output (`ostJoin`).
 * `dataScripts` are the period spine and the case's dataset scripts, in order.
 */
export function ostParts(c: ConformanceCase, dataScripts: string[]): string[] {
  const queries = ostQueries(c);
  const unasked = c.readings.filter((r) => !r.where).map((r) => r.name);
  const head = [
    ...comment(`GASP conformance case ${c.id}: ${c.construct}.`),
    ...comment(`Metric ${c.metric} for the period ${c.period.start} to ${c.period.end}. GASP formula:`),
    `#   ${c.formula.trim()}`,
    ...(c.canonicalUrl ? [`# ${c.canonicalUrl}`] : []),
    "#",
    ...comment("A script for ost, the Apache Ossie SQL test runner (ost/docs/ost.md in apache/ossie). executeExpand expands the query with the view expander into SQL over the tables created below and runs it on DuckDB. The text and the table under each command are the expected output, as ost wrote them. Run it from the conformance directory:"),
    `#   uv run --project <apache/ossie checkout>/ost ost -d . cases/${c.id}/${OST_FILE}`,
    "#",
    ...comment("Generated by npm run conformance in gasp-wiki-mcp. Do not edit."),
    "",
    ...comment(`A double is written with ${OST_DOUBLE_DIGITS} digits after the point.`),
    `set("doubleDigits", ${OST_DOUBLE_DIGITS});`,
    "",
    ...comment(`The tables the case reads: the statements of ../../data/period_spine.sql${c.datasets.map((d) => ` and ../../data/${d}.sql`).join("")}, copied here so the script stands alone.`),
    ...dataScripts.flatMap(inlineData),
    "",
    ...comment(`The model beside this script. Each of its datasets is a relation in the schema ${c.model.name}.`),
    `modelFile("${c.model.name}", "model.ossie.yaml");`,
    ...(unasked.length ? ["", ...comment(`readings.sql also lists ${unasked.join(" and ")}, which ${unasked.length === 1 ? "changes" : "change"} the SQL of the model and so ${unasked.length === 1 ? "has" : "have"} no query here.`)] : []),
  ];
  const parts = queries.map((q, i) => [
    ...(i === 0 ? head : []),
    "",
    ...comment(q.comment),
    "executeExpand(",
    ...q.sql.map((l, j) => `  ${l}${j === q.sql.length - 1 ? ");" : ""}`),
    "",
  ].join("\n"));
  // ost refuses a script with a tab or a space at the end of a line.
  const bad = parts.join("").split("\n").findIndex((l) => /\t|\s$|\r/.test(l));
  if (bad >= 0) throw new Error(`Conformance case ${c.id}: line ${bad + 1} of the ost script holds a tab or ends with a space, which ost refuses`);
  return parts;
}

/** The script: each part followed by the output of its command. */
export const ostJoin = (parts: string[], outputs: string[]): string => parts.map((p, i) => p + (outputs[i] ?? "")).join("");

/** The output of one executeExpand: the expansion as a raw string, then the result table. */
const OUTPUT = /^> \{_\|\n[\s\S]*?\n\|_\} : string\n(?:[+|].*\n)+$/;

/** The outputs in a script with these parts, or nothing when the text is another script or an output is missing. */
export function ostOutputs(parts: string[], text: string): string[] | undefined {
  const outputs: string[] = [];
  let at = 0;
  for (let i = 0; i < parts.length; i++) {
    if (!text.startsWith(parts[i], at)) return undefined;
    at += parts[i].length;
    const next = i + 1 < parts.length ? text.indexOf(parts[i + 1], at) : text.length;
    if (next < 0) return undefined;
    outputs.push(text.slice(at, next));
    at = next;
  }
  return outputs.every((o) => OUTPUT.test(o)) ? outputs : undefined;
}

/** The result table of an output: its column names and each row's cells as text, NULL an empty cell. */
export function ostTable(output: string): { columns: string[]; rows: string[][] } | undefined {
  const table = output.slice(output.indexOf("\n|_} : string\n") + "\n|_} : string\n".length).split("\n").filter((l) => l.startsWith("|"));
  if (!table.length) return undefined;
  const [columns, ...rows] = table.map((l) => l.slice(1, -1).split("|").map((cell) => cell.trim()));
  return { columns, rows };
}

/** A cell against a value computed on PGlite: text as it is, a number within the rounding of the script. */
function sameCell(cell: string, want: unknown): boolean {
  if (want === null || want === undefined) return cell === "";
  if (typeof want === "number") return /^-?\d+(\.\d+)?$/.test(cell) && Math.abs(Number(cell) - want) <= 0.5 * 10 ** -OST_DOUBLE_DIGITS + 1e-9 * Math.abs(want);
  return cell === String(want);
}

/** What the outputs of a case script say that the expected rows and the reading values do not. Empty when they agree. */
export function ostProblems(c: ConformanceCase, outputs: string[], expected: Array<Record<string, unknown>>, readings: Record<string, number | null>): string[] {
  const queries = ostQueries(c);
  if (outputs.length !== queries.length) return [`${outputs.length} outputs for ${queries.length} commands`];
  const columns = [...c.dimensions, "value"];
  return queries.flatMap((q, i) => {
    const what = q.reading ?? "the expected value";
    const table = ostTable(outputs[i]);
    if (!table) return [`${what}: no result table`];
    if (table.columns.join() !== columns.join()) return [`${what}: columns ${table.columns.join(", ")}, expected ${columns.join(", ")}`];
    const want = q.reading ? [{ value: readings[q.reading] ?? null }] as Array<Record<string, unknown>> : expected;
    if (table.rows.length !== want.length) return [`${what}: ${table.rows.length} rows, expected ${want.length}`];
    return table.rows.flatMap((row, r) => columns.flatMap((col, k) => (sameCell(row[k], want[r][col]) ? [] : [`${what}: row ${r + 1} ${col} is ${row[k] || "NULL"}, expected ${String(want[r][col])}`])));
  });
}
