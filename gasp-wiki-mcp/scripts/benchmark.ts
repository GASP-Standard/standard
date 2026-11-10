/**
 * The GASP accuracy benchmark: does an LLM answer a SaaS metric question
 * correctly over a warehouse, and how much does the GASP semantic layer help?
 *
 * Three conditions, same question, same model, same warehouse (the synthetic
 * SaaS dataset the test suite runs on, loaded into PGlite), the SQL the model
 * writes executed and compared with the canonical value:
 *   raw     the CREATE TABLE statements and the question (text-to-SQL baseline)
 *   gasp    the same plus the GASP definition of the metric: its formula in the
 *           standard's grammar, what the grammar means, the fields it reads and
 *           the table and column each maps to (the semantic layer as context)
 *   layer   the GASP tools answer: generate_query's compiled SQL, run as is
 * Ground truth is the canonical compiled SQL on the same data, which the test
 * suite pins against independently computed values.
 *
 * Usage (from gasp-wiki-mcp):
 *   npx tsx scripts/benchmark.ts --dry-run                 # questions, truth and the layer condition, no API calls
 *   npx tsx scripts/benchmark.ts --runs 5 --models claude-sonnet-5-5,claude-opus-5-5
 * Reads ANTHROPIC_API_KEY from the environment or from gasp-wiki-mcp/.env (KEY=value lines).
 * Writes docs/benchmark/results-<date>.json and docs/benchmark/results-<date>.md at the repo root.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import Anthropic from "@anthropic-ai/sdk";
import { loadStandard, isMetricStub, metricFormulaId } from "../src/loader.js";
import { formatCanonicalFormula, formatDataRequirement, fillTemplate } from "../src/tools.js";
import { adapter, fixtureDb, bind } from "../test/fixture-db.js";
import type { Metric, StandardData } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..");
const OUT = join(ROOT, "docs", "benchmark");

// ── arguments ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const DRY = args.includes("--dry-run");
const RUNS = Number(flag("runs", "5"));
const MODELS = flag("models", "claude-sonnet-5-5,claude-opus-5-5").split(",");
const CONCURRENCY = Number(flag("concurrency", "4"));
const LIMIT = Number(flag("questions", "0"));
const PERIOD = { label: "March 2026", start: "2026-03-01", end: "2026-03-31" };

// .env: KEY=value lines, no export, no quotes needed
const envFile = join(here, "..", ".env");
if (existsSync(envFile)) for (const line of readFileSync(envFile, "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// ── the warehouse ──────────────────────────────────────────────────────────────
const data: StandardData = loadStandard();
const db: PGlite = await fixtureDb();

async function ddl(): Promise<string> {
  const res = await db.query<{ table_name: string; column_name: string; data_type: string }>(
    "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'gasp_%' ORDER BY table_name, ordinal_position",
  );
  const tables = new Map<string, string[]>();
  for (const r of res.rows) tables.set(r.table_name, [...(tables.get(r.table_name) ?? []), `  ${r.column_name} ${r.data_type.toUpperCase()}`]);
  return [...tables].map(([t, cols]) => `CREATE TABLE ${t} (\n${cols.join(",\n")}\n);`).join("\n\n");
}
const DDL = await ddl();

// ── the questions ──────────────────────────────────────────────────────────────
interface Question { id: string; metric: Metric; text: string; truth: number | null; layerSql: string }

const layerSql = (id: string): string => bind(fillTemplate(data.queryTemplates![id]!, adapter, data).sql, PERIOD.start, PERIOD.end);

async function scalar(sql: string): Promise<{ value: number | null; rows: number; cols: number }> {
  const res = await db.query<Record<string, unknown>>(sql);
  const first = res.rows[0];
  const cols = first ? Object.keys(first).length : 0;
  const v = first ? Object.values(first)[0] : null;
  return { value: v === null || v === undefined ? null : Number(v), rows: res.rows.length, cols };
}

const questions: Question[] = [];
for (const metric of data.metrics.filter((m) => m.department === "Core" && !isMetricStub(m))) {
  const id = metricFormulaId(data, metric);
  const formula = data.formulas?.[id];
  if (!formula || formula.notComputable || !data.queryTemplates?.[id]) continue;
  const sql = layerSql(id);
  const { value } = await scalar(sql);
  if (value === null) { console.error(`skip ${id}: canonical value is null for ${PERIOD.label}`); continue; }
  questions.push({ id, metric, text: `What was ${metric.name} for ${PERIOD.label}?`, truth: value, layerSql: sql });
}
const picked = LIMIT ? questions.slice(0, LIMIT) : questions;

const SHOW = flag("show", "");

// ── the prompts ────────────────────────────────────────────────────────────────
const SYSTEM = [
  "You are a data analyst writing PostgreSQL 16 SQL over a SaaS company's warehouse.",
  "Answer with exactly one SQL query in a ```sql fenced block and nothing else: no explanation, no comments outside the block.",
  "The query must return one row with one numeric column, the answer to the question.",
  "A period named as a month is the inclusive calendar range of that month: 'March 2026' is 2026-03-01 to 2026-03-31.",
  "Express rates, ratios and percentages as decimals: 0.95, not 95. Express money in the currency units stored, not cents.",
  "Tables whose names end in _snapshots or that carry a snapshot_date hold one row per entity per snapshot date; a value 'at' a date is read from the latest snapshot on or before that date.",
].join(" ");

const GRAMMAR = [
  "How to read a GASP formula: `field.x` is a column; `metric.y` is another GASP metric, computed the same way for the same period and substituted in.",
  "`sum(expr where cond)` and `count_distinct(x where cond)` aggregate rows of one dataset filtered to the reporting period by the dataset's date field unless the formula says otherwise.",
  "`at period_end` and `at period_start` read a snapshot dataset at the latest snapshot on or before that date (period_start is the first day of the period, period_end the last).",
  "`lag(metric.y, 1 month)` is the metric for the period one month earlier. `in_period(field.d)` filters to rows whose date d falls in the period.",
  "A sum over no matching rows is 0; a count is 0; a ratio with a zero denominator is NULL. Ratios are unscaled decimals.",
].join(" ");

/** The warehouse table of each dataset the metric reads and the column of each field, from the fixture adapter (`gaspField`, `warehouseRef` as table.column). */
function mappingText(id: string): string {
  const req = data.dataRequirements?.find((r) => r.formulaId === id);
  if (!req) return "";
  const lines: string[] = [];
  for (const ds of req.datasets) {
    const table = (adapter.datasets as Record<string, string> | undefined)?.[ds];
    if (table) lines.push(`- dataset ${ds} → table ${table}`);
  }
  for (const f of req.fields) {
    const refs = (adapter.mappings as Array<{ gaspField: string; warehouseRef: string }>)
      .filter((m) => m.gaspField === f && req.datasets.some((ds) => m.warehouseRef.startsWith(`${(adapter.datasets as Record<string, string>)[ds]}.`)))
      .map((m) => m.warehouseRef);
    if (refs.length) lines.push(`- field.${f} → ${refs.join(", ")}`);
  }
  return lines.join("\n");
}

/** The canonical formula and unit of every metric the formula reaches through `metric.` references, transitively: the layer defines them, so the context carries them. */
function referencedMetrics(id: string): string {
  const seen = new Set<string>([id]);
  const queue = [id];
  const lines: string[] = [];
  while (queue.length) {
    const cur = queue.shift()!;
    const f = data.formulas?.[cur];
    if (!f?.formula) continue;
    for (const m of f.formula.matchAll(/metric\.([a-z0-9_]+)/g)) {
      const ref = m[1];
      if (seen.has(ref)) continue;
      seen.add(ref);
      const rf = data.formulas?.[ref];
      if (!rf?.formula) continue;
      const name = data.metrics.find((x) => metricFormulaId(data, x) === ref)?.name ?? ref;
      lines.push(`- metric.${ref} (${name}): \`${rf.formula}\`${rf.unit ? ` [unit: ${rf.unit}]` : ""}`);
      queue.push(ref);
    }
  }
  return lines.length ? `The metrics this formula references, each defined by the standard the same way:\n${lines.join("\n")}` : "";
}

function gaspContext(q: Question): string {
  const canonical = formatCanonicalFormula(data, q.metric).join("\n");
  const referenced = referencedMetrics(q.id);
  const req = data.dataRequirements?.find((r) => r.formulaId === q.id);
  const requirement = req ? formatDataRequirement(req) : "";
  const definition = q.metric.definition ? `Definition: ${q.metric.definition}` : "";
  const mapping = mappingText(q.id);
  return [
    `The GASP Standard defines ${q.metric.name} as follows. Compute exactly this definition.`,
    definition,
    canonical,
    referenced,
    GRAMMAR,
    requirement,
    mapping ? `Where each field lives in this warehouse:\n${mapping}` : "",
  ].filter(Boolean).join("\n\n");
}

if (SHOW) {
  const q = picked.find((x) => x.id === SHOW);
  if (!q) { console.error(`no question ${SHOW}`); process.exit(1); }
  console.log(`=== question\n${q.text}\n=== truth ${q.truth}\n=== gasp context\n${gaspContext(q)}\n=== layer sql\n${q.layerSql}\n=== DDL (first 600 chars of ${DDL.length})\n${DDL.slice(0, 600)}`);
  await db.close();
  process.exit(0);
}

// ── grading ────────────────────────────────────────────────────────────────────
type Category = "correct" | "wrong value" | "scaled by 100" | "null" | "sql error" | "no sql" | "not a scalar" | "unsafe sql" | "refusal";
interface Run { model: string; condition: "raw" | "gasp" | "layer"; metric: string; run: number; sql: string; value: number | null; truth: number | null; category: Category; error?: string; ms: number; input_tokens?: number; output_tokens?: number; cache_read?: number }

const close = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(1e-9, 1e-6 * Math.max(Math.abs(a), Math.abs(b)));
const UNSAFE = /\b(drop|delete|insert|update|alter|create|truncate|grant|copy)\b/i;

async function grade(sql: string, truth: number | null): Promise<Pick<Run, "value" | "category" | "error">> {
  if (!sql.trim()) return { value: null, category: "no sql" };
  if (UNSAFE.test(sql)) return { value: null, category: "unsafe sql" };
  try {
    const r = await Promise.race([scalar(sql), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout after 60s")), 60_000))]);
    if (r.rows !== 1 || r.cols !== 1) return { value: r.value, category: r.value !== null && truth !== null && close(r.value, truth) ? "correct" : "not a scalar" };
    if (r.value === null) return { value: null, category: truth === null ? "correct" : "null" };
    if (truth === null) return { value: r.value, category: "wrong value" };
    if (close(r.value, truth)) return { value: r.value, category: "correct" };
    if (close(r.value / 100, truth) || close(r.value * 100, truth)) return { value: r.value, category: "scaled by 100" };
    return { value: r.value, category: "wrong value" };
  } catch (e) {
    return { value: null, category: "sql error", error: (e as Error).message.split("\n")[0].slice(0, 200) };
  }
}

const extractSql = (text: string): string => { const m = text.match(/```sql\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/); return (m ? m[1] : text).trim().replace(/;\s*$/, ""); };

// ── the model ──────────────────────────────────────────────────────────────────
const client = new Anthropic({ maxRetries: 4 });
async function ask(model: string, q: Question, condition: "raw" | "gasp"): Promise<{ sql: string; ms: number; usage: { input_tokens: number; output_tokens: number; cache_read: number }; refusal: boolean }> {
  const user = condition === "raw" ? q.text : `${q.text}\n\n${gaspContext(q)}`;
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: 4000,
    system: [
      { type: "text", text: SYSTEM },
      { type: "text", text: `The warehouse:\n\n${DDL}`, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: user }],
    output_config: { effort: "medium" },
  };
  const started = performance.now();
  const response: Anthropic.Message = await client.messages.create(params);
  const ms = Math.round(performance.now() - started);
  const refusal = response.stop_reason === "refusal";
  const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n");
  return { sql: refusal ? "" : extractSql(text), ms, usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens, cache_read: response.usage.cache_read_input_tokens ?? 0 }, refusal };
}

// ── run ────────────────────────────────────────────────────────────────────────
const runs: Run[] = [];
for (const q of picked) {
  const started = performance.now();
  const g = await grade(q.layerSql, q.truth);
  runs.push({ model: "gasp-standard-mcp", condition: "layer", metric: q.id, run: 1, sql: q.layerSql, truth: q.truth, ms: Math.round(performance.now() - started), ...g });
}

if (!DRY) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) { console.error("No ANTHROPIC_API_KEY in the environment or gasp-wiki-mcp/.env; run with --dry-run or add the key."); process.exit(2); }
  const jobs: Array<() => Promise<void>> = [];
  for (const model of MODELS) for (const condition of ["raw", "gasp"] as const) for (const q of picked) for (let i = 1; i <= RUNS; i++) {
    jobs.push(async () => {
      try {
        const a = await ask(model, q, condition);
        const g = a.refusal ? { value: null, category: "refusal" as Category } : await grade(a.sql, q.truth);
        runs.push({ model, condition, metric: q.id, run: i, sql: a.sql, truth: q.truth, ms: a.ms, input_tokens: a.usage.input_tokens, output_tokens: a.usage.output_tokens, cache_read: a.usage.cache_read, ...g });
      } catch (e) {
        runs.push({ model, condition, metric: q.id, run: i, sql: "", value: null, truth: q.truth, category: "sql error", error: `api: ${(e as Error).message.slice(0, 200)}`, ms: 0 });
      }
      process.stderr.write(`\r${runs.length - picked.length}/${jobs.length} calls`);
    });
  }
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (next < jobs.length) { const j = jobs[next++]; await j(); } }));
  process.stderr.write("\n");
}

// ── report ─────────────────────────────────────────────────────────────────────
const date = new Date().toISOString().slice(0, 10);
mkdirSync(OUT, { recursive: true });
const pct = (n: number, d: number): string => d ? `${(100 * n / d).toFixed(1)}%` : "n/a";
const groups = new Map<string, Run[]>();
for (const r of runs) { const k = `${r.model}|${r.condition}`; groups.set(k, [...(groups.get(k) ?? []), r]); }

const lines: string[] = [];
lines.push(`# GASP accuracy benchmark, ${date}`, "");
lines.push(`${picked.length} questions, one per Core metric with a canonical formula, each "What was <metric> for ${PERIOD.label}?" over the GASP synthetic SaaS warehouse (${DDL.split("CREATE TABLE").length - 1} tables, PGlite). Ground truth: the canonical compiled SQL on the same data, which the test suite pins. A run is correct when its SQL returns one row and one column within 1e-6 relative of the truth.${DRY ? " Dry run: the layer condition only." : ` ${RUNS} runs per question per condition per model, effort medium, adaptive thinking, no fallbacks.`}`, "");
lines.push("| Model | Condition | Correct | Scaled by 100 | Wrong value | Null | SQL error | Other |", "|---|---|---|---|---|---|---|---|");
for (const [k, rs] of groups) {
  const [model, condition] = k.split("|");
  const c = (cat: Category) => rs.filter((r) => r.category === cat).length;
  const other = rs.length - c("correct") - c("scaled by 100") - c("wrong value") - c("null") - c("sql error");
  lines.push(`| ${model} | ${condition} | **${pct(c("correct"), rs.length)}** (${c("correct")}/${rs.length}) | ${c("scaled by 100")} | ${c("wrong value")} | ${c("null")} | ${c("sql error")} | ${other} |`);
}
lines.push("", "## Per metric", "", `| Metric | Truth | ${[...groups.keys()].map((k) => k.replace("|", " ")).join(" | ")} |`, `|---|---|${[...groups.keys()].map(() => "---").join("|")}|`);
for (const q of picked) {
  const cells = [...groups.values()].map((rs) => { const mine = rs.filter((r) => r.metric === q.id); return pct(mine.filter((r) => r.category === "correct").length, mine.length); });
  lines.push(`| ${q.metric.name} | ${q.truth} | ${cells.join(" | ")} |`);
}
const tokens = runs.filter((r) => r.input_tokens);
if (tokens.length) {
  const sum = (f: (r: Run) => number) => tokens.reduce((a, r) => a + f(r), 0);
  lines.push("", "## Cost", "", `${tokens.length} model calls, ${sum((r) => r.input_tokens!).toLocaleString()} input tokens of which ${sum((r) => r.cache_read ?? 0).toLocaleString()} read from cache, ${sum((r) => r.output_tokens!).toLocaleString()} output tokens.`);
}
lines.push("", "## Method", "", "Conditions: `raw` is the CREATE TABLE statements and the question, the text-to-SQL baseline; `gasp` adds the GASP definition of the metric (the formula in the standard's grammar, how to read the grammar, the fields and the table and column each maps to), the semantic layer as context; `layer` is the compiled SQL the GASP tools return for the question, run as is. The same system prompt in every model condition states the period convention, that ratios are decimals and how snapshot tables are read. SQL that is not a single SELECT is refused unrun. Every answer, its SQL and its category are in the JSON beside this file.");
writeFileSync(join(OUT, `results-${date}.md`), lines.join("\n") + "\n");
writeFileSync(join(OUT, `results-${date}.json`), JSON.stringify({ date, period: PERIOD, models: DRY ? [] : MODELS, runs: RUNS, questions: picked.map((q) => ({ id: q.id, name: q.metric.name, text: q.text, truth: q.truth })), results: runs }, null, 1));
console.log(lines.slice(0, 12).join("\n"));
console.log(`\nWritten: docs/benchmark/results-${date}.md and .json`);
await db.close();
