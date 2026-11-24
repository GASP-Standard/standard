/**
 * Metric scope (src/ossie/scope.ts): GASP writes a metric that reads one
 * dataset under that dataset with single-part names and reads every metric
 * back in the `dataset.field` form. The two are inverses for every metric the
 * reference model, the Core example and a company's compiled model hold; a
 * company's own metrics score the same in either scope; the checker reports a
 * dataset-scoped metric that names a dataset.
 */
import { describe, expect, it } from "vitest";
import { loadStandard } from "../src/loader.js";
import { resolveCompany } from "../src/ossie/adapt.js";
import { checkExport } from "../src/ossie/check.js";
import { compileModel, isGaspMetric } from "../src/ossie/company.js";
import { companyMetrics } from "../src/ossie/drift.js";
import { exportExample } from "../src/ossie/example.js";
import { exportOssie, ossieYaml } from "../src/ossie/index.js";
import { buildMetrics, REFERENCE_TARGET } from "../src/ossie/model.js";
import { datasetsRead, modelMetrics, placeMetrics, qualifyExpression, refsIn, scopedMetrics, unqualifyExpression } from "../src/ossie/scope.js";
import { expressionText, portable, type OssieDataset, type OssieMetric, type OssieSemanticModel } from "../src/ossie/types.js";
import { acmeAdapterText } from "./ossie-helpers.js";

const data = loadStandard();
const exp = exportOssie(data);
const byName = (metrics: OssieMetric[]): Map<string, OssieMetric> => new Map(metrics.map((m) => [m.name, m]));

describe("the reference model", () => {
  const built = buildMetrics(data, REFERENCE_TARGET).metrics;
  const scoped = scopedMetrics(exp.model);

  it("declares every metric once, in one scope or the other", () => {
    expect(scoped.length).toBe(built.length);
    expect(new Set(scoped.map((s) => s.metric.name)).size).toBe(built.length);
    expect(scoped.some((s) => s.dataset)).toBe(true);
    expect(scoped.some((s) => !s.dataset)).toBe(true);
  });

  it("puts a metric under a dataset exactly when it reads that one dataset", () => {
    const read = new Map(built.map((m) => [m.name, [...datasetsRead(m.expression)]]));
    for (const { metric, dataset } of scoped) {
      const datasets = read.get(metric.name)!;
      if (dataset) expect(datasets, metric.name).toEqual([dataset.name]);
      else expect(datasets.length, metric.name).not.toBe(1);
    }
  });

  it("writes a dataset-scoped metric with single-part names only", () => {
    for (const { metric, dataset } of scoped) {
      if (dataset) expect(refsIn(expressionText(metric)!), `${dataset.name}.${metric.name}`).toEqual([]);
    }
  });

  it("keeps field and metric names apart within a dataset", () => {
    for (const d of exp.model.datasets) {
      const names = [...(d.fields ?? []).map((f) => f.name), ...(d.metrics ?? []).map((m) => m.name)];
      expect(new Set(names).size, d.name).toBe(names.length);
    }
  });

  it("reads every metric back as the builder wrote it", () => {
    const back = byName(modelMetrics(exp.model));
    for (const m of built) expect(back.get(m.name), m.name).toEqual(m);
  });

  it("reads the same metrics from the published YAML", async () => {
    const { parse } = await import("yaml");
    const doc = parse(ossieYaml({ semantic_model: [exp.model] })) as { semantic_model: OssieSemanticModel[] };
    expect(modelMetrics(doc.semantic_model[0])).toEqual(modelMetrics(exp.model));
  });
});

describe("the Core example", () => {
  const ex = exportExample(data, exp);
  it("holds each Core metric in its scope and nothing else from the reference model", () => {
    const kept = byName(modelMetrics(ex.model));
    const reference = byName(modelMetrics(exp.model));
    expect(kept.size).toBeGreaterThan(0);
    for (const [name, m] of kept) expect(m, name).toEqual(reference.get(name));
    for (const { metric, dataset } of scopedMetrics(ex.model)) {
      if (dataset) expect(refsIn(expressionText(metric)!), metric.name).toEqual([]);
    }
  });
});

describe("a company's compiled model", () => {
  const company = resolveCompany(acmeAdapterText, undefined, data);
  if ("error" in company) throw new Error(company.error);
  const first = compileModel(company, data);
  if ("error" in first) throw new Error(first.error);

  it("declares each compiled metric in its scope, over the company's own dataset names", () => {
    expect(first.problems).toEqual([]);
    const names = new Set(first.model.datasets.map((d) => d.name));
    const scoped = scopedMetrics(first.model).filter((s) => isGaspMetric(s.metric));
    expect(scoped.length).toBe(first.counts.direct + first.counts.staged);
    expect(scoped.some((s) => s.dataset)).toBe(true);
    for (const { metric, dataset } of scoped) {
      if (dataset) expect(refsIn(expressionText(metric)!), metric.name).toEqual([]);
      else expect(datasetsRead(metric.expression).size, metric.name).not.toBe(1);
    }
    for (const m of modelMetrics(first.model)) for (const ds of datasetsRead(m.expression)) expect(names.has(ds), `${m.name} reads ${ds}`).toBe(true);
  });

  it("replaces what an earlier compile wrote in either scope and keeps the company's own metrics", () => {
    const own: OssieMetric = { name: "acme_open_tickets", expression: portable("COUNT(ticket_id)") };
    const rootOwn: OssieMetric = { name: "acme_bookings", expression: portable("SUM(a.x) + SUM(b.y)") };
    const base: OssieSemanticModel = {
      ...first.model,
      datasets: first.model.datasets.map((d, i) => (i === 0 ? { ...d, metrics: [...(d.metrics ?? []), own] } : d)),
      metrics: [...(first.model.metrics ?? []), rootOwn],
    };
    const again = compileModel({ ...company, model: base }, data);
    if ("error" in again) throw new Error(again.error);
    const names = scopedMetrics(again.model).map((s) => s.metric.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((n) => n !== own.name && n !== rootOwn.name).sort()).toEqual(scopedMetrics(first.model).map((s) => s.metric.name).sort());
    expect(again.model.datasets[0].metrics).toContainEqual(own);
    expect(again.model.metrics).toContainEqual(rootOwn);
  });
});

describe("a company's own metrics", () => {
  const dataset: OssieDataset = {
    name: "revenue_event",
    source: "analytics.revenue_event",
    fields: [{ name: "mrr_change", expression: portable("mrr_change") }, { name: "event_type", expression: portable("event_type") }],
  };
  const rootForm = "SUM(revenue_event.mrr_change) FILTER (WHERE revenue_event.event_type = 'new')";
  const scopedForm = "SUM(mrr_change) FILTER (WHERE event_type = 'new')";

  it("are read alike from the model root and from a dataset", () => {
    const root = companyMetrics(ossieYaml({ version: "0.3.0.dev0", name: "m", datasets: [dataset], metrics: [{ name: "new_mrr", expression: portable(rootForm) }] }));
    const scoped = companyMetrics(ossieYaml({ version: "0.3.0.dev0", name: "m", datasets: [{ ...dataset, metrics: [{ name: "new_mrr", expression: portable(scopedForm) }] }] }));
    expect(root.error).toBeUndefined();
    expect(scoped.error).toBeUndefined();
    expect(scoped.metrics).toEqual(root.metrics);
    expect(expressionText(scoped.metrics![0])).toBe(rootForm);
  });

  it("take the field names from the company's model when the document declares none", () => {
    const text = ossieYaml({ version: "0.3.0.dev0", name: "m", datasets: [{ name: "revenue_event", source: "x", metrics: [{ name: "new_mrr", expression: portable(scopedForm) }] }] });
    expect(expressionText(companyMetrics(text).metrics![0])).toBe(scopedForm);
    const declaring: OssieSemanticModel = { version: "0.3.0.dev0", name: "acme", datasets: [dataset] };
    expect(expressionText(companyMetrics(text, declaring).metrics![0])).toBe(rootForm);
  });

  it("report a document with no metrics in either scope", () => {
    expect(companyMetrics(ossieYaml({ version: "0.3.0.dev0", name: "m", datasets: [dataset] })).error).toContain("no metrics list");
  });
});

describe("qualifyExpression and unqualifyExpression", () => {
  const q = (sql: string, fields: string[]) => qualifyExpression(sql, "d", new Set(fields));

  it("qualifies a name only where a column can stand", () => {
    expect(q("SUM(amount) FILTER (WHERE status = 'status')", ["amount", "status"])).toBe("SUM(d.amount) FILTER (WHERE d.status = 'status')");
    expect(q("COUNT(DISTINCT id) FILTER (WHERE date >= DATE '2026-01-01')", ["id", "date"])).toBe("COUNT(DISTINCT d.id) FILTER (WHERE d.date >= DATE '2026-01-01')");
    expect(q("SUM(CAST(amount AS decimal))", ["amount", "decimal"])).toBe("SUM(CAST(d.amount AS decimal))");
    expect(q("SUM(value) / COUNT(count)", ["value", "count", "sum"])).toBe("SUM(d.value) / COUNT(d.count)");
    expect(q("AVG(EXTRACT(day FROM closed) - day)", ["day", "closed"])).toBe("AVG(EXTRACT(day FROM d.closed) - d.day)");
    expect(q("MAX(closed + INTERVAL '1' day)", ["day", "closed"])).toBe("MAX(d.closed + INTERVAL '1' day)");
  });

  it("leaves dotted names, source columns and quoted text as written", () => {
    expect(q("SUM(source.amount) + SUM(other.amount) + SUM(amount)", ["amount"])).toBe("SUM(source.amount) + SUM(other.amount) + SUM(d.amount)");
    expect(q(`SUM("amount") FILTER (WHERE note = 'amount''s')`, ["amount", "note"])).toBe(`SUM("amount") FILTER (WHERE d.note = 'amount''s')`);
  });

  it("takes the qualifier off one dataset's names and no other", () => {
    expect(unqualifyExpression("SUM(d.amount) FILTER (WHERE d.kind = 'd.kind') + SUM(dd.amount) + SUM(x.d.amount)", "d")).toBe("SUM(amount) FILTER (WHERE kind = 'd.kind') + SUM(dd.amount) + SUM(x.d.amount)");
  });
});

describe("placeMetrics", () => {
  const a: OssieDataset = { name: "a", source: "s.a", fields: [{ name: "x", expression: portable("x") }, { name: "total", expression: portable("total") }], nonportable_extensions: [] };
  const b: OssieDataset = { name: "b", source: "s.b", fields: [{ name: "y", expression: portable("y") }] };
  const m = (name: string, sql: string): OssieMetric => ({ name, expression: portable(sql) });

  it("moves a single-dataset metric under its dataset and leaves the rest at the root", () => {
    const metrics = [m("one", "SUM(a.x)"), m("both", "SUM(a.x) / SUM(b.y)"), m("constant", "1"), m("elsewhere", "SUM(c.z)"), m("total", "SUM(a.x)")];
    const placed = placeMetrics([a, b], metrics);
    expect(placed.metrics.map((x) => x.name)).toEqual(["both", "constant", "elsewhere", "total"]);
    expect(placed.datasets[0].metrics).toEqual([m("one", "SUM(x)")]);
    expect(Object.keys(placed.datasets[0])).toEqual(["name", "source", "fields", "metrics", "nonportable_extensions"]);
    expect(placed.datasets[1]).toBe(b);
    expect(a.metrics).toBeUndefined();
    expect(modelMetrics(placed)).toEqual([m("one", "SUM(a.x)"), ...placed.metrics]);
  });

  it("keeps a second metric of the same name at the root", () => {
    const placed = placeMetrics([a], [m("one", "SUM(a.x)"), m("one", "COUNT(a.x)")]);
    expect(placed.datasets[0].metrics).toHaveLength(1);
    expect(placed.metrics).toHaveLength(1);
  });
});

describe("the checker", () => {
  const withModel = (model: OssieSemanticModel): string[] => checkExport({ ...exp, model }, { extensionSchema: data.extensionSchema });
  const edit = (f: (d: OssieDataset) => OssieDataset): OssieSemanticModel => {
    const i = exp.model.datasets.findIndex((d) => d.metrics?.length);
    return { ...exp.model, datasets: exp.model.datasets.map((d, k) => (k === i ? f(d) : d)) };
  };

  it("passes the reference model", () => {
    expect(withModel(exp.model)).toEqual([]);
  });

  it("reports a dataset-scoped metric that names a dataset", () => {
    const own = withModel(edit((d) => ({ ...d, metrics: [...d.metrics!, { name: "extra", expression: portable(`SUM(${d.name}.${d.fields![0].name})`) }] })));
    expect(own).toHaveLength(1);
    expect(own[0]).toContain("is dataset-scoped and references");
    const other = withModel(edit((d) => ({ ...d, metrics: [...d.metrics!, { name: "extra", expression: portable("SUM(elsewhere.amount)") }] })));
    expect(other[0]).toContain("belongs in the model-root metrics");
  });

  it("allows a column of the dataset's source", () => {
    expect(withModel(edit((d) => ({ ...d, metrics: [...d.metrics!, { name: "extra", expression: portable("SUM(source.amount)") }] })))).toEqual([]);
  });

  it("reports a name a dataset uses twice", () => {
    const clash = withModel(edit((d) => ({ ...d, metrics: [...d.metrics!, { name: d.fields![0].name, expression: portable("COUNT(*)") }] })));
    expect(clash.some((p) => p.includes("as a field and as a metric"))).toBe(true);
    const twice = withModel(edit((d) => ({ ...d, metrics: [...d.metrics!, d.metrics![0]] })));
    expect(twice.some((p) => p.includes("is declared more than once in dataset"))).toBe(true);
  });

  it("checks the GASP extension of a dataset-scoped metric", () => {
    const bad = withModel(edit((d) => ({ ...d, metrics: d.metrics!.map((x, k) => (k === 0 ? { ...x, nonportable_extensions: [{ vendor_name: "GASP", data: { gasp_id: 1 } }] } : x)) })));
    expect(bad.some((p) => p.includes("nonportable_extensions of metric"))).toBe(true);
  });
});
