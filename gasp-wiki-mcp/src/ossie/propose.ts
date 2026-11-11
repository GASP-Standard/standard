/**
 * Mapping proposer behind `propose_mapping`: a profiled semantic model to a
 * draft GASP mapping, level 2 of the readiness pipeline
 * (docs/ossie-interop-spec.md).
 *
 * The input is the model `profile_schema` wrote (or a schema, profiled on the
 * way in), or a company's own Ossie model. For every dataset the proposer
 * scores each GASP dataset on four signals, in order of weight: how many of
 * the dataset's columns find a GASP field of that dataset, how the profiled
 * kind, key and time field line up with the GASP dataset's declared ones, and
 * the name. For every column of a proposed pair it scores each GASP field of
 * the dataset: the same name, the structural role (the table's time field is
 * the dataset's date, its key the dataset's key), a synonym from the short
 * list here (the ontology carries none), the same words in another order or a
 * near name through the fuzzy matcher, each checked against the warehouse
 * type and, for an enum field, the listed values.
 *
 * Two transforms are proposed when the evidence is in the name or the values:
 * a column in cents becomes the field divided by 100, and enum values the
 * standard does not use are recoded (upgrade to expansion) when the recode
 * table knows them. Without a transform such a pair validates and computes
 * wrong numbers.
 *
 * Only a high-confidence pair goes into the mapping. A medium one is listed
 * as a candidate with its evidence and what would settle it; a low one is not
 * listed at all, so the agent sees the column as unmatched. The mapping comes
 * back as an Ossie mapping over the model (a transform becomes a calculated
 * field in the model, as `adapterToOssie` does), ready for `validate_mapping`,
 * and as the v1 adapter shape when asked. The candidates and the unmatched
 * tables travel in full in the mapping's GASP extension, so the Decide step
 * (decide.ts) can list what is open from the documents alone.
 */
import { fuzzyScore, words } from "../fuzzy.js";
import type { OntologyDataset, OntologyField, StandardData } from "../types.js";
import { checkAdapter, type Adapter } from "../tools.js";
import { GASP_ONTOLOGY_IRI, expressionText, isOssieModel, ossieSchemaErrors, parseDocument, resolveMapping } from "./adapt.js";
import { checkExport } from "./check.js";
import { ossieYaml } from "./index.js";
import { mappingOver, type MappingGap } from "./mapping.js";
import { ossieDataType, slug } from "./names.js";
import { exportOntology, planOntology } from "./ontology.js";
import { parseSchema, parseStatistics, profileSchema, sameWord, tableWords, type Confidence, type DatasetKind } from "./profile.js";
import { portable, readGaspExtension, writeGaspExtension, type OssieDataType, type OssieDataset, type OssieField, type OssieMapping, type OssieSemanticModel } from "./types.js";

// ── vocabulary ───────────────────────────────────────────────────────────────

/** Word-level abbreviations and aliases, applied to a column name before any comparison. */
const WORD_ALIASES: Record<string, string> = {
  sub: "subscription", subs: "subscription", subscr: "subscription",
  acct: "customer", account: "customer", accounts: "customer", client: "customer", cust: "customer", customers: "customer",
  emp: "employee", employees: "employee", opp: "opportunity", opps: "opportunity", oppty: "opportunity",
  proj: "project", qty: "quantity", amt: "amount", num: "number", txn: "transaction", svc: "service", mgr: "manager",
  dept: "department", org: "organization", cat: "category", desc: "description", pct: "percent", avg: "average",
  state: "status", ref: "id", key: "id", code: "id", uid: "id", uuid: "id", pk: "id",
};

/** GASP field id → column names that mean it, beyond what the aliases and the structural rules give. */
const FIELD_SYNONYMS: Record<string, string[]> = {
  event_type: ["movement_type", "movement", "change_type", "mrr_movement_type", "revenue_event_type", "type"],
  mrr: ["monthly_recurring_revenue", "mrr_amount", "monthly_revenue", "recurring_revenue"],
  arr: ["annual_recurring_revenue", "arr_amount"],
  mrr_change: ["mrr_delta", "delta_mrr", "mrr_movement", "movement_amount", "change_amount", "mrr_diff"],
  customer_id: ["account_number", "customer_number", "customer_key", "tenant_id", "org_id", "company_id"],
  snapshot_date: ["as_of", "as_of_date", "as_at", "asof", "asat", "snapshot_day", "snap_date", "snapshot_dt", "valid_from", "effective_date"],
  event_date: ["occurred_on", "occurred_at", "booked_on", "booked_at", "incurred_on", "happened_at", "event_time", "event_ts", "event_timestamp"],
  close_date: ["closed_on", "closed_date", "close_dt", "closed_at", "won_date", "closed_won_date"],
  hire_date: ["start_date", "started_on", "joined_on", "join_date", "hired_on", "hire_dt"],
  termination_date: ["end_date", "ended_on", "left_on", "leave_date", "terminated_on"],
  segment: ["customer_segment", "account_segment", "tier", "size_band"],
  plan_name: ["plan", "plan_label", "pricing_plan", "product_plan"],
  currency: ["currency_code", "ccy", "iso_currency"],
  invoice_amount: ["amount", "total", "invoice_total", "total_amount", "amount_due"],
  outstanding_amount: ["balance", "balance_due", "amount_outstanding", "open_amount", "unpaid_amount"],
  hours: ["hours_logged", "logged_hours", "time_hours", "hours_worked"],
  seats_assigned: ["assigned_seats", "seats_used", "used_seats", "active_seats"],
  seats_purchased: ["purchased_seats", "seats", "seat_count", "licensed_seats"],
  user_id: ["member_id", "person_id", "login_id"],
  created_at: ["created_on", "created_date", "opened_at", "opened_on", "open_date"],
  resolved_at: ["resolved_on", "resolution_date", "closed_at", "closed_on"],
  acquisition_date: ["signup_date", "signed_up_on", "became_customer_on", "first_purchase_date"],
  contract_start: ["contract_began", "contract_begin_date", "contract_start_date", "contract_from", "term_start"],
  contract_end: ["contract_ended", "contract_end_date", "contract_to", "contract_until", "term_end"],
  trial_status: ["outcome", "trial_outcome", "trial_result"],
};

/** Standard enum value ← values a warehouse uses for it. Only applied to a field that declares the standard value. */
const RECODE: Record<string, string[]> = {
  expansion: ["upgrade", "upgraded", "upsell", "increase", "expand", "expanded", "growth"],
  contraction: ["downgrade", "downgraded", "downsell", "decrease", "reduce", "reduced", "shrink"],
  churn: ["cancel", "cancelled", "canceled", "cancellation", "churned", "lost", "closed_lost", "terminated"],
  reactivation: ["reactivate", "reactivated", "winback", "win_back", "returned", "resurrected"],
  renewal: ["renew", "renewed", "renewals"],
  new: ["new_business", "new_logo", "acquisition", "signup", "won", "closed_won", "initial"],
  active: ["live", "current", "enabled", "ok", "open"],
  churned: ["cancelled", "canceled", "lost", "closed", "inactive"],
  cancelled: ["canceled", "cancel", "churned"],
  paused: ["suspended", "on_hold", "hold"],
  expired: ["lapsed", "ended"],
  terminated: ["left", "departed", "exited"],
  on_leave: ["leave", "sabbatical"],
  paid: ["settled", "complete", "completed", "closed"],
  unpaid: ["open", "due", "outstanding", "pending"],
  written_off: ["writeoff", "write_off", "bad_debt"],
};

const DATE_WORDS = new Set(["on", "at", "date", "day", "dt", "ts", "time", "timestamp"]);
const ID_WORDS = new Set(["id", "ref", "key", "code", "uid", "uuid", "pk", "number", "no"]);
const UNIT_SUFFIX = /_(cents|pence|minor)$/;

const alias = (w: string): string => WORD_ALIASES[w] ?? w;

/** The column's words after aliases: `account_ref` → ["customer", "id"], `sub_ref` → ["subscription", "id"]. */
function columnWords(column: string): string[] {
  const ws = words(column).map(alias);
  if (ws.length > 1 && ID_WORDS.has(ws[ws.length - 1])) ws[ws.length - 1] = "id";
  return ws;
}

const sameWords = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().join(" ") === [...b].sort().join(" ");

/** Whether an Ossie datatype can carry a GASP field type. */
function compatible(column: OssieDataType | undefined, field: string): boolean {
  if (!column) return true;
  switch (field) {
    case "decimal": case "integer": return ["Integer", "Decimal", "Float"].includes(column);
    case "string": case "enum": return column === "String";
    case "boolean": return column === "Boolean" || column === "Integer";
    case "date": return ["Date", "DateTime", "DateTimeTz"].includes(column);
    case "timestamp": return ["DateTime", "DateTimeTz", "Date"].includes(column);
    default: return column !== "Opaque";
  }
}

// ── the model as the proposer reads it ───────────────────────────────────────

export interface Column {
  name: string;
  datatype?: OssieDataType;
  /** Listed values (from the profile, or `ai_context.instructions` "One of ...") */
  values?: string[];
  /** Whether the model field is the bare column (a calculated field is left alone) */
  bare: boolean;
}

export interface Table {
  name: string;
  source: string;
  columns: Column[];
  kind?: DatasetKind;
  kindConfidence?: Confidence;
  key: string[];
  time?: string;
}

/** The model as the proposer and the Decide step read it: one table per dataset with the profile's kind, key, time field and listed values. */
export function readModel(model: OssieSemanticModel): Table[] {
  return model.datasets.map((d) => {
    const profile = readGaspExtension<{ profile?: { kind?: DatasetKind; confidence?: { kind?: Confidence }; values?: Record<string, string[]> } }>(d.nonportable_extensions)?.profile ?? {};
    const columns: Column[] = (d.fields ?? []).map((f) => {
      const text = expressionText(f);
      const hint = typeof f.ai_context === "object" ? f.ai_context?.instructions : undefined;
      const listed = profile.values?.[f.name] ?? (typeof hint === "string" ? hint.match(/^One of (.+)$/)?.[1]?.split(", ") : undefined);
      return { name: f.name, datatype: f.datatype, ...(listed?.length ? { values: listed.map(String) } : {}), bare: !text || text.trim() === f.name };
    });
    const time = (d.fields ?? []).find((f) => f.dimension?.is_time)?.name;
    return { name: d.name, source: d.source ?? d.name, columns, kind: profile.kind, kindConfidence: profile.confidence?.kind, key: d.primary_key ?? [], time };
  });
}

// ── column to field ──────────────────────────────────────────────────────────

export interface FieldMatch {
  column: string;
  field: string;
  score: number;
  confidence: Confidence;
  evidence: string;
  transform?: string;
  /** The model field the mapping reads when a transform made a calculated field */
  modelField?: string;
  /** What would settle a medium match */
  settle?: string;
}

/** A column's name against a field's, in 0..1 with the reason. The structural rules are applied by the caller. */
function nameScore(column: string, f: OntologyField): { score: number; evidence: string; cents?: boolean } | undefined {
  const col = column.toLowerCase();
  if (col === f.id) return { score: 1, evidence: "same name" };
  const stem = col.replace(UNIT_SUFFIX, "");
  if (stem !== col && (stem === f.id || columnWords(stem).join("_") === f.id)) return { score: 0.92, evidence: `the name less its unit suffix`, cents: true };
  const cw = columnWords(col);
  if (cw.join("_") === f.id) return { score: 0.9, evidence: `\`${col}\` reads as ${f.id}` };
  if (FIELD_SYNONYMS[f.id]?.includes(col) || FIELD_SYNONYMS[f.id]?.includes(cw.join("_"))) return { score: 0.9, evidence: `a synonym of ${f.id}` };
  const fw = f.id.split("_");
  if (sameWords(cw, fw)) return { score: 0.9, evidence: "the same words in another order" };
  const dated = ["date", "timestamp"].includes(f.type);
  const strip = (ws: string[]) => (dated && ws.length > 1 ? ws.filter((w) => !DATE_WORDS.has(w)) : ws).filter((w) => w !== "id" || ws.length === 1);
  const a = strip(cw).join(" "), b = strip(fw).join(" ");
  if (!a || !b) return undefined;
  if (a === b) return { score: 0.85, evidence: `the same name but for a date suffix` };
  const s = Math.max(fuzzyScore(a, b), fuzzyScore(b, a));
  if (s >= 0.6) return { score: s * 0.9, evidence: `near ${f.id} (${Math.round(s * 100)}% of the words)` };
  return undefined;
}

/** The recode a column's values need to be the field's, or why they cannot be. */
function enumFit(values: string[] | undefined, f: OntologyField): { ok: boolean; transform?: string; evidence: string } {
  if (!f.values?.length) return { ok: true, evidence: "" };
  if (!values?.length) return { ok: true, evidence: `values not listed; the standard's are ${f.values.join(", ")}` };
  const declared = new Set(f.values);
  const cases: Array<[string, string]> = [];
  const unknown: string[] = [];
  for (const v of values) {
    if (declared.has(v)) continue;
    const to = f.values.find((d) => RECODE[d]?.includes(v.toLowerCase()));
    if (to) cases.push([v, to]);
    else unknown.push(v);
  }
  if (unknown.length) return { ok: false, evidence: `values ${unknown.join(", ")} are not among the standard's ${f.values.join(", ")} and no recode is known for them` };
  if (!cases.length) return { ok: true, evidence: "the listed values are the standard's" };
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  return {
    ok: true,
    transform: `CASE ${cases.map(([from, to]) => `WHEN {{value}} = ${q(from)} THEN ${q(to)}`).join(" ")} ELSE {{value}} END`,
    evidence: `values recoded: ${cases.map(([from, to]) => `${from} to ${to}`).join(", ")}`,
  };
}

/**
 * Every column of the table against every field of the GASP dataset, assigned
 * greedily, best pair first. A column ending in status, type, kind or stage
 * that names no field is the dataset's field of that suffix when there is one
 * such field, or the one named for the dataset (`partner_status` on partner)
 * when there are several.
 */
export function matchColumns(t: Table, ds: string, meta: OntologyDataset, fields: OntologyField[]): FieldMatch[] {
  const pairs: FieldMatch[] = [];
  const keyColumns = t.key.filter((k) => k !== t.time);
  const suffixField = (word: string): OntologyField | undefined => {
    const ending = fields.filter((x) => x.id.endsWith(`_${word}`));
    return ending.length === 1 ? ending[0] : ending.find((x) => x.id === `${ds}_${word}`);
  };
  for (const c of t.columns) {
    if (!c.bare || c.datatype === "Opaque") continue;
    const cw = columnWords(c.name);
    const last = cw[cw.length - 1];
    const suffix = /^(status|type|kind|stage)$/.test(last) && !fields.some((x) => x.id === c.name.toLowerCase()) ? suffixField(last) : undefined;
    for (const f of fields) {
      let best: { score: number; evidence: string; cents?: boolean } | undefined = nameScore(c.name, f);
      if (suffix === f && (!best || best.score < 0.88)) best = { score: 0.88, evidence: `the dataset's ${cw.length === 1 && f.id === `${ds}_${last}` ? "own" : "one"} ${last} field` };
      if (c.name === t.time && f.id === meta.date) best = { score: Math.max(0.95, best?.score ?? 0), evidence: best?.score === 1 ? "same name; the table's time field" : "the table's time field is the dataset's date" };
      else if (keyColumns.length === 1 && c.name === keyColumns[0] && f.id === meta.key) best = { score: Math.max(0.95, best?.score ?? 0), evidence: best?.score === 1 ? "same name; the table's key" : "the table's key is the dataset's key" };
      if (!best) continue;
      const typeOk = compatible(c.datatype, f.type);
      const fit = enumFit(c.values, f);
      const evidence = [best.evidence, typeOk ? "" : `the column is ${c.datatype} where GASP expects ${f.type}`, fit.evidence].filter(Boolean).join("; ");
      let transform = fit.transform;
      if (best.cents) transform = "{{value}} / 100";
      const high = best.score >= 0.85 && typeOk && fit.ok;
      const medium = best.score >= 0.6 || (best.score > 0 && (!typeOk || !fit.ok));
      if (!high && !medium) continue;
      const settle = !high ? (!typeOk ? "cast the column or confirm its type" : !fit.ok ? "add a CASE transform for the values listed, or confirm they mean something else" : "confirm the name means the same thing") : undefined;
      pairs.push({ column: c.name, field: f.id, score: high ? best.score : Math.min(best.score, 0.84), confidence: high ? "high" : "medium", evidence, ...(transform ? { transform } : {}), ...(settle ? { settle } : {}) });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.column.localeCompare(b.column));
  const usedC = new Set<string>(), usedF = new Set<string>();
  const out: FieldMatch[] = [];
  for (const p of pairs) {
    if (usedC.has(p.column) || usedF.has(p.field)) continue;
    usedC.add(p.column); usedF.add(p.field);
    out.push(p);
  }
  return out;
}

// ── table to dataset ─────────────────────────────────────────────────────────

export interface DatasetMatch {
  table: string;
  source: string;
  dataset: string;
  score: number;
  /** How well the table's name matches the dataset's, 0 to 1 */
  name: number;
  confidence: Confidence;
  evidence: string;
  fields: FieldMatch[];
  /** Columns no field matched at any confidence */
  unmatched: string[];
}

function scoreDataset(t: Table, ds: string, meta: OntologyDataset, fields: OntologyField[]): Omit<DatasetMatch, "confidence"> {
  const matches = matchColumns(t, ds, meta, fields);
  const usable = t.columns.filter((c) => c.bare && c.datatype !== "Opaque");
  const tableCoverage = usable.length ? matches.length / usable.length : 0;
  const datasetCoverage = fields.length ? matches.length / fields.length : 0;
  const kind = !t.kind || t.kindConfidence === "low" ? 0.5 : t.kind === meta.kind ? 1 : 0;
  const key = matches.some((m) => m.field === meta.key && m.confidence === "high") ? 1 : 0;
  const time = matches.some((m) => m.field === meta.date && m.confidence === "high") ? 1 : 0;
  const tw = tableWords(t.source).map(alias);
  const name = Math.max(sameWord(tw.join("_"), ds) ? 1 : 0, fuzzyScore(tw.join(" "), ds), fuzzyScore(ds, tw.join(" ")), fuzzyScore(tw.join(" "), meta.label));
  const score = 0.45 * tableCoverage + 0.15 * datasetCoverage + 0.1 * kind + 0.1 * key + 0.1 * time + 0.1 * name;
  const high = matches.filter((m) => m.confidence === "high").length;
  const parts = [
    `${high} of ${usable.length} columns name GASP fields of ${ds}${matches.length > high ? ` (${matches.length - high} more near)` : ""}`,
    !t.kind ? "the table's kind is not profiled" : t.kind === meta.kind ? `kind ${t.kind} matches` : t.kindConfidence === "low" ? `the profile's kind ${t.kind} was a low-confidence guess` : `the table is ${t.kind === "reference" ? "a reference table" : `a ${t.kind} table`} where GASP's ${ds} is ${meta.kind === "event" ? "an event" : `a ${meta.kind}`} table`,
    key ? `its key is the dataset's key ${meta.key}` : "",
    time ? `its time field is the dataset's ${meta.date}` : "",
    name >= 0.8 ? "the name matches" : "",
  ].filter(Boolean);
  return { table: t.name, source: t.source, dataset: ds, score, name, evidence: parts.join(", "), fields: matches, unmatched: usable.filter((c) => !matches.some((m) => m.column === c.name)).map((c) => c.name) };
}

// ── the proposal ─────────────────────────────────────────────────────────────

export interface Candidate {
  table: string;
  source: string;
  column?: string;
  dataset: string;
  field?: string;
  evidence: string;
  settle: string;
}

export interface ProposalResult {
  organization: string;
  model: OssieSemanticModel;
  mapping: OssieMapping;
  adapter: Adapter;
  /** Tables proposed to a GASP dataset, with their high-confidence field pairs */
  proposed: DatasetMatch[];
  /** Tables and columns the evidence supports without settling */
  candidates: Candidate[];
  /** Tables no GASP dataset matches */
  unmatchedTables: Array<{ table: string; source: string; best?: { dataset: string; score: number } }>;
  gaps: MappingGap[];
  /** Unmatched column → the GASP datasets that carry a field of that name, when the proposed dataset does not */
  elsewhere: Record<string, string[]>;
  coverage: { fully: number; partial: number; metrics: number };
  problems: string[];
}

/** The calculated field a transform becomes: named for the GASP field (`<id>_gasp` when the dataset has a field of that name), the transform over the column. */
export function calculatedField(existing: OssieField[], field: OntologyField, column: string, transform: string, why: string): OssieField {
  const name = existing.some((x) => x.name === field.id) ? `${field.id}_gasp` : field.id;
  return { name, expression: portable(transform.replace(/\{\{value\}\}/g, column)), datatype: ossieDataType(field.type), description: `GASP ${field.id} from ${column}: ${why}` };
}

/** Propose a GASP mapping over a semantic model, profiled or a company's own. */
export function proposeMapping(model: OssieSemanticModel, data: StandardData, opts: { organization?: string } = {}): ProposalResult {
  const organization = opts.organization?.trim() || model.name.replace(/ semantic model$/i, "") || "Company";
  const plan = planOntology(data);
  const datasets = data.ontology?.datasets ?? {};
  const fieldById = new Map((data.ontology?.fields ?? []).map((f) => [f.id, f]));
  const tables = readModel(model);
  const problems: string[] = [];

  // Every table against every GASP dataset; the best per table, then one table per dataset.
  const scored = tables.map((t) => {
    const all = Object.entries(datasets).map(([ds, meta]) => scoreDataset(t, ds, meta, plan.fieldsOf(ds))).sort((a, b) => b.score - a.score);
    return { t, all };
  });
  const confidenceOf = (m: Omit<DatasetMatch, "confidence">, t: Table, runnerUp?: number): Confidence => {
    const meta = datasets[m.dataset];
    const usable = t.columns.filter((c) => c.bare && c.datatype !== "Opaque").length;
    const high = m.fields.filter((f) => f.confidence === "high").length;
    const kindOk = !t.kind || t.kind === meta.kind || t.kindConfidence === "low";
    const anchored = m.fields.some((f) => f.confidence === "high" && (f.field === meta.key || f.field === meta.date)) || m.name >= 0.8;
    if (kindOk && usable && high / usable >= 0.5 && anchored && m.score - (runnerUp ?? 0) >= 0.1) return "high";
    // A candidate needs more than its time field and a shared key column: two further named fields, or the name.
    if (m.score >= 0.35 && (high - (m.fields.some((f) => f.field === meta.date && f.confidence === "high") ? 1 : 0) >= 3 || m.name >= 0.8)) return "medium";
    return "low";
  };
  const proposed: DatasetMatch[] = [];
  const candidates: Candidate[] = [];
  const unmatchedTables: ProposalResult["unmatchedTables"] = [];
  const taken = new Map<string, string>();
  for (const { t, all } of scored.sort((a, b) => b.all[0].score - a.all[0].score)) {
    const best = all[0];
    const conf = confidenceOf(best, t, all[1]?.score);
    if (conf === "high" && !taken.has(best.dataset)) {
      taken.set(best.dataset, t.name);
      proposed.push({ ...best, confidence: "high" });
      continue;
    }
    if (conf === "low") { unmatchedTables.push({ table: t.name, source: t.source, ...(best.score >= 0.2 ? { best: { dataset: best.dataset, score: best.score } } : {}) }); continue; }
    const other = taken.get(best.dataset);
    candidates.push({
      table: t.name, source: t.source, dataset: best.dataset,
      evidence: `${best.evidence}${all[1] && best.score - all[1].score < 0.1 ? `; ${all[1].dataset} scores nearly as well` : ""}${other ? `; ${other} is already proposed as ${best.dataset}` : ""}`,
      settle: other ? `decide which table carries ${best.dataset}, or whether this one is another GASP dataset` : t.kind && t.kind !== datasets[best.dataset].kind ? `confirm the table is ${best.dataset} despite its kind${t.kind === "reference" ? " (a reference table has no time field; GASP would read it as a snapshot with a fixed date)" : ""}` : "confirm the dataset, then map its columns",
    });
  }
  proposed.sort((a, b) => a.table.localeCompare(b.table));
  for (const p of proposed) {
    for (const f of p.fields.filter((x) => x.confidence === "medium")) candidates.push({ table: p.table, source: p.source, column: f.column, dataset: p.dataset, field: f.field, evidence: f.evidence, settle: f.settle ?? "confirm" });
    p.fields = p.fields.filter((x) => x.confidence === "high");
  }

  // The model with a calculated field per transform, and the mapping over it.
  const modelDatasets: OssieDataset[] = model.datasets.map((d) => {
    const p = proposed.find((x) => x.table === d.name);
    const extra: OssieField[] = [];
    for (const f of p?.fields ?? []) {
      if (!f.transform) continue;
      const calc = calculatedField([...(d.fields ?? []), ...extra], fieldById.get(f.field)!, f.column, f.transform, f.evidence);
      extra.push(calc);
      f.modelField = calc.name;
    }
    return extra.length ? { ...d, fields: [...(d.fields ?? []), ...extra] } : d;
  });
  const out: OssieSemanticModel = { ...model, datasets: modelDatasets };
  const names: Record<string, Record<string, { dataset: string; field: string }>> = {};
  for (const p of proposed) names[p.dataset] = Object.fromEntries(p.fields.map((f) => [f.field, { dataset: p.table, field: f.modelField ?? f.column }]));
  const base = slug(organization);
  const { mapping, gaps } = mappingOver(data, {
    name: `gasp_mapping_${base}`,
    description: `Proposed by the GASP mapping proposer from ${model.name}: ${proposed.length} datasets, ${proposed.reduce((n, p) => n + p.fields.length, 0)} fields; ${candidates.length} candidates to review.`,
    ontologyIri: GASP_ONTOLOGY_IRI,
    modelName: out.name,
    modelIri: `./${base}.semantic_model.yaml`,
    datasets: proposed.map((p) => p.dataset),
    include: (ds, f) => Boolean(names[ds]?.[f]),
    expr: (ds, f) => `${names[ds][f].dataset}.${names[ds][f].field}`,
    nonportable_extensions: writeGaspExtension(undefined, { organization, proposed: { datasets: proposed.length, fields: proposed.reduce((n, p) => n + p.fields.length, 0), transforms: proposed.reduce((n, p) => n + p.fields.filter((f) => f.transform).length, 0), candidates, unmatched: unmatchedTables } }),
  });
  const resolved = resolveMapping(mapping, out, data);
  problems.push(...resolved.problems);
  const schema = ossieSchemaErrors(mapping, "mapping", data);
  if (schema?.length) problems.push(...schema.map((e) => `mapping: ${e}`));
  problems.push(...checkExport({ ontology: exportOntology(data), model: out, mapping }, { extensionSchema: data.extensionSchema }));
  const cov = proposed.length ? checkAdapter(resolved.adapter, data) : undefined;
  const elsewhere: Record<string, string[]> = {};
  for (const p of proposed) for (const c of p.unmatched) { const f = fieldById.get(c.toLowerCase()); if (f?.datasets?.length && !f.datasets.includes(p.dataset)) elsewhere[c] = f.datasets; }
  return {
    organization, model: out, mapping, adapter: resolved.adapter, proposed, candidates, unmatchedTables, gaps, elsewhere,
    coverage: { fully: cov?.fully.length ?? 0, partial: cov?.partial.length ?? 0, metrics: data.dataRequirements.length },
    problems,
  };
}

// ── report ───────────────────────────────────────────────────────────────────

export function formatProposalReport(r: ProposalResult): string {
  const lines: string[] = [`# Mapping proposal: ${r.organization}`, ""];
  const tables = r.proposed.length + r.candidates.filter((c) => !c.column).length + r.unmatchedTables.length;
  const columns = r.model.datasets.reduce((n, d) => n + (d.fields?.length ?? 0), 0) - r.proposed.reduce((n, p) => n + p.fields.filter((f) => f.transform).length, 0);
  const fields = r.proposed.reduce((n, p) => n + p.fields.length, 0);
  const transforms = r.proposed.reduce((n, p) => n + p.fields.filter((f) => f.transform).length, 0);
  const unmatched = r.proposed.reduce((n, p) => n + p.unmatched.length, 0);
  lines.push(`**Proposed:** ${r.proposed.length} of ${tables} tables to GASP datasets and ${fields} of ${columns} columns to GASP fields${transforms ? ` (${transforms} with a transform)` : ""}; ${r.candidates.length} candidate${r.candidates.length === 1 ? "" : "s"} to review; ${unmatched} column${unmatched === 1 ? "" : "s"} of the proposed tables unmatched.`);
  lines.push(`**Covers:** ${r.coverage.fully} of ${r.coverage.metrics} GASP metrics with a formula fully and ${r.coverage.partial} partly with the proposed pairs alone.`);
  for (const g of r.gaps) lines.push(`**Gap:** dataset \`${g.dataset}\` is left out of the mapping: ${g.reason}.`);
  if (r.problems.length) lines.push("", "**Problems:**", ...r.problems.map((p) => `- ${p}`));
  lines.push("", "## Proposed");
  if (!r.proposed.length) lines.push("", "No table matched a GASP dataset at high confidence.");
  for (const p of r.proposed) {
    lines.push("", `### ${p.source}${p.source !== p.table ? ` (${p.table})` : ""} → ${p.dataset} (high confidence: ${p.evidence})`);
    for (const f of p.fields) lines.push(`- ${f.column} → ${f.field} (${f.evidence})${f.transform ? `; transform \`${f.transform}\`` : ""}`);
    if (p.unmatched.length) lines.push(`- unmatched: ${p.unmatched.map((c) => `${c}${r.elsewhere[c] ? ` (a GASP field of ${r.elsewhere[c].join(", ")})` : ""}`).join(", ")}`);
  }
  if (r.candidates.length) {
    lines.push("", `## Candidates (${r.candidates.length})`, "", "For the Decide step: each is a pair the evidence supports without settling. Add the ones you accept to the mapping.", "");
    for (const c of r.candidates) lines.push(`- ${c.source}${c.column ? `.${c.column}` : ""} → ${c.dataset}${c.field ? `.${c.field}` : ""} (medium confidence: ${c.evidence}). To settle: ${c.settle}.`);
  }
  if (r.unmatchedTables.length) {
    lines.push("", `## Tables without a GASP dataset (${r.unmatchedTables.length})`, "");
    for (const t of r.unmatchedTables) lines.push(`- ${t.source}${t.best ? ` (nearest: ${t.best.dataset}, too few of its columns match)` : ""}`);
  }
  lines.push("", "## Next", "", r.candidates.length ? "Take the candidates to the people who know the data and record their answers with record_decision (the mapping and the model as given), then pass the mapping to validate_mapping with the model as `semantic_model`, compile_model and score_drift." : "Pass the mapping to validate_mapping with the model as `semantic_model` (it lists the fields the metrics still need), then compile_model and score_drift; record_decision records metric owners and judgement calls on the way.");
  return lines.join("\n");
}

export interface ProposeOptions {
  organization?: string;
  output?: "report" | "mapping" | "model" | "adapter" | "json";
}

/** The tool: a semantic model (profiled or the company's own) or a schema to profile, to the proposal. */
export function proposeMappingFromText(modelText: string | undefined, schemaText: string | undefined, statisticsText: string | undefined, data: StandardData, opts: ProposeOptions = {}): string {
  let model: OssieSemanticModel | undefined;
  if (modelText?.trim()) {
    const m = parseDocument(modelText);
    if (!m.doc) return `Invalid semantic model. ${m.error}`;
    if (!isOssieModel(m.doc)) return "The semantic model must be an Ossie semantic model document (an object with a \"datasets\" array), such as the one profile_schema returns.";
    model = m.doc;
  } else if (schemaText?.trim()) {
    const schema = parseSchema(schemaText);
    if ("error" in schema) return schema.error;
    const stats = parseStatistics(statisticsText);
    if ("error" in stats) return stats.error;
    model = profileSchema(schema, stats.stats, data, { organization: opts.organization }).model;
  } else return "Pass semantic_model (the model profile_schema returned, or your own Ossie model) or schema (the warehouse schema, profiled on the way in).";
  const r = proposeMapping(model, data, { organization: opts.organization });
  if (opts.output === "json") return JSON.stringify({ organization: r.organization, proposed: r.proposed, candidates: r.candidates, unmatchedTables: r.unmatchedTables, elsewhere: r.elsewhere, gaps: r.gaps, coverage: r.coverage, problems: r.problems, mapping: r.mapping, model: r.model, adapter: r.adapter }, null, 2);
  if (opts.output === "mapping") return ossieYaml(r.mapping);
  if (opts.output === "model") return ossieYaml(r.model);
  if (opts.output === "adapter") return JSON.stringify(r.adapter, null, 2);
  const changed = r.proposed.some((p) => p.fields.some((f) => f.transform));
  return `${formatProposalReport(r)}\n\n## Mapping\n\nThe proposed pairs as an Ossie mapping over ${changed ? "the model below (it gained a calculated field per transform)" : "the model as given"}; \`output: adapter\` gives the same as a GASP adapter.\n\n\`\`\`yaml\n${ossieYaml(r.mapping)}\`\`\`\n${changed ? `\n## Semantic model\n\n\`\`\`yaml\n${ossieYaml(r.model)}\`\`\`\n` : ""}`;
}
