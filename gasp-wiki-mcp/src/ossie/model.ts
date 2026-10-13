/**
 * GASP Standard → Apache Ossie semantic model (core-spec/spec.md).
 *
 *   datasets       one per GASP dataset (ontology.json datasets), every field whose
 *                  `datasets` names it, the date field as the time dimension
 *   relationships  every `*_id` field that is the key of another dataset
 *   metrics        one per formula entry expression (main, forms, variants, named breakdowns);
 *                  direct when the formula is a plain Ossie aggregate (metrics.ts),
 *                  else a staged per-period dataset built from the compiled SQL
 *
 * The reference model's physical sources are `gasp.<dataset>` and its columns are
 * the canonical field ids; an adopter's mapping replaces both.
 */
import { compileMetric } from "../compile.js";
import { OSSIE_DIALECT_OF, type DialectName } from "../dialect.js";
import { metricFormulaId, isMetricStub } from "../loader.js";
import { metricUrl } from "../urls.js";
import type { Metric, OntologyDataset, OntologyField, StandardData } from "../types.js";
import { breakdownOf, emitMetric, formulaSource, type EmitContext } from "./metrics.js";
import { metricName, ossieDataType, physicalSource } from "./names.js";
import {
  GASP_VENDOR, OSSIE_DIALECT, OSSIE_VERSION,
  type MetricCoverage, type OssieDataset, type OssieExpression, type OssieExtension, type OssieField,
  type OssieMetric, type OssieRelationship, type OssieSemanticModel,
} from "./types.js";

/** Grain table the adopter provides for staged metrics: one row per reporting period. */
export const PERIOD_SPINE = "gasp.period_spine";

const sql = (expression: string): OssieExpression => ({ dialects: [{ dialect: OSSIE_DIALECT, expression }] });
const gasp = (data: Record<string, unknown>): OssieExtension[] => [{ vendor_name: GASP_VENDOR, data: JSON.stringify(data) }];

export const stagedDatasetName = (metric: string): string => `gasp_staged_${metric}`;

/** Snapshot and fact rows are one per key per date; event rows one per key. */
export function primaryKey(d: OntologyDataset): string[] {
  if (d.kind === "event") return [d.key];
  return d.key === d.date ? [d.date] : [d.key, d.date];
}

function datasetOf(id: string, d: OntologyDataset, fields: OntologyField[]): OssieDataset {
  const own = fields.filter((f) => f.datasets?.includes(id));
  const description = [d.label.replace(/\.?$/, "."), `Kind: ${d.kind}.`, d.cel ? `CEL class: ${d.cel}.` : ""].filter(Boolean).join(" ");
  return {
    name: id,
    source: physicalSource(id),
    description,
    primary_key: primaryKey(d),
    fields: own.map((f): OssieField => ({
      name: f.id,
      expression: sql(f.id),
      ...(f.id === d.date ? { dimension: { is_time: true } } : {}),
      ...(f.description ? { description: f.description } : {}),
      datatype: ossieDataType(f.type),
      ...(f.type === "enum" && f.values?.length ? { ai_context: { instructions: `One of ${f.values.join(", ")}` } } : {}),
    })),
    custom_extensions: gasp({ kind: d.kind, ...(d.cel ? { cel: d.cel } : {}), ...(d.activeWhen ? { activeWhen: d.activeWhen } : {}) }),
  };
}

/**
 * A field is a foreign key when it is named `*_id`, is not the dataset's own key
 * or date, and is the key of another dataset. When several datasets share that
 * key (subscription and revenue_schedule both key on subscription_id) the target
 * is the first dataset, in ontology.json order, whose `entities` include the
 * entity the key names (`subscription_id` → `subscription`), else the first
 * dataset keyed by it. Shared non-entity keys (event_id, period_start,
 * snapshot_date) are each dataset's own key and so never become joins.
 * A snapshot target is a daily snapshot, so the join carries the date too and
 * matches the row on the referencing row's date. An event or fact target joins
 * on the key alone: a fact row covers a period, and matching it to a date inside
 * that period needs a range join Ossie cannot express. The join then reaches
 * every period's row for the key, so the query layer filters the fact's time
 * dimension to the reporting period.
 */
export function relationshipsOf(datasets: Record<string, OntologyDataset>, fields: OntologyField[]): OssieRelationship[] {
  const ids = Object.keys(datasets);
  const target = (key: string): string | undefined => {
    const keyed = ids.filter((id) => datasets[id].key === key);
    const entity = key.replace(/_id$/, "");
    return keyed.find((id) => datasets[id].entities?.includes(entity)) ?? keyed[0];
  };
  const out: OssieRelationship[] = [];
  for (const from of ids) {
    const d = datasets[from];
    for (const f of fields) {
      if (!f.datasets?.includes(from) || !f.id.endsWith("_id") || f.id === d.key || f.id === d.date) continue;
      const to = target(f.id);
      if (!to || to === from) continue;
      const t = datasets[to];
      const withDate = t.kind === "snapshot";
      out.push({
        name: `${from}_${f.id}`,
        from,
        to,
        from_columns: withDate ? [f.id, d.date] : [f.id],
        to_columns: withDate ? [t.key, t.date] : [t.key],
      });
    }
  }
  return out;
}

const fillReference = (s: string): string => {
  const out = s
    .replace(/\{\{(\w+)@\w+\}\}/g, "$1")
    .replace(/\{\{_table:(\w+)\}\}/g, (_, ds: string) => physicalSource(ds))
    .replace(/\{\{_period_start\}\}/g, "p.period_start")
    .replace(/\{\{_period_end\}\}/g, "p.period_end");
  if (out.includes("{{")) throw new Error(`Unfilled placeholder in ${out}`);
  return out;
};

/**
 * The compiled SQL with every placeholder filled for the reference model, per
 * reporting period. A breakdown query (compile.ts) becomes one row per period
 * and dimension value: the spine crossed with the breakdown's domain, which
 * reads no period bound, so its correlated subqueries see both. A breakdown
 * reached through a key carries both the key and the label column.
 */
export function stagedSource(compiledSql: string): string {
  const b = /^SELECT ((?:_d\.\w+ AS \w+, )+)([^\n]*) AS \w+\nFROM \(([^\n]*)\) _d$/.exec(compiledSql);
  if (b) {
    const [, cols, scalar, domain] = b;
    // A keyed dataset's snapshot domain reads the period end: carry its date out and join on it
    // (portable, where a correlated derived table would need LATERAL).
    const dated = /^(SELECT DISTINCT [^\n]*?) FROM (\{\{_table:\w+\}\}) WHERE (\{\{\w+@\w+\}\}) = \{\{_period_end\}\}$/.exec(domain);
    const join = dated
      ? `JOIN (${fillReference(`${dated[1]}, ${dated[3]} AS _period FROM ${dated[2]}`)}) _d ON _d._period = p.period_end`
      : `CROSS JOIN (${fillReference(domain)}) _d`;
    return `SELECT p.period_start, p.period_end, ${cols}(${fillReference(scalar)}) AS value FROM ${PERIOD_SPINE} p ${join}`;
  }
  const m = /^SELECT ([\s\S]*) AS \w+$/.exec(compiledSql);
  if (!m) throw new Error(`Unexpected compiled SQL shape: ${compiledSql.slice(0, 80)}`);
  return `SELECT p.period_start, p.period_end, (${fillReference(m[1])}) AS value FROM ${PERIOD_SPINE} p`;
}

const FORM_LABEL: Record<string, string> = { O: "Operating form", M: "Market form" };

export function exportModel(data: StandardData): { model: OssieSemanticModel; coverage: Record<string, MetricCoverage> } {
  const ont = data.ontology;
  if (!ont?.fields || !ont.datasets || !data.formulas) throw new Error("Standard data has no fields, datasets or formulas");
  const fieldList = ont.fields;
  const ctx: EmitContext = { fields: Object.fromEntries(fieldList.map((f) => [f.id, f])), datasets: ont.datasets, formulas: data.formulas };

  const datasets = Object.entries(ont.datasets).map(([id, d]) => datasetOf(id, d, fieldList));
  const relationships = relationshipsOf(ont.datasets, fieldList);

  // Formula id → the metric record that owns it (stubs defer to another metric).
  const owner = new Map<string, Metric>();
  for (const m of data.metrics) {
    if (isMetricStub(m)) continue;
    const id = metricFormulaId(data, m);
    if (!owner.has(id)) owner.set(id, m);
  }

  const metrics: OssieMetric[] = [];
  const staged: OssieDataset[] = [];
  const coverage: Record<string, MetricCoverage> = {};

  for (const [id, f] of Object.entries(data.formulas)) {
    const m = owner.get(id);
    const entries: Array<{ key: string; variant?: string; form?: string; named?: boolean }> = [];
    if (f.formula || f.notComputable) entries.push({ key: id });
    for (const form of Object.keys(f.forms ?? {})) entries.push({ key: `${id}:${form}`, variant: form, form });
    for (const v of Object.keys(f.variants ?? {})) entries.push({ key: `${id}:${v}`, variant: v });
    for (const b of Object.keys(f.breakdowns ?? {})) entries.push({ key: `${id}:${b}`, variant: b, named: true });

    for (const e of entries) {
      const emission = emitMetric(id, ctx, e.variant);
      if (emission.kind === "notComputable") {
        coverage[e.key] = { kind: "notComputable", reason: emission.reason };
        continue;
      }
      const name = metricName(id, e.variant);
      const label = m?.name ?? id;
      const qualifier = e.form ? `, ${FORM_LABEL[e.form]}` : e.named ? `, ${e.variant} breakdown` : e.variant ? `, ${e.variant} variant` : "";
      const instructions = [m ? `Canonical definition: ${metricUrl(m)}.` : ""];
      const breakdown = breakdownOf(f, e.variant);
      // A breakdown reached through a key (plan_name on plan, via plan_id): the consumer joins to that dataset.
      const via = breakdown ? compileMetric(id, { fields: ctx.fields, datasets: ctx.datasets, formulas: ctx.formulas }, e.variant).breakdown?.via : undefined;
      const dimension = breakdown && via ? `${via.dataset}.${breakdown}` : breakdown;
      if (breakdown) {
        instructions.push(via
          ? `Broken down by ${dimension}: report one value per ${breakdown}${emission.kind === "direct" ? `, joining each dataset the expression reads to ${via.dataset} on ${via.key} (the model's relationship) and grouping on ${dimension}` : ""}.`
          : `Broken down by ${breakdown}: report one value per ${breakdown}${emission.kind === "direct" ? ` by grouping on the ${breakdown} field of each dataset the expression reads` : ""}.`);
      }
      let expression: string;
      if (emission.kind === "direct") {
        expression = emission.expression;
        coverage[e.key] = { kind: "direct", ossieName: name };
        if (emission.snapshots.length) {
          instructions.push(`Reads the ${emission.snapshots.join(" and ")} snapshot: select one snapshot date (the period end) with the time dimension, since summing snapshot rows across dates double counts.`);
        }
      } else {
        const dsName = stagedDatasetName(name);
        const compiled = compileMetric(id, { fields: ctx.fields, datasets: ctx.datasets, formulas: ctx.formulas }, e.variant);
        const bf = breakdown ? ctx.fields[breakdown] : undefined;
        staged.push({
          name: dsName,
          source: stagedSource(compiled.sql),
          description: `Staged dataset for ${name}: one row per reporting period${breakdown ? ` and ${breakdown} value` : ""} holding the metric value, computed by the GASP compiled query (needs ${emission.reasons.join(", ")}).`,
          primary_key: breakdown ? ["period_start", via ? via.key : breakdown] : ["period_start"],
          fields: [
            { name: "period_start", expression: sql("period_start"), dimension: { is_time: true }, datatype: "Date", description: "First day of the reporting period" },
            { name: "period_end", expression: sql("period_end"), datatype: "Date", description: "Last day of the reporting period" },
            ...(via ? [{ name: via.key, expression: sql(via.key), datatype: ossieDataType(ctx.fields[via.key]?.type ?? "string"), description: ctx.fields[via.key]?.description ?? via.key }] : []),
            ...(breakdown ? [{ name: breakdown, expression: sql(breakdown), datatype: bf ? ossieDataType(bf.type) : "String" as const, description: bf?.description ?? `Bucket label of ${label}` }] : []),
            { name: "value", expression: sql("value"), datatype: "Decimal", description: `${label}${qualifier} for the period${breakdown ? ` and ${breakdown}` : ""}` },
          ],
          // Ossie's dataset `source` is one string, so the other dialects' sources travel here (docs/ossie-spike.md).
          custom_extensions: gasp({
            staged: true, for: name, reason: emission.reason,
            source_dialect: "postgres",
            sources: Object.fromEntries(Object.entries(OSSIE_DIALECT_OF).map(([d, ossie]) => [
              ossie, stagedSource(compileMetric(id, { fields: ctx.fields, datasets: ctx.datasets, formulas: ctx.formulas, dialect: d as DialectName }, e.variant).sql),
            ])),
          }),
        });
        expression = `SUM(${dsName}.value)`;
        coverage[e.key] = { kind: "staged", ossieName: name, stagedDataset: dsName, reason: emission.reason };
        instructions.push(`Staged (${emission.reason}): ${dsName} holds one row per reporting period, so filter its period_start to one period. ${PERIOD_SPINE} is a table of (period_start, period_end) rows the adopter provides.`);
      }
      metrics.push({
        name,
        expression: sql(expression),
        description: `${label}${qualifier}. ${m?.definition ?? f.notes ?? ""}`.trim(),
        datatype: f.unit === "count" ? "Integer" : "Decimal",
        ai_context: { ...(m?.aliases?.length ? { synonyms: m.aliases } : {}), instructions: instructions.filter(Boolean).join(" ") },
        custom_extensions: gasp({
          gasp_id: id,
          gasp_version: "1",
          ...(e.form ? { form: e.form } : {}),
          ...(e.variant && !e.form ? { variant: e.variant } : {}),
          unit: f.unit,
          formula: formulaSource(f, e.variant),
          ...(breakdown ? { gasp_breakdown: dimension } : {}),
          ...(emission.kind === "staged" ? { staged: true } : {}),
        }),
      });
    }
  }

  const model: OssieSemanticModel = {
    version: OSSIE_VERSION,
    name: "GASP reference model",
    description: "GASP Standard reference model: the canonical SaaS datasets, their joins and every computable GASP metric. Sources and columns use the canonical names; an adopter's mapping replaces them. https://gaspwiki.com",
    datasets: [...datasets, ...staged],
    relationships,
    metrics,
  };
  return { model, coverage };
}
