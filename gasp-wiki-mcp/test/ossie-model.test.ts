import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateUpstream, uvAvailable } from "../src/ossie/validate.js";
import { stringify } from "yaml";
import { PGlite } from "@electric-sql/pglite";
import { loadStandard } from "../src/loader.js";
import { exportModel, stagedDatasetName } from "../src/ossie/model.js";
import { emitMetric } from "../src/ossie/metrics.js";
import type { MetricFormula } from "../src/types.js";
import { metricName } from "../src/ossie/names.js";
import { OSSIE_DIALECT, GASP_VENDOR, type OssieDataset } from "../src/ossie/types.js";

// The Ossie semantic model exporter: every GASP dataset, field and formula
// expression lands in the model, direct metrics are plain OSSIE_SQL_2026
// aggregates, and staged metrics carry a per-period dataset whose source runs.

const data = loadStandard();
const { model, coverage } = exportModel(data);
const ontology = data.ontology!;
const gaspDatasets = ontology.datasets!;
const byName = new Map(model.datasets.map((d) => [d.name, d]));
const metricByName = new Map((model.metrics ?? []).map((m) => [m.name, m]));
const expr = (name: string) => metricByName.get(name)?.expression.dialects[0].expression;
const ext = (d: { custom_extensions?: Array<{ vendor_name: string; data: string }> }) =>
  JSON.parse(d.custom_extensions!.find((e) => e.vendor_name === GASP_VENDOR)!.data);

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

  it("has every field on every dataset it belongs to, typed, with enum values", () => {
    for (const f of ontology.fields!) {
      for (const ds of f.datasets ?? []) {
        const field = byName.get(ds)!.fields!.find((x) => x.name === f.id);
        expect(field, `${f.id}@${ds}`).toBeDefined();
        expect(field!.expression.dialects).toEqual([{ dialect: OSSIE_DIALECT, expression: f.id }]);
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
    expect(model.metrics!.length).toBe(emitted);
    expect(new Set(model.metrics!.map((m) => m.name)).size).toBe(model.metrics!.length);
  });

  it("every main formula marked notComputable is reported, and no metric is emitted for it", () => {
    for (const [id, f] of Object.entries(data.formulas!)) {
      if (f.notComputable) expect(coverage[id]).toEqual({ kind: "notComputable", reason: f.notComputable });
    }
  });

  it("no metric expression contains SELECT, WHERE or a placeholder", () => {
    for (const m of model.metrics!) {
      const e = m.expression.dialects[0].expression;
      expect(m.expression.dialects[0].dialect).toBe(OSSIE_DIALECT);
      expect(e, m.name).not.toMatch(/\bSELECT\b/i);
      expect(e, m.name).not.toMatch(/\bWHERE\b/i);
      expect(e, m.name).not.toMatch(/\bFROM\b/i);
      expect(e, m.name).not.toContain("{{");
      expect(e, m.name).not.toMatch(/\bPERIOD_(START|END|DAYS)\b/);
    }
  });

  it("metrics read only datasets in the model, by fields those datasets have; direct metrics never read a staged dataset", () => {
    const kind = new Map(Object.values(coverage).flatMap((c) => (c.kind === "notComputable" ? [] : [[c.ossieName, c.kind] as const])));
    for (const m of model.metrics!) {
      for (const [, ds, field] of m.expression.dialects[0].expression.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g)) {
        expect(byName.has(ds), `${m.name}: ${ds}`).toBe(true);
        expect(byName.get(ds)!.fields!.some((f) => f.name === field), `${m.name}: ${ds}.${field}`).toBe(true);
        expect(ds.startsWith("gasp_staged_"), m.name).toBe(kind.get(m.name) === "staged");
      }
    }
  });

  it("every staged metric has its staged dataset and every staged dataset belongs to a staged metric", () => {
    const stagedCoverage = Object.values(coverage).filter((c) => c.kind === "staged") as Array<Extract<typeof coverage[string], { kind: "staged" }>>;
    const stagedDatasets = model.datasets.filter((d) => d.name.startsWith("gasp_staged_"));
    expect(stagedDatasets.map((d) => d.name).sort()).toEqual(stagedCoverage.map((c) => c.stagedDataset).sort());
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
      expect(ext(ds)).toEqual({ staged: true, for: c.ossieName, reason: c.reason });
      expect(ext(metricByName.get(c.ossieName)!).staged).toBe(true);
    }
  });

  it("every metric carries a description, datatype, canonical link and its GASP extension", () => {
    for (const m of model.metrics!) {
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
    expect(expr("gasp_expansion_mrr")).toBe("SUM(CASE WHEN revenue_event.event_type = 'expansion' THEN revenue_event.mrr_change ELSE 0 END)");
    for (const k of ["nrr", "nrr:O", "nrr:M"]) expect(coverage[k]).toMatchObject({ kind: "staged", reason: "cohort" });
    expect(expr("gasp_nrr_o")).toBe("SUM(gasp_staged_gasp_nrr_o.value)");
    // MRR reads the subscription snapshot; the query layer selects the period-end snapshot date.
    expect(coverage.mrr.kind).toBe("direct");
    expect(expr("gasp_mrr")).toBe("SUM(CASE WHEN subscription.subscription_status = 'active' THEN subscription.mrr ELSE 0 END)");
    expect((metricByName.get("gasp_mrr")!.ai_context as any).instructions).toMatch(/select one snapshot date/);
    // Win rate filters the opportunity snapshot by close_date in the period: a period bound the metric cannot see.
    expect(coverage.win_rate).toMatchObject({ kind: "staged", reason: "period bound in filter" });
    expect(coverage.cac.kind).toBe("direct");
    expect(expr("gasp_cac")).toBe(
      "(CAST(SUM(CASE WHEN cost_event.cost_function = 'gtm' THEN cost_event.cost ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(DISTINCT CASE WHEN revenue_event.event_type = 'new' THEN revenue_event.customer_id END), 0))",
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
        kind: "direct", expression: "SUM(CASE WHEN revenue_event.event_type = 'expansion' THEN revenue_event.mrr_change ELSE 0 END)",
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
        kind: "direct", expression: "PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY CASE WHEN subscription.subscription_status = 'active' THEN subscription.mrr END)",
      });
      expect(emit("median(field.mrr)")).toMatchObject({ kind: "direct", expression: "MEDIAN(subscription.mrr)" });
      expect(emit("max(sum(field.mrr_change), 0) / 2")).toMatchObject({ kind: "direct", expression: "(CAST(GREATEST(SUM(revenue_event.mrr_change), 0) AS DECIMAL) / 2)" });
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
    const m = direct.model.metrics!.find((x) => x.name === "gasp_ticket_volume")!;
    expect(m.expression.dialects[0].expression).toBe("COUNT(DISTINCT ticket.ticket_id)");
    expect(ext(m).gasp_breakdown).toBe("ticket_type");
    expect((m.ai_context as any).instructions).toMatch(/Broken down by ticket_type/);
    // A named breakdown is its own metric, like a variant, with the variant name and gasp_breakdown.
    const named = withEntry("ticket_volume", { formula: "count_distinct(field.ticket_id)", unit: "count", breakdowns: { by_type: "field.ticket_type" } });
    expect(named.coverage.ticket_volume.kind).toBe("direct");
    expect(named.coverage["ticket_volume:by_type"].kind).toBe("direct");
    const nm = named.model.metrics!.find((x) => x.name === "gasp_ticket_volume_by_type")!;
    expect(nm.expression.dialects[0].expression).toBe("COUNT(DISTINCT ticket.ticket_id)");
    expect(ext(nm)).toMatchObject({ gasp_id: "ticket_volume", variant: "by_type", gasp_breakdown: "ticket_type" });
    expect(ext(named.model.metrics!.find((x) => x.name === "gasp_ticket_volume")!).gasp_breakdown).toBeUndefined();
    // A staged main formula stages the named breakdown too, one row per period and value.
    const namedStaged = withEntry("ticket_volume", { formula: "count_distinct(field.ticket_id) to_date", unit: "count", breakdowns: { by_type: "field.ticket_type" } });
    expect(namedStaged.coverage["ticket_volume:by_type"]).toMatchObject({ kind: "staged", reason: "to_date" });
    expect(namedStaged.model.datasets.find((d) => d.name === "gasp_staged_gasp_ticket_volume_by_type")!.primary_key).toEqual(["period_start", "ticket_type"]);
    expect(namedStaged.model.datasets.find((d) => d.name === "gasp_staged_gasp_ticket_volume")!.primary_key).toEqual(["period_start"]);
    // Ticket Distribution by Type uses total(): staged, one row per period and ticket type.
    expect(coverage.ticket_distribution_by_type).toMatchObject({ kind: "staged", reason: "total" });
    const ds = byName.get("gasp_staged_gasp_ticket_distribution_by_type")!;
    expect(ds.primary_key).toEqual(["period_start", "ticket_type"]);
    expect(ext(metricByName.get("gasp_ticket_distribution_by_type")!).gasp_breakdown).toBe("ticket_type");
    // Breadth of Adoption counts distinct (account, feature) pairs.
    expect(coverage.breadth_of_adoption).toMatchObject({ kind: "staged", reason: "distinct pair" });
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
    for (const ds of model.datasets.filter((d): d is OssieDataset => d.name.startsWith("gasp_staged_"))) {
      try {
        const res = await db.query(ds.source);
        // A breakdown on an enum field has one row per period and declared value.
        const bf = ds.primary_key!.find((k) => k !== "period_start");
        const expected = bf ? 2 * values.get(bf)! : 2;
        if (res.rows.length !== expected) failures.push(`${ds.name}: ${res.rows.length} rows, expected ${expected}`);
      } catch (e) {
        failures.push(`${ds.name}: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);
});

describe("Ossie model: upstream validator", () => {
  const hasUv = uvAvailable();
  const dir = mkdtempSync(join(tmpdir(), "gasp-ossie-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.skipIf(!hasUv)("passes validation/validate.py", async () => {
    const file = join(dir, "gasp.semantic_model.yaml");
    writeFileSync(file, stringify(model, { lineWidth: 0 }));
    const r = await validateUpstream(file, "model");
    expect(r.ok, r.output).toBe(true);
  }, 120_000);

  it.runIf(!hasUv)("skips the upstream validator", () => {
    console.log("Skipping the Ossie validator: uv is not on PATH");
  });
});
