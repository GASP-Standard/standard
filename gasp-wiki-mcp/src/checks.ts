/**
 * Readiness checks and the fix plan (docs/ossie-interop-spec.md, readiness
 * level 3: Check and Plan), behind the generate_checks and plan_fixes tools.
 *
 * A check is a rule the standard already states (cel.md, atl.md), written as
 * SQL that counts the rows breaking it over the GASP datasets a mapping covers.
 * GASP has no warehouse access: generate_checks writes the SQL in the
 * warehouse's dialect with the compiler's placeholders, the company runs it and
 * pastes the result rows (check_id, violations) back, and the tool reports pass
 * or fail per check and per metric. A check protects the metrics whose compiled
 * formulas read the field or dataset it covers, so a failing check names the
 * numbers it puts in doubt.
 *
 * The checks (decided 2026-11-03, DECISIONS.md):
 *   revenue_event_identity      prior_mrr + mrr_change = new_mrr on every revenue event (cel.md)
 *   mrr_continuity              a subscription's mrr_start equals its mrr on the previous snapshot
 *   unique_event_id:<dataset>   event_id unique within each event dataset that carries one
 *   lifecycle_tag:<dataset>     one lifecycle_attribution, from the ATL enum, on every event (ATL rule 1)
 *   expansion_tag:<dataset>     expansion_classification on expansion, contraction and reactivation
 *                               revenue events and on every amendment (ATL rule 2)
 *   cost_function_tag           cost_function, from the enum, on every cost event (ATL rule 3)
 *   customer_identity:events    every revenue event's customer_id is a known customer
 *   customer_identity:customers every customer active on the latest snapshot has a revenue event
 *   freshness:<dataset>         the latest date in each mapped dataset is within the sync window
 *   range:<formulaId>           the metric's value stays inside the ontology's hard min and max
 *                               (validationRules) in every reporting period of the period spine
 *
 * A range check evaluates the metric's compiled template once per row of the
 * company's period spine (the table compile_model reads, gasp.period_spine by
 * default) and counts the periods outside the bounds; a NULL value is not a
 * violation. The bounds come from src/ranges.ts, which scales a percent rule on
 * a percent formula by 100 (GRR at most 1) and takes any other rule as given;
 * the drift scorer reads the same bounds. A range check is kept only when the
 * mapping covers its metric fully.
 *
 * Left out on purpose: the O/M bridges. They reconcile by construction when
 * both forms come from the GASP formulas, so they live in the drift scorer,
 * where a company's own O and M numbers arrive.
 *
 * plan_fixes ranks every fix a mapping and a set of results call for: map an
 * unmapped field, or clear a failing check. Core metrics unlocked first, then
 * all metrics unlocked; the effort class is shown and breaks ties, never
 * multiplied into the order.
 */
import { DIALECT, type DialectName } from "./dialect.js";
import { exampleSql } from "./compile.js";
import { breakdownTemplate, checkAdapter, chooseDialect, fillTemplate, type Adapter } from "./tools.js";
import { loadAdapter } from "./ossie/adapt.js";
import { PERIOD_SPINE } from "./ossie/model.js";
import { describeRange, rangeRules } from "./ranges.js";
import { metricUrl, resolveDocLink } from "./urls.js";
import type { DataRequirement, QueryTemplate, StandardData } from "./types.js";

export type Effort = "small" | "medium" | "large";

export interface ReadinessCheck {
  id: string;
  name: string;
  /** The rule, in one sentence. */
  rule: string;
  /** Where the standard states it: a doc link resolveDocLink accepts. */
  source: string;
  /** The datasets the check reads. */
  datasets: string[];
  /** The field@dataset pairs the SQL reads; the mapping must cover them all. */
  placeholders: string[];
  /** What the check protects: the metrics reading this field, or any field of this dataset, or one metric (a range check). */
  protects: { dataset: string; field?: string } | { metric: string };
  effort: Effort;
  /** The SQL, with placeholders, returning one row: violations. */
  sql: (d: DialectName) => string;
}

const ph = (field: string, ds: string) => `{{${field}@${ds}}}`;
const table = (ds: string) => `{{_table:${ds}}}`;
const quoted = (values: string[]) => values.map((v) => `'${v}'`).join(", ");
const count = (from: string) => `SELECT COUNT(*) AS violations FROM ${from}`;

/** Options every check function takes: the freshness window and date, and the company's period spine for the range checks. */
export interface CheckOptions {
  window?: number;
  asOf?: string;
  /** The period table (period_start, period_end) the range checks read; compile_model reads the same one. Default gasp.period_spine. */
  spine?: string;
}

/** A bound as SQL and as text: no exponent, no float noise. */
const num = (n: number) => String(Number(n.toPrecision(12)));

/**
 * The range checks: one per metric with a hard min or max in the ontology's validationRules
 * (src/ranges.ts scales them to the formula) and a scalar compiled template. Breakdown
 * templates are skipped.
 */
function rangeChecks(data: StandardData, spine: string): ReadinessCheck[] {
  const out: ReadinessCheck[] = [];
  const seen = new Set<string>();
  for (const rule of rangeRules(data)) {
    const { metric, formulaId: id, min, max } = rule;
    const template = data.queryTemplates?.[id];
    if (seen.has(id) || !template || template.breakdown) continue;
    if (!/^SELECT [\s\S]* AS \w+$/.test(template.parameterizedQuery)) continue;
    seen.add(id);
    const unit = data.formulas?.[id]?.unit;
    const shown = unit === "percent" ? " (an unscaled ratio)" : unit ? ` (${unit})` : "";
    const where = [...(min !== undefined ? [`v.value < ${num(min)}`] : []), ...(max !== undefined ? [`v.value > ${num(max)}`] : [])].join(" OR ");
    const name = metric.name;
    out.push({
      id: `range:${id}`,
      name: `Range of ${name}`,
      rule: `${name} stays ${describeRange(rule)}${shown} in every reporting period${rule.notes.length ? `; ${rule.notes.join("; ")}` : ""}`,
      source: metricUrl(metric),
      datasets: template.datasets,
      placeholders: template.placeholders,
      protects: { metric: name },
      effort: "medium",
      sql: (d) => {
        const t = d === "postgres" ? template : (breakdownTemplate(data, id, undefined, d) as { template: QueryTemplate }).template;
        const expr = /^SELECT ([\s\S]*) AS \w+$/.exec(t.parameterizedQuery)![1]
          .split("{{_period_start}}").join("p.period_start").split("{{_period_end}}").join("p.period_end");
        return `SELECT COUNT(*) AS violations FROM (\n  SELECT p.period_start, p.period_end, (${expr}) AS value FROM ${spine} p\n) v\nWHERE ${where}`;
      },
    });
  }
  return out;
}

/** The checks the standard's data admits, from the ontology: event datasets carrying event_id, the tag fields, every dated dataset for freshness and the hard value ranges. */
export function readinessChecks(data: StandardData, opts: CheckOptions = {}): ReadinessCheck[] {
  const fields = new Map((data.ontology?.fields ?? []).map((f) => [f.id, f]));
  const datasets = data.ontology?.datasets ?? {};
  const on = (field: string) => fields.get(field)?.datasets ?? [];
  const values = (field: string) => fields.get(field)?.values ?? [];
  const checks: ReadinessCheck[] = [];

  checks.push({
    id: "revenue_event_identity",
    name: "CEL row identity",
    rule: "prior_mrr + mrr_change = new_mrr on every revenue event, to the cent",
    source: "cel.md#revenue_event",
    datasets: ["revenue_event"],
    placeholders: ["prior_mrr@revenue_event", "mrr_change@revenue_event", "new_mrr@revenue_event"],
    protects: { dataset: "revenue_event" },
    effort: "medium",
    sql: () => count(`${table("revenue_event")}\nWHERE ABS(COALESCE(${ph("prior_mrr", "revenue_event")}, 0) + COALESCE(${ph("mrr_change", "revenue_event")}, 0) - COALESCE(${ph("new_mrr", "revenue_event")}, 0)) >= 0.005`),
  });

  checks.push({
    id: "mrr_continuity",
    name: "MRR continuity",
    rule: "a subscription's mrr_start on a snapshot equals its mrr on the previous snapshot",
    source: "cel.md#deriving-revenue-events-from-a-subscription-ledger",
    datasets: ["subscription"],
    placeholders: ["subscription_id@subscription", "snapshot_date@subscription", "mrr@subscription", "mrr_start@subscription"],
    protects: { dataset: "subscription" },
    effort: "medium",
    sql: () => count(`(
  SELECT ${ph("mrr_start", "subscription")} AS mrr_start,
         LAG(${ph("mrr", "subscription")}) OVER (PARTITION BY ${ph("subscription_id", "subscription")} ORDER BY ${ph("snapshot_date", "subscription")}) AS previous_mrr
  FROM ${table("subscription")}
) s
WHERE previous_mrr IS NOT NULL AND ABS(COALESCE(mrr_start, 0) - previous_mrr) >= 0.005`),
  });

  for (const ds of on("event_id")) {
    checks.push({
      id: `unique_event_id:${ds}`,
      name: `Unique event_id on ${ds}`,
      rule: `event_id identifies one ${ds} row; corrections are new events and the original row stays`,
      source: "cel.md#design-principles",
      datasets: [ds],
      placeholders: [`event_id@${ds}`],
      protects: { dataset: ds },
      effort: "medium",
      sql: () => `SELECT COUNT(*) - COUNT(DISTINCT ${ph("event_id", ds)}) + SUM(CASE WHEN ${ph("event_id", ds)} IS NULL THEN 1 ELSE 0 END) AS violations FROM ${table(ds)}`,
    });
  }

  for (const ds of on("lifecycle_attribution")) {
    checks.push({
      id: `lifecycle_tag:${ds}`,
      name: `Lifecycle tag on ${ds}`,
      rule: `every ${ds} row carries one lifecycle_attribution from the ATL enum`,
      source: "atl.md#rule-1-every-event-gets-a-lifecycle-tag",
      datasets: [ds],
      placeholders: [`lifecycle_attribution@${ds}`],
      protects: { dataset: ds, field: "lifecycle_attribution" },
      effort: "medium",
      sql: () => count(`${table(ds)}\nWHERE ${ph("lifecycle_attribution", ds)} IS NULL OR ${ph("lifecycle_attribution", ds)} NOT IN (${quoted(values("lifecycle_attribution"))})`),
    });
  }

  for (const ds of on("expansion_classification")) {
    const scoped = ds === "revenue_event" && on("event_type").includes(ds);
    checks.push({
      id: `expansion_tag:${ds}`,
      name: `Expansion classification on ${ds}`,
      rule: scoped
        ? "every expansion, contraction and reactivation revenue event carries one expansion_classification from the ATL enum"
        : `every ${ds} row carries one expansion_classification from the ATL enum`,
      source: "atl.md#rule-2-revenue-growth-and-amendments-get-an-expansion-tag",
      datasets: [ds],
      placeholders: [`expansion_classification@${ds}`, ...(scoped ? [`event_type@${ds}`] : [])],
      protects: { dataset: ds, field: "expansion_classification" },
      effort: "medium",
      sql: () => count(`${table(ds)}\nWHERE ${scoped ? `${ph("event_type", ds)} IN ('expansion', 'contraction', 'reactivation') AND ` : ""}(${ph("expansion_classification", ds)} IS NULL OR ${ph("expansion_classification", ds)} NOT IN (${quoted(values("expansion_classification"))}))`),
    });
  }

  for (const ds of on("cost_function")) {
    checks.push({
      id: "cost_function_tag",
      name: "Cost function tag",
      rule: "every cost event carries one cost_function from the ATL enum",
      source: "atl.md#rule-3-cost-events-get-a-cost-function-tag",
      datasets: [ds],
      placeholders: [`cost_function@${ds}`],
      protects: { dataset: ds, field: "cost_function" },
      effort: "medium",
      sql: () => count(`${table(ds)}\nWHERE ${ph("cost_function", ds)} IS NULL OR ${ph("cost_function", ds)} NOT IN (${quoted(values("cost_function"))})`),
    });
  }

  if (on("customer_id").includes("revenue_event") && on("customer_id").includes("customer")) {
    checks.push({
      id: "customer_identity:events",
      name: "Revenue events resolve to a customer",
      rule: "every revenue event's customer_id appears in the customer snapshot",
      source: "cel.md#relationship-to-existing-data-model",
      datasets: ["revenue_event", "customer"],
      placeholders: ["customer_id@revenue_event", "customer_id@customer"],
      protects: { dataset: "revenue_event" },
      effort: "large",
      sql: () => count(`${table("revenue_event")} e\nWHERE e.${ph("customer_id", "revenue_event")} IS NULL OR NOT EXISTS (SELECT 1 FROM ${table("customer")} c WHERE c.${ph("customer_id", "customer")} = e.${ph("customer_id", "revenue_event")})`),
    });
    checks.push({
      id: "customer_identity:customers",
      name: "Active customers have revenue events",
      rule: "every customer active on the latest snapshot has at least one revenue event",
      source: "cel.md#relationship-to-existing-data-model",
      datasets: ["customer", "revenue_event"],
      placeholders: ["customer_id@customer", "snapshot_date@customer", "customer_status@customer", "customer_id@revenue_event"],
      protects: { dataset: "customer" },
      effort: "large",
      sql: () => count(`${table("customer")} c
WHERE c.${ph("snapshot_date", "customer")} = (SELECT MAX(${ph("snapshot_date", "customer")}) FROM ${table("customer")})
  AND c.${ph("customer_status", "customer")} = 'active'
  AND NOT EXISTS (SELECT 1 FROM ${table("revenue_event")} e WHERE e.${ph("customer_id", "revenue_event")} = c.${ph("customer_id", "customer")})`),
    });
  }

  const window = opts.window ?? 2;
  const asOf = opts.asOf ? `DATE '${opts.asOf}'` : "CURRENT_DATE";
  for (const [ds, meta] of Object.entries(datasets)) {
    if (!meta.date) continue;
    checks.push({
      id: `freshness:${ds}`,
      name: `Freshness of ${ds}`,
      rule: `the latest ${meta.date} in ${ds} is within ${window} day${window === 1 ? "" : "s"} of ${opts.asOf ?? "today"}`,
      source: "/v1/digital-twin",
      datasets: [ds],
      placeholders: [`${meta.date}@${ds}`],
      protects: { dataset: ds },
      effort: "small",
      // violations: the days beyond the window, 0 when fresh; an empty dataset counts as one violation.
      sql: (d) => `SELECT CASE WHEN MAX(${ph(meta.date, ds)}) IS NULL THEN 1 ELSE GREATEST(${DIALECT[d].daysBetween(asOf, `CAST(MAX(${ph(meta.date, ds)}) AS DATE)`)} - ${window}, 0) END AS violations FROM ${table(ds)}`,
    });
  }
  checks.push(...rangeChecks(data, opts.spine?.trim() || PERIOD_SPINE));
  return checks;
}

/** The metrics (data requirements) a check protects: those whose compiled formula, or one of its O and M forms, reads the field, or any field of the dataset; a range check protects its own metric (its O and M forms are the same requirement). */
export function protectedBy(check: ReadinessCheck, data: StandardData): DataRequirement[] {
  if ("metric" in check.protects) {
    const { metric } = check.protects;
    return data.dataRequirements.filter((dr) => dr.metric === metric);
  }
  const { dataset, field } = check.protects;
  return data.dataRequirements.filter((dr) =>
    dr.placeholders.some((p) => (field ? p === `${field}@${dataset}` : p.endsWith(`@${dataset}`)))
    || Object.values(dr.forms ?? {}).some((f) => f.datasets.includes(dataset) && (!field || f.fields.includes(field))));
}

/** A check as a query template, so fillTemplate compiles it over a mapping like a metric. */
export function checkTemplate(check: ReadinessCheck, dialect: DialectName): QueryTemplate {
  return {
    metric: check.id, fields: check.placeholders.map((p) => p.split("@")[0]), datasets: check.datasets, sourceTable: check.datasets.length === 1 ? check.datasets[0] : null,
    grain: "check", frequency: "on demand", source: check.source, parameterizedQuery: check.sql(dialect), staged: false, placeholders: check.placeholders,
  };
}

export interface CompiledCheck {
  check: ReadinessCheck;
  /** The SQL over the mapping; undefined when the mapping lacks a field or table it needs. */
  sql?: string;
  missing: string[];
  protects: DataRequirement[];
}

/** Every check compiled over a mapping: the runnable ones with their SQL, the rest with what they lack. */
export function compileChecks(adapter: Adapter, data: StandardData, dialect: DialectName, opts: CheckOptions = {}): CompiledCheck[] {
  const r = checkAdapter(adapter, data);
  const fully = new Set(r.fully.map((f) => f.metric));
  const covered = new Set([...r.fully.map((f) => f.metric), ...r.partial.map((p) => p.metric)]);
  return readinessChecks(data, opts).map((check) => {
    const filled = fillTemplate(checkTemplate(check, dialect), adapter, data);
    const missing = [...filled.missingFields, ...filled.missingTables.map((t) => `table for ${t}`)];
    // A check protects the metrics the mapping covers at least in part; the rest are not this company's concern yet.
    const protects = protectedBy(check, data).filter((dr) => covered.has(dr.metric));
    return { check, sql: missing.length ? undefined : filled.sql, missing, protects };
  })
    .filter((c) => !c.check.id.startsWith("freshness:") || c.protects.length > 0)
    // A range check over a metric the mapping does not cover fully is noise.
    .filter((c) => !("metric" in c.check.protects) || fully.has(c.check.protects.metric));
}

/** The runnable checks as one statement: one row per check (check_id, violations). */
export function checksAsOneQuery(compiled: CompiledCheck[]): string {
  return compiled.filter((c) => c.sql).map((c) => `SELECT '${c.check.id}' AS check_id, violations FROM (\n${c.sql}\n) ${c.check.id.replace(/\W/g, "_")}`).join("\nUNION ALL\n");
}

export type CheckResult = { check_id: string; violations: number };

/** Result rows pasted back: JSON (an array of objects or of [id, n] pairs, or an object keyed by check id) or CSV with a header or two columns. */
export function parseResults(text: string): { results?: CheckResult[]; error?: string } {
  const t = text.trim();
  if (!t) return { error: "Pass results: the rows the checks query returned, as JSON or CSV with check_id and violations." };
  const out: CheckResult[] = [];
  const take = (id: unknown, n: unknown) => {
    const v = Number(n);
    if (typeof id !== "string" || !id.trim() || !Number.isFinite(v)) return false;
    out.push({ check_id: id.trim(), violations: v });
    return true;
  };
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const parsed = JSON.parse(t) as unknown;
      const rows = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed ? Object.entries(parsed as Record<string, unknown>) : [];
      for (const row of rows) {
        const o = row as Record<string, unknown>;
        const ok = Array.isArray(row) ? take(row[0], row[1]) : typeof row === "object" && row ? take(o.check_id ?? o.CHECK_ID, o.violations ?? o.VIOLATIONS) : false;
        if (!ok) return { error: `Cannot read a result row: ${JSON.stringify(row)}. Each needs check_id and violations.` };
      }
      return out.length ? { results: out } : { error: "No result rows found in the JSON." };
    } catch (e) {
      return { error: `Results are not valid JSON: ${(e as Error).message}` };
    }
  }
  for (const line of t.split(/\r?\n/)) {
    const cells = line.split(/[,\t;]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cells.length < 2 || /^check_id$/i.test(cells[0])) continue;
    if (!take(cells[0], cells[1])) return { error: `Cannot read a result row: "${line}". Each needs check_id and violations.` };
  }
  return out.length ? { results: out } : { error: "No result rows found. Pass the rows the checks query returned, as JSON or CSV with check_id and violations." };
}

export type CheckStatus = "pass" | "fail" | "not run" | "cannot run";

export interface CheckReport {
  dialect: string;
  checks: Array<{ id: string; name: string; rule: string; status: CheckStatus; violations?: number; missing: string[]; protects: string[]; effort: Effort }>;
  /** Per metric that at least one runnable check protects: pass when every check protecting it passed. */
  metrics: Array<{ metric: string; department: string; status: "pass" | "fail" | "not run"; failing: string[] }>;
  sql: string;
  unknownResults: string[];
  /** The period spine the range checks read, when any range check is in the report. */
  spine?: string;
}

/** The checks compiled, with results applied when given. */
export function checkReport(compiled: CompiledCheck[], dialect: string, results?: CheckResult[], spine: string = PERIOD_SPINE): CheckReport {
  const byId = new Map((results ?? []).map((r) => [r.check_id, r.violations]));
  const checks = compiled.map((c) => {
    const v = byId.get(c.check.id);
    const status: CheckStatus = c.sql ? (v === undefined ? "not run" : v > 0 ? "fail" : "pass") : "cannot run";
    return { id: c.check.id, name: c.check.name, rule: c.check.rule, status, ...(v === undefined ? {} : { violations: v }), missing: c.missing, protects: c.protects.map((p) => p.metric), effort: c.check.effort };
  });
  const metricMap = new Map<string, { department: string; checks: string[] }>();
  for (const c of compiled) if (c.sql) for (const dr of c.protects) (metricMap.get(dr.metric) ?? metricMap.set(dr.metric, { department: dr.department, checks: [] }).get(dr.metric)!).checks.push(c.check.id);
  const statusOf = new Map(checks.map((c) => [c.id, c.status]));
  const metrics = [...metricMap.entries()].map(([metric, { department, checks: ids }]) => {
    const failing = ids.filter((id) => statusOf.get(id) === "fail");
    const status: "pass" | "fail" | "not run" = failing.length ? "fail" : ids.every((id) => statusOf.get(id) === "pass") ? "pass" : "not run";
    return { metric, department, status, failing };
  }).sort((a, b) => (a.department === "Core" ? 0 : 1) - (b.department === "Core" ? 0 : 1) || a.metric.localeCompare(b.metric));
  const known = new Set(compiled.map((c) => c.check.id));
  const ranged = compiled.some((c) => c.sql && c.check.id.startsWith("range:"));
  return { dialect, checks, metrics, sql: checksAsOneQuery(compiled), unknownResults: [...byId.keys()].filter((k) => !known.has(k)), ...(ranged ? { spine } : {}) };
}

export function formatCheckReport(r: CheckReport, opts: { withSql: boolean }): string {
  const p: string[] = ["# GASP readiness checks", `**Rules:** ${resolveDocLink("cel.md")} and ${resolveDocLink("atl.md")}`, `**Dialect:** ${r.dialect}`];
  const runnable = r.checks.filter((c) => c.status !== "cannot run");
  const ran = runnable.filter((c) => c.status !== "not run");
  p.push(`**Checks:** ${runnable.length} runnable over this mapping, ${r.checks.length - runnable.length} need fields the mapping lacks${ran.length ? `; ${ran.filter((c) => c.status === "pass").length} pass, ${ran.filter((c) => c.status === "fail").length} fail` : "; no results yet"}.`);
  if (r.unknownResults.length) p.push(`**Results for unknown checks ignored:** ${r.unknownResults.join(", ")}`);
  p.push("", "## Checks", "", "| Check | Status | Violations | Rule | Protects | Effort |", "| --- | --- | --- | --- | --- | --- |");
  for (const c of r.checks) p.push(`| \`${c.id}\` | ${c.status}${c.status === "cannot run" ? ` (needs ${c.missing.join(", ")})` : ""} | ${c.violations ?? ""} | ${c.rule} | ${c.protects.length} metric${c.protects.length === 1 ? "" : "s"} | ${c.effort} |`);
  if (ran.length) {
    p.push("", "## Metrics", "");
    const failing = r.metrics.filter((m) => m.status === "fail");
    const passing = r.metrics.filter((m) => m.status === "pass");
    p.push(`${passing.length} pass every check that protects them, ${failing.length} have a failing check, ${r.metrics.length - passing.length - failing.length} wait on a check not yet run.`);
    if (failing.length) {
      p.push("", "| Metric | Department | Failing checks |", "| --- | --- | --- |");
      for (const m of failing) p.push(`| ${m.metric} | ${m.department} | ${m.failing.map((f) => `\`${f}\``).join(", ")} |`);
    }
  }
  if (opts.withSql) {
    p.push("", "## Run this", "", `One statement, one row per check.${r.spine ? ` The range checks read the period spine \`${r.spine}\` (period_start, period_end, one row per reporting period), the table compile_model reads; pass \`spine\` to name another.` : ""} Paste the rows back as \`results\` (JSON or CSV with check_id and violations) to get pass or fail per check and per metric, then plan_fixes for the ranked list.`, "", "```sql\n" + r.sql + "\n```");
  }
  return p.join("\n");
}

export interface GenerateChecksOptions {
  dialect?: string;
  window?: number;
  asOf?: string;
  /** The period table the range checks read (default gasp.period_spine). */
  spine?: string;
  results?: string;
  output?: "report" | "sql" | "json";
}

/** The generate_checks tool. */
export function generateChecksFromText(documentText: string | undefined, modelText: string | undefined, data: StandardData, opts: GenerateChecksOptions = {}): string {
  if (!documentText?.trim()) return "Pass adapter: your mapping as text, a GASP adapter (JSON) or an Ossie mapping document (YAML or JSON) with its semantic_model. Check it with validate_mapping first.";
  if (opts.asOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(opts.asOf)) return `as_of must be a date as YYYY-MM-DD, got ${JSON.stringify(opts.asOf)}.`;
  if (opts.window !== undefined && (!Number.isInteger(opts.window) || opts.window < 0)) return `window must be a whole number of days, got ${JSON.stringify(opts.window)}.`;
  const loaded = loadAdapter(documentText, modelText, data);
  if (!loaded.adapter) return loaded.error!;
  const chosen = chooseDialect(opts.dialect, loaded.adapter.warehouse);
  if ("error" in chosen) return chosen.error;
  let results: CheckResult[] | undefined;
  if (opts.results !== undefined) {
    const parsed = parseResults(opts.results);
    if (parsed.error) return parsed.error;
    results = parsed.results;
  }
  const compiled = compileChecks(loaded.adapter, data, chosen.dialect, { window: opts.window, asOf: opts.asOf, spine: opts.spine });
  const report = checkReport(compiled, chosen.note, results, opts.spine?.trim() || PERIOD_SPINE);
  if (opts.output === "sql") return report.sql;
  if (opts.output === "json") return JSON.stringify(report, null, 2);
  return formatCheckReport(report, { withSql: !results });
}

// ── plan_fixes ───────────────────────────────────────────────────────────────

export interface Fix {
  kind: "map" | "check";
  /** The field@dataset pair to map, or the check id to clear. */
  what: string;
  effort: Effort;
  /** Metrics this fix brings to covered and passing, Core first. */
  unlocks: Array<{ metric: string; department: string }>;
  core: number;
  /** Metrics the fix helps but which still wait on something else. */
  alsoHelps: number;
  why: string;
}

const EFFORT_RANK: Record<Effort, number> = { small: 0, medium: 1, large: 2 };

/**
 * Every fix the mapping and the results call for, ranked: Core metrics unlocked, then all metrics
 * unlocked, then metrics helped, then effort (smaller first), then name. A fix unlocks a metric
 * when it is the only thing between that metric and covered-and-passing.
 */
export function planFixes(adapter: Adapter, data: StandardData, dialect: DialectName, results: CheckResult[] | undefined, opts: CheckOptions = {}): Fix[] {
  const coverage = checkAdapter(adapter, data);
  const compiled = compileChecks(adapter, data, dialect, opts);
  const byId = new Map((results ?? []).map((r) => [r.check_id, r.violations]));
  const failing = compiled.filter((c) => c.sql && (byId.get(c.check.id) ?? 0) > 0);
  const missingOf = new Map<string, string[]>(coverage.partial.map((p) => [p.metric, p.missing] as const));
  const failingOf = new Map<string, string[]>();
  for (const c of failing) for (const dr of c.protects) failingOf.set(dr.metric, [...(failingOf.get(dr.metric) ?? []), c.check.id]);
  const dept = new Map(data.dataRequirements.map((dr) => [dr.metric, dr.department]));
  const blockers = (metric: string) => (missingOf.get(metric)?.length ?? 0) + (failingOf.get(metric)?.length ?? 0);

  const fixes = new Map<string, Fix>();
  const add = (kind: Fix["kind"], what: string, effort: Effort, why: string, metric: string) => {
    const f = fixes.get(what) ?? fixes.set(what, { kind, what, effort, unlocks: [], core: 0, alsoHelps: 0, why }).get(what)!;
    if (blockers(metric) === 1) {
      f.unlocks.push({ metric, department: dept.get(metric) ?? "" });
      if (dept.get(metric) === "Core") f.core++;
    } else f.alsoHelps++;
  };
  for (const [metric, missing] of missingOf) for (const pair of missing) add("map", pair, "small", "map the column that holds this field", metric);
  for (const c of failing) {
    const n = byId.get(c.check.id)!;
    for (const dr of c.protects) add("check", c.check.id, c.check.effort, `clear ${n} violation${n === 1 ? "" : "s"}: ${c.check.rule}`, dr.metric);
  }
  for (const f of fixes.values()) f.unlocks.sort((a, b) => (a.department === "Core" ? 0 : 1) - (b.department === "Core" ? 0 : 1) || a.metric.localeCompare(b.metric));
  return [...fixes.values()].sort((a, b) => b.core - a.core || b.unlocks.length - a.unlocks.length || b.alsoHelps - a.alsoHelps || EFFORT_RANK[a.effort] - EFFORT_RANK[b.effort] || a.what.localeCompare(b.what));
}

export function formatFixPlan(fixes: Fix[], haveResults: boolean, limit: number): string {
  const p: string[] = ["# GASP fix plan", "**Ranked by:** Core metrics unlocked, then all metrics unlocked, then effort (smaller first). A fix unlocks a metric when it is the last thing between that metric and covered-and-passing."];
  if (!haveResults) p.push("**No check results given**, so the plan covers mapping gaps only. Run the SQL from generate_checks and pass its rows as results to rank data fixes beside them.");
  if (!fixes.length) return [...p, "", "Nothing to fix: every metric the mapping can cover is covered and every runnable check passes."].join("\n");
  const shown = fixes.slice(0, limit);
  p.push(`**Fixes:** ${fixes.length}${fixes.length > shown.length ? `, the first ${shown.length} shown` : ""}: ${fixes.filter((f) => f.kind === "map").length} field${fixes.filter((f) => f.kind === "map").length === 1 ? "" : "s"} to map, ${fixes.filter((f) => f.kind === "check").length} check${fixes.filter((f) => f.kind === "check").length === 1 ? "" : "s"} to clear.`, "", "| # | Fix | Effort | Unlocks (Core) | Also helps | Metrics unlocked |", "| --- | --- | --- | --- | --- | --- |");
  shown.forEach((f, i) => {
    const names = f.unlocks.slice(0, 6).map((u) => u.metric).join(", ") + (f.unlocks.length > 6 ? ` and ${f.unlocks.length - 6} more` : "");
    p.push(`| ${i + 1} | ${f.kind === "map" ? `map \`${f.what}\`` : `clear \`${f.what}\``}: ${f.why} | ${f.effort} | ${f.unlocks.length} (${f.core}) | ${f.alsoHelps} | ${names} |`);
  });
  return p.join("\n");
}

export interface PlanFixesOptions extends GenerateChecksOptions {
  limit?: number;
}

/** The plan_fixes tool. */
export function planFixesFromText(documentText: string | undefined, modelText: string | undefined, data: StandardData, opts: PlanFixesOptions = {}): string {
  if (!documentText?.trim()) return "Pass adapter: your mapping as text, a GASP adapter (JSON) or an Ossie mapping document (YAML or JSON) with its semantic_model.";
  const loaded = loadAdapter(documentText, modelText, data);
  if (!loaded.adapter) return loaded.error!;
  const chosen = chooseDialect(opts.dialect, loaded.adapter.warehouse);
  if ("error" in chosen) return chosen.error;
  let results: CheckResult[] | undefined;
  if (opts.results !== undefined) {
    const parsed = parseResults(opts.results);
    if (parsed.error) return parsed.error;
    results = parsed.results;
  }
  const fixes = planFixes(loaded.adapter, data, chosen.dialect, results, { window: opts.window, asOf: opts.asOf, spine: opts.spine });
  if (opts.output === "json") return JSON.stringify(fixes, null, 2);
  return formatFixPlan(fixes, results !== undefined, opts.limit ?? 25);
}

/** A check's SQL over the GASP field names, for documentation. */
export const referenceCheckSql = (check: ReadinessCheck, dialect: DialectName = "postgres"): string => exampleSql(check.sql(dialect));
