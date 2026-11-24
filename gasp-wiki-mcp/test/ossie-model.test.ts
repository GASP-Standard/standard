import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateUpstream, uvAvailable } from "../src/ossie/validate.js";
import { stringify } from "yaml";
import { PGlite } from "@electric-sql/pglite";
import { loadStandard } from "../src/loader.js";
import { exportModel, snapshotRule, stagedDatasetName } from "../src/ossie/model.js";
import { emitMetric } from "../src/ossie/metrics.js";
import { ACCOUNT_COHORTS, cohortTableProblems } from "../src/ossie/cohorts.js";
import { stagedValueQuery } from "../src/ossie/demo.js";
import { compileMetric, type CompileContext } from "../src/compile.js";
import type { MetricFormula } from "../src/types.js";
import { metricName } from "../src/ossie/names.js";
import { DIALECT, type DialectName } from "../src/dialect.js";
import { stagedSource } from "../src/ossie/model.js";
import { modelMetrics } from "../src/ossie/scope.js";
import { GASP_VENDOR, type OssieDataset } from "../src/ossie/types.js";
import { fixtureDb, addOssieViews, scalar, runTemplate, moveSegment } from "./fixture-db.js";

// The Ossie semantic model exporter: every GASP dataset, field and formula
// expression lands in the model, direct metrics are plain OSSIE_SQL_2026
// aggregates, and staged metrics carry a per-period dataset whose source runs.

const data = loadStandard();
const { model, coverage } = exportModel(data);
const ontology = data.ontology!;
const gaspDatasets = ontology.datasets!;
const byName = new Map(model.datasets.map((d) => [d.name, d]));
/** Every metric of the model in the `dataset.field` form, whichever scope declares it. */
const metrics = modelMetrics(model);
const metricByName = new Map(metrics.map((m) => [m.name, m]));
const expr = (name: string) => metricByName.get(name)?.expression.sql;
const ext = (d: { nonportable_extensions?: Array<{ vendor_name: string; data: Record<string, any> }> }) => // eslint-disable-line @typescript-eslint/no-explicit-any
  d.nonportable_extensions!.find((e) => e.vendor_name === GASP_VENDOR)!.data;

// Every formula entry expression: main formula (or a notComputable entry), each form, each variant.
const entries: Array<{ key: string; id: string; variant?: string }> = [];
for (const [id, f] of Object.entries(data.formulas!)) {
  if (f.formula || f.notComputable) entries.push({ key: id, id });
  for (const v of [...Object.keys(f.forms ?? {}), ...Object.keys(f.variants ?? {}), ...Object.keys(f.breakdowns ?? {})]) entries.push({ key: `${id}:${v}`, id, variant: v });
}

describe("Ossie model: datasets", () => {
  it("has every GASP dataset with its physical source and GASP extension", () => {
    for (const [id, d] of Object.entries(gaspDatasets)) {
      const ds = byName.get(id);
      expect(ds, id).toBeDefined();
      expect(ds!.source).toBe(`gasp.${id}`);
      const x = ext(ds!);
      expect(x.kind).toBe(d.kind);
      if (d.cel) expect(x.cel).toBe(d.cel);
      if (d.activeWhen) expect(x.activeWhen).toBe(d.activeWhen);
    }
  });

  it("describes a dataset by its label alone and states the snapshot reading rule once, on each snapshot", () => {
    for (const [id, d] of Object.entries(gaspDatasets)) {
      const ds = byName.get(id)!;
      // The kind and the CEL class are in the extension; the description repeats neither.
      expect(ds.description, id).toBe(d.label.replace(/\.?$/, "."));
      const instructions = (ds.ai_context as { instructions?: string } | undefined)?.instructions;
      if (d.kind === "snapshot") {
        expect(instructions, id).toBe(snapshotRule(d));
        expect(instructions, id).toContain(`select one ${d.date} (the period end)`);
        expect(instructions, id).toContain(d.key === d.date ? `one row per ${d.date}:` : `one row per ${d.key} per ${d.date}:`);
      } else expect(ds.ai_context, id).toBeUndefined();
    }
    // No metric of the reference model restates it: every snapshot it reads says so itself.
    for (const m of metricByName.values()) expect(JSON.stringify(m.ai_context ?? ""), m.name).not.toContain("double counts");
  });

  it("has every field on every dataset it belongs to, typed, with enum values", () => {
    for (const f of ontology.fields!) {
      for (const ds of f.datasets ?? []) {
        const field = byName.get(ds)!.fields!.find((x) => x.name === f.id);
        expect(field, `${f.id}@${ds}`).toBeDefined();
        expect(field!.expression).toEqual({ sql: f.id });
        expect(field!.datatype).toBeDefined();
        if (f.type === "enum" && f.values?.length) expect((field!.ai_context as any).instructions).toBe(`One of ${f.values.join(", ")}`);
      }
    }
    const fieldCount = ontology.fields!.reduce((n, f) => n + (f.datasets?.length ?? 0), 0);
    const emitted = Object.keys(gaspDatasets).reduce((n, id) => n + byName.get(id)!.fields!.length, 0);
    expect(emitted).toBe(fieldCount);
  });

  it("primary keys and time dimensions follow the dataset kind", () => {
    for (const [id, d] of Object.entries(gaspDatasets)) {
      const ds = byName.get(id)!;
      const expected = d.kind === "event" ? [d.key] : d.key === d.date ? [d.date] : [d.key, d.date];
      expect(ds.primary_key, id).toEqual(expected);
      const time = ds.fields!.filter((f) => f.dimension?.is_time).map((f) => f.name);
      expect(time, id).toEqual([d.date]);
      for (const k of ds.primary_key!) expect(ds.fields!.some((f) => f.name === k), `${id}.${k}`).toBe(true);
    }
  });

  it("relationships reference existing datasets and columns and cover the target key", () => {
    const rels = model.relationships ?? [];
    expect(rels.length).toBeGreaterThan(0);
    expect(new Set(rels.map((r) => r.name)).size).toBe(rels.length);
    for (const r of rels) {
      const from = byName.get(r.from);
      const to = byName.get(r.to);
      expect(from && to, r.name).toBeTruthy();
      expect(r.from).not.toBe(r.to);
      expect(r.from_columns.length).toBe(r.to_columns.length);
      for (const c of r.from_columns) expect(from!.fields!.some((f) => f.name === c), `${r.name} from ${c}`).toBe(true);
      for (const c of r.to_columns) expect(to!.fields!.some((f) => f.name === c), `${r.name} to ${c}`).toBe(true);
      // A fact target is joined on its key alone (see the next test); every other target's key is covered.
      if (data.ontology!.datasets![r.to]?.kind === "fact") continue;
      expect(to!.primary_key!.every((k) => r.to_columns.includes(k)), r.name).toBe(true);
    }
  });

  it("joins a fact dataset on its key alone, with no date condition", () => {
    const facts = (model.relationships ?? []).filter((r) => data.ontology!.datasets![r.to]?.kind === "fact");
    expect(facts.map((r) => r.name)).toEqual(expect.arrayContaining(["opportunity_rep_id", "project_consultant_id", "time_entry_consultant_id"]));
    for (const r of facts) {
      const target = data.ontology!.datasets![r.to];
      expect(r.to_columns, r.name).toEqual([target.key]);
      expect(r.from_columns, r.name).toHaveLength(1);
      expect(r.to_columns).not.toContain(target.date);
      expect(r.from_columns).not.toContain(data.ontology!.datasets![r.from].date);
    }
    expect(model.relationships!.find((r) => r.name === "opportunity_rep_id")).toMatchObject({ from: "opportunity", to: "sales_rep", from_columns: ["rep_id"], to_columns: ["rep_id"] });
  });

  it("joins a subscription to its customer by key and snapshot date, and an event to a snapshot by key and date", () => {
    const sub = model.relationships!.find((r) => r.name === "subscription_customer_id")!;
    expect(sub).toMatchObject({ from: "subscription", to: "customer", from_columns: ["customer_id", "snapshot_date"], to_columns: ["customer_id", "snapshot_date"] });
    const rev = model.relationships!.find((r) => r.name === "revenue_event_customer_id")!;
    expect(rev).toMatchObject({ to: "customer", from_columns: ["customer_id", "event_date"], to_columns: ["customer_id", "snapshot_date"] });
    // A dataset's own key is never a join, even when other datasets share it (event_id, period_start).
    expect(model.relationships!.some((r) => r.from_columns[0] === "event_id" || r.from_columns[0] === "period_start" || r.from_columns[0] === "snapshot_date")).toBe(false);
  });
});

describe("Ossie model: metrics", () => {
  it("maps every formula expression to exactly one metric or a notComputable entry", () => {
    expect(Object.keys(coverage).sort()).toEqual(entries.map((e) => e.key).sort());
    for (const e of entries) {
      const c = coverage[e.key];
      if (c.kind === "notComputable") {
        expect(metricByName.has(metricName(e.id, e.variant))).toBe(false);
        continue;
      }
      expect(c.ossieName).toBe(metricName(e.id, e.variant));
      expect(metricByName.has(c.ossieName), c.ossieName).toBe(true);
    }
    const emitted = Object.values(coverage).filter((c) => c.kind !== "notComputable").length;
    expect(metrics.length).toBe(emitted);
    expect(new Set(metrics.map((m) => m.name)).size).toBe(metrics.length);
  });

  it("every main formula marked notComputable is reported, and no metric is emitted for it", () => {
    for (const [id, f] of Object.entries(data.formulas!)) {
      if (f.notComputable) expect(coverage[id]).toEqual({ kind: "notComputable", reason: f.notComputable });
    }
  });

  it("no metric expression contains SELECT, a bare WHERE or a placeholder", () => {
    for (const m of metrics) {
      // The portable form alone, as upstream's canonical examples write it since apache/ossie#640; no dialect entries beside it.
      expect(Object.keys(m.expression), m.name).toEqual(["sql"]);
      const e = m.expression.sql!;
      expect(e, m.name).not.toMatch(/\bSELECT\b/i);
      // The aggregate filter clause `FILTER (WHERE ...)` is required by the expression language; a bare WHERE is a query.
      expect(e.replace(/\bFILTER \(WHERE\b/g, "FILTER ("), m.name).not.toMatch(/\bWHERE\b/i);
      expect(e, m.name).not.toMatch(/\bCASE WHEN\b/i);
      expect(e, m.name).not.toMatch(/\bFROM\b/i);
      expect(e, m.name).not.toContain("{{");
      expect(e, m.name).not.toMatch(/\bPERIOD_(START|END|DAYS)\b/);
    }
  });

  it("metrics read only datasets in the model, by fields those datasets have; direct metrics never read a staged dataset", () => {
    const kind = new Map(Object.values(coverage).flatMap((c) => (c.kind === "notComputable" ? [] : [[c.ossieName, c.kind] as const])));
    // A staged dataset is one GASP marks as staged: the per-period ones and the cohort table.
    const stagedNames = new Set(model.datasets.filter((d) => ext(d).staged === true).map((d) => d.name));
    for (const m of metrics) {
      for (const [, ds, field] of m.expression.sql!.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g)) {
        expect(byName.has(ds), `${m.name}: ${ds}`).toBe(true);
        expect(byName.get(ds)!.fields!.some((f) => f.name === field), `${m.name}: ${ds}.${field}`).toBe(true);
        expect(stagedNames.has(ds), m.name).toBe(kind.get(m.name) === "staged");
      }
    }
  });

  it("every staged metric has its staged dataset and every staged dataset belongs to a staged metric", () => {
    const everyStaged = Object.values(coverage).filter((c) => c.kind === "staged") as Array<Extract<typeof coverage[string], { kind: "staged" }>>;
    // The entries over the cohort table share one dataset and are checked in the test after this one.
    const stagedCoverage = everyStaged.filter((c) => !c.cohortTable);
    const stagedDatasets = model.datasets.filter((d) => d.name.startsWith("gasp_staged_"));
    expect(stagedDatasets.map((d) => d.name).sort()).toEqual(stagedCoverage.map((c) => c.stagedDataset).sort());
    expect(model.datasets.filter((d) => ext(d).staged === true).map((d) => d.name).sort()).toEqual([...new Set(everyStaged.map((c) => c.stagedDataset))].sort());
    for (const c of stagedCoverage) {
      const ds = byName.get(c.stagedDataset)!;
      expect(c.stagedDataset).toBe(stagedDatasetName(c.ossieName));
      expect(expr(c.ossieName)).toBe(`SUM(${c.stagedDataset}.value)`);
      // A breakdown adds its field: one row per period and value.
      const bf = ext(metricByName.get(c.ossieName)!).gasp_breakdown as string | undefined;
      expect(ds.primary_key).toEqual(bf ? ["period_start", bf] : ["period_start"]);
      expect(ds.fields!.map((f) => f.name)).toEqual(bf ? ["period_start", "period_end", bf, "value"] : ["period_start", "period_end", "value"]);
      expect(ds.fields!.find((f) => f.name === "period_start")!.dimension?.is_time).toBe(true);
      if (bf) {
        expect(ds.source).toMatch(new RegExp(`^SELECT p\\.period_start, p\\.period_end, _d\\.${bf} AS ${bf}, \\(`));
        expect(ds.source).toMatch(/AS value FROM gasp\.period_spine p CROSS JOIN \(.*\) _d$/);
      } else {
        expect(ds.source).toMatch(/^SELECT p\.period_start, p\.period_end, \(/);
        expect(ds.source).toMatch(/AS value FROM gasp\.period_spine p$/);
      }
      expect(ds.source).not.toContain("{{");
      const x = ext(ds);
      expect(x).toMatchObject({ staged: true, for: c.ossieName, reason: c.reason, source_dialect: "POSTGRES" });
      // Ossie's source is one string: the other dialects' sources travel in the GASP extension.
      expect(Object.keys(x.sources).sort()).toEqual(["BIGQUERY", "DATABRICKS", "SNOWFLAKE"]);
      for (const [ossie, src] of Object.entries(x.sources as Record<string, string>)) {
        const dialect = ossie.toLowerCase() as DialectName;
        expect(src, `${ds.name} ${ossie}`).toMatch(/^SELECT p\.period_start, p\.period_end, /);
        expect(src).not.toContain("{{");
        for (const token of DIALECT[dialect].forbidden) expect(src, `${ds.name} ${ossie}: ${token}`).not.toContain(token);
      }
      expect(ext(metricByName.get(c.ossieName)!).staged).toBe(true);
    }
  });

  it("the cohort table serves the NRR, GRR, Revenue Churn Rate and Expansion Rate entries as plain sums over one row per customer per period", () => {
    const served = Object.entries(coverage).filter(([, c]) => c.kind === "staged" && c.cohortTable);
    expect(served.map(([k]) => k).sort()).toEqual(["expansion_rate", "expansion_rate:by_segment", "grr", "grr:adjusted", "grr:by_segment", "grr:per_customer", "nrr", "nrr:M", "nrr:O", "nrr:adjusted", "nrr:by_segment", "revenue_churn_rate", "revenue_churn_rate:by_segment"]);
    expect(cohortTableProblems(ACCOUNT_COHORTS, data.formulas!)).toEqual([]);
    const ds = byName.get(ACCOUNT_COHORTS.name)!;
    const key = ACCOUNT_COHORTS.cohort.key;
    expect(ds.primary_key).toEqual(["period_start", key]);
    // The segment each customer held on the cohort's day follows the key: the one dimension the two breakdowns group by.
    expect(ds.fields!.slice(0, 4).map((f) => f.name)).toEqual(["period_start", "period_end", key, "segment"]);
    expect(ds.fields![3]).toMatchObject({ expression: { sql: "segment" }, datatype: "String" });
    expect(ds.fields!.find((f) => f.name === "period_start")!.dimension?.is_time).toBe(true);
    // Every column is declared, in the declared order, and read by a served metric: the table carries nothing unused.
    const columns = ds.fields!.slice(4).map((f) => f.name);
    const read = new Set<string>();
    for (const [key, c] of served) {
      if (c.kind !== "staged") continue;
      expect(c.stagedDataset, key).toBe(ACCOUNT_COHORTS.name);
      expect(c.reason, key).toBe("cohort");
      const e = expr(c.ossieName)!;
      // Sums of the table's columns and arithmetic over them, nothing else.
      const names = [...e.matchAll(/SUM\(gasp_account_cohorts\.([a-z_]+)\)/g)].map((m) => m[1]);
      expect(names.length, key).toBeGreaterThan(0);
      expect(e.replace(/SUM\(gasp_account_cohorts\.[a-z_]+\)/g, "x").replace(/CAST\(|NULLIF\(| AS DECIMAL|, 0/g, ""), key).toMatch(/^[x\s()+\-*\/]+$/);
      expect(e, key).not.toContain("COALESCE");
      for (const n of names) read.add(n);
      expect(ext(metricByName.get(c.ossieName)!).staged, key).toBe(true);
      // A breakdown keeps the expression of the entry it breaks down and names the table's dimension.
      const [id, variant] = key.split(":");
      if (variant === "by_segment") {
        expect(e, key).toBe(expr(coverage[id].ossieName));
        expect(ext(metricByName.get(c.ossieName)!).gasp_breakdown, key).toBe("segment");
        expect((metricByName.get(c.ossieName)!.ai_context as any).instructions, key).toContain("grouping by gasp_account_cohorts.segment");
      } else expect(ext(metricByName.get(c.ossieName)!).gasp_breakdown, key).toBeUndefined();
    }
    expect(columns).toEqual(ACCOUNT_COHORTS.columns.map((c) => c.name).filter((c) => read.has(c)));
    const x = ext(ds);
    expect(x).toMatchObject({ staged: true, reason: "cohort", cohort: { key, point: ACCOUNT_COHORTS.cohort.point }, source_dialect: "POSTGRES" });
    expect([...x.for].sort()).toEqual(served.map(([, c]) => (c as { ossieName: string }).ossieName).sort());
    expect(ds.source).toMatch(new RegExp(`^SELECT p\\.period_start, p\\.period_end, _c\\.${key}, _c\\.segment, \\(SELECT `));
    expect(ds.source).not.toContain("{{");
    expect(Object.keys(x.sources).sort()).toEqual(["BIGQUERY", "DATABRICKS", "SNOWFLAKE"]);
    for (const [ossie, src] of Object.entries(x.sources as Record<string, string>)) {
      expect(src, ossie).toMatch(/^SELECT p\.period_start, p\.period_end, /);
      expect(src).not.toContain("{{");
      for (const token of DIALECT[ossie.toLowerCase() as DialectName].forbidden) expect(src, `${ossie}: ${token}`).not.toContain(token);
    }
    // The cohorts on another key or another day stay on a per-period dataset.
    for (const k of ["arr:O", "commit_accuracy", "consumption_net_revenue_retention"]) {
      expect(coverage[k], k).toMatchObject({ kind: "staged" });
      expect((coverage[k] as { cohortTable?: true }).cohortTable, k).toBeUndefined();
    }
  });

  it("every metric carries a description, datatype, canonical link and its GASP extension", () => {
    for (const m of metrics) {
      expect(m.description, m.name).toBeTruthy();
      expect(["Decimal", "Integer"]).toContain(m.datatype);
      const x = ext(m);
      expect(x.gasp_version).toBe("1");
      expect(typeof x.formula).toBe("string");
      expect(x.unit).toBeTruthy();
      expect(m.datatype).toBe(x.unit === "count" ? "Integer" : "Decimal");
      expect((m.ai_context as any).instructions, m.name).toMatch(/Canonical definition: https:\/\/gaspwiki\.com\/v1\/metrics\//);
    }
  });

  it("spot checks", () => {
    expect(expr("gasp_expansion_mrr")).toBe("COALESCE(SUM(revenue_event.mrr_change) FILTER (WHERE revenue_event.event_type = 'expansion'), 0)");
    for (const k of ["nrr", "nrr:O", "nrr:M"]) expect(coverage[k]).toMatchObject({ kind: "staged", reason: "cohort" });
    expect(expr("gasp_nrr_o")).toBe("(CAST((((SUM(gasp_account_cohorts.opening_mrr) + SUM(gasp_account_cohorts.expansion_mrr_o)) - SUM(gasp_account_cohorts.contraction_mrr)) - SUM(gasp_account_cohorts.churned_mrr)) AS DECIMAL) / NULLIF(SUM(gasp_account_cohorts.opening_mrr), 0))");
    expect(expr("gasp_grr_per_customer")).toBe("(CAST(SUM(gasp_account_cohorts.retained_mrr) AS DECIMAL) / NULLIF(SUM(gasp_account_cohorts.mrr_start), 0))");
    // A breakdown of a cohort metric by a field the customer carries reads the same sums, grouped by the table's column.
    expect(expr("gasp_nrr_by_segment")).toBe(expr("gasp_nrr"));
    expect(byName.has("gasp_staged_gasp_nrr_by_segment")).toBe(false);
    // MRR reads the subscription snapshot; the query layer selects the period-end snapshot date.
    expect(coverage.mrr.kind).toBe("direct");
    expect(expr("gasp_mrr")).toBe("COALESCE(SUM(subscription.mrr) FILTER (WHERE subscription.subscription_status = 'active'), 0)");
    expect((byName.get("subscription")!.ai_context as any).instructions).toMatch(/select one snapshot_date \(the period end\)/);
    expect((metricByName.get("gasp_mrr")!.ai_context as any).instructions).not.toMatch(/double counts/);
    // Win rate filters the opportunity snapshot by close_date in the period: a period bound the metric cannot see.
    expect(coverage.win_rate).toMatchObject({ kind: "staged", reason: "period bound in filter" });
    expect(coverage.cac.kind).toBe("direct");
    expect(expr("gasp_cac")).toBe(
      "(CAST(COALESCE(SUM(cost_event.cost) FILTER (WHERE cost_event.cost_function = 'gtm'), 0) AS DECIMAL) / NULLIF((COUNT(DISTINCT revenue_event.customer_id) FILTER (WHERE revenue_event.event_type = 'new')), 0))",
    );
    expect(ext(metricByName.get("gasp_nrr_m")!)).toMatchObject({ gasp_id: "nrr", form: "M", unit: "percent", staged: true });
  });

  describe("emitter rules on synthetic formulas", () => {
    const ctx = (formula: string, extra: Record<string, MetricFormula> = {}) => ({
      fields: Object.fromEntries(ontology.fields!.map((f) => [f.id, f])),
      datasets: gaspDatasets,
      formulas: { ...data.formulas!, t: { formula, unit: "currency" as const }, ...extra },
    });
    const emit = (formula: string, extra?: Record<string, MetricFormula>) => emitMetric("t", ctx(formula, extra));

    it("drops in_period on an event dataset's own date field", () => {
      expect(emit("sum(field.mrr_change where in_period(field.event_date) and field.event_type = 'expansion')")).toMatchObject({
        kind: "direct", expression: "COALESCE(SUM(revenue_event.mrr_change) FILTER (WHERE revenue_event.event_type = 'expansion'), 0)",
      });
      expect(emit("count(field.event_id where in_period(field.event_date))")).toMatchObject({ kind: "direct", expression: "COUNT(revenue_event.event_id)" });
    });

    it("stages in_period on any other field, and every period construct", () => {
      expect(emit("count(field.opportunity_id where in_period(field.close_date))")).toMatchObject({ kind: "staged", reason: "period bound in filter" });
      expect(emit("sum(field.mrr_change) to_date")).toMatchObject({ kind: "staged", reason: "to_date" });
      expect(emit("sum(field.mrr_change) at period_end")).toMatchObject({ kind: "staged", reason: "to_date" });
      expect(emit("sum(field.mrr where field.subscription_status = 'active') at period_start")).toMatchObject({ kind: "staged", reason: "at period_start" });
      expect(emit("lag(sum(field.mrr_change), 1 month)")).toMatchObject({ kind: "staged", reason: "lag" });
      expect(emit("window(sum(field.mrr_change), 12 month)")).toMatchObject({ kind: "staged", reason: "window" });
      expect(emit("sum(field.mrr_change) / period_days")).toMatchObject({ kind: "staged", reason: "period_days" });
      expect(emit("metric.mrr over cohort(field.customer_id, period_end)")).toMatchObject({ kind: "staged", reason: "cohort" });
      // A cohort inside a referenced metric stages the referencing one.
      expect(emit("metric.nrr * 2")).toMatchObject({ kind: "staged", reason: "cohort" });
    });

    it("dates, percentiles, scalar functions and division", () => {
      expect(emit("avg(field.close_date - field.opportunity_created_date)")).toMatchObject({
        kind: "direct", expression: "AVG(DATEDIFF(day, opportunity.opportunity_created_date, opportunity.close_date))",
      });
      expect(emit("percentile(field.mrr, 0.9 where field.subscription_status = 'active')")).toMatchObject({
        kind: "direct", expression: "PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY subscription.mrr) FILTER (WHERE subscription.subscription_status = 'active')",
      });
      expect(emit("median(field.mrr)")).toMatchObject({ kind: "direct", expression: "MEDIAN(subscription.mrr)" });
      expect(emit("max(sum(field.mrr_change), 0) / 2")).toMatchObject({ kind: "direct", expression: "(CAST(GREATEST(COALESCE(SUM(revenue_event.mrr_change), 0), 0) AS DECIMAL) / 2)" });
    });

    it("stages distinct pairs and total(); a breakdown with neither stays direct", () => {
      expect(emit("count_distinct(field.customer_id, field.feature_id)")).toMatchObject({ kind: "staged", reason: "distinct pair" });
      expect(emit("count(field.ticket_id) / total(count(field.ticket_id))")).toMatchObject({ kind: "staged", reason: "total" });
      expect(emit("count(field.ticket_id)")).toMatchObject({ kind: "direct", expression: "COUNT(ticket.ticket_id)" });
    });

    it("a reference to a notComputable metric is not computable", () => {
      expect(emit("metric.x * 2", { x: { notComputable: "no single formula" } })).toMatchObject({ kind: "notComputable" });
    });
  });

  it("marks a breakdown with no total() as direct with the gasp_breakdown extension, and stages one with total()", () => {
    const withEntry = (id: string, f: MetricFormula) => exportModel({ ...data, formulas: { ...data.formulas!, [id]: f } });
    const direct = withEntry("ticket_volume", { formula: "count_distinct(field.ticket_id)", unit: "count", breakdown: "field.ticket_type" });
    expect(direct.coverage.ticket_volume.kind).toBe("direct");
    const m = modelMetrics(direct.model).find((x) => x.name === "gasp_ticket_volume")!;
    expect(m.expression.sql).toBe("COUNT(DISTINCT ticket.ticket_id)");
    expect(ext(m).gasp_breakdown).toBe("ticket_type");
    expect((m.ai_context as any).instructions).toMatch(/Broken down by ticket_type/);
    // A named breakdown is its own metric, like a variant, with the variant name and gasp_breakdown.
    const named = withEntry("ticket_volume", { formula: "count_distinct(field.ticket_id)", unit: "count", breakdowns: { by_type: "field.ticket_type" } });
    expect(named.coverage.ticket_volume.kind).toBe("direct");
    expect(named.coverage["ticket_volume:by_type"].kind).toBe("direct");
    const nm = modelMetrics(named.model).find((x) => x.name === "gasp_ticket_volume_by_type")!;
    expect(nm.expression.sql).toBe("COUNT(DISTINCT ticket.ticket_id)");
    expect(ext(nm)).toMatchObject({ gasp_id: "ticket_volume", variant: "by_type", gasp_breakdown: "ticket_type" });
    expect(ext(modelMetrics(named.model).find((x) => x.name === "gasp_ticket_volume")!).gasp_breakdown).toBeUndefined();
    // A staged main formula stages the named breakdown too, one row per period and value.
    const namedStaged = withEntry("ticket_volume", { formula: "count_distinct(field.ticket_id) to_date", unit: "count", breakdowns: { by_type: "field.ticket_type" } });
    expect(namedStaged.coverage["ticket_volume:by_type"]).toMatchObject({ kind: "staged", reason: "to_date" });
    expect(namedStaged.model.datasets.find((d) => d.name === "gasp_staged_gasp_ticket_volume_by_type")!.primary_key).toEqual(["period_start", "ticket_type"]);
    expect(namedStaged.model.datasets.find((d) => d.name === "gasp_staged_gasp_ticket_volume")!.primary_key).toEqual(["period_start"]);
    // A named breakdown in total mode is staged like total(): CAC by cost centre.
    expect(coverage["cac:by_cost_centre"]).toMatchObject({ kind: "staged", reason: "total" });
    expect(ext(metricByName.get("gasp_cac_by_cost_centre")!)).toMatchObject({ gasp_id: "cac", variant: "by_cost_centre", gasp_breakdown: "cost_centre" });
    expect(byName.get("gasp_staged_gasp_cac_by_cost_centre")!.primary_key).toEqual(["period_start", "cost_centre"]);
    // Aging Buckets groups by a computed dimension: staged with reason bucket, one row per period and bucket label.
    expect(coverage.aging_buckets).toMatchObject({ kind: "staged", reason: "bucket" });
    const aging = byName.get("gasp_staged_gasp_aging_buckets")!;
    expect(aging.primary_key).toEqual(["period_start", "bucket"]);
    expect(aging.fields!.find((x) => x.name === "bucket")!.datatype).toBe("String");
    expect(ext(metricByName.get("gasp_aging_buckets")!).gasp_breakdown).toBe("bucket");
    // MRR by plan reaches plan_name through plan_id: still direct, with the dimension named on its dataset.
    expect(coverage["mrr:by_plan"].kind).toBe("direct");
    expect(ext(metricByName.get("gasp_mrr_by_plan")!).gasp_breakdown).toBe("plan.plan_name");
    expect((metricByName.get("gasp_mrr_by_plan")!.ai_context as any).instructions).toMatch(/joining each dataset the expression reads to plan on plan_id/);
    expect(model.relationships!.some((r) => r.from === "subscription" && r.to === "plan" && r.from_columns[0] === "plan_id")).toBe(true);
    // Ticket Distribution by Type uses total(): staged, one row per period and ticket type.
    expect(coverage.ticket_distribution_by_type).toMatchObject({ kind: "staged", reason: "total" });
    const ds = byName.get("gasp_staged_gasp_ticket_distribution_by_type")!;
    expect(ds.primary_key).toEqual(["period_start", "ticket_type"]);
    expect(ext(metricByName.get("gasp_ticket_distribution_by_type")!).gasp_breakdown).toBe("ticket_type");
    // Breadth of Adoption counts distinct (account, feature) pairs.
    expect(coverage.breadth_of_adoption).toMatchObject({ kind: "staged", reason: "distinct pair" });
  });

  it("a staged breakdown reached through a key joins the keyed snapshot on the period end, carrying key and label", () => {
    const src = stagedSource("SELECT _d.plan_id AS plan_id, _d.plan_name AS plan_name, (SELECT SUM({{mrr@subscription}}) FROM {{_table:subscription}} WHERE {{snapshot_date@subscription}} = {{_period_end}} AND {{plan_id@subscription}} = _d.plan_id) AS mrr\n" +
      "FROM (SELECT DISTINCT {{plan_id@plan}} AS plan_id, {{plan_name@plan}} AS plan_name FROM {{_table:plan}} WHERE {{snapshot_date@plan}} = {{_period_end}}) _d");
    expect(src).toBe("SELECT p.period_start, p.period_end, _d.plan_id AS plan_id, _d.plan_name AS plan_name, ((SELECT SUM(mrr) FROM gasp.subscription WHERE snapshot_date = p.period_end AND plan_id = _d.plan_id)) AS value FROM gasp.period_spine p " +
      "JOIN (SELECT DISTINCT plan_id AS plan_id, plan_name AS plan_name, snapshot_date AS _period FROM gasp.plan) _d ON _d._period = p.period_end");
  });

  it("reports coverage counts", () => {
    const counts: Record<string, number> = {};
    for (const c of Object.values(coverage)) {
      const k = c.kind === "staged" ? `staged: ${c.reason}` : c.kind;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    console.log(`Ossie coverage over ${Object.keys(coverage).length} formula expressions:`, counts);
    expect(counts.direct).toBeGreaterThan(100);
  });
});

describe("Ossie model: staged sources run", () => {
  let db: PGlite | undefined;
  afterAll(async () => { await db?.close(); });

  it("every staged dataset source executes against empty reference tables", async () => {
    db = new PGlite();
    const PG: Record<string, string> = { date: "DATE", timestamp: "TIMESTAMP", decimal: "NUMERIC", integer: "INTEGER", boolean: "BOOLEAN" };
    const types = new Map(ontology.fields!.map((f) => [f.id, f.type]));
    await db.exec("CREATE SCHEMA gasp");
    for (const id of Object.keys(gaspDatasets)) {
      const ds = byName.get(id)!;
      await db.exec(`CREATE TABLE gasp."${id}" (${ds.fields!.map((f) => `"${f.name}" ${PG[types.get(f.name)!] ?? "TEXT"}`).join(", ")})`);
    }
    await db.exec("CREATE TABLE gasp.period_spine (period_start DATE, period_end DATE)");
    await db.exec("INSERT INTO gasp.period_spine VALUES ('2026-01-01', '2026-01-31'), ('2026-02-01', '2026-02-28')");
    const failures: string[] = [];
    const values = new Map(ontology.fields!.map((f) => [f.id, f.values?.length ?? 0]));
    // A bucketed breakdown has one row per period and bucket label.
    const bucketCounts = new Map<string, number>();
    for (const [id, f] of Object.entries(data.formulas!)) {
      for (const [variant, b] of [[undefined, f.breakdown], ...Object.entries(f.breakdowns ?? {})] as Array<[string | undefined, any]>) {
        if (b && typeof b === "object" && "expression" in b) bucketCounts.set(stagedDatasetName(metricName(id, variant)), Object.keys(b.buckets).length);
      }
    }
    for (const ds of model.datasets.filter((d): d is OssieDataset => d.name.startsWith("gasp_staged_"))) {
      try {
        const res = await db.query(ds.source);
        // A breakdown on an enum field has one row per period and declared value.
        const bf = ds.primary_key!.find((k) => k !== "period_start");
        const expected = bf ? 2 * (bucketCounts.get(ds.name) ?? values.get(bf)!) : 2;
        if (res.rows.length !== expected) failures.push(`${ds.name}: ${res.rows.length} rows, expected ${expected}`);
      } catch (e) {
        failures.push(`${ds.name}: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
    // The cohort table has a row per customer live on the first day: none over empty tables.
    expect((await db.query(byName.get(ACCOUNT_COHORTS.name)!.source)).rows).toEqual([]);
  }, 60_000);
});

describe("Ossie model: values match the compiled templates on the fixture, June 2026", () => {
  // The same rows execute.test.ts runs the templates on, exposed as gasp.<dataset>
  // views under GASP field names, plus a one-period spine for the staged sources.
  let db: PGlite;
  const [start, end] = ["2026-06-01", "2026-06-30"];
  beforeAll(async () => {
    db = await fixtureDb();
    await addOssieViews(db);
    await db.exec(`CREATE TABLE gasp.period_spine (period_start DATE, period_end DATE); INSERT INTO gasp.period_spine VALUES ('${start}', '${end}')`);
  }, 120_000);
  afterAll(async () => { await db?.close(); });

  /**
   * OSSIE_SQL_2026 to Postgres: DATEDIFF(second, a, b) becomes EXTRACT(EPOCH FROM (b - a)),
   * the only construct these metrics use that PGlite lacks.
   */
  const toPostgres = (sql: string) =>
    sql.replace(/DATEDIFF\(second, ([a-z_.]+), ([a-z_.]+)\)/g, "EXTRACT(EPOCH FROM ($2 - $1))");

  /**
   * A direct metric over one dataset: its expression aggregates the dataset's rows
   * for the period, which the query layer selects (snapshot rows on the period end,
   * event and fact rows dated in the period).
   */
  async function direct(id: string): Promise<number | null> {
    const c = coverage[id];
    if (c?.kind !== "direct") throw new Error(`${id} is ${c?.kind}, not direct`);
    const e = expr(c.ossieName)!;
    const datasets = [...new Set([...e.matchAll(/\b([a-z_][a-z0-9_]*)\.[a-z_][a-z0-9_]*\b/g)].map((m) => m[1]))];
    expect(datasets, id).toHaveLength(1);
    const ds = gaspDatasets[datasets[0]];
    // A timestamp time dimension covers the whole last day, as the compiled templates do.
    const ts = ontology.fields!.find((f) => f.id === ds.date)?.type === "timestamp";
    const upper = ts ? `"${ds.date}" < DATE '${end}' + 1` : `"${ds.date}" <= DATE '${end}'`;
    const where = ds.kind === "snapshot" ? `"${ds.date}" = DATE '${end}'` : `"${ds.date}" >= DATE '${start}' AND ${upper}`;
    return scalar(db, `SELECT ${toPostgres(e)} FROM (SELECT * FROM gasp."${datasets[0]}" WHERE ${where}) AS ${datasets[0]}`);
  }

  /** A staged metric: its expression over its staged dataset's rows for the June period of the spine. */
  async function staged(id: string): Promise<number | null> {
    const c = coverage[id];
    if (c?.kind !== "staged") throw new Error(`${id} is ${c?.kind}, not staged`);
    const source = byName.get(c.stagedDataset)!.source;
    return scalar(db, `SELECT ${stagedValueQuery(expr(c.ossieName)!, c.stagedDataset, source, { start, end })}`);
  }

  for (const id of ["mrr", "arr", "license_utilization", "realization_rate", "mttr"]) {
    it(`direct: ${id}`, async () => {
      const expected = await runTemplate(db, data, id, start, end);
      expect(expected, id).not.toBeNull();
      expect(await direct(id)).toBeCloseTo(expected!, 9);
    });
  }

  // Win Rate and Project Margin filter a snapshot by a date in the period, so the exporter stages them.
  for (const id of ["nrr", "grr", "logo_churn_rate", "dau_mau", "win_rate", "project_margin"]) {
    it(`staged: ${id}`, async () => {
      const expected = await runTemplate(db, data, id, start, end);
      expect(expected, id).not.toBeNull();
      expect(await staged(id)).toBeCloseTo(expected!, 9);
    });
  }
});

describe("Ossie model: the cohort table gives the values the per-period sources gave", () => {
  // Each served entry summed over the table's rows for a period, beside the same
  // entry staged the general way (one row per period holding the value): months,
  // quarters, the half year and a month before the first snapshot, whose cohort is empty.
  const periods: Array<[string, string]> = [
    ["2025-03-01", "2025-03-31"],
    ["2026-01-01", "2026-01-31"], ["2026-02-01", "2026-02-28"], ["2026-03-01", "2026-03-31"],
    ["2026-04-01", "2026-04-30"], ["2026-05-01", "2026-05-31"], ["2026-06-01", "2026-06-30"],
    ["2026-01-01", "2026-03-31"], ["2026-04-01", "2026-06-30"], ["2026-01-01", "2026-06-30"],
  ];
  const cctx: CompileContext = { fields: Object.fromEntries(ontology.fields!.map((f) => [f.id, f])), datasets: gaspDatasets, formulas: data.formulas! };
  const key = ([s, e]: [string, string]) => `${s} ${e}`;
  let db: PGlite;
  beforeAll(async () => {
    db = await fixtureDb();
    // Two customers change segment part way through, so a period that spans the change tells the
    // segment a customer held on its first day from the segment their later rows carry.
    await moveSegment(db, "c07", "2026-05-01", "enterprise");
    await moveSegment(db, "c14", "2026-06-01", "enterprise");
    await addOssieViews(db);
    await db.exec(`CREATE TABLE gasp.period_spine (period_start DATE, period_end DATE); INSERT INTO gasp.period_spine VALUES ${periods.map(([s, e]) => `('${s}', '${e}')`).join(", ")}`);
    await db.exec(`CREATE VIEW ${ACCOUNT_COHORTS.name} AS ${byName.get(ACCOUNT_COHORTS.name)!.source}`);
  }, 120_000);
  afterAll(async () => { await db?.close(); });

  it("holds one row per customer per period and none for an empty cohort", async () => {
    const rows = (await db.query<{ s: string; e: string; n: number; d: number }>(
      `SELECT CAST(period_start AS TEXT) s, CAST(period_end AS TEXT) e, CAST(COUNT(*) AS INT) n, CAST(COUNT(DISTINCT ${ACCOUNT_COHORTS.cohort.key}) AS INT) d FROM ${ACCOUNT_COHORTS.name} GROUP BY 1, 2`)).rows;
    expect(rows.map((r) => key([r.s, r.e])).sort()).toEqual(periods.slice(1).map(key).sort());
    for (const r of rows) {
      expect(r.n, key([r.s, r.e])).toBe(r.d);
      expect(r.n).toBeGreaterThan(0);
    }
  });

  for (const [entry, c] of Object.entries(coverage)) {
    if (c.kind !== "staged" || !c.cohortTable) continue;
    it(`${entry} in every period`, async () => {
      const [id, variant] = entry.split(":");
      // A breakdown is read per group: the table grouped by its dimension beside the general source's row per group.
      const dim = ext(metricByName.get(c.ossieName)!).gasp_breakdown as string | undefined;
      const groups = dim ? (await db.query<{ g: string }>(`SELECT DISTINCT ${dim} AS g FROM gasp.customer WHERE ${dim} IS NOT NULL`)).rows.map((r) => r.g).sort() : [""];
      if (dim) expect(groups.length).toBeGreaterThan(1);
      const cell = (p: [string, string], g: string) => `${key(p)} ${g}`.trim();
      const read = async (sql: string) => new Map((await db.query<{ s: string; e: string; g: string; value: unknown }>(sql)).rows.map((r) => [cell([r.s, r.e], r.g), r.value === null ? null : Number(r.value)]));
      const g = dim ?? "''";
      const table = await read(`SELECT CAST(period_start AS TEXT) s, CAST(period_end AS TEXT) e, ${g} AS g, ${expr(c.ossieName)} AS value FROM ${ACCOUNT_COHORTS.name} GROUP BY 1, 2, 3`);
      const general = await read(`SELECT CAST(period_start AS TEXT) s, CAST(period_end AS TEXT) e, ${g} AS g, value FROM (${stagedSource(compileMetric(id, cctx, variant).sql)}) q`);
      expect([...general.keys()].sort()).toEqual(periods.flatMap((p) => groups.map((x) => cell(p, x))).sort());
      let values = 0;
      for (const p of periods) for (const x of groups) {
        const want = general.get(cell(p, x))!;
        // No row for the period and group sums to NULL, as a ratio over an empty cohort is.
        const got = table.get(cell(p, x)) ?? null;
        if (want === null) expect(got, cell(p, x)).toBeNull();
        else { expect(got, cell(p, x)).toBeCloseTo(want, 12); values++; }
      }
      for (const x of groups) expect(general.get(cell(periods[0], x))).toBeNull();
      // Every period after the first has a value, and with a breakdown one for more than one group.
      if (dim) expect(values).toBeGreaterThan(periods.length - 1);
      else expect(values).toBe(periods.length - 1);
    });
  }
});

describe("Ossie model: upstream validator", () => {
  const dir = mkdtempSync(join(tmpdir(), "gasp-ossie-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.skipIf(!uvAvailable())("passes validation/validate.py", async () => {
    const file = join(dir, "gasp.semantic_model.yaml");
    writeFileSync(file, stringify(model, { lineWidth: 0 }));
    const r = await validateUpstream(file, "model");
    expect(r.ok, r.output).toBe(true);
  }, 120_000);
});
