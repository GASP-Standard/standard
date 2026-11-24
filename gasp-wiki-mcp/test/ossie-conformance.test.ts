import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parse } from "yaml";
import { PGlite } from "@electric-sql/pglite";
import { buildConformance, readConformance, CONFORMANCE_DIR } from "../scripts/ossie-conformance.js";
import { CONFORMANCE_CASES, type ConformanceManifest } from "../src/ossie/conformance.js";
import { SNAPSHOT_CASE_COUNT } from "../src/ossie/conformance-snapshot.js";
import { STAGED_REASONS } from "../src/ossie/metrics.js";
import { modelMetrics } from "../src/ossie/scope.js";
import { validateUpstream, uvAvailable } from "../src/ossie/validate.js";

// The conformance set (standard/exports/ossie/conformance) is derived from the
// formulas, the export and the fixture. Building it runs every case on PGlite
// and verifies the data slices, so "current" also means "every expected value
// still comes out of the staged sources". The snapshot cases and the readings
// (the values a named mistake or alternative reading returns) are checked
// again here from the published files alone.

describe("Ossie conformance set", async () => {
  const files = await buildConformance();
  const current = readConformance();

  it("covers every staged reason the export uses, once each", () => {
    // "period bound" (a bound outside a filter) is never the first reason reported, so no entry is staged for it.
    expect([...CONFORMANCE_CASES.map((c) => c.reason)].sort()).toEqual([...STAGED_REASONS].filter((r) => r !== "period bound").sort());
  });

  it("is current on disk (run npm run conformance)", () => {
    expect(Object.keys(current).sort()).toEqual(Object.keys(files).sort());
    for (const k of Object.keys(files)) expect(current[k], k).toBe(files[k]);
  });

  it("every case names its datasets, columns and at least one expected row", () => {
    const m = JSON.parse(files["manifest.json"]);
    expect(m.cases).toHaveLength(CONFORMANCE_CASES.length + SNAPSHOT_CASE_COUNT);
    for (const c of m.cases) {
      expect(c.datasets.length, c.id).toBeGreaterThan(0);
      for (const ds of c.datasets) expect(files[`data/${ds}.sql`], `${c.id} reads ${ds}`).toBeTruthy();
      expect(c.expected.length, c.id).toBeGreaterThan(0);
      for (const row of c.expected) expect(Object.keys(row), c.id).toEqual(c.columns);
      const model = parse(files[`cases/${c.id}/model.ossie.yaml`]);
      // A staged case declares its staged dataset after the ones it reads; a direct case declares those alone.
      expect(model.datasets.map((d: { name: string }) => d.name), c.id).toEqual(c.kind === "staged" ? [...c.datasets, model.datasets.at(-1).name] : c.datasets);
      expect(modelMetrics(model).map((x) => x.name), c.id).toEqual([c.metric]);
      // Each case's metric reads one dataset, so the model declares it there with single-part names.
      expect(model.metrics, c.id).toBeUndefined();
      expect(files[`cases/${c.id}/expected.sql`], c.id).toContain(`AS expected (${c.columns.join(", ")})`);
    }
  });

  const m: ConformanceManifest = JSON.parse(files["manifest.json"]);
  const byId = (part: string) => m.cases.find((c) => c.id.includes(part))!;
  const reading = (part: string, name: string) => byId(part).readings?.find((r) => r.name === name);

  it("the snapshot cases give the closing value and name the wrong ones", () => {
    const snapshot = m.cases.filter((c) => c.group === "snapshot");
    expect(snapshot).toHaveLength(SNAPSHOT_CASE_COUNT);
    for (const c of snapshot.filter((x) => x.kind === "direct")) expect(c.formula, c.id).toMatch(/ at period_end$/);
    // June MRR: the last date, every date, the first date.
    expect(byId("snapshot_mrr_month").expected).toEqual([{ value: 24200 }]);
    expect(reading("snapshot_mrr_month", "summed_over_every_date")).toMatchObject({ grade: "wrong", value: 695900 });
    expect(reading("snapshot_mrr_month", "opening_value")).toMatchObject({ grade: "wrong", value: 21800 });
    // The second quarter closes on June's value; its three month ends add up to another number.
    expect(byId("snapshot_mrr_quarter").expected).toEqual([{ value: 24200 }]);
    expect(reading("snapshot_mrr_quarter", "month_ends_summed")).toMatchObject({ grade: "wrong", value: 64800 });
    // Customers: 18 at the close, 19 active at some point in June, 525 active rows.
    expect(byId("snapshot_total_customers").expected).toEqual([{ value: 18 }]);
    expect(reading("snapshot_total_customers", "distinct_over_every_date")).toMatchObject({ grade: "wrong", value: 19 });
    expect(reading("snapshot_total_customers", "rows_over_every_date")).toMatchObject({ grade: "wrong", value: 525 });
  });

  it("the opening case separates the first day of the period from the prior close", () => {
    const c = byId("logo_churn_rate_four_weeks");
    expect(c.period).toEqual({ start: "2026-02-09", end: "2026-03-08" });
    expect(c.expected[0].value).toBeCloseTo(1 / 14, 12);
    expect(c.readings).toHaveLength(1);
    expect(c.readings![0]).toMatchObject({ grade: "alternative", name: "prior_period_close" });
    expect(c.readings![0].value).toBeCloseTo(1 / 13, 12);
    expect(files["data/period_spine.sql"]).toContain("(DATE '2026-02-09', DATE '2026-03-08')");
    // On the full window the two opening readings agree, so the staged case lists the closing value alone.
    expect(byId("c03_").readings!.map((r) => r.name)).toEqual(["closing_value"]);
    expect(byId("c05_").readings!.map((r) => r.name)).toEqual(["period_on_snapshot_date_only"]);
  });

  it("every reading has a grade, a description and a value of its own", () => {
    for (const c of m.cases) {
      expect(Boolean(files[`cases/${c.id}/readings.sql`]), c.id).toBe(Boolean(c.readings?.length));
      if (!c.readings) continue;
      expect(c.columns, c.id).toEqual(["value"]);
      const values = [Number(c.expected[0].value), ...c.readings.map((r) => r.value)];
      expect(new Set(values).size, c.id).toBe(values.length);
      for (const r of c.readings) {
        expect(["wrong", "alternative"], `${c.id} ${r.name}`).toContain(r.grade);
        expect(r.description.length, `${c.id} ${r.name}`).toBeGreaterThan(20);
        expect(r.value, `${c.id} ${r.name}`).not.toBeNull();
        expect(files[`cases/${c.id}/readings.sql`], `${c.id} ${r.name}`).toContain(`SELECT '${r.grade}' AS grade, '${r.name}' AS reading`);
      }
    }
    expect(Object.keys(m.grading)).toEqual(["right", "alternative", "wrong", "failed"]);
  });

  it("the published files alone give every expected row and reading value", async () => {
    const db = new PGlite();
    await db.exec(files["data/period_spine.sql"]);
    for (const k of Object.keys(files).filter((x) => x.startsWith("data/") && x !== "data/period_spine.sql").sort()) await db.exec(files[k]);
    const number = (v: unknown) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
    for (const c of m.cases) {
      const got = (await db.query<Record<string, unknown>>(files[`cases/${c.id}/reference.postgres.sql`])).rows;
      expect(got.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, number(v)]))), c.id).toEqual(c.expected);
      if (!c.readings) continue;
      const rows = (await db.query<{ grade: string; reading: string; value: unknown }>(files[`cases/${c.id}/readings.sql`])).rows;
      const want = [...c.readings].sort((a, b) => a.name.localeCompare(b.name));
      expect(rows.map((r) => [r.grade, r.reading]), c.id).toEqual(want.map((r) => [r.grade, r.name]));
      rows.forEach((r, i) => expect(Number(r.value), `${c.id} ${r.reading}`).toBeCloseTo(want[i].value!, 9));
    }
    await db.close();
  }, 120_000);

  it.skipIf(!uvAvailable())("every case model passes the upstream validator", async () => {
    const models = Object.keys(files).filter((k) => /^cases\/[^/]+\/model\.ossie\.yaml$/.test(k)).sort();
    expect(models).toHaveLength(CONFORMANCE_CASES.length + SNAPSHOT_CASE_COUNT);
    for (const id of models) {
      const r = await validateUpstream(join(CONFORMANCE_DIR, id), "model");
      expect(r.ok, `${id}\n${r.output}`).toBe(true);
    }
  }, 240_000);
});
