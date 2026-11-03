import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { loadStandard } from "../src/loader.js";
import { fillTemplate } from "../src/tools.js";
import { DIALECT, DIALECTS } from "../src/dialect.js";
import { checkReport, checksAsOneQuery, compileChecks, generateChecksFromText, parseResults, planFixes, planFixesFromText, readinessChecks, type CheckResult } from "../src/checks.js";
import { DERIVED_FIELDS, revenueEventDerivation } from "../src/cel.js";
import { END } from "../src/synthetic.js";
import { adapter, fixtureDb, scalar } from "./fixture-db.js";

// The readiness checks (docs/ossie-interop-spec.md, level 3) run on the synthetic
// dataset, which must pass them all; on a copy with planted violations, which must
// fail the right ones by the right counts; and on the events derive_cel writes, which
// fail only the expansion tag the ledger cannot fill.

const data = loadStandard();
let db: PGlite;
beforeAll(async () => { db = await fixtureDb(); }, 120_000);
afterAll(async () => { await db?.close(); });

const FRESH = { asOf: END, window: 30 };
const compiled = () => compileChecks(adapter, data, "postgres", FRESH);

/** Run every runnable check and return check id -> violations. */
async function run(a = adapter, opts = FRESH): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const c of compileChecks(a, data, "postgres", opts)) if (c.sql) out[c.check.id] = (await scalar(db, c.sql))!;
  return out;
}

/** The fixture adapter with another table behind one dataset: its dataset entry and its column mappings move to it. */
function adapterOver(dataset: string, table: string) {
  const from = `${adapter.datasets[dataset]}.`;
  return { ...adapter, datasets: { ...adapter.datasets, [dataset]: table }, mappings: adapter.mappings.map((m: { warehouseRef: string; dataset?: string; gaspField: string }) => (m.warehouseRef.startsWith(from) ? { ...m, warehouseRef: `${table}.${m.warehouseRef.slice(from.length)}` } : m)) };
}

describe("readiness checks", () => {
  it("come from the ontology: the event datasets, the tag fields and every dated dataset", () => {
    const ids = readinessChecks(data).map((c) => c.id);
    expect(ids).toContain("revenue_event_identity");
    expect(ids).toContain("mrr_continuity");
    expect(ids.filter((i) => i.startsWith("unique_event_id:"))).toHaveLength(6);
    expect(ids).toEqual(expect.arrayContaining(["lifecycle_tag:revenue_event", "lifecycle_tag:cost_event", "lifecycle_tag:amendment_event", "expansion_tag:revenue_event", "expansion_tag:amendment_event", "cost_function_tag", "customer_identity:events", "customer_identity:customers"]));
    expect(ids.filter((i) => i.startsWith("freshness:")).length).toBe(Object.values(data.ontology!.datasets!).filter((d) => d.date).length);
    for (const c of readinessChecks(data)) expect(c.placeholders.every((p) => c.datasets.includes(p.split("@")[1])), c.id).toBe(true);
  });

  it("the synthetic dataset passes every runnable check", async () => {
    const results = await run();
    expect(Object.keys(results).length).toBeGreaterThan(20);
    const failing = Object.entries(results).filter(([, v]) => v !== 0);
    expect(failing, failing.map(([k, v]) => `${k}=${v}`).join(", ")).toEqual([]);
  });

  it("runs as one statement whose rows read back as results and give a clean report", async () => {
    const rows = (await db.query<CheckResult>(checksAsOneQuery(compiled()))).rows;
    expect(rows.length).toBe(compiled().filter((c) => c.sql).length);
    const report = generateChecksFromText(JSON.stringify(adapter), undefined, data, { ...FRESH, results: JSON.stringify(rows) });
    expect(report).toMatch(/\d+ pass, 0 fail/);
    expect(report).toContain("0 have a failing check");
    expect(report).not.toContain("## Run this");
    const withSql = generateChecksFromText(JSON.stringify(adapter), undefined, data, FRESH);
    expect(withSql).toContain("## Run this");
    expect(withSql).toContain("UNION ALL");
    expect(withSql).not.toContain("{{");
  });

  it("measures freshness as days beyond the window from as_of", async () => {
    const stale = await run(adapter, { asOf: "2026-12-31", window: 2 });
    for (const [id, v] of Object.entries(stale)) if (id.startsWith("freshness:")) expect(v, id).toBeGreaterThan(0);
    const exact = await run(adapter, { asOf: END, window: 0 });
    const latest = await scalar(db, "SELECT MAX(booked_on) - DATE '2026-06-30' FROM gasp_revenue_events");
    expect(exact["freshness:revenue_event"]).toBe(-latest!);
    expect(generateChecksFromText(JSON.stringify(adapter), undefined, data, { asOf: "yesterday" })).toContain("as_of must be a date");
  });

  it("fails the right checks by the right counts on planted violations", async () => {
    await db.exec(`CREATE TABLE bad_revenue AS SELECT * FROM gasp_revenue_events`);
    await db.exec(`UPDATE bad_revenue SET new_mrr = new_mrr + 1 WHERE event_id = 're01'`);
    await db.exec(`INSERT INTO bad_revenue SELECT * FROM gasp_revenue_events WHERE event_id IN ('re02', 're03')`);
    await db.exec(`UPDATE bad_revenue SET lifecycle_attribution = NULL WHERE event_id IN ('re04', 're05', 're06')`);
    await db.exec(`UPDATE bad_revenue SET expansion_classification = 'other' WHERE event_id = 're02' AND event_type = 'expansion'`);
    await db.exec(`UPDATE bad_revenue SET account_ref = 'ghost' WHERE event_id = 're07'`);
    const r = await run(adapterOver("revenue_event", "bad_revenue"));
    expect(r["revenue_event_identity"]).toBe(1);
    expect(r["unique_event_id:revenue_event"]).toBe(2);
    expect(r["lifecycle_tag:revenue_event"]).toBe(3);
    expect(r["expansion_tag:revenue_event"]).toBe(2); // the planted row and its duplicate
    expect(r["customer_identity:events"]).toBe(1);
    expect(r["customer_identity:customers"]).toBe(0);
    expect(r["mrr_continuity"]).toBe(0);
  });

  it("the derived revenue events fail only the expansion tag the ledger cannot fill", async () => {
    const sql = fillTemplate(revenueEventDerivation({ dialect: "postgres", currency: "USD" }), adapter, data).sql;
    await db.exec(`CREATE TABLE derived_events AS ${sql}`);
    const a = {
      warehouse: "postgres",
      datasets: { revenue_event: "derived_events", customer: adapter.datasets.customer },
      mappings: [
        ...DERIVED_FIELDS.map((f) => ({ gaspField: f, dataset: "revenue_event", warehouseRef: `derived_events.${f}` })),
        ...adapter.mappings.filter((m: { warehouseRef: string }) => m.warehouseRef.startsWith(`${adapter.datasets.customer}.`)),
      ],
    };
    const r = await run(a as typeof adapter);
    const tagged = await scalar(db, "SELECT COUNT(*) FROM derived_events WHERE event_type IN ('expansion', 'contraction', 'reactivation')");
    expect(tagged).toBeGreaterThan(5);
    expect(r["expansion_tag:revenue_event"]).toBe(tagged);
    for (const [id, v] of Object.entries(r)) if (id !== "expansion_tag:revenue_event" && !id.startsWith("freshness:")) expect(v, id).toBe(0);
  });

  it("names the metrics a check protects, through the O and M forms too", () => {
    const byId = new Map(compiled().map((c) => [c.check.id, c]));
    const names = (id: string) => byId.get(id)!.protects.map((p) => p.metric);
    expect(names("expansion_tag:revenue_event")).toEqual(expect.arrayContaining(["ARR (Annual Recurring Revenue)", "Net Revenue Retention (NRR)"]));
    expect(names("revenue_event_identity")).toEqual(expect.arrayContaining(["New MRR", "Net Revenue Retention (NRR)", "Churned MRR"]));
    expect(names("cost_function_tag")).toEqual(expect.arrayContaining(["CAC (Customer Acquisition Cost)"]));
    expect(names("revenue_event_identity").length).toBeGreaterThan(names("expansion_tag:revenue_event").length);
    const report = checkReport(compiled(), "postgres", [{ check_id: "revenue_event_identity", violations: 3 }, { check_id: "nope", violations: 1 }]);
    expect(report.metrics.filter((m) => m.status === "fail").map((m) => m.metric)).toEqual(expect.arrayContaining(["New MRR", "Net Revenue Retention (NRR)"]));
    expect(report.metrics[0].department).toBe("Core");
    expect(report.unknownResults).toEqual(["nope"]);
  });

  it("lists a check the mapping cannot run with what it needs, and compiles in every dialect", () => {
    const acme = readFileSync(join(import.meta.dirname, "fixture", "acme-adapter.json"), "utf8");
    const report = generateChecksFromText(acme, undefined, data, FRESH);
    expect(report).toContain("snowflake (from the adapter's warehouse");
    expect(report).toMatch(/`cost_function_tag` \| cannot run \(needs cost_function@cost_event, table for cost_event\)/);
    for (const dialect of DIALECTS) {
      for (const c of readinessChecks(data, FRESH)) for (const token of DIALECT[dialect].forbidden) expect(c.sql(dialect), `${dialect} ${c.id}: ${token}`).not.toContain(token);
    }
    expect(readinessChecks(data, FRESH).find((c) => c.id === "freshness:revenue_event")!.sql("bigquery")).toContain("DATE_DIFF(DATE '2026-06-30'");
  });

  it("reads results as JSON objects, pairs, a keyed object or CSV, and rejects junk", () => {
    expect(parseResults('[{"check_id":"a","violations":1}]').results).toEqual([{ check_id: "a", violations: 1 }]);
    expect(parseResults('[["a", 2]]').results).toEqual([{ check_id: "a", violations: 2 }]);
    expect(parseResults('{"a": 3}').results).toEqual([{ check_id: "a", violations: 3 }]);
    expect(parseResults('CHECK_ID,VIOLATIONS\n"a",4\nb\t5').results).toEqual([{ check_id: "a", violations: 4 }, { check_id: "b", violations: 5 }]);
    expect(parseResults("[1, 2]").error).toContain("Cannot read a result row");
    expect(parseResults("a,many").error).toContain("Cannot read a result row");
    expect(parseResults("").error).toContain("Pass results");
  });
});

describe("plan_fixes", () => {
  it("has nothing to fix when the mapping is complete and every check passes", async () => {
    const rows = (await db.query<CheckResult>(checksAsOneQuery(compiled()))).rows;
    expect(planFixes(adapter, data, "postgres", rows, FRESH)).toEqual([]);
    expect(planFixesFromText(JSON.stringify(adapter), undefined, data, { ...FRESH, results: JSON.stringify(rows) })).toContain("Nothing to fix");
  });

  it("ranks a mapping gap and a failing check by the Core metrics each unlocks, with effort shown", () => {
    const gapped = { ...adapter, mappings: adapter.mappings.filter((m: { gaspField: string }) => m.gaspField !== "mrr_change") };
    const fixes = planFixes(gapped, data, "postgres", [{ check_id: "unique_event_id:cost_event", violations: 4 }], FRESH);
    const map = fixes.find((f) => f.what === "mrr_change@revenue_event")!;
    const check = fixes.find((f) => f.what === "unique_event_id:cost_event")!;
    expect(map.kind).toBe("map");
    expect(map.effort).toBe("small");
    expect(map.unlocks.map((u) => u.metric)).toEqual(expect.arrayContaining(["New MRR", "Expansion MRR", "Churned MRR"]));
    expect(map.core).toBeGreaterThan(0);
    expect(check.kind).toBe("check");
    expect(check.effort).toBe("medium");
    expect(check.unlocks.map((u) => u.metric)).toContain("CAC (Customer Acquisition Cost)");
    // Ordered by Core unlocks, then all unlocks.
    for (let i = 1; i < fixes.length; i++) expect(fixes[i - 1].core >= fixes[i].core, `${fixes[i - 1].what} before ${fixes[i].what}`).toBe(true);
    // A metric with a second blocker (another unmapped field or a failing check) is helped, not unlocked.
    expect(map.alsoHelps).toBeGreaterThan(0);
    expect(map.unlocks.length + map.alsoHelps).toBe(data.dataRequirements.filter((dr) => dr.placeholders.includes("mrr_change@revenue_event")).length);
    const report = planFixesFromText(JSON.stringify(gapped), undefined, data, { ...FRESH, results: JSON.stringify([{ check_id: "unique_event_id:cost_event", violations: 4 }]) });
    expect(report).toContain("| 1 | map `mrr_change@");
    expect(report).toContain("clear `unique_event_id:cost_event`: clear 4 violations");
    expect(planFixesFromText(JSON.stringify(gapped), undefined, data, {})).toContain("No check results given");
  });
});
