/**
 * The metric compiler into a company's model (src/ossie/company.ts): compiled
 * against the fixture adapter it reproduces the reference export's coverage and
 * every metric's value on the fixture rows, over the fixture's own table and
 * column names; against the Acme adapter it compiles exactly the metrics the
 * mapping covers, in Acme's dialect, idempotently, from either input format,
 * and the result passes the upstream validator.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isMetricStub, loadStandard, metricFormulaId } from "../src/loader.js";
import { checkAdapter, type Adapter } from "../src/tools.js";
import { adapterToOssie, resolveCompany, type Company } from "../src/ossie/adapt.js";
import { compileModel, compileModelFromText, formatCompileReport, selectFormulas, SPINE_DATASET, type CompiledModel } from "../src/ossie/company.js";
import { directQuery } from "../src/ossie/demo.js";
import { ossieYaml } from "../src/ossie/index.js";
import { exportModel } from "../src/ossie/model.js";
import { GASP_VENDOR, OSSIE_DIALECT } from "../src/ossie/types.js";
import { uvAvailable, validateUpstream } from "../src/ossie/validate.js";
import { DIALECT } from "../src/dialect.js";
import { addOssieViews, adapter as fixtureAdapter, fixtureDb, scalar } from "./fixture-db.js";
import { columnName, TABLES } from "./fixture/generate.js";

const data = loadStandard();
const fields = Object.fromEntries(data.ontology!.fields!.map((f) => [f.id, f]));
const gaspDatasets = data.ontology!.datasets!;
const acme = JSON.parse(readFileSync(join(process.cwd(), "..", "gasp-wiki-frontend", "src", "data", "examples", "acme-adapter.json"), "utf-8")) as Adapter;
const reference = exportModel(data);

const company = (a: Adapter): Company => {
  const c = resolveCompany(JSON.stringify(a), undefined, data);
  if ("error" in c) throw new Error(c.error);
  return c;
};
const compiled = (c: Company, opts = {}): CompiledModel => {
  const r = compileModel(c, data, opts);
  if ("error" in r) throw new Error(r.error);
  return r;
};
const ext = (x: { custom_extensions?: Array<{ vendor_name: string; data: string }> }) => JSON.parse(x.custom_extensions!.find((e) => e.vendor_name === GASP_VENDOR)!.data);
const exprOf = (m: { expression: { dialects: Array<{ expression: string }> } }) => m.expression.dialects[0].expression;

describe("Company compile: the fixture adapter reproduces the reference export", () => {
  const r = compiled(company(fixtureAdapter as Adapter));

  it("compiles every entry the reference compiles, the same way, with nothing unmapped", () => {
    expect(r.counts.unmapped).toBe(0);
    expect(Object.keys(r.coverage).sort()).toEqual(Object.keys(reference.coverage).sort());
    for (const [key, c] of Object.entries(reference.coverage)) {
      const mine = r.coverage[key];
      expect(mine.kind, key).toBe(c.kind);
      if (c.kind === "staged" && mine.kind === "staged") expect(mine.reason, key).toBe(c.reason);
    }
    expect(r.model.metrics!.map((m) => m.name)).toEqual(reference.model.metrics!.map((m) => m.name));
    expect(r.problems).toEqual([]);
  });

  it("writes the company's own names: the fixture's columns in direct expressions, its tables in staged sources", () => {
    const mrr = r.model.metrics!.find((m) => m.name === "gasp_mrr")!;
    expect(exprOf(mrr)).toBe("SUM(subscription.mrr) FILTER (WHERE subscription.status = 'active')");
    const nrr = r.model.datasets.find((d) => d.name === "gasp_staged_gasp_nrr")!;
    expect(nrr.source).toContain("FROM gasp_subscriptions WHERE snapshot_day = p.period_start AND status = 'active'");
    expect(nrr.source).toContain("FROM gasp_customers WHERE as_of_date = p.period_start AND lifecycle_status = 'active'");
    expect(nrr.source).toMatch(/FROM gasp\.period_spine p$/);
    expect(ext(nrr)).toMatchObject({ staged: true, for: "gasp_nrr", reason: "cohort", source_dialect: "POSTGRES" });
    expect(ext(nrr).sources).toBeUndefined(); // one dialect, the company's
    // Every dataset the fixture maps is in the model, with the spine declared for the staged sources.
    expect(r.model.datasets.find((d) => d.name === SPINE_DATASET)!.source).toBe("gasp.period_spine");
    expect(ext(r.model).compiled).toMatchObject({ dialect: "POSTGRES", period_spine: "gasp.period_spine", metrics: r.model.metrics!.length, staged: r.counts.staged });
  });

  describe("values match the reference export on the fixture rows, first half of 2026", () => {
    // Physical tables under the fixture's names and gasp.<dataset> views of the same rows under the canonical names,
    // so the company's compiled metrics and the reference model's run side by side on identical data.
    let db: PGlite;
    const period = { start: "2026-01-01", end: "2026-06-30" };
    beforeAll(async () => {
      db = await fixtureDb();
      await addOssieViews(db);
      await db.exec(`CREATE TABLE gasp.period_spine (period_start DATE, period_end DATE); INSERT INTO gasp.period_spine VALUES ('${period.start}', '${period.end}')`);
    }, 120_000);
    afterAll(async () => { await db?.close(); });

    // OSSIE_SQL_2026 to Postgres: the date functions PGlite lacks (the model test does the same).
    const toPostgres = (sql: string) => sql
      .replace(/DATEDIFF\(second, ([a-z_.]+), ([a-z_.]+)\)/g, "EXTRACT(EPOCH FROM ($2 - $1))")
      .replace(/DATEDIFF\(day, ([a-z_.]+), ([a-z_.]+)\)/g, "($2 - $1)")
      .replace(/\bMEDIAN\(/g, "PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ");
    const physical = { table: (ds: string) => TABLES[ds], date: (ds: string) => columnName(ds, gaspDatasets[ds].date) };
    const refMetric = new Map(reference.model.metrics!.map((m) => [m.name, m]));
    const refDataset = new Map(reference.model.datasets.map((d) => [d.name, d]));
    const mine = new Map(r.model.metrics!.map((m) => [m.name, m]));
    const mineDataset = new Map(r.model.datasets.map((d) => [d.name, d]));
    const close = (a: number | null, b: number | null, key: string) => {
      if (a === null || b === null) expect(a, key).toBe(b);
      else expect(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)), `${key}: ${a} vs ${b}`).toBe(true);
    };

    it("every direct metric", async () => {
      const keys = Object.entries(r.coverage).filter(([, c]) => c.kind === "direct");
      expect(keys.length).toBeGreaterThan(150);
      const failures: string[] = [];
      // `user` is a reserved word in Postgres, so a query cannot qualify columns by that dataset name; the reference demo has the same limit.
      const reserved = (expression: string) => /\buser\./.test(expression);
      for (const [key, c] of keys) {
        if (c.kind !== "direct" || reserved(exprOf(refMetric.get(c.ossieName)!))) continue;
        try {
          const theirs = await scalar(db, `SELECT ${toPostgres(directQuery(exprOf(refMetric.get(c.ossieName)!), gaspDatasets, fields, period))}`);
          const ours = await scalar(db, `SELECT ${toPostgres(directQuery(exprOf(mine.get(c.ossieName)!), gaspDatasets, fields, period, physical))}`);
          close(ours, theirs, key);
        } catch (e) {
          failures.push(`${key}: ${(e as Error).message.split("\n")[0]}`);
        }
      }
      expect(failures).toEqual([]);
    }, 300_000);

    it("every staged metric, row for row", async () => {
      const keys = Object.entries(r.coverage).filter(([, c]) => c.kind === "staged");
      expect(keys.length).toBeGreaterThan(100);
      const rows = async (source: string) => (await db.query<Record<string, unknown>>(`SELECT * FROM (${source}) s`)).rows
        .map((row) => Object.values(row).map((v) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v)))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      for (const [key, c] of keys) {
        if (c.kind !== "staged") continue;
        const theirs = await rows(refDataset.get(c.stagedDataset)!.source);
        const ours = await rows(mineDataset.get(c.stagedDataset)!.source);
        expect(ours.length, key).toBe(theirs.length);
        for (let i = 0; i < ours.length; i++) {
          for (let j = 0; j < ours[i].length; j++) {
            const [a, b] = [ours[i][j], theirs[i][j]];
            if (typeof a === "number" && typeof b === "number") close(a, b, `${key} row ${i} col ${j}`);
            else expect(a, `${key} row ${i} col ${j}`).toEqual(b);
          }
        }
      }
    }, 300_000);
  });
});

describe("Company compile: the Acme adapter", () => {
  const c = company(acme);
  const r = compiled(c);
  const scored = checkAdapter(acme, data);

  it("compiles exactly the metrics the mapping covers, in the adapter's dialect", () => {
    expect(r.dialect).toBe("snowflake");
    expect(r.counts.direct + r.counts.staged).toBeGreaterThan(20);
    expect(r.counts.unmapped).toBeGreaterThan(200);
    // validate_mapping's fully covered metrics are the compiled main entries; partially and not covered ones are left out with their missing pairs.
    const idOf = (name: string) => metricFormulaId(data, data.metrics.find((m) => m.name === name && !isMetricStub(m))!);
    for (const f of scored.fully) expect(["direct", "staged"], f.metric).toContain(r.coverage[idOf(f.metric)].kind);
    for (const p of scored.partial) {
      const cov = r.coverage[idOf(p.metric)];
      expect(cov.kind, p.metric).toBe("unmapped");
      if (cov.kind === "unmapped") expect(cov.missing, p.metric).toEqual(p.missing);
    }
    for (const n of scored.none) expect(["unmapped", "notComputable"], n).toContain(r.coverage[idOf(n)].kind);
    expect(r.problems).toEqual([]);
    expect(c.problems).toEqual([]);
  });

  it("reads Acme's columns, transforms and tables", () => {
    expect(exprOf(r.model.metrics!.find((m) => m.name === "gasp_mrr")!)).toBe("SUM(subscription.mrr) FILTER (WHERE subscription.subscription_status = 'active')");
    const nrr = r.model.datasets.find((d) => d.name === "gasp_staged_gasp_nrr")!;
    expect(nrr.source).toContain("SUM((mrr_cents / 100)) FROM billing.subscriptions WHERE snapshot_date = p.period_start");
    expect(nrr.source).toContain("FROM billing.mrr_movements WHERE event_date >= p.period_start");
    expect(nrr.source).toContain("(CASE WHEN movement_type = 'upgrade' THEN 'expansion'");
    expect(ext(nrr).source_dialect).toBe("SNOWFLAKE");
    for (const token of DIALECT.snowflake.forbidden) expect(nrr.source).not.toContain(token);
    // The company's datasets keep their fields; the GASP additions follow.
    const sub = r.model.datasets.find((d) => d.name === "subscription")!;
    expect(sub.source).toBe("billing.subscriptions");
    expect(sub.fields!.find((f) => f.name === "mrr")!.expression.dialects[0].expression).toBe("mrr_cents / 100");
    expect(r.model.name).toBe(c.model.name);
  });

  it("takes a dialect, a period spine and a metric selection", () => {
    const bq = compiled(c, { dialect: "bigquery", spine: "analytics.periods" });
    const nrr = bq.model.datasets.find((d) => d.name === "gasp_staged_gasp_nrr")!;
    expect(nrr.source).toMatch(/FROM analytics\.periods p$/);
    for (const token of DIALECT.bigquery.forbidden) expect(nrr.source).not.toContain(token);
    expect(bq.model.datasets.find((d) => d.name === SPINE_DATASET)!.source).toBe("analytics.periods");
    expect(ext(nrr).source_dialect).toBe("BIGQUERY");

    const sel = selectFormulas(data, "MRR, NRR", undefined);
    expect(sel.only).toEqual(new Set(["mrr", "nrr"]));
    const some = compiled(c, { only: sel.only });
    const names = some.model.metrics!.map((m) => m.name);
    expect(names).toContain("gasp_mrr");
    expect(names).toContain("gasp_nrr_o");
    for (const m of some.model.metrics!) expect(["mrr", "nrr"], m.name).toContain(ext(m).gasp_id);
    expect(Object.keys(some.coverage).every((k) => /^(mrr|nrr)(:|$)/.test(k))).toBe(true);
    expect(selectFormulas(data, undefined, "core").only!.size).toBeGreaterThan(20);
    expect(selectFormulas(data, "nope", undefined).error).toMatch(/not a metric/);
    expect(selectFormulas(data, undefined, "nope").error).toMatch(/Unknown department/);
    expect(selectFormulas(data, "Activation Rate", undefined).error).toMatch(/names 2 metrics/);
  });

  it("recompiles idempotently from the compiled model", () => {
    const form = adapterToOssie(acme, data);
    const again = resolveCompany(ossieYaml(form.mapping), ossieYaml(r.model), data);
    if ("error" in again) throw new Error(again.error);
    const r2 = compiled(again);
    expect(r2.model).toEqual(r.model);
  });

  it("compiles the same metrics from the Ossie mapping and model as from the adapter", () => {
    const form = adapterToOssie(acme, data);
    const o = resolveCompany(ossieYaml(form.mapping), ossieYaml(form.model), data);
    if ("error" in o) throw new Error(o.error);
    const ro = compiled(o);
    expect(ro.model.metrics).toEqual(r.model.metrics);
    expect(ro.model.datasets.filter((d) => d.name.startsWith("gasp_"))).toEqual(r.model.datasets.filter((d) => d.name.startsWith("gasp_")));
    // Without the model a transform cannot be recovered: the staged source reads the bare column.
    const bare = resolveCompany(ossieYaml(form.mapping), undefined, data);
    if ("error" in bare) throw new Error(bare.error);
    const rb = compiled(bare);
    expect(rb.model.datasets.find((d) => d.name === "gasp_staged_gasp_nrr")!.source).toContain("SUM(mrr) FROM subscription WHERE");
    expect(formatCompileReport(rb, data, { document: false })).toContain("without a semantic model");
  });

  it("names a query source as a derived table in staged sources", () => {
    const form = adapterToOssie(acme, data);
    const model = { ...form.model, datasets: form.model.datasets.map((d) => (d.name === "subscription" ? { ...d, source: "SELECT * FROM billing.subscriptions WHERE deleted_at IS NULL" } : d)) };
    const q = resolveCompany(ossieYaml(form.mapping), ossieYaml(model), data);
    if ("error" in q) throw new Error(q.error);
    const rq = compiled(q);
    expect(rq.model.datasets.find((d) => d.name === "gasp_staged_gasp_nrr")!.source).toContain("FROM (SELECT * FROM billing.subscriptions WHERE deleted_at IS NULL) AS _subscription WHERE");
    expect(rq.problems).toEqual([]);
  });

  it("reports in sections and carries the model document", () => {
    const report = formatCompileReport(r, data);
    for (const h of ["# Compiled GASP metrics: Acme SaaS", "**Mapping:** GASP adapter v1.1", "**Dialect:** snowflake (from the adapter's warehouse `snowflake`)", "**Period spine:** `gasp.period_spine`", "**Checks:** the compiled metrics pass", "## Staged", "- cohort:", "## Left out: unmapped (", "needs `", "## Model", "```yaml", `name: ${c.model.name}`, "gasp_staged_gasp_nrr"]) expect(report).toContain(h);
    expect(formatCompileReport(r, data, { document: false })).not.toContain("```yaml");
    const text = compileModelFromText(JSON.stringify(acme), undefined, data, { metrics: "MRR", document: false });
    expect(text).toContain("**Compiled:** 1 metric (1 direct, 0 staged");
    expect(text).toContain("MRR (Monthly Recurring Revenue) (by_segment): needs `segment@subscription`");
    expect(compileModelFromText(JSON.stringify({ hello: 1 }), undefined, data)).toMatch(/must be a GASP adapter/);
    expect(compileModelFromText(JSON.stringify(acme), undefined, data, { dialect: "oracle" })).toMatch(/Unknown SQL dialect/);
    expect(compileModelFromText(JSON.stringify(acme), undefined, data, { metrics: "nope" })).toMatch(/not a metric/);
  });

  const upstream = uvAvailable() ? it : it.skip;
  upstream("passes the upstream validator", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gasp-company-"));
    try {
      const file = join(dir, "acme_saas.semantic_model.yaml");
      writeFileSync(file, ossieYaml(r.model));
      const v = await validateUpstream(file, "model");
      expect(v.ok, v.output).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("keeps every direct expression in the portable dialect", () => {
    for (const m of r.model.metrics!) expect(m.expression.dialects[0].dialect, m.name).toBe(OSSIE_DIALECT);
  });
});
