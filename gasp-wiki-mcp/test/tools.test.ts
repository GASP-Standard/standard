import { describe, it, expect } from "vitest";
import { loadStandard, resolveNode, resolveNodeResult, findDefinition, getRelationships, search, metricFormulaId, isMetricStub } from "../src/loader.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveMetric, suggestMatches, formatAmbiguous, fillTemplate, formatCanonicalFormula, validateAdapter, adapterSchemaErrors, checkAdapter, formatValidationReport, formatDataRequirement, breakdownTemplate, breakdownRequirement, chooseDialect } from "../src/tools.js";
import { enumFilters, formatFilters } from "../src/filters.js";
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

  it("resolves every graph node label to its metric, or lists it among the candidates", () => {
    const failed = data.nodes
      .filter((n) => !n.nodeType || n.nodeType === "metric")
      .filter((n) => {
        const r = resolveMetric(data, n.label);
        const owns = (m: { slug: string }) => data.metricNodeIds?.[m.slug] === n.id;
        return !(r.kind === "metric" && owns(r.metric)) && !(r.kind === "ambiguous" && r.candidates.some(owns));
      })
      .map((n) => n.label);
    expect(failed).toEqual([]);
  });

  it("resolves every graph node id to the metric that owns it", () => {
    for (const n of data.nodes.filter((n) => !n.nodeType || n.nodeType === "metric")) {
      const r = resolveMetric(data, n.id);
      expect(r.kind, n.id).toBe("metric");
      if (r.kind === "metric") expect(data.metricNodeIds?.[r.metric.slug], n.id).toBe(n.id);
    }
  });

  it("reports a name two departments define as ambiguous, with each candidate's department and URL", () => {
    const cases: Array<[string, string[]]> = [
      ["Escalation Rate", ["Professional Services", "Support"]],
      ["Milestone Completion Rate", ["Onboarding", "Professional Services"]],
      ["Activation Rate", ["Onboarding", "Product"]],
    ];
    for (const [q, depts] of cases) {
      const r = resolveMetric(data, q);
      expect(r.kind, q).toBe("ambiguous");
      if (r.kind !== "ambiguous") continue;
      expect(r.candidates.map((m) => m.department).sort(), q).toEqual(depts);
      const text = formatAmbiguous(data, q, r.candidates);
      for (const m of r.candidates) {
        expect(text).toContain(`(${m.department})`);
        expect(text).toContain(`\`${metricFormulaId(data, m)}\``);
        expect(text).toMatch(new RegExp(`https://gaspwiki\\.com/v1/metrics/[a-z-]+/${m.slug}`));
      }
    }
  });

  it("no name gives two full records silently: every name that matches two resolves as ambiguous", () => {
    const full = data.metrics.filter((m) => !isMetricStub(m));
    const byName = new Map<string, number>();
    for (const m of full) byName.set(m.name.toLowerCase(), (byName.get(m.name.toLowerCase()) ?? 0) + 1);
    for (const [name, n] of byName) if (n > 1) expect(resolveMetric(data, name).kind, name).toBe("ambiguous");
  });

  it("takes a department-qualified formula id, or the name qualified by department", () => {
    for (const q of ["support_escalation_rate", "Support Escalation Rate", "Escalation Rate (Support)", "support escalation rate"]) {
      const r = resolveMetric(data, q);
      expect(r.kind, q).toBe("metric");
      if (r.kind === "metric") expect(r.metric.department, q).toBe("Support");
    }
    const ps = resolveMetric(data, "professional_services_escalation_rate");
    expect(ps.kind === "metric" && ps.metric.department).toBe("Professional Services");
    const product = resolveMetric(data, "product_activation_rate");
    expect(product.kind === "metric" && product.metric.department).toBe("Product");
  });

  it("prefers the full record over a cross-reference stub at every tier", () => {
    const cac = resolveMetric(data, "customer acquisition cost");
    expect(cac.kind === "metric" && [cac.metric.department, isMetricStub(cac.metric)]).toEqual(["Core", false]);
    const dso = resolveMetric(data, "Days Sales Outstanding (DSO)");
    expect(dso.kind === "metric" && [dso.metric.department, isMetricStub(dso.metric)]).toEqual(["RevOps", false]);
    // Any name a stub shares with a full record resolves to a full record
    for (const stub of data.metrics.filter(isMetricStub)) {
      const r = resolveMetric(data, stub.name);
      if (r.kind === "metric") expect(isMetricStub(r.metric) && data.metrics.some((m) => !isMetricStub(m) && m.name.toLowerCase() === stub.name.toLowerCase()), stub.name).toBe(false);
    }
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

  it("agrees with resolveMetric on metric names: the same node or the same ambiguity", () => {
    for (const q of ["Escalation Rate", "Milestone Completion Rate", "Activation Rate"]) {
      const metric = resolveMetric(data, q);
      const node = resolveNodeResult(data, q);
      expect(node.kind, q).toBe("ambiguous");
      if (metric.kind === "ambiguous" && node.kind === "ambiguous") expect(node.candidates).toEqual(metric.candidates);
      expect(getRelationships(data, q).ambiguous?.length, q).toBe(metric.kind === "ambiguous" ? metric.candidates.length : -1);
    }
    for (const m of data.metrics) {
      const r = resolveMetric(data, m.name);
      const n = resolveNodeResult(data, m.name);
      if (r.kind === "ambiguous") expect(n.kind, m.name).toBe("ambiguous");
      else if (r.kind === "metric" && n.kind === "node" && n.node.nodeType !== "entity" && n.node.nodeType !== "concept") expect(data.metricNodeIds?.[r.metric.slug], m.name).toBe(n.node.id);
    }
    // A metric outside the graph is reported as such, never given another metric's node
    const product = resolveNodeResult(data, "product_activation_rate");
    expect(product.kind).toBe("none");
    expect(product.kind === "none" && product.metric?.department).toBe("Product");
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

describe("get_formula forms", () => {
  it("lists gross_margin's cost fields under LTV's O form, which reads metric.gross_margin.O", () => {
    const r = resolveMetric(data, "LTV");
    if (r.kind !== "metric") throw new Error("LTV did not resolve");
    const text = formatCanonicalFormula(data, r.metric).join("\n");
    const o = text.split("\n").find((l) => l.startsWith("**Operating form (O) reads fields:**"));
    expect(o).toBeDefined();
    expect(o).toContain("`cost`");
    expect(o).toContain("`cost_function`");
    expect(text).toMatch(/\*\*O form datasets:\*\* .*cost_event/);
    expect(text).toContain("**Market form (M) reads fields:**");
  });

  it("derives a requirement per declared form at load time", () => {
    const withForms = Object.entries(data.formulas!).filter(([, f]) => f.forms).map(([id]) => id).sort();
    for (const id of withForms) {
      const dr = data.dataRequirements.find((d) => d.formulaId === id)!;
      expect(Object.keys(dr.forms ?? {}).sort(), id).toEqual(Object.keys(data.formulas![id].forms!).sort());
    }
  });
});

describe("get_formula form filters", () => {
  const ctx = { fields: Object.fromEntries(data.ontology!.fields!.map((f) => [f.id, f])), formulas: data.formulas! };
  const filtersOf = (id: string, form: "O" | "M") => enumFilters(data.formulas![id].forms![form], ctx);
  const values = (id: string, form: "O" | "M", field: string) => filtersOf(id, form).find((f) => f.field === field)?.include ?? [];
  const text = (name: string) => {
    const r = resolveMetric(data, name);
    if (r.kind !== "metric") throw new Error(`${name} did not resolve`);
    return formatCanonicalFormula(data, r.metric).join("\n");
  };

  it("CAC: the O form lists implementation and onboarding, the M form does not", () => {
    expect(values("cac", "O", "cost_function")).toEqual(["gtm", "implementation", "onboarding"]);
    expect(values("cac", "M", "cost_function")).toEqual(["gtm"]);
    const t = text("CAC");
    expect(t).toContain("**O form filters:** cost_function in (gtm, implementation, onboarding); event_type = new");
    expect(t).toContain("**M form filters:** cost_function = gtm; event_type = new");
  });

  it("LTV: forms read the same fields and differ in the cost filters reached through metric.gross_margin.O", () => {
    const r = resolveMetric(data, "LTV");
    if (r.kind !== "metric") throw new Error("LTV did not resolve");
    const dr = data.dataRequirements.find((d) => d.formulaId === "ltv")!;
    expect(dr.forms!.O!.fields).toEqual(dr.forms!.M!.fields);
    expect(values("ltv", "O", "cost_function")).toEqual(["implementation", "infrastructure", "onboarding", "success_engineering", "support"]);
    expect(values("ltv", "M", "cost_function")).toEqual(["infrastructure"]);
    // Filters inside referenced metrics (arpa, revenue_churn_rate) are collected too.
    expect(values("ltv", "M", "event_type")).toEqual(["churn", "contraction"]);
    const t = text("LTV");
    expect(t).toMatch(/\*\*O form filters:\*\* cost_function in \(implementation, infrastructure, onboarding, success_engineering, support\)/);
    expect(t).toMatch(/\*\*M form filters:\*\* cost_function = infrastructure;/);
    // The main formula equals the M form, so it gets no line of its own.
    expect(t).not.toContain("**Main formula filters:**");
  });

  it("collects != and not in as exclusions, and prints the main formula when it differs from every form", () => {
    expect(formatFilters(enumFilters("sum(field.cost where field.cost_function != 'gtm' and field.cost_function not in ('support', 'onboarding'))", ctx)))
      .toBe("cost_function not in (gtm, onboarding, support)");
    expect(text("NRR")).toContain("**Main formula filters:**");
  });
});

describe("generate_query named breakdown", () => {
  const adapter = JSON.parse(readFileSync(join(new URL(".", import.meta.url).pathname, "fixture", "adapter.json"), "utf-8"));

  it("MRR by_plan fills every placeholder from the fixture adapter and groups by plan_id, labelled by plan_name", () => {
    const b = breakdownTemplate(data, "mrr", "by_plan");
    if ("error" in b) throw new Error(b.error);
    expect(b.template.breakdown).toEqual({ field: "plan_name", via: { dataset: "plan", key: "plan_id" } });
    const r = fillTemplate(b.template, adapter, data);
    expect(r.missingFields).toEqual([]);
    expect(r.missingTables).toEqual([]);
    expect(r.sql).not.toContain("{{");
    expect(r.sql).toContain("_d.plan_id");
  });

  it("rejects an unknown name with the declared breakdowns", () => {
    const b = breakdownTemplate(data, "mrr", "by_region");
    expect("error" in b && b.error).toMatch(/no breakdown named `by_region`\. Declared breakdowns: `by_plan`/);
    const none = breakdownTemplate(data, "magic_number", "by_plan");
    expect("error" in none && none.error).toMatch(/declares no named breakdowns/);
  });
});

describe("get_formula breakdown", () => {
  it("shows the breakdown line for Ticket Distribution by Type, and requirements say one row per value", () => {
    const r = resolveMetric(data, "Ticket Distribution by Type");
    if (r.kind !== "metric") throw new Error("Ticket Distribution by Type did not resolve");
    const text = formatCanonicalFormula(data, r.metric).join("\n");
    expect(text).toContain("**Breakdown by:** `ticket_type`");
    expect(text).toContain("one row per value");
    expect(text).toContain("`ticket_type`");
    const dr = data.dataRequirements.find((d) => d.formulaId === "ticket_distribution_by_type")!;
    expect(dr.breakdown).toEqual({ field: "ticket_type" });
    expect(data.queryTemplates!.ticket_distribution_by_type.breakdown).toEqual({ field: "ticket_type" });
    expect(formatDataRequirement(dr)).toContain("The query returns one row per `ticket_type` value.");
  });
});

describe("bucketed breakdowns and get_data_requirements breakdown", () => {
  it("get_formula prints Aging Buckets' buckets", () => {
    const r = resolveMetric(data, "Aging Buckets");
    if (r.kind !== "metric") throw new Error("Aging Buckets did not resolve");
    const text = formatCanonicalFormula(data, r.metric).join("\n");
    expect(text).toContain("**Breakdown by:** buckets of `field.snapshot_date - field.invoice_date` (column `bucket`, inclusive bounds): `current` 0 to 30, `days_31_60` 31 to 60, `days_61_90` 61 to 90, `days_90_plus` 91 and over");
  });

  it("breakdownRequirement compiles a named breakdown's requirement and rejects an unknown name", () => {
    const b = breakdownRequirement(data, "mrr", "by_plan");
    if ("error" in b) throw new Error(b.error);
    expect(b.requirement.fields).toEqual(expect.arrayContaining(["plan_id", "plan_name"]));
    expect(b.requirement.breakdown).toEqual({ field: "plan_name", via: { dataset: "plan", key: "plan_id" } });
    expect(b.requirement.exampleQuery).toContain("_d.plan_id");
    expect(b.requirement.fieldTypes.plan_name).toBeDefined();
    expect(formatDataRequirement(b.requirement)).toContain("The query returns one row per `plan_name` value, with its `plan_id` (read from plan).");
    const bad = breakdownRequirement(data, "mrr", "by_region");
    expect("error" in bad && bad.error).toMatch(/no breakdown named `by_region`\. Declared breakdowns: `by_plan`/);
  });
});

describe("dialect argument", () => {
  it("chooseDialect: the requested dialect, else the adapter's warehouse, else postgres", () => {
    expect(chooseDialect("BigQuery", "snowflake")).toEqual({ dialect: "bigquery", note: "bigquery (requested)" });
    expect(chooseDialect(undefined, "Snowflake")).toMatchObject({ dialect: "snowflake" });
    expect(chooseDialect(undefined, "redshift")).toMatchObject({ dialect: "postgres", note: "postgres (from the adapter's warehouse `redshift`)" });
    expect(chooseDialect(undefined, "oracle")).toMatchObject({ dialect: "postgres", note: "postgres (default; the adapter's warehouse `oracle` names no supported dialect)" });
    expect(chooseDialect(undefined, undefined)).toEqual({ dialect: "postgres", note: "postgres (default)" });
    expect(chooseDialect("oracle", undefined)).toMatchObject({ error: expect.stringContaining("Unknown SQL dialect `oracle`") });
  });

  it("breakdownTemplate and breakdownRequirement compile in the dialect, with or without a breakdown", () => {
    const sf = breakdownTemplate(data, "dau_mau", undefined, "snowflake");
    if ("error" in sf) throw new Error(sf.error);
    expect(sf.template.parameterizedQuery).toContain("DATEADD(day, -");
    expect(sf.template.parameterizedQuery).not.toContain("INTERVAL '");
    expect(breakdownTemplate(data, "dau_mau")).toEqual({ template: data.queryTemplates!.dau_mau });
    const bq = breakdownRequirement(data, "mrr", "by_plan", "bigquery");
    if ("error" in bq) throw new Error(bq.error);
    expect(bq.requirement.exampleQuery).toContain("_d.plan_name");
    const req = breakdownRequirement(data, "mttr", undefined, "databricks");
    if ("error" in req) throw new Error(req.error);
    expect(req.requirement.exampleQuery).toContain("TIMESTAMPDIFF(SECOND");
    expect(req.requirement.metric).toBe(data.dataRequirements.find((d) => d.formulaId === "mttr")!.metric);
  });
});

describe("get_formula total-mode breakdowns", () => {
  it("prints the total mode on CAC's by_cost_centre breakdown", () => {
    const r = resolveMetric(data, "CAC (Customer Acquisition Cost)");
    if (r.kind !== "metric") throw new Error("CAC did not resolve");
    expect(formatCanonicalFormula(data, r.metric).join("\n")).toContain("`by_cost_centre` by `cost_centre` (total mode: other aggregates stay whole)");
  });
});

describe("get_formula named breakdowns", () => {
  it("lists named breakdowns on a Breakdowns line", () => {
    const r = resolveMetric(data, "Ticket Volume");
    if (r.kind !== "metric") throw new Error("Ticket Volume did not resolve");
    const id = "ticket_volume";
    const withNamed = { ...data, formulas: { ...data.formulas!, [id]: { ...data.formulas![id], breakdowns: { by_type: "field.ticket_type" } } } };
    const text = formatCanonicalFormula(withNamed, r.metric).join("\n");
    expect(text).toContain("**Breakdowns:** `by_type` by `ticket_type`");
    const withNone = { ...data, formulas: { ...data.formulas!, [id]: { ...data.formulas![id], breakdowns: undefined } } };
    expect(formatCanonicalFormula(withNone, r.metric).join("\n")).not.toContain("**Breakdowns:**");
  });
});

describe("validateAdapter schema check", () => {
  const here = new URL(".", import.meta.url).pathname;
  const fixture = JSON.parse(readFileSync(join(here, "fixture", "adapter.json"), "utf-8"));
  const template = JSON.parse(readFileSync(join(here, "..", "..", "standard", "exports", "gasp-adapter-template.json"), "utf-8"));
  const base = { version: "1.1", mappings: [{ gaspField: "mrr", warehouseRef: "billing.subscriptions.mrr" }] };
  /** The lines under the Schema heading, up to the next blank line. */
  const schemaLines = (adapter: unknown) => {
    const out = validateAdapter(adapter as any, data).split("\n");
    const start = out.findIndex((l) => l.startsWith("## Schema"));
    expect(start, "Schema heading").toBeGreaterThanOrEqual(0);
    const end = out.indexOf("", start);
    return out.slice(start, end).join("\n");
  };

  it("passes the fixture adapter and the published template", () => {
    expect(adapterSchemaErrors(fixture, data)).toEqual([]);
    expect(adapterSchemaErrors(template, data)).toEqual([]);
    expect(schemaLines(fixture)).toMatch(/^## Schema\nValid against/);
  });

  it("reports an extra top-level key", () => {
    const s = schemaLines({ ...base, extra: true });
    expect(s).toMatch(/## Schema \(1 error\)/);
    expect(s).toContain("`/` must NOT have additional properties: `extra`");
  });

  it("reports version as a number", () => {
    expect(schemaLines({ ...base, version: 1.1 })).toContain("`/version` must be equal to one of the allowed values");
  });

  it("reports a missing version", () => {
    const { version, ...noVersion } = base;
    expect(schemaLines(noVersion)).toContain("`/` must have required property 'version'");
  });

  it("reports a mapping missing a required property", () => {
    expect(schemaLines({ ...base, mappings: [{ gaspField: "mrr" }] })).toContain("`/mappings/0` must have required property 'warehouseRef'");
  });

  it("puts the schema result before the existing checks and still scores coverage", () => {
    const out = validateAdapter({ ...base, extra: true, mappings: [...base.mappings, { gaspField: "not_a_field", warehouseRef: "x.y.z" }] } as any, data);
    expect(out.indexOf("## Schema")).toBeLessThan(out.indexOf("## Problems"));
    expect(out).toContain("Unknown GASP field `not_a_field`");
    expect(out).toMatch(/\*\*Metrics:\*\* \d+ fully covered/);
  });

  it("returns the schema errors when there is no mappings array", () => {
    const out = validateAdapter({ version: "1.1" } as any, data);
    expect(out).toContain("must have required property 'mappings'");
    expect(out).toContain('Adapter must have a "mappings" array');
  });
});

describe("exported report formatters", () => {
  it("formatValidationReport over checkAdapter is the validate_adapter report", () => {
    const fixture = JSON.parse(readFileSync(join(new URL(".", import.meta.url).pathname, "fixture", "adapter.json"), "utf-8"));
    const result = checkAdapter(fixture, data);
    expect(result.schemaErrors).toEqual([]);
    expect(result.fully.length).toBeGreaterThan(0);
    expect(formatValidationReport(result, fixture, data)).toBe(validateAdapter(fixture, data));
  });

  it("formatDataRequirement renders the field table and example SQL", () => {
    const dr = data.dataRequirements.find((d) => d.formulaId === "nrr")!;
    const md = formatDataRequirement(dr);
    expect(md.startsWith(`### ${dr.metric}\n- **Source:**`)).toBe(true);
    for (const f of dr.fields) expect(md).toContain(`| \`${f}\` |`);
    expect(md).toContain("```sql\n" + dr.exampleQuery + "\n```");
  });
});

describe("suggestions and search", () => {
  it("suggests the intended metric for a misspelling", () => {
    expect(suggestMatches(data, "Net Revenue Retension")).toContain("Net Revenue Retention (NRR) (Core)");
    expect(suggestMatches(data, "Pipline Coverage")).toContain("Pipeline Coverage Ratio (Sales)");
  });

  it("matches whole words, not inside them", () => {
    expect(search(data, "NDR", 20).map((r) => r.name)).not.toContain("Cash Runway");
    expect(search(data, "burn", 20).map((r) => r.name)).not.toContain("Billable Utilization");
  });

  it("returns one result per metric or definition", () => {
    for (const q of ["CAC", "NRR", "churn", "win rate", "ARR"]) {
      const keys = search(data, q, 50).map((r) => `${r.type}:${r.name}:${r.department ?? ""}`);
      expect(new Set(keys).size, q).toBe(keys.length);
      const metricIds = search(data, q, 50).filter((r) => r.type === "metric").map((r) => r.url);
      expect(new Set(metricIds).size, q).toBe(metricIds.length);
    }
    // A stub and its canonical record fold into one result, the canonical one
    const cac = search(data, "Customer Acquisition Cost", 50).filter((r) => r.type === "metric" && /customer-acquisition-cost/.test(r.url ?? ""));
    expect(cac.map((r) => r.department)).toEqual(["Core"]);
  });

  it("ranks name and alias hits above definition hits above formula and field hits", () => {
    const order = { name: 0, alias: 0, term: 0, definition: 1, formula: 2, field: 2, category: 3, department: 3, section: 3 } as Record<string, number>;
    for (const q of ["churn", "win rate", "pipeline", "mrr"]) {
      const ranks = search(data, q, 50).map((r) => order[r.matched]);
      expect([...ranks].sort((a, b) => a - b), q).toEqual(ranks);
    }
    expect(search(data, "win rate", 1)[0].name).toBe("Win Rate");
  });

  it("falls back to similar names, labelled, only when nothing matches", () => {
    const fuzzy = search(data, "Net Revenue Retension", 5);
    expect(fuzzy.length).toBeGreaterThan(0);
    expect(fuzzy.every((r) => r.didYouMean)).toBe(true);
    expect(fuzzy[0].name).toBe("Net Revenue Retention (NRR)");
    expect(search(data, "chrun", 5).some((r) => /Churn/.test(r.name))).toBe(true);
    expect(search(data, "churn", 5).some((r) => r.didYouMean)).toBe(false);
    for (const r of [...fuzzy, ...search(data, "churn", 5)]) expect(r.url).toMatch(/^https:\/\/gaspwiki\.com\//);
  });
});

describe("entity measured-by list", () => {
  it("lists every metric entityMappings ties to an entity, with department, beyond the graph's measures edges", () => {
    for (const entity of ["quote", "requisition", "incident"]) {
      const ids = data.ontology!.entityMappings![entity];
      const rel = getRelationships(data, entity);
      expect(rel.node?.id).toBe(`entity_${entity}`);
      expect(rel.measuredBy.map((m) => metricFormulaId(data, m)).sort(), entity).toEqual([...ids].sort());
      expect(rel.measuredBy.every((m) => !isMetricStub(m) && m.department)).toBe(true);
    }
    expect(getRelationships(data, "arr").measuredBy).toEqual([]);
  });
});

describe("validate_adapter dataset check", () => {
  it("flags a field mapped to a dataset that does not carry it", () => {
    const adapter = { version: "1.1", mappings: [{ gaspField: "mrr", dataset: "ticket", warehouseRef: "support.tickets.mrr" }, { gaspField: "mrr", dataset: "subscription", warehouseRef: "billing.subs.mrr" }] };
    const problems = checkAdapter(adapter as any, data).problems;
    expect(problems.some((p) => p.includes("`mrr` is mapped to dataset `ticket`, which does not carry it"))).toBe(true);
    expect(problems.some((p) => p.includes("dataset `subscription`, which does not carry it"))).toBe(false);
  });
});

describe("data requirement entry", () => {
  it("shows the dataset each field is read from and the staged flag", () => {
    for (const dr of data.dataRequirements.slice(0, 40)) {
      const md = formatDataRequirement(dr, "https://gaspwiki.com/v1/metrics/core/x");
      for (const p of dr.placeholders) {
        const [f, ds] = p.split("@");
        expect(md, p).toContain(`| \`${f}\` | ${ds} |`);
      }
      expect(md).toContain(`- **Staged:** ${dr.staged ? "yes" : "no"}`);
      expect(md).toContain("- **URL:** https://gaspwiki.com/v1/metrics/core/x");
    }
  });
});
