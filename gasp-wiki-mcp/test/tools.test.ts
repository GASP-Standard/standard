import { describe, it, expect } from "vitest";
import { loadStandard, resolveNode, findDefinition, getRelationships } from "../src/loader.js";
import { resolveMetric, fillTemplate } from "../src/tools.js";
import { compileMetric, exampleSql, interval } from "../src/compile.js";

// Every lookup resolves by exact match or says not found. A substring guess
// ("revenue" -> Revenue Churn Rate, "churn" -> Churned MRR) is worse than no answer.

const data = loadStandard();

describe("resolveMetric", () => {
  it("matches the name with and without its abbreviation, and the abbreviation alone", () => {
    for (const q of ["Net Revenue Retention (NRR)", "Net Revenue Retention", "net revenue retention", "NRR"]) {
      const r = resolveMetric(data, q);
      expect(r.kind, q).toBe("metric");
      if (r.kind === "metric") expect(r.metric.name).toBe("Net Revenue Retention (NRR)");
    }
  });

  it("resolves every graph node label", () => {
    const failed = data.nodes
      .filter((n) => !n.nodeType || n.nodeType === "metric")
      .filter((n) => resolveMetric(data, n.label).kind !== "metric")
      .map((n) => n.label);
    expect(failed).toEqual([]);
  });

  it("never returns a substring match", () => {
    expect(resolveMetric(data, "Customer").kind).not.toBe("metric");
    expect(resolveMetric(data, "retention").kind).toBe("none");
  });
});

describe("resolveNode", () => {
  it("matches id, label, label without abbreviation, abbreviation and metric aliases", () => {
    expect(resolveNode(data, "nrr")?.id).toBe("nrr");
    expect(resolveNode(data, "Net Revenue Retention (NRR)")?.id).toBe("nrr");
    expect(resolveNode(data, "Net Revenue Retention")?.id).toBe("nrr");
    expect(resolveNode(data, "NRR")?.id).toBe("nrr");
    expect(resolveNode(data, "Annual Recurring Revenue")?.id).toBe("arr");
  });

  it("resolves entities and concepts by bare name", () => {
    expect(resolveNode(data, "customer")?.id).toBe("entity_customer");
    expect(resolveNode(data, "revenue")?.id).toBe("concept_revenue");
  });

  it("never returns a substring match", () => {
    expect(resolveNode(data, "churn")).toBeUndefined();
    expect(resolveNode(data, "retention")).toBeUndefined();
    expect(getRelationships(data, "churn").node).toBeUndefined();
  });
});

describe("findDefinition", () => {
  it("never returns a substring match", () => {
    expect(findDefinition(data, "tier")).toBeUndefined();
    expect(findDefinition(data, "Churn")?.term ?? "").not.toBe("Churned MRR");
  });
});

describe("compiled division", () => {
  const ont = data.ontology!;
  const ctx = { fields: Object.fromEntries(ont.fields!.map((f) => [f.id, f])), datasets: ont.datasets!, formulas: data.formulas! };

  it("casts the numerator so COUNT / COUNT is not integer division", () => {
    const sql = compileMetric("nps", ctx).sql;
    expect(sql).toMatch(/CAST\(.* AS DOUBLE PRECISION\) \/ NULLIF\(/s);
    const ratios = Object.entries(data.formulas!).filter(([, f]) => f.formula?.includes("/"));
    for (const [id] of ratios) expect(compileMetric(id, ctx).sql, id).toContain("CAST(");
  });
});

describe("tagged placeholders", () => {
  const ont = data.ontology!;
  const ctx = { fields: Object.fromEntries(ont.fields!.map((f) => [f.id, f])), datasets: ont.datasets!, formulas: data.formulas! };

  it("tags every field placeholder with its dataset and lists the pairs", () => {
    for (const [id, f] of Object.entries(data.formulas!)) {
      if (!f.formula) continue;
      const c = compileMetric(id, ctx);
      const tags = [...c.sql.matchAll(/\{\{(\w+)@(\w+)\}\}/g)].map((m) => `${m[1]}@${m[2]}`);
      expect(c.sql.match(/\{\{[a-z]\w*\}\}/g) ?? [], id).toEqual([]); // no untagged field placeholder
      expect([...new Set(tags)].sort(), id).toEqual(c.placeholders);
      for (const p of c.placeholders) expect(ont.datasets![p.split("@")[1]], `${id}: ${p}`).toBeDefined();
    }
  });

  it("strips the tag for the documentation example", () => {
    expect(exampleSql("SELECT {{mrr@subscription}} FROM {{_table:subscription}} WHERE {{snapshot_date@subscription}} = {{_period_end}}"))
      .toBe("SELECT mrr FROM subscription WHERE snapshot_date = :period_end");
  });

  it("emits intervals Postgres accepts", () => {
    expect(interval(1, "quarter")).toBe("INTERVAL '3 month'");
    expect(interval(2, "week")).toBe("INTERVAL '2 week'");
    expect(compileMetric("magic_number", ctx).sql).not.toContain("quarter");
  });

  it("window gives DAU, WAU and MAU distinct date filters", () => {
    const sqls = ["daily_active_users_dau", "weekly_active_users_wau", "monthly_active_users_mau"].map((id) => compileMetric(id, ctx).sql);
    expect(new Set(sqls).size).toBe(3);
    expect(sqls[0]).toContain("INTERVAL '1 day'");
    expect(sqls[2]).toContain("INTERVAL '30 day'");
  });

  it("compiles a form reference to that form: LTV-O reads contribution margin", () => {
    const o = compileMetric("ltv", ctx, "O").sql;
    const m = compileMetric("ltv", ctx).sql;
    expect(o).toContain("'success_engineering'");
    expect(o).toContain("'support'");
    expect(m).not.toContain("'success_engineering'");
    expect(compileMetric("ltv", ctx, "M").sql).toBe(m);
  });

  it("ARR-O subtracts the trailing 12 months of tagged MRR change for the period-end cohort", () => {
    const sql = compileMetric("arr", ctx, "O").sql;
    expect(sql).toContain("INTERVAL '12 month'");
    expect(sql).toContain("'pricing_adjustment', 'recontracting'");
    expect(sql).toContain("{{customer_id@revenue_event}} IN (SELECT");
  });

  it("all_time drops the period filter from the retention numerators", () => {
    const sql = compileMetric("cohort_retention", ctx).sql;
    const numerator = sql.slice(0, sql.indexOf("AS DOUBLE PRECISION"));
    expect(numerator).not.toMatch(/event_date@product_event\}\} (>=|<=) \{\{_period/);
    expect(numerator).toContain("{{signup_date@product_event}} >= {{_period_start}}");
  });

  it("fills per-dataset mappings by tag, including the cohort subquery inside another dataset's aggregate", () => {
    const adapter = {
      version: "1.1",
      datasets: { subscription: "dw.subs", customer: "dw.customers", revenue_event: "dw.rev_events" },
      mappings: [
        { gaspField: "snapshot_date", dataset: "subscription", warehouseRef: "dw.subs.as_of" },
        { gaspField: "snapshot_date", dataset: "customer", warehouseRef: "dw.customers.as_of_day" },
        { gaspField: "mrr", warehouseRef: "dw.subs.mrr_usd" },
        { gaspField: "subscription_status", warehouseRef: "dw.subs.status" },
        { gaspField: "customer_id", dataset: "subscription", warehouseRef: "dw.subs.acct" },
        { gaspField: "customer_id", dataset: "customer", warehouseRef: "dw.customers.id" },
        { gaspField: "customer_id", dataset: "revenue_event", warehouseRef: "dw.rev_events.acct" },
        { gaspField: "customer_status", warehouseRef: "dw.customers.state" },
        { gaspField: "event_date", dataset: "revenue_event", warehouseRef: "dw.rev_events.happened_on" },
        { gaspField: "event_type", warehouseRef: "dw.rev_events.kind" },
      ],
    };
    const r = fillTemplate(data.queryTemplates!.nrr, adapter, data);
    expect(r.missingFields).toEqual(["mrr_change@revenue_event"]);
    expect(r.missingTables).toEqual([]);
    expect(r.sql).toContain("FROM dw.customers WHERE as_of_day = :period_start AND state = 'active'");
    expect(r.sql).toContain("FROM dw.subs WHERE as_of = :period_start");
    expect(r.sql).toContain("acct IN (SELECT id FROM dw.customers");
    expect(r.sql).not.toContain("{{customer_status");
    expect(r.sql).toContain("{{mrr_change@revenue_event}}");
    expect(r.mapped.find((m) => m.field === "snapshot_date" && m.dataset === "customer")?.ref).toBe("dw.customers.as_of_day");
  });
});
