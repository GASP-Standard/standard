/**
 * Schema profiling (src/ossie/profile.ts): the synthetic dataset's own
 * information_schema, profiled from names alone, gives every table the key,
 * time field and kind the ontology declares except where the names cannot
 * tell (listed, each a question); with statistics the rest resolve; the Acme
 * DDL fixture reads its declared keys and references, asks about what it
 * cannot settle and gives a model that passes the bundled schema and the
 * upstream validator; every input shape parses; the tool answers in prose.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadStandard } from "../src/loader.js";
import { ossieSchemaErrors } from "../src/ossie/adapt.js";
import { ossieYaml } from "../src/ossie/index.js";
import { formatProfileReport, ossieTypeOf, parseCsv, parseSchema, parseStatistics, profileSchema, profileSchemaFromText, sameWord, statisticsSql, valuesSql, type ColumnStats, type ParsedSchema, type ProfileResult } from "../src/ossie/profile.js";
import { uvAvailable, validateUpstream } from "../src/ossie/validate.js";
import { TABLES, columnName } from "../src/synthetic.js";
import { fixtureDb } from "./fixture-db.js";
import { acmeDdl, informationSchema, parsedSchema } from "./ossie-helpers.js";

const data = loadStandard();

let db: PGlite;
let schema: ParsedSchema;
let stats: ColumnStats[];
beforeAll(async () => {
  db = await fixtureDb();
  schema = parsedSchema(await informationSchema(db));
  // The statistics as an agent would gather them: the tool's query, then the values of every short text column it names.
  const rows = (await db.query<Record<string, unknown>>(statisticsSql(schema.columns).replace(/;$/, ""))).rows;
  for (const r of rows) {
    const c = schema.columns.find((x) => x.table === r.table_name && x.column === r.column_name)!;
    if (Number(r.distinct_count) <= 20 && ossieTypeOf(c.type) === "String") {
      const v = await db.query<Record<string, unknown>>(valuesSql(c.table, c.column).replace(/;$/, ""));
      r.values = v.rows.map((x) => x.value).filter((x) => x !== null);
    }
  }
  const parsedStats = parseStatistics(JSON.stringify(rows));
  if ("error" in parsedStats) throw new Error(parsedStats.error);
  stats = parsedStats.stats;
}, 300_000);
afterAll(async () => { await db?.close(); });

/** The ontology's key, time and kind per fixture table. The row key of a snapshot or per-period table is the entity key with its date. */
const expected = () => Object.entries(data.ontology!.datasets!).filter(([ds]) => TABLES[ds]).map(([ds, m]) => ({
  ds,
  table: TABLES[ds],
  kind: m.kind,
  time: columnName(ds, m.date),
  key: [columnName(ds, m.key), ...(m.kind !== "event" && m.key !== m.date ? [columnName(ds, m.date)] : [])],
}));

describe("Profile: the synthetic dataset from names alone", () => {
  let r: ProfileResult;
  beforeAll(() => { r = profileSchema(schema, [], data, { organization: "Fixture" }); });

  it("reads every table and column of the fixture", () => {
    expect(r.format).toBe("columns-json");
    expect(r.datasets.length).toBe(Object.keys(TABLES).length);
    expect(r.statistics).toEqual({ given: 0, columns: schema.columns.length });
    expect(r.problems).toEqual([]);
    expect(ossieSchemaErrors(r.model, "model", data)).toEqual([]);
  });

  it("gives every table the ontology's time field, except the one whose row is a span", () => {
    const off = expected().filter((e) => r.datasets.find((d) => d.source === e.table)!.time?.value !== e.time).map((e) => e.table);
    expect(off).toEqual(["gasp_trials"]); // trial_start_date or trial_end_date: GASP counts a trial when it ends, which the names cannot say
    expect(r.questions.find((q) => q.dataset === "gasp_trials" && q.about === "time")!.options).toEqual(["trial_start_date", "trial_end_date"]);
  });

  it("gives every table the ontology's kind, except the span table", () => {
    const off = expected().filter((e) => r.datasets.find((d) => d.source === e.table)!.kind.value !== e.kind).map((e) => `${e.table}: ${r.datasets.find((d) => d.source === e.table)!.kind.value}`);
    expect(off).toEqual(["gasp_trials: event"]);
  });

  it("names the key of every table whose columns name it, with the date for a snapshot or per-period row, and asks about the rest", () => {
    const off = expected().filter((e) => (r.datasets.find((d) => d.source === e.table)!.key?.value.join(",") ?? "?") !== e.key.join(",")).map((e) => e.table);
    // Two foreign keys and no own id (revenue_schedule), or no id column at all on a per-period table: a question each.
    expect(off).toEqual(["gasp_trials", "gasp_revenue_schedule", "gasp_usage_records", "gasp_financials", "gasp_web_traffic", "gasp_brand_mentions"]);
    expect(r.datasets.find((d) => d.source === "gasp_trials")!.key).toMatchObject({ value: ["trial_id"], confidence: "medium" });
    for (const t of off.slice(1)) expect(r.questions.some((q) => q.dataset === t && q.about === "key"), t).toBe(true);
    expect(r.questions.map((q) => `${q.dataset}:${q.about}`).sort()).toEqual(["gasp_brand_mentions:key", "gasp_financials:key", "gasp_revenue_schedule:key", "gasp_trials:time", "gasp_usage_records:key", "gasp_web_traffic:key"]);
    // period_start beside period_end bounds the period the row describes: the row is dated its start, no question asked.
    expect(r.datasets.find((d) => d.source === "gasp_usage_records")!.time).toEqual({ value: "period_start", confidence: "high", evidence: "the period start of a per-period row; period_end is the end of the same period" });
    expect(r.datasets.find((d) => d.source === "gasp_usage_records")!.kind).toMatchObject({ value: "fact" });
  });

  it("explains each inference", () => {
    const subs = r.datasets.find((d) => d.source === "gasp_subscriptions")!;
    expect(subs.key).toEqual({ value: ["subscription_id", "snapshot_day"], confidence: "medium", evidence: "named after the table (subscription_id); with snapshot_day, since a snapshot repeats each entity per date" });
    expect(subs.time).toMatchObject({ value: "snapshot_day", confidence: "high" });
    expect(subs.kind).toMatchObject({ value: "snapshot", confidence: "high" });
    const events = r.datasets.find((d) => d.source === "gasp_revenue_events")!;
    expect(events.time).toMatchObject({ value: "booked_on", evidence: "the only date column" });
    expect(events.kind.evidence).toContain("one row per occurrence");
  });

  it("infers relationships from columns named after other tables' keys", () => {
    const rel = (from: string, column: string) => r.relationships.find((x) => x.from === from && x.column === column);
    expect(rel("gasp_subscriptions", "customer_id")).toMatchObject({ to: "gasp_customers", confidence: "medium" });
    expect(rel("gasp_subscriptions", "plan_id")).toMatchObject({ to: "gasp_plans" });
    expect(rel("gasp_time_entries", "consultant_id")).toMatchObject({ to: "gasp_consultant_capacity" });
    expect(rel("gasp_revenue_events", "subscription_id")).toMatchObject({ to: "gasp_subscriptions" });
    const model = r.model.relationships!.find((x) => x.from === "gasp_subscriptions" && x.from_columns[0] === "customer_id")!;
    expect(model.to_columns).toEqual(["customer_id"]);
  });
});

describe("Profile: the synthetic dataset with statistics", () => {
  let r: ProfileResult;
  beforeAll(() => { r = profileSchema(schema, stats, data, { organization: "Fixture" }); });

  it("confirms every key the names gave and settles the per-period tables", () => {
    expect(r.statistics.given).toBe(schema.columns.length);
    const byTable = (t: string) => r.datasets.find((d) => d.source === t)!;
    for (const e of expected()) {
      const d = byTable(e.table);
      if (["gasp_trials", "gasp_revenue_schedule", "gasp_usage_records", "gasp_financials", "gasp_onboarding_milestones", "gasp_onboarding_sessions"].includes(e.table)) continue;
      expect(d.key?.value, e.table).toEqual(e.key);
      expect(d.key!.confidence, e.table).toBe("high");
    }
    expect(byTable("gasp_financials").key).toMatchObject({ value: ["revenue_type", "period_start"], confidence: "high" }); // the fixture holds one row per revenue type per period
    expect(byTable("gasp_web_traffic").key).toMatchObject({ value: ["traffic_source", "period_start"], confidence: "high" });
    expect(byTable("gasp_balance_sheet").key).toMatchObject({ value: ["snapshot_date"], confidence: "high" });
    // One row per milestone per onboarding: the row key is the pair, where the ontology names the entity key alone.
    expect(byTable("gasp_onboarding_milestones").key).toMatchObject({ value: ["onboarding_id", "milestone_date"], confidence: "high" });
  });

  it("asks when two candidates cover the rows alike", () => {
    const q = r.questions.find((x) => x.dataset === "gasp_revenue_schedule")!;
    expect(q.about).toBe("key");
    expect(q.options).toEqual(["customer_id, period_start", "subscription_id, period_start"]);
    expect(q.why).toContain("cannot tell them apart");
    expect(r.questions.map((x) => x.dataset).sort()).toEqual(["gasp_revenue_schedule", "gasp_trials", "gasp_usage_records"]); // usage records: one row per subscription per month, and one customer per subscription
  });

  it("lists the values of enum columns and leaves identifiers alone", () => {
    const subs = r.datasets.find((d) => d.source === "gasp_subscriptions")!;
    expect(subs.enums.find((e) => e.column === "status")!.values.sort()).toEqual(["active", "cancelled"]);
    expect(subs.enums.map((e) => e.column)).not.toContain("subscription_id");
    expect(subs.enums.map((e) => e.column)).not.toContain("customer_id");
    const field = r.model.datasets.find((d) => d.source === "gasp_subscriptions")!.fields!.find((f) => f.name === "status")!;
    expect((field.ai_context as { instructions: string }).instructions).toMatch(/^One of /);
  });

  it("writes the report with evidence per dataset", () => {
    const report = formatProfileReport(r);
    expect(report).toContain("# Schema profile: Fixture");
    expect(report).toContain(`**Input:** ${Object.keys(TABLES).length} tables, ${schema.columns.length} columns from information_schema rows (JSON); statistics for ${schema.columns.length} columns.`);
    expect(report).toContain("- key: subscription_id, snapshot_day (high confidence: named after the table (subscription_id); ");
    expect(report).toContain("## Questions (3)");
    expect(report).not.toContain("## Statistics");
  });
});

describe("Profile: the Acme DDL", () => {
  let r: ProfileResult;
  beforeAll(() => {
    const s = parseSchema(acmeDdl);
    if ("error" in s) throw new Error(s.error);
    r = profileSchema(s, [], data, { organization: "Acme SaaS" });
  });
  const ds = (name: string) => r.datasets.find((d) => d.name === name)!;

  it("names a question's dataset as the model names the table, also when two schemas share a table name", () => {
    const r = profileSchema(parsedSchema("CREATE TABLE crm.events (account_id VARCHAR, workspace_id VARCHAR, occurred_at TIMESTAMP);\nCREATE TABLE billing.events (account_id VARCHAR, workspace_id VARCHAR, occurred_at TIMESTAMP);"), [], data);
    expect(r.model.datasets.map((d) => d.name)).toEqual(["crm_events", "billing_events"]);
    expect(r.questions.map((q) => q.dataset)).toEqual(["crm_events", "billing_events"]);
  });

  it("reads the tables, the declared keys and the references", () => {
    expect(r.format).toBe("ddl");
    expect(r.datasets.map((d) => `${d.name}=${d.source}`)).toEqual(["subscriptions=billing.subscriptions", "mrr_movements=billing.mrr_movements", "customers=billing.customers", "invoices=billing.invoices", "plan_prices=billing.plan_prices", "usage_daily=analytics.usage_daily"]);
    expect(ds("subscriptions").key).toEqual({ value: ["subscription_id", "snapshot_date"], confidence: "declared", evidence: "declared PRIMARY KEY" });
    expect(ds("mrr_movements").key).toMatchObject({ value: ["event_id"], confidence: "declared" });
    expect(r.relationships.find((x) => x.from === "mrr_movements" && x.column === "customer_id")).toMatchObject({ to: "customers", confidence: "declared" });
    expect(r.relationships.find((x) => x.from === "invoices" && x.column === "customer_id")).toMatchObject({ to: "customers", confidence: "medium" });
  });

  it("infers the rest from names", () => {
    expect(ds("customers")).toMatchObject({ kind: { value: "snapshot" }, key: { value: ["customer_id", "snapshot_date"], confidence: "medium" }, time: { value: "snapshot_date" } });
    expect(ds("mrr_movements")).toMatchObject({ kind: { value: "event" }, time: { value: "event_date", confidence: "high" } });
    expect(ds("plan_prices")).toMatchObject({ kind: { value: "reference", evidence: "no date or timestamp column: a reference table, read as of now" }, key: { value: ["plan_code"] } });
    expect(ds("plan_prices").time).toBeUndefined();
    expect(ds("usage_daily").key).toBeUndefined();
  });

  it("asks about what it cannot settle", () => {
    expect(r.questions.map((q) => `${q.dataset}:${q.about}`)).toEqual(["plan_prices:type", "usage_daily:key"]);
    expect(r.questions[0].question).toContain("price_tiers (VARIANT)");
    expect(r.questions[1].options).toEqual(["account_id", "workspace_id"]);
  });

  it("maps warehouse types to Ossie datatypes", () => {
    const f = (d: string, c: string) => r.model.datasets.find((x) => x.name === d)!.fields!.find((x) => x.name === c)!.datatype;
    expect(f("subscriptions", "mrr_cents")).toBe("Integer"); // NUMBER(18, 0)
    expect(f("subscriptions", "renewal_amount")).toBe("Decimal"); // NUMBER(18, 2)
    expect(f("invoices", "credit_memo_count")).toBe("Integer");
    expect(f("subscriptions", "renewed")).toBe("Boolean");
    expect(f("subscriptions", "updated_at")).toBe("DateTime");
    expect(f("mrr_movements", "loaded_at")).toBe("DateTimeTz");
    expect(f("mrr_movements", "currency")).toBe("String");
    expect(f("plan_prices", "price_tiers")).toBe("Opaque");
    expect(r.model.datasets.find((x) => x.name === "subscriptions")!.fields!.find((x) => x.name === "snapshot_date")!.dimension).toEqual({ is_time: true });
  });

  it("gives a model that passes the bundled schema and carries the profile in the GASP extension", () => {
    expect(ossieSchemaErrors(r.model, "model", data)).toEqual([]);
    expect(r.model.name).toBe("Acme SaaS semantic model");
    const ext = JSON.parse(r.model.datasets.find((x) => x.name === "customers")!.custom_extensions![0].data) as { profile: { kind: string; confidence: Record<string, string> } };
    expect(ext.profile).toMatchObject({ kind: "snapshot", confidence: { kind: "high", key: "medium", time: "high" } });
  });

  const upstream = uvAvailable() ? it : it.skip;
  upstream("passes the upstream validator", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gasp-profile-"));
    try {
      const file = join(dir, "acme_saas.semantic_model.yaml");
      writeFileSync(file, ossieYaml(r.model));
      const v = await validateUpstream(file, "model");
      expect(v.ok, v.output).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("Profile: input shapes", () => {
  it("reads information_schema rows as CSV, a tables list and DDL with quoted names", () => {
    const csv = parseSchema('table_schema,table_name,column_name,data_type,is_nullable\npublic,orders,order_id,integer,NO\npublic,orders,"placed_at",timestamp with time zone,YES\nsales,"reps",rep_id,text,NO\n');
    expect(csv).toMatchObject({ format: "columns-csv", columns: [{ table: "orders", column: "order_id", type: "integer", nullable: false }, { table: "orders", column: "placed_at", type: "timestamp with time zone", nullable: true }, { table: "sales.reps", column: "rep_id", type: "text", nullable: false }] });
    const tables = parseSchema(JSON.stringify({ tables: [{ name: "orders", schema: "shop", columns: [{ name: "order_id", type: "int" }, "note"] }] }));
    expect(tables).toMatchObject({ format: "tables-json", columns: [{ table: "shop.orders", column: "order_id", type: "int" }, { table: "shop.orders", column: "note", type: "unknown" }] });
    const ddl = parseSchema('CREATE TABLE IF NOT EXISTS "Shop"."Orders" ("Order Id" INT PRIMARY KEY, placed_at TIMESTAMP NOT NULL, total NUMERIC(10,2), CONSTRAINT fk FOREIGN KEY (customer_id) REFERENCES shop.customers (id));');
    expect(ddl).toMatchObject({ format: "ddl", keys: [{ table: "Shop.Orders", columns: ["Order Id"] }] });
    expect((ddl as ParsedSchema).columns.map((c) => `${c.column}:${c.type}`)).toEqual(["Order Id:INT", "placed_at:TIMESTAMP", "total:NUMERIC(10,2)"]);
    expect(parseCsv('a,b\n"x, y","q""r"\n')).toEqual([{ a: "x, y", b: 'q"r' }]);
  });

  it("reads statistics as JSON or CSV under either spelling of each column", () => {
    const json = parseStatistics(JSON.stringify([{ table_name: "t", column_name: "c", row_count: 10, null_count: 1, distinct_count: 3, min_value: "a", max_value: "z", values: ["a", "b", "z"] }]));
    expect(json).toMatchObject({ stats: [{ table: "t", column: "c", rows: 10, nulls: 1, distinct: 3, min: "a", max: "z", values: ["a", "b", "z"] }] });
    const csv = parseStatistics("table,column,rows,null_rate,distinct,values\nt,c,10,0.1,3,a|b|z\n");
    expect(csv).toMatchObject({ stats: [{ table: "t", column: "c", rows: 10, nulls: 1, distinct: 3, values: ["a", "b", "z"] }] });
    expect(parseStatistics("[1, 2]")).toMatchObject({ stats: [], problems: [] });
    expect("error" in parseStatistics("{nope")).toBe(true);
  });

  it("writes the statistics query in standard SQL, one row per column, without MIN or MAX on booleans", () => {
    const sql = statisticsSql([{ table: "t", column: "a", type: "text" }, { table: "t", column: "ok", type: "boolean" }]);
    expect(sql).toContain(`SELECT 't' AS table_name, 'a' AS column_name, COUNT(*) AS row_count, COUNT(*) - COUNT(a) AS null_count, COUNT(DISTINCT a) AS distinct_count, CAST(MIN(a) AS VARCHAR) AS min_value, CAST(MAX(a) AS VARCHAR) AS max_value FROM t`);
    expect(sql).toContain(`COUNT(DISTINCT ok) AS distinct_count, CAST(NULL AS VARCHAR) AS min_value, CAST(NULL AS VARCHAR) AS max_value FROM t;`);
    expect(statisticsSql([{ table: "t", column: "a", type: "text" }], "bigquery")).toContain("CAST(MIN(a) AS STRING)"); // BigQuery and Databricks have no VARCHAR cast
    expect(valuesSql("billing.plans", "tier")).toBe("SELECT tier AS value, COUNT(*) AS row_count FROM billing.plans GROUP BY tier ORDER BY row_count DESC;");
  });

  it("matches words across plurals and maps types across warehouses", () => {
    expect(sameWord("license", "licenses")).toBe(true);
    expect(sameWord("entry", "entries")).toBe(true);
    expect(sameWord("status", "statuses")).toBe(true);
    expect(sameWord("customer", "customer_id")).toBe(false);
    expect(["NUMBER(38,0)", "int64", "BIGINT", "serial"].map(ossieTypeOf)).toEqual(["Integer", "Integer", "Integer", "Integer"]);
    expect(["NUMBER(18,2)", "numeric", "DECIMAL(10, 2)", "bignumeric"].map(ossieTypeOf)).toEqual(["Decimal", "Decimal", "Decimal", "Decimal"]);
    expect(["FLOAT64", "double precision", "real"].map(ossieTypeOf)).toEqual(["Float", "Float", "Float"]);
    expect(["TIMESTAMP_NTZ", "datetime", "timestamp without time zone"].map(ossieTypeOf)).toEqual(["DateTime", "DateTime", "DateTime"]);
    expect(["TIMESTAMP_TZ", "timestamptz", "TIMESTAMP_LTZ"].map(ossieTypeOf)).toEqual(["DateTimeTz", "DateTimeTz", "DateTimeTz"]);
    expect(["VARIANT", "ARRAY", "geography"].map(ossieTypeOf)).toEqual(["Opaque", "Opaque", "Opaque"]);
  });

  it("answers the tool's cases in prose", () => {
    expect(profileSchemaFromText(undefined, undefined, data)).toContain("Pass schema");
    expect(profileSchemaFromText("hello world", undefined, data)).toContain("not in a shape the profiler reads");
    expect(profileSchemaFromText("[{\"x\": 1}]", undefined, data)).toContain("no rows with a table and a column");
    expect(profileSchemaFromText(acmeDdl, "{nope", data)).toContain("statistics is not valid JSON");
    const report = profileSchemaFromText(acmeDdl, undefined, data, { organization: "Acme SaaS" });
    expect(report).toContain("# Schema profile: Acme SaaS");
    expect(report).toContain("## Semantic model");
    expect(report).toContain("name: Acme SaaS semantic model");
    const model = profileSchemaFromText(acmeDdl, undefined, data, { output: "model" });
    expect(model).toMatch(/^(#[^\n]*\n)*version: /);
    expect(model).not.toContain("# Schema profile");
    const json = JSON.parse(profileSchemaFromText(acmeDdl, undefined, data, { output: "json" })) as { datasets: unknown[]; model: { datasets: unknown[] } };
    expect(json.datasets.length).toBe(6);
    expect(json.model.datasets.length).toBe(6);
    expect(profileSchemaFromText(acmeDdl, undefined, data, { output: "statistics" })).toContain("FROM billing.subscriptions");
  });
});
