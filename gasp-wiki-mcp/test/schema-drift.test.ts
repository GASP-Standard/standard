/**
 * Schema drift: a schema snapshot compared with a mapping, and the scheduled
 * re-check bundle that writes the snapshot query. The fixture's own tables on
 * PGlite give a snapshot with nothing broken; a dropped column breaks the pairs
 * that read it and names the metrics that lose coverage; a retyped column is
 * named with the pairs that read it.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateChecksFromText } from "../src/checks.js";
import { loadStandard } from "../src/loader.js";
import { readinessFromText } from "../src/readiness.js";
import { columnsRead, mappedExpression, mappedTables, schemaColumns, schemaDrift, schemaSnapshotSql } from "../src/schema-drift.js";
import type { SchemaColumn } from "../src/ossie/profile.js";
import type { Adapter } from "../src/tools.js";
import { adapter as fixtureAdapter, fixtureDb } from "./fixture-db.js";
import { acmeAdapter, acmeAdapterText, acmeDdl } from "./ossie-helpers.js";

const data = await loadStandard();
const acmeText = acmeAdapterText;
const acme: Adapter = acmeAdapter();
const columns = (text: string): SchemaColumn[] => {
  const c = schemaColumns(text);
  if ("error" in c) throw new Error(c.error);
  return c;
};
const acmeColumns = columns(acmeDdl);
const without = (cols: SchemaColumn[], table: string, column: string) => cols.filter((c) => !(c.table === table && c.column === column));

describe("columnsRead", () => {
  it("reads the columns of an expression and nothing else", () => {
    expect(columnsRead("mrr_cents / 100")).toEqual(["mrr_cents"]);
    expect(columnsRead("CASE WHEN movement_type = 'upgrade' THEN 'expansion' ELSE movement_type END")).toEqual(["movement_type"]);
    expect(columnsRead("COALESCE(t.amount, credit) * 1.5")).toEqual(["amount", "credit"]);
    expect(columnsRead('CAST("Plan Name" AS VARCHAR)')).toEqual(["plan name"]);
    expect(columnsRead("DATE_TRUNC('month', created_at)")).toEqual(["created_at"]);
  });

  it("puts the column in place of {{value}}", () => {
    expect(mappedExpression({ gaspField: "mrr", warehouseRef: "billing.subscriptions.mrr_cents", transform: "{{value}} / 100" })).toBe("mrr_cents / 100");
    expect(mappedExpression({ gaspField: "mrr", warehouseRef: "mrr" })).toBe("mrr");
  });
});

describe("schemaDrift", () => {
  it("finds nothing broken when the snapshot matches the mapping", () => {
    const d = schemaDrift(acme, acmeColumns, data);
    expect(d.tables.every((t) => t.found)).toBe(true);
    expect(d.broken).toEqual([]);
    expect(d.metricsLost).toEqual([]);
    expect(d.coveredAfter).toBe(d.coveredBefore);
    expect(d.coveredBefore).toBeGreaterThan(0);
  });

  it("names the pair a dropped column breaks and the metrics that lose coverage, Core first", () => {
    const d = schemaDrift(acme, without(acmeColumns, "billing.subscriptions", "mrr_cents"), data, acmeColumns);
    expect(d.broken).toEqual([expect.objectContaining({ dataset: "subscription", field: "mrr", expression: "mrr_cents / 100", missing: ["mrr_cents"] })]);
    const lost = d.metricsLost.map((m) => m.metric);
    expect(lost.some((m) => m.startsWith("MRR (Monthly Recurring Revenue)"))).toBe(true);
    expect(d.metricsLost[0].department).toBe("Core");
    expect(d.coveredAfter).toBe(d.coveredBefore - d.metricsLost.length);
    expect(d.changes).toEqual([expect.objectContaining({ table: "billing.subscriptions", column: "mrr_cents", change: "dropped", readBy: ["mrr@subscription"] })]);
  });

  it("breaks every pair on a table that is gone", () => {
    const d = schemaDrift(acme, acmeColumns.filter((c) => c.table !== "billing.mrr_movements"), data);
    expect(d.tables.find((t) => t.dataset === "revenue_event")?.found).toBeNull();
    const onTable = d.broken.filter((b) => b.dataset === "revenue_event");
    expect(onTable.length).toBeGreaterThan(0);
    expect(onTable.every((b) => b.missing === "table")).toBe(true);
  });

  it("names a retyped column with the pairs that read it, and an added one", () => {
    const retyped = acmeColumns.map((c) => (c.table === "billing.subscriptions" && c.column === "mrr_cents" ? { ...c, type: "FLOAT" } : c));
    const d = schemaDrift(acme, [...retyped, { table: "billing.subscriptions", column: "seats", type: "INTEGER" }], data, acmeColumns);
    expect(d.broken).toEqual([]);
    expect(d.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: "mrr_cents", change: "retyped", from: "NUMBER(18, 0)", to: "FLOAT", readBy: ["mrr@subscription"] }),
      expect.objectContaining({ column: "seats", change: "added" }),
    ]));
  });

  it("matches a bare table name in the snapshot to a qualified one in the mapping", () => {
    const bare = acmeColumns.map((c) => ({ ...c, table: c.table.split(".").pop()!.toUpperCase(), column: c.column.toUpperCase() }));
    expect(schemaDrift(acme, bare, data).broken).toEqual([]);
  });
});

describe("the snapshot query", () => {
  let db: PGlite;
  beforeAll(async () => { db = await fixtureDb(); });
  afterAll(async () => { await db.close(); });

  const snapshot = async (): Promise<SchemaColumn[]> => {
    const sql = schemaSnapshotSql(mappedTables(fixtureAdapter, data), "postgres");
    const rows = (await db.query(sql)).rows;
    return columns(JSON.stringify(rows));
  };

  it("snapshots the fixture's mapped tables so that nothing is broken", async () => {
    const tables = mappedTables(fixtureAdapter, data);
    const cols = await snapshot();
    expect(new Set(cols.map((c) => c.table)).size).toBe(tables.length);
    expect(schemaDrift(fixtureAdapter, cols, data).broken).toEqual([]);
  });

  it("sees a column dropped in the warehouse", async () => {
    const before = await snapshot();
    await db.exec("ALTER TABLE gasp_subscriptions DROP COLUMN mrr CASCADE");
    const d = schemaDrift(fixtureAdapter, await snapshot(), data, before);
    expect(d.broken.map((b) => `${b.field}@${b.dataset}`)).toContain("mrr@subscription");
    expect(d.metricsLost.length).toBeGreaterThan(0);
    expect(d.changes.find((c) => c.column === "mrr")?.change).toBe("dropped");
  });

  it("reads INFORMATION_SCHEMA per dataset on BigQuery", () => {
    const sql = schemaSnapshotSql(["proj.billing.customers", "proj.billing.invoices", "analytics.usage"], "bigquery");
    expect(sql).toContain("FROM `proj.billing`.INFORMATION_SCHEMA.COLUMNS WHERE LOWER(table_name) IN ('customers', 'invoices')");
    expect(sql).toContain("FROM `analytics`.INFORMATION_SCHEMA.COLUMNS");
  });
});

describe("the tools", () => {
  it("generate_checks writes the re-check bundle: the checks and the snapshot", () => {
    const out = generateChecksFromText(acmeText, undefined, data, { output: "bundle" });
    expect(out).toContain("## gasp_checks.sql");
    expect(out).toContain("## gasp_schema_snapshot.sql");
    expect(out).toContain("LOWER(table_name) = 'subscriptions'");
    expect(out).toContain("previous_schema");
  });

  it("readiness_report blocks level 2 on a broken pair and reports the drift", async () => {
    const schema = JSON.stringify(without(acmeColumns, "billing.subscriptions", "mrr_cents").map((c) => ({ table_name: c.table, column_name: c.column, data_type: c.type })));
    const r = JSON.parse(await readinessFromText(acmeText, undefined, data, { schema, output: "json" }));
    const l2 = r.levels.find((l: { level: number }) => l.level === 2);
    expect(l2.status).toBe("blocked");
    expect(l2.blockers.join(" ")).toContain("the schema changed under the mapping");
    expect(r.schema.broken[0].field).toBe("mrr");
    const text = await readinessFromText(acmeText, undefined, data, { schema });
    expect(text).toContain("## Schema drift");
    expect(text).toContain("`mrr@subscription`");
  });

  it("readiness_report notes a clean snapshot and refuses previous_schema alone", async () => {
    const r = JSON.parse(await readinessFromText(acmeText, undefined, data, { schema: acmeDdl, output: "json" }));
    expect(r.schema.broken).toEqual([]);
    expect(r.levels.find((l: { level: number }) => l.level === 2).notes.join(" ")).toContain("every mapped pair reads columns that exist");
    expect(await readinessFromText(acmeText, undefined, data, { previousSchema: acmeDdl })).toContain("previous_schema needs schema");
    expect(await readinessFromText(acmeText, undefined, data, { schema: "nonsense" })).toMatch(/^schema: /);
  });
});
