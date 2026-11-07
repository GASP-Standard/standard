/**
 * The compile targets (src/targets/): the dialect emitter writes every direct
 * metric in each warehouse dialect, equal in value to the OSSIE_SQL_2026
 * expression on the fixture and free of each dialect's forbidden tokens; the
 * Snowflake writer turns the Acme adapter into a Cortex Analyst model whose
 * expressions run on Snowflake and whose staged views are the compiled
 * Snowflake sources; the Cube writer turns the fixture adapter into cubes whose
 * measures and staged queries give the canonical values on PGlite; the
 * compile_target tool answers in each output shape.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parse } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DIALECT, type DialectName } from "../src/dialect.js";
import { loadStandard } from "../src/loader.js";
import type { Adapter } from "../src/tools.js";
import { resolveCompany, type Company } from "../src/ossie/adapt.js";
import { compileModel, type CompiledModel } from "../src/ossie/company.js";
import { directQuery } from "../src/ossie/demo.js";
import { directExpressionFor, emitMetric, type EmitContext } from "../src/ossie/metrics.js";
import { exportModel } from "../src/ossie/model.js";
import { compileTarget, compileTargetFromText, withDatabase, type TargetResult } from "../src/targets/index.js";
import { TOOL_TITLES, createServer } from "../src/server.js";
import { addOssieViews, adapter as fixtureAdapter, fixtureDb, scalar } from "./fixture-db.js";
import { columnName, TABLES } from "./fixture/generate.js";

const data = loadStandard();
const fields = Object.fromEntries(data.ontology!.fields!.map((f) => [f.id, f]));
const gaspDatasets = data.ontology!.datasets!;
const ctx: EmitContext = { fields, datasets: gaspDatasets, formulas: data.formulas! };
const acme = JSON.parse(readFileSync(join(process.cwd(), "test", "fixture", "acme-adapter.json"), "utf-8")) as Adapter;
const reference = exportModel(data);
const refMetric = new Map(reference.model.metrics!.map((m) => [m.name, m.expression.sql!]));
const directKeys = Object.entries(reference.coverage).flatMap(([key, c]) => (c.kind === "direct" ? [{ key, name: c.ossieName }] : []));
const split = (key: string): [string, string | undefined] => { const [id, v] = key.split(":"); return [id, v]; };

const company = (a: Adapter): Company => {
  const c = resolveCompany(JSON.stringify(a), undefined, data);
  if ("error" in c) throw new Error(c.error);
  return c;
};
const target = (c: Company, opts: Parameters<typeof compileTarget>[2]): TargetResult => {
  const r = compileTarget(c, data, opts);
  if ("error" in r) throw new Error(r.error);
  return r;
};
const compiled = (c: Company, dialect: DialectName): CompiledModel => {
  const r = compileModel(c, data, { dialect });
  if ("error" in r) throw new Error(r.error);
  return r;
};

// OSSIE_SQL_2026 to Postgres: the date functions PGlite lacks (as ossie-company.test.ts does).
const toPostgres = (sql: string) => sql
  .replace(/DATEDIFF\(second, ([a-z_.]+), ([a-z_.]+)\)/g, "EXTRACT(EPOCH FROM ($2 - $1))")
  .replace(/DATEDIFF\(day, ([a-z_.]+), ([a-z_.]+)\)/g, "($2 - $1)")
  .replace(/\bMEDIAN\(/g, "PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ");
// `user` is a reserved word in Postgres, so a query cannot qualify columns by that dataset name.
const reserved = (expression: string) => /\buser\./.test(expression);
const close = (a: number | null, b: number | null, key: string) => {
  if (a === null || b === null) expect(a, key).toBe(b);
  else expect(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)), `${key}: ${a} vs ${b}`).toBe(true);
};
const period = { start: "2026-01-01", end: "2026-06-30" };

describe("Dialect emitter", () => {
  it("leaves the OSSIE_SQL_2026 output unchanged when no dialect is set", () => {
    for (const { key, name } of directKeys) {
      const [id, v] = split(key);
      const e = emitMetric(id, ctx, v);
      expect(e.kind, key).toBe("direct");
      if (e.kind === "direct") expect(e.expression, key).toBe(refMetric.get(name));
      expect(emitMetric(id, { ...ctx, dialect: undefined }, v)).toEqual(e);
    }
  });

  it("writes snowflake, bigquery and databricks without FILTER or a forbidden token", () => {
    for (const d of ["snowflake", "bigquery", "databricks"] as const) {
      for (const { key } of directKeys) {
        const [id, v] = split(key);
        const x = directExpressionFor(id, ctx, d, v)!;
        expect(x, `${d} ${key}`).toBeDefined();
        expect(x, `${d} ${key}`).not.toContain("FILTER (WHERE");
        for (const token of DIALECT[d].forbidden) expect(x, `${d} ${key}`).not.toContain(token);
      }
    }
    expect(directExpressionFor("nrr", ctx, "snowflake")).toBeUndefined(); // staged
  });

  describe("postgres expressions equal the OSSIE_SQL_2026 ones on the fixture", () => {
    let db: PGlite;
    beforeAll(async () => { db = await fixtureDb(); await addOssieViews(db); }, 120_000);
    afterAll(async () => { await db?.close(); });

    it("every direct entry of the reference model", async () => {
      const failures: string[] = [];
      let n = 0;
      for (const { key, name } of directKeys) {
        const ossie = refMetric.get(name)!;
        if (reserved(ossie)) continue;
        const [id, v] = split(key);
        const pg = directExpressionFor(id, ctx, "postgres", v)!;
        expect(pg, key).not.toContain("FILTER (WHERE");
        try {
          const want = await scalar(db, `SELECT ${toPostgres(directQuery(ossie, gaspDatasets, fields, period))}`);
          const got = await scalar(db, `SELECT ${directQuery(pg, gaspDatasets, fields, period)}`);
          close(got, want, key);
          n++;
        } catch (e) {
          failures.push(`${key}: ${(e as Error).message.split("\n")[0]}`);
        }
      }
      expect(failures).toEqual([]);
      expect(n).toBeGreaterThan(150);
    }, 300_000);
  });
});

describe("Snowflake target: the Acme adapter", () => {
  const c = company(acme);
  const r = target(c, { target: "snowflake", database: "ACME_DW" });
  const doc = parse(r.files["semantic_model.yaml"]);
  const model = compiled(c, "snowflake");
  type Table = { name: string; base_table: Record<string, string>; primary_key?: { columns: string[] }; time_dimensions?: Array<{ name: string; expr: string }>; dimensions?: Array<{ name: string; expr: string }>; facts?: Array<{ name: string; expr: string }> };
  const tables = doc.tables as Table[];
  const metrics = doc.metrics as Array<{ name: string; expr: string }>;

  it("writes every table with a three-part base table and its primary key", () => {
    expect(tables.map((t) => t.name).sort()).toEqual(model.model.datasets.map((d) => d.name).sort());
    for (const t of tables) {
      expect(Object.keys(t.base_table).sort(), t.name).toEqual(["database", "schema", "table"]);
      expect(t.base_table.database, t.name).toBe("ACME_DW");
      const d = model.model.datasets.find((x) => x.name === t.name)!;
      if (d.primary_key?.length) expect(t.primary_key?.columns, t.name).toEqual(d.primary_key);
    }
    expect(tables.find((t) => t.name === "subscription")!.base_table).toEqual({ database: "ACME_DW", schema: "BILLING", table: "SUBSCRIPTIONS" });
    expect(JSON.stringify(tables)).not.toMatch(/"definition"/);
  });

  it("writes every direct and staged metric in Snowflake SQL", () => {
    const want = Object.values(model.coverage).flatMap((x) => (x.kind === "direct" || x.kind === "staged" ? [x.ossieName] : []));
    expect(metrics.map((m) => m.name).sort()).toEqual(want.sort());
    expect(r.counts.direct + r.counts.staged).toBe(want.length);
    for (const m of metrics) {
      expect(m.expr, m.name).not.toContain("FILTER (WHERE");
      for (const token of DIALECT.snowflake.forbidden) expect(m.expr, m.name).not.toContain(token);
    }
    expect(metrics.find((m) => m.name === "gasp_mrr")!.expr).toBe("COALESCE(SUM(CASE WHEN subscription.subscription_status = 'active' THEN subscription.mrr END), 0)");
    expect(metrics.find((m) => m.name === "gasp_nrr")!.expr).toBe("SUM(gasp_staged_gasp_nrr.value)");
    expect(tables.find((t) => t.name === "gasp_staged_gasp_nrr")!.base_table).toEqual({ database: "ACME_DW", schema: "BILLING", table: "GASP_STAGED_GASP_NRR" });
  });

  it("carries Acme's recode and cents division as field expressions", () => {
    const all = (t: Table) => [...(t.time_dimensions ?? []), ...(t.dimensions ?? []), ...(t.facts ?? [])];
    const sub = all(tables.find((t) => t.name === "subscription")!);
    expect(sub.find((f) => f.name === "mrr")!.expr).toBe("mrr_cents / 100");
    const ev = all(tables.find((t) => t.name === "revenue_event")!);
    expect(ev.find((f) => f.name === "event_type")!.expr).toMatch(/^CASE WHEN movement_type = 'upgrade' THEN 'expansion'/);
    expect(tables.find((t) => t.name === "subscription")!.time_dimensions!.map((f) => f.name)).toContain("snapshot_date");
  });

  it("writes one view per staged dataset, each the compiled Snowflake source", () => {
    const sql = r.files["staged_views.sql"];
    const views = new Map([...sql.matchAll(/CREATE OR REPLACE VIEW ([\w.]+) AS\n([\s\S]*?);\n(?=\n|$)/g)].map((m) => [m[1], m[2]]));
    const staged = model.model.datasets.filter((d) => d.name.startsWith("gasp_staged_"));
    expect(views.size).toBe(staged.length);
    for (const d of staged) expect(views.get(`ACME_DW.BILLING.${d.name.toUpperCase()}`), d.name).toBe(d.source.replace(/\bbilling\./g, "ACME_DW.billing.").replace(/gasp\.period_spine/g, "ACME_DW.GASP.PERIOD_SPINE"));
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS ACME_DW.GASP.PERIOD_SPINE (period_start DATE, period_end DATE);");
    expect(r.notes.join(" ")).toMatch(/Cortex Analyst/);
    expect(r.notes.join(" ")).toMatch(/Run staged_views\.sql first/);
  });

  it("reads three-part tables in every view body when a database is given, compiled that way", () => {
    const sql = r.files["staged_views.sql"];
    const froms = [...sql.matchAll(/\bFROM\s+([A-Za-z_][\w$.]*)/g)].map((m) => m[1]);
    expect(froms.length).toBeGreaterThan(0);
    for (const t of froms) expect(t.split("."), t).toHaveLength(3);
    expect(sql).toContain("FROM ACME_DW.billing.subscriptions");
    expect(sql).toContain("FROM ACME_DW.GASP.PERIOD_SPINE p");
    const q = withDatabase(c, "ACME_DW");
    const three = compileModel(q.company, data, { dialect: "snowflake", spine: q.spine });
    if ("error" in three) throw new Error(three.error);
    const views = new Map([...sql.matchAll(/CREATE OR REPLACE VIEW ([\w.]+) AS\n([\s\S]*?);\n(?=\n|$)/g)].map((m) => [m[1], m[2]]));
    const staged = three.model.datasets.filter((d) => d.name.startsWith("gasp_staged_"));
    expect(views.size).toBe(staged.length);
    for (const d of staged) expect(views.get(`ACME_DW.BILLING.${d.name.toUpperCase()}`), d.name).toBe(d.source);
    // A given spine keeps three parts as written and gains the database at two.
    expect(withDatabase(c, "ACME_DW", "OTHER.analytics.periods").spine).toBe("OTHER.analytics.periods");
    expect(withDatabase(c, "ACME_DW", "analytics.periods").spine).toBe("ACME_DW.analytics.periods");
  });

  it("joins the mapped datasets as GASP declares them", () => {
    const rels = doc.relationships as Array<{ left_table: string; right_table: string; relationship_columns: Array<{ left_column: string; right_column: string }>; join_type: string; relationship_type: string }>;
    const rc = rels.find((x) => x.left_table === "revenue_event" && x.right_table === "customer")!;
    expect(rc.relationship_columns).toEqual([{ left_column: "customer_id", right_column: "customer_id" }, { left_column: "event_date", right_column: "snapshot_date" }]);
    expect(rc).toMatchObject({ join_type: "left_outer", relationship_type: "many_to_one" });
  });

  it("asks for a database when a source has two parts and none is given", () => {
    const bare = target(c, { target: "snowflake" });
    expect(bare.notes.join(" ")).toMatch(/pass database/);
    expect(compileTarget(c, data, { target: "snowflake", dialect: "bigquery" })).toHaveProperty("error");
  });
});

describe("Cube target: the fixture adapter on PGlite", () => {
  const c = company(fixtureAdapter as Adapter);
  const r = target(c, { target: "cube" });
  const model = compiled(c, "postgres");
  const cubes = new Map(Object.entries(r.files).filter(([p]) => p.startsWith("model/cubes/")).map(([, s]) => {
    const cube = parse(s).cubes[0];
    return [cube.name as string, cube];
  }));
  const viewFiles = Object.entries(r.files).filter(([p]) => p.startsWith("model/views/"));

  it("writes one cube per table and one view", () => {
    expect([...cubes.keys()].sort()).toEqual(model.model.datasets.map((d) => d.name).sort());
    expect(viewFiles).toHaveLength(1);
    expect(cubes.get("subscription").sql_table).toBe("gasp_subscriptions");
    const nrr = cubes.get("gasp_staged_gasp_nrr");
    expect(nrr.measures).toEqual([expect.objectContaining({ name: "gasp_nrr", sql: "{CUBE}.value", type: "sum" })]);
    expect(cubes.get("subscription").measures.find((m: { name: string }) => m.name === "gasp_mrr").sql).toBe("COALESCE(SUM(CASE WHEN {CUBE}.status = 'active' THEN {CUBE}.mrr END), 0)");
  });

  it("lists every cube reachable from the base along the joins, each with its path", () => {
    const view = parse(viewFiles[0][1]).views[0];
    const joins = (name: string): string[] => (cubes.get(name)?.joins ?? []).map((j: { name: string }) => j.name);
    const reach = new Set<string>();
    const walk = (n: string) => { if (reach.has(n)) return; reach.add(n); joins(n).forEach(walk); };
    walk("revenue_event");
    const entries = view.cubes as Array<{ join_path: string; prefix?: boolean }>;
    expect(new Set(entries.map((e) => e.join_path.split(".").pop()))).toEqual(reach);
    for (const e of entries) {
      const path = e.join_path.split(".");
      expect(path[0]).toBe("revenue_event");
      for (let i = 1; i < path.length; i++) expect(joins(path[i - 1]), e.join_path).toContain(path[i]);
      expect(e.prefix === true, e.join_path).toBe(path.length > 1);
    }
  });

  describe("values on the fixture rows, first half of 2026", () => {
    let db: PGlite;
    beforeAll(async () => {
      db = await fixtureDb();
      await addOssieViews(db);
      await db.exec(`CREATE TABLE gasp.period_spine (period_start DATE, period_end DATE); INSERT INTO gasp.period_spine VALUES ('${period.start}', '${period.end}')`);
    }, 120_000);
    afterAll(async () => { await db?.close(); });
    const physical = { table: (ds: string) => TABLES[ds], date: (ds: string) => columnName(ds, gaspDatasets[ds].date) };

    it("every direct measure gives the canonical value", async () => {
      const failures: string[] = [];
      const checked: string[] = [];
      for (const [home, cube] of cubes) {
        for (const m of (cube.measures ?? []) as Array<{ name: string; sql: string; type: string }>) {
          if (m.type !== "number") continue;
          const ossie = refMetric.get(m.name)!;
          if (reserved(ossie) || home === "user") continue;
          // {CUBE}.col is the home table's column; {other.col} the other table's, aliased by its dataset name.
          const sql = m.sql.replace(/\{CUBE\}\./g, `${home}.`).replace(/\{CUBE\.(\w+)\}/g, `${home}.$1`).replace(/\{(\w+)\.(\w+)\}/g, "$1.$2");
          try {
            const want = await scalar(db, `SELECT ${toPostgres(directQuery(ossie, gaspDatasets, fields, period))}`);
            const got = await scalar(db, `SELECT ${directQuery(sql, gaspDatasets, fields, period, physical)}`);
            close(got, want, m.name);
            checked.push(m.name);
          } catch (e) {
            failures.push(`${m.name}: ${(e as Error).message.split("\n")[0]}`);
          }
        }
      }
      expect(failures).toEqual([]);
      for (const name of ["gasp_mrr", "gasp_arr", "gasp_gross_margin", "gasp_new_mrr", "gasp_churned_mrr"]) expect(checked).toContain(name);
      expect(checked.length).toBeGreaterThan(150);
    }, 300_000);

    it("every staged cube's query runs and returns the staged source's rows", async () => {
      const rows = async (source: string) => (await db.query<Record<string, unknown>>(`SELECT * FROM (${source}) s`)).rows
        .map((row) => JSON.stringify(Object.values(row))).sort();
      const staged = model.model.datasets.filter((d) => d.name.startsWith("gasp_staged_"));
      expect(staged.length).toBeGreaterThan(100);
      for (const d of staged) {
        const cube = cubes.get(d.name);
        expect(cube.sql, d.name).toBe(d.source);
        const got = await rows(cube.sql);
        expect(got.length, d.name).toBeGreaterThan(0);
        expect(got, d.name).toEqual(await rows(d.source));
      }
    }, 300_000);
  });
});

describe("compile_target", () => {
  const text = JSON.stringify(acme);

  it("answers in each output shape", () => {
    const full = compileTargetFromText(text, undefined, data, { target: "snowflake", database: "ACME_DW" });
    for (const h of ["# GASP metrics for Snowflake (Cortex Analyst semantic model): Acme SaaS", "**Written:**", "## Notes", "## Left out: unmapped", "## Files", "### semantic_model.yaml", "```yaml", "### staged_views.sql", "```sql"]) expect(full).toContain(h);
    const files = compileTargetFromText(text, undefined, data, { target: "snowflake", database: "ACME_DW", output: "files" });
    expect(files.startsWith("### semantic_model.yaml\n\nname: Acme SaaS semantic model")).toBe(true);
    expect(files).not.toContain("## Notes");
    const report = compileTargetFromText(text, undefined, data, { target: "snowflake", output: "report" });
    expect(report).toContain("**Written:**");
    expect(report).not.toContain("## Files");
    expect(compileTargetFromText(text, undefined, data, { target: "snowflake", metrics: "MRR", output: "report" })).toContain("**Written:** 1 metric (1 direct, 0 staged)");
    expect(compileTargetFromText(text, undefined, data, { target: "dbt" as never })).toMatch(/Unknown target/);
    expect(compileTargetFromText(text, undefined, data, { target: "cube", metrics: "nope" })).toMatch(/not a metric/);
  });

  it("writes Cube for Acme in Snowflake SQL with the two-part source", () => {
    const r = target(company(acme), { target: "cube", database: "ACME_DW" });
    expect(r.model.dialect).toBe("snowflake");
    const sub = parse(r.files["model/cubes/subscription.yml"]).cubes[0];
    expect(sub.sql_table).toBe("billing.subscriptions");
    expect(sub.measures.find((m: { name: string }) => m.name === "gasp_mrr").sql).toBe("COALESCE(SUM(CASE WHEN {CUBE}.subscription_status = 'active' THEN {CUBE.mrr} END), 0)");
    expect(sub.dimensions.find((d: { name: string }) => d.name === "mrr").sql).toBe("mrr_cents / 100");
    expect(r.notes.join(" ")).toMatch(/database ACME_DW is not needed/);
    for (const [p, s] of Object.entries(r.files)) {
      expect(s, p).not.toContain("FILTER (WHERE");
      for (const token of DIALECT.snowflake.forbidden) expect(s, p).not.toContain(token);
    }
  });

  it("is listed by the server with its title and read-only annotations", async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverSide);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
    const { tools } = await client.listTools();
    const t = tools.find((x) => x.name === "compile_target")!;
    expect(t.title).toBe(TOOL_TITLES.compile_target);
    expect(t.annotations).toMatchObject({ title: TOOL_TITLES.compile_target, readOnlyHint: true, destructiveHint: false });
    const res = await client.callTool({ name: "compile_target", arguments: { adapter: JSON.stringify(acme), target: "cube", metrics: "MRR", output: "files" } });
    expect((res.content as Array<{ text: string }>)[0].text).toContain("### model/cubes/subscription.yml");
    await client.close();
  });
});
