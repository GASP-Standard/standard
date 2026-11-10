/**
 * The Decide step behind `record_decision`: the judgement calls an agent
 * cannot make, answered by named people and recorded in the mapping
 * (docs/ossie-interop-spec.md, readiness level 2).
 *
 * The profiler leaves a question wherever the names cannot settle a key, a
 * time field or a type, and the proposer leaves a candidate wherever the
 * evidence supports a pair without settling it. Both travel in full in the
 * documents' GASP extensions, so this step reads the model and the mapping
 * alone. A decision names its subject by content (the dataset, the column,
 * the GASP dataset or field, the metric, the topic), never by a generated id,
 * and carries the owner who made it and the date.
 *
 * Four kinds are applied: a profiler question answered (the key, the time
 * field, the kind or a datatype, written into the model in place), a
 * candidate accepted or rejected (a table to a GASP dataset, with its columns
 * matched as the proposer would; a column to a field, with an optional
 * transform that becomes a calculated field), a metric owner (written to
 * `metricOwners`, the slot `validate_mapping` reads) and a named judgement
 * call GASP cannot apply (which system owns customer identity, the reporting
 * currency, the churn date), recorded with its answer. Every decision lands
 * in `decisions[]` of the mapping's GASP extension, keyed by its subject so a
 * later decision on the same subject replaces the earlier one.
 *
 * Called with no decisions it lists what is open: the questions no decision
 * or model state has settled, the candidates no decision has settled and the
 * covered metrics without an owner. Readiness level 2 is reached when no
 * question and no candidate is open.
 */
import { closest } from "../fuzzy.js";
import { resolveMetric } from "../loader.js";
import type { OntologyField, StandardData } from "../types.js";
import { checkAdapter, suggestMatches, type Adapter } from "../tools.js";
import { expressionText, isOssieMapping, isOssieModel, ossieSchemaErrors, parseDocument, resolveMapping, type ModelRefs } from "./adapt.js";
import { checkExport } from "./check.js";
import { ossieYaml } from "./index.js";
import { mappingOver, type MappingGap } from "./mapping.js";
import { bareName } from "./names.js";
import { exportOntology, planOntology } from "./ontology.js";
import type { DatasetKind, Question } from "./profile.js";
import { calculatedField, matchColumns, readModel, type Candidate } from "./propose.js";
import { readGaspExtension, writeGaspExtension, type OssieDataType, type OssieDataset, type OssieMapping, type OssieSemanticModel } from "./types.js";
import { parse as parseYaml } from "yaml";

export type DecisionAbout = "key" | "time" | "kind" | "type" | "table" | "field" | "owner" | "topic";

const ABOUTS: DecisionAbout[] = ["key", "time", "kind", "type", "table", "field", "owner", "topic"];
const KINDS: DatasetKind[] = ["snapshot", "event", "fact", "reference"];
const TYPES: OssieDataType[] = ["String", "Integer", "Decimal", "Float", "Boolean", "Date", "Time", "DateTime", "DateTimeTz", "Opaque"];

/** A decision as given to the tool. */
export interface Decision {
  about: DecisionAbout;
  /** The model dataset the decision is about, by its name or its source table (key, time, kind, type, table, field) */
  dataset?: string;
  /** The column (type, field) */
  column?: string;
  /** The GASP dataset (table) or GASP field (field) */
  to?: string;
  /** key: the key columns (or "none"); time: the time column (or "none"); kind: snapshot, event, fact or reference; type: an Ossie datatype; topic: the answer */
  answer?: string | string[];
  /** table, field: accepted (the default) or rejected */
  accept?: boolean;
  /** field: a transform over `{{value}}` that becomes a calculated field */
  transform?: string;
  /** owner: the metric */
  metric?: string;
  /** owner: how to reach the owner */
  contact?: string;
  /** topic: the question decided */
  topic?: string;
  /** Who decided (owner: the team that owns the metric) */
  owner: string;
  /** ISO date; today when omitted */
  date?: string;
  note?: string;
}

/** A decision as recorded in the mapping. */
export interface DecisionRecord extends Decision {
  date: string;
  /** What applying it did */
  effect: string;
}

interface Extension {
  organization?: string;
  warehouse?: string;
  proposed?: { datasets?: number; fields?: number; transforms?: number; candidates?: Candidate[]; unmatched?: Array<{ table: string; source: string; best?: { dataset: string; score: number } }> };
  metricOwners?: Adapter["metricOwners"];
  decisions?: DecisionRecord[];
  [k: string]: unknown;
}

interface Profile {
  kind?: DatasetKind;
  confidence?: Record<string, string>;
  evidence?: Record<string, string>;
  questions?: Question[];
  [k: string]: unknown;
}

export interface DecideResult {
  organization: string;
  model: OssieSemanticModel;
  mapping: OssieMapping;
  adapter: Adapter;
  /** The decisions of this run that changed the model or the mapping */
  applied: DecisionRecord[];
  /** The decisions of this run recorded without a change to apply */
  recorded: DecisionRecord[];
  /** Every decision on file after this run */
  decisions: DecisionRecord[];
  problems: string[];
  open: { questions: Question[]; candidates: Candidate[]; unowned: string[] };
  gaps: MappingGap[];
  /** Whether the model changed (a key, time field, kind, type or calculated field) */
  modelChanged: boolean;
  /** Readiness level 2: no open question and no open candidate */
  level2: boolean;
}

const today = (): string => new Date().toISOString().slice(0, 10);
const readExt = readGaspExtension;
const writeExt = writeGaspExtension;

/** The subject a decision settles; a later decision on the same subject replaces the earlier one. */
export function subjectOf(d: Decision): string {
  switch (d.about) {
    case "key": case "time": case "kind": return `${d.about}:${d.dataset}`;
    case "type": return `type:${d.dataset}.${d.column}`;
    case "table": return `table:${d.dataset}>${d.to}`;
    case "field": return `field:${d.dataset}.${d.column}>${d.to}`;
    case "owner": return `owner:${(d.metric ?? "").toLowerCase().trim()}`;
    case "topic": return `topic:${(d.topic ?? "").toLowerCase().trim()}`;
  }
}

const describe = (d: Decision): string => {
  switch (d.about) {
    case "key": case "time": case "kind": return `${d.dataset} ${d.about}`;
    case "type": return `${d.dataset}.${d.column} type`;
    case "table": return `${d.dataset} → ${d.to}`;
    case "field": return `${d.dataset}.${d.column} → ${d.to}`;
    case "owner": return `${d.metric} owner`;
    case "topic": return `${d.topic}`;
  }
};

/** The questions still open in a model: a question the state has not settled and no decision has answered. */
export function openQuestions(model: OssieSemanticModel, decisions: DecisionRecord[]): Question[] {
  const decided = new Set(decisions.map(subjectOf));
  const out: Question[] = [];
  for (const d of model.datasets) {
    const profile = readExt<{ profile?: Profile }>(d.custom_extensions)?.profile;
    const questions = Array.isArray(profile?.questions) ? profile.questions : [];
    for (const q of questions) {
      const settled = q.about === "key" ? Boolean(d.primary_key?.length) || decided.has(`key:${d.name}`)
        : q.about === "time" ? (d.fields ?? []).some((f) => f.dimension?.is_time) || decided.has(`time:${d.name}`)
        : (d.fields ?? []).every((f) => f.datatype !== "Opaque" || decided.has(`type:${d.name}.${f.name}`));
      if (!settled) out.push(q);
    }
  }
  return out;
}

/** Record decisions against a model and its mapping; with none, list what is open. */
export function recordDecisions(model: OssieSemanticModel, mapping: OssieMapping, decisions: Decision[], data: StandardData): DecideResult {
  const plan = planOntology(data);
  const datasets = data.ontology?.datasets ?? {};
  const fieldById = new Map((data.ontology?.fields ?? []).map((f) => [f.id, f]));
  const ext: Extension = readExt<Extension>(mapping.custom_extensions) ?? {};
  const organization = ext.organization ?? mapping.semantic_model_ref?.name?.replace(/ semantic model$/i, "") ?? "Company";
  const onFile: DecisionRecord[] = Array.isArray(ext.decisions) ? ext.decisions : [];
  let candidates: Candidate[] = Array.isArray(ext.proposed?.candidates) ? ext.proposed.candidates : [];
  const owners: NonNullable<Adapter["metricOwners"]> = [...(ext.metricOwners ?? [])];
  const problems: string[] = [];

  // The model, copied so the edits stay inside this call.
  const out: OssieSemanticModel = { ...model, datasets: model.datasets.map((d) => ({ ...d, fields: (d.fields ?? []).map((f) => ({ ...f })), ...(d.primary_key ? { primary_key: [...d.primary_key] } : {}) })) };
  const findDataset = (name: string | undefined): OssieDataset | undefined => {
    if (!name) return undefined;
    const q = name.toLowerCase();
    return out.datasets.find((d) => d.name.toLowerCase() === q) ?? out.datasets.find((d) => d.source?.toLowerCase() === q) ?? out.datasets.find((d) => bareName(d.source ?? d.name) === bareName(q));
  };
  const profileOf = (d: OssieDataset): Profile => readExt<{ profile?: Profile }>(d.custom_extensions)?.profile ?? {};
  const setProfile = (d: OssieDataset, edit: (p: Profile) => void) => {
    const whole = readExt<{ profile?: Profile; [k: string]: unknown }>(d.custom_extensions) ?? {};
    const p = whole.profile ?? {};
    edit(p);
    d.custom_extensions = writeExt(d.custom_extensions, { ...whole, profile: p });
  };
  let modelChanged = false;
  /** The model field a transform over a column reads: an existing calculated field with that expression, else a new one. */
  const calculated = (ds: OssieDataset, field: OntologyField, column: string, transform: string, why: string): string => {
    const calc = calculatedField(ds.fields ?? [], field, column, transform, why);
    const existing = (ds.fields ?? []).find((x) => expressionText(x) === expressionText(calc));
    if (existing) return existing.name;
    (ds.fields ??= []).push(calc);
    modelChanged = true;
    return calc.name;
  };

  // The mapping as references: GASP dataset → GASP field → the model's dataset and field.
  const resolved = resolveMapping(mapping, out, data);
  const refs: ModelRefs = {};
  for (const [ds, fields] of Object.entries(resolved.refs)) refs[ds] = { ...fields };
  const tableOf = (ds: string): string | undefined => Object.values(refs[ds] ?? {})[0]?.dataset;
  const datasetOf = (table: string): string | undefined => Object.keys(refs).find((ds) => tableOf(ds) === table);
  let mappingChanged = false;

  const order: Record<DecisionAbout, number> = { key: 0, time: 0, kind: 0, type: 0, table: 1, field: 2, owner: 3, topic: 3 };
  const applied: DecisionRecord[] = [];
  const recorded: DecisionRecord[] = [];
  const near = (name: string, among: string[]): string => {
    const hits = closest(name, among.map((x) => ({ item: x, names: [x] })), 3).map((h) => h.item);
    return hits.length ? ` Near names: ${hits.join(", ")}.` : "";
  };

  decisions.map((d, i) => ({ d, i })).sort((a, b) => order[a.d.about] - order[b.d.about] || a.i - b.i).forEach(({ d, i }) => {
    const who = `Decision ${i + 1} (${ABOUTS.includes(d.about) ? describe(d) : String(d.about)})`;
    if (!ABOUTS.includes(d.about)) { problems.push(`${who}: "about" must be one of ${ABOUTS.join(", ")}.`); return; }
    if (!d.owner?.trim()) { problems.push(`${who}: every decision names its owner.`); return; }
    const date = d.date?.trim() || today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { problems.push(`${who}: the date must be YYYY-MM-DD.`); return; }
    const answers = (): string[] => (Array.isArray(d.answer) ? d.answer : String(d.answer ?? "").split(",")).map((s) => s.trim()).filter(Boolean);
    let effect = "";
    let changes = false;

    if (["key", "time", "kind", "type", "table", "field"].includes(d.about)) {
      const ds = findDataset(d.dataset);
      if (!ds) { problems.push(`${who}: the model has no dataset "${d.dataset ?? ""}".${near(d.dataset ?? "", out.datasets.map((x) => x.name))}`); return; }
      d = { ...d, dataset: ds.name };
      const column = (name: string | undefined) => (ds.fields ?? []).find((f) => f.name.toLowerCase() === (name ?? "").toLowerCase());

      if (d.about === "key") {
        const cols = answers();
        if (!cols.length) { problems.push(`${who}: answer names the key columns, or "none".`); return; }
        if (cols.length === 1 && cols[0].toLowerCase() === "none") {
          if (ds.primary_key) { delete ds.primary_key; changes = true; }
          effect = "no key";
        } else {
          const missing = cols.filter((c) => !column(c));
          if (missing.length) { problems.push(`${who}: ${ds.name} has no column ${missing.join(", ")}.`); return; }
          const names = cols.map((c) => column(c)!.name);
          changes = JSON.stringify(ds.primary_key ?? []) !== JSON.stringify(names);
          ds.primary_key = names;
          effect = `key set to ${names.join(", ")}`;
        }
        setProfile(ds, (p) => { (p.confidence ??= {}).key = "declared"; (p.evidence ??= {}).key = `decided by ${d.owner}${d.note ? `: ${d.note}` : ""}`; });
      } else if (d.about === "time") {
        const a = answers();
        if (a.length !== 1) { problems.push(`${who}: answer names the time column, or "none".`); return; }
        const col = a[0].toLowerCase() === "none" ? undefined : column(a[0]);
        if (a[0].toLowerCase() !== "none" && !col) { problems.push(`${who}: ${ds.name} has no column ${a[0]}.`); return; }
        for (const f of ds.fields ?? []) {
          const want = f === col;
          if (Boolean(f.dimension?.is_time) !== want) {
            changes = true;
            if (want) f.dimension = { ...(f.dimension ?? {}), is_time: true };
            else if (f.dimension) { const { is_time: _t, ...rest } = f.dimension; f.dimension = Object.keys(rest).length ? rest : undefined; if (!f.dimension) delete f.dimension; }
          }
        }
        effect = col ? `time field set to ${col.name}` : "no time field";
        setProfile(ds, (p) => { (p.confidence ??= {}).time = "declared"; (p.evidence ??= {}).time = `decided by ${d.owner}${d.note ? `: ${d.note}` : ""}`; });
      } else if (d.about === "kind") {
        const a = answers()[0]?.toLowerCase() as DatasetKind | undefined;
        if (!a || !KINDS.includes(a)) { problems.push(`${who}: answer must be one of ${KINDS.join(", ")}.`); return; }
        changes = profileOf(ds).kind !== a;
        setProfile(ds, (p) => { p.kind = a; (p.confidence ??= {}).kind = "declared"; (p.evidence ??= {}).kind = `decided by ${d.owner}${d.note ? `: ${d.note}` : ""}`; });
        effect = `kind set to ${a}`;
      } else if (d.about === "type") {
        const col = column(d.column);
        if (!col) { problems.push(`${who}: ${ds.name} has no column "${d.column ?? ""}".`); return; }
        d = { ...d, column: col.name };
        const a = answers()[0];
        const type = TYPES.find((t) => t.toLowerCase() === (a ?? "").toLowerCase());
        if (!type) { problems.push(`${who}: answer must be an Ossie datatype (${TYPES.join(", ")}).`); return; }
        changes = col.datatype !== type;
        col.datatype = type;
        effect = `datatype set to ${type}`;
      } else if (d.about === "table") {
        const to = (d.to ?? "").toLowerCase().trim();
        if (!datasets[to]) { problems.push(`${who}: GASP has no dataset "${d.to ?? ""}".${near(to, Object.keys(datasets))}`); return; }
        d = { ...d, to };
        if (d.accept === false) {
          if (tableOf(to) === ds.name) { delete refs[to]; changes = true; effect = `${to} no longer read from ${ds.name}`; } else effect = `${ds.name} is not ${to}`;
          candidates = candidates.filter((c) => !(c.table === ds.name && c.dataset === to));
        } else {
          const holder = tableOf(to);
          if (holder && holder !== ds.name) { problems.push(`${who}: ${to} is already read from ${holder}; reject that pair first (about: table, dataset: ${holder}, to: ${to}, accept: false).`); return; }
          const was = datasetOf(ds.name);
          if (was && was !== to) delete refs[was];
          const table = readModel(out).find((t) => t.name === ds.name)!;
          const matches = matchColumns(table, to, datasets[to], plan.fieldsOf(to));
          const high = matches.filter((m) => m.confidence === "high");
          const before = JSON.stringify(refs[to] ?? {});
          refs[to] = {};
          for (const m of high) refs[to][m.field] = { dataset: ds.name, field: m.transform ? calculated(ds, fieldById.get(m.field)!, m.column, m.transform, m.evidence) : m.column };
          candidates = candidates.filter((c) => !(c.table === ds.name && c.dataset === to));
          const medium = matches.filter((m) => m.confidence === "medium");
          for (const m of medium) candidates.push({ table: ds.name, source: ds.source ?? ds.name, column: m.column, dataset: to, field: m.field, evidence: m.evidence, settle: m.settle ?? "confirm" });
          changes = before !== JSON.stringify(refs[to]);
          effect = `${to} read from ${ds.name}: ${high.length} column${high.length === 1 ? "" : "s"} mapped${medium.length ? `, ${medium.length} candidate${medium.length === 1 ? "" : "s"} to review` : ""}${high.some((m) => m.field === datasets[to].key) ? "" : `; its key ${datasets[to].key} is not mapped, so decide that column next`}`;
        }
      } else if (d.about === "field") {
        const col = column(d.column);
        if (!col) { problems.push(`${who}: ${ds.name} has no column "${d.column ?? ""}".${near(d.column ?? "", (ds.fields ?? []).map((f) => f.name))}`); return; }
        const gaspDs = datasetOf(ds.name);
        if (!gaspDs) { problems.push(`${who}: ${ds.name} is not read as a GASP dataset; decide the table first (about: table).`); return; }
        const to = (d.to ?? "").toLowerCase().trim();
        const field = plan.fieldsOf(gaspDs).find((f) => f.id === to);
        if (!field) {
          const f = fieldById.get(to);
          problems.push(`${who}: ${f ? `${to} is a GASP field of ${f.datasets?.join(", ")}, not of ${gaspDs}` : `GASP has no field "${d.to ?? ""}"`}.${f ? "" : near(to, plan.fieldsOf(gaspDs).map((x) => x.id))}`);
          return;
        }
        d = { ...d, column: col.name, to };
        const current = refs[gaspDs][to];
        const word = new RegExp(`(^|[^A-Za-z0-9_])${col.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_]|$)`);
        const reads = (f: string) => f === col.name || (ds.fields ?? []).some((x) => x.name === f && word.test(expressionText(x) ?? ""));
        if (d.accept === false) {
          if (current && reads(current.field)) { delete refs[gaspDs][to]; changes = true; effect = `${to} no longer read from ${col.name}`; } else effect = `${col.name} is not ${to}`;
        } else {
          if (d.transform?.trim() && !d.transform.includes("{{value}}")) { problems.push(`${who}: the transform must read the column as {{value}}.`); return; }
          const modelField = d.transform?.trim() ? calculated(ds, field, col.name, d.transform.trim(), `decided by ${d.owner}`) : col.name;
          changes = !current || current.field !== modelField;
          refs[gaspDs][to] = { dataset: ds.name, field: modelField };
          effect = `${gaspDs}.${to} read from ${col.name}${d.transform ? ` through ${modelField}` : ""}${current && current.field !== modelField ? ` (was ${current.field})` : ""}`;
        }
        candidates = candidates.filter((c) => !(c.table === ds.name && c.column === col.name && c.dataset === gaspDs && c.field === to));
      }
    } else if (d.about === "owner") {
      const name = d.metric?.trim() ?? "";
      if (!name) { problems.push(`${who}: name the metric.`); return; }
      let metric = name;
      if (name.toLowerCase() !== "all core metrics") {
        const r = resolveMetric(data, name);
        if (r.kind === "metric") metric = r.metric.name;
        else if (r.kind === "ambiguous") { problems.push(`${who}: "${name}" is ambiguous: ${r.candidates.map((m) => `${m.name} (${m.department})`).join(", ")}.`); return; }
        else { problems.push(`${who}: "${name}" is not a GASP metric.${suggestMatches(data, name)}`); return; }
      }
      d = { ...d, metric };
      const at = owners.findIndex((o) => o.metric.toLowerCase() === metric.toLowerCase());
      const entry = { metric, team: d.owner.trim(), ...(d.contact?.trim() ? { contact: d.contact.trim() } : {}) };
      changes = at < 0 || JSON.stringify(owners[at]) !== JSON.stringify(entry);
      if (at < 0) owners.push(entry); else owners[at] = entry;
      effect = `owned by ${entry.team}`;
    } else if (d.about === "topic") {
      if (!d.topic?.trim()) { problems.push(`${who}: name the topic.`); return; }
      if (!answers().length) { problems.push(`${who}: give the answer.`); return; }
      d = { ...d, topic: d.topic.trim() };
      effect = `recorded: ${answers().join(", ")}`;
    }

    const record: DecisionRecord = { ...d, owner: d.owner.trim(), date, effect };
    if (changes) { applied.push(record); if (d.about === "table" || d.about === "field") mappingChanged = true; else if (d.about !== "owner") modelChanged = true; }
    else recorded.push(record);
  });

  // Every decision on file, the new ones replacing earlier ones on the same subject.
  const all = [...onFile];
  const content = ({ date: _d, effect: _e, ...rest }: DecisionRecord) => JSON.stringify(rest);
  for (const r of [...applied, ...recorded]) {
    const s = subjectOf(r);
    const at = all.findIndex((x) => subjectOf(x) === s);
    if (at < 0) all.push(r);
    else if (!(recorded.includes(r) && content(all[at]) === content(r))) all[at] = r; // a repeat of a decision on file keeps the record of what it did
  }

  // The mapping: rebuilt over the references when a pair changed, else as given; the extension always refreshed.
  let gaps: MappingGap[] = [];
  let outMapping: OssieMapping = mapping;
  if (mappingChanged || !Array.isArray(ext.proposed?.candidates) || !Array.isArray(ext.decisions) || decisions.length) {
    const ids = Object.keys(datasets).filter((ds) => Object.keys(refs[ds] ?? {}).length);
    const built = mappingChanged ? mappingOver(data, {
      name: mapping.name,
      description: mapping.description ?? "",
      ontologyIri: mapping.ontology_ref?.iri ?? "",
      modelName: mapping.semantic_model_ref?.name ?? out.name,
      modelIri: mapping.semantic_model_ref?.iri ?? "",
      datasets: ids,
      include: (ds, f) => Boolean(refs[ds]?.[f]),
      expr: (ds, f) => `${refs[ds][f].dataset}.${refs[ds][f].field}`,
    }) : undefined;
    gaps = built?.gaps ?? [];
    const base = built?.mapping ?? mapping;
    const adapterNow = resolveMapping(base, out, data).adapter;
    const extension: Extension = {
      ...ext,
      proposed: { ...(ext.proposed ?? {}), datasets: Object.keys(adapterNow.datasets ?? {}).length, fields: adapterNow.mappings.length, transforms: adapterNow.mappings.filter((m) => m.transform).length, candidates, unmatched: (ext.proposed?.unmatched ?? []).filter((u) => !datasetOf(u.table)) },
      ...(owners.length ? { metricOwners: owners } : {}),
      decisions: all,
    };
    outMapping = { ...base, custom_extensions: writeExt(mapping.custom_extensions, extension) };
  }

  const final = resolveMapping(outMapping, out, data);
  problems.push(...final.problems);
  const schema = ossieSchemaErrors(outMapping, "mapping", data);
  if (schema?.length) problems.push(...schema.map((e) => `mapping: ${e}`));
  if (modelChanged) {
    const me = ossieSchemaErrors(out, "model", data);
    if (me?.length) problems.push(...me.map((e) => `model: ${e}`));
  }
  problems.push(...checkExport({ ontology: exportOntology(data), model: out, mapping: outMapping }, { extensionSchema: data.extensionSchema }));
  const cov = final.adapter.mappings.length ? checkAdapter(final.adapter, data) : undefined;
  const questions = openQuestions(out, all);
  return {
    organization, model: out, mapping: outMapping, adapter: final.adapter, applied, recorded, decisions: all, problems,
    open: { questions, candidates, unowned: cov?.unowned ?? [] },
    gaps, modelChanged, level2: !questions.length && !candidates.length,
  };
}

// ── report ───────────────────────────────────────────────────────────────────

const stamp = (r: DecisionRecord): string => `${r.owner}, ${r.date}${r.note ? `: ${r.note}` : ""}`;

export function formatDecisionReport(r: DecideResult, ran: number): string {
  const lines: string[] = [`# Decisions: ${r.organization}`, ""];
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  const refused = ran - r.applied.length - r.recorded.length;
  if (ran) lines.push(`**This run:** ${n(ran, "decision")} given, ${r.applied.length} applied to the model or the mapping, ${r.recorded.length} recorded with nothing to change${refused ? `, ${refused} refused (see the problems)` : ""}; ${n(r.decisions.length, "decision")} on file.`);
  else lines.push(`**On file:** ${n(r.decisions.length, "decision")}.`);
  lines.push(`**Open:** ${n(r.open.questions.length, "question")} and ${n(r.open.candidates.length, "candidate")}; ${n(r.open.unowned.length, "covered metric")} without an owner.`);
  lines.push(r.level2 ? "**Readiness:** level 2 (mapped) reached: every question and candidate is decided." : `**Readiness:** level 2 (mapped) is blocked by ${[r.open.questions.length ? n(r.open.questions.length, "open question") : "", r.open.candidates.length ? n(r.open.candidates.length, "open candidate") : ""].filter(Boolean).join(" and ")}.`);
  for (const g of r.gaps) lines.push(`**Gap:** dataset \`${g.dataset}\` is left out of the mapping: ${g.reason}.`);
  if (r.problems.length) lines.push("", `## Problems (${r.problems.length})`, "", ...r.problems.map((p) => `- ${p}`));
  if (r.applied.length) lines.push("", `## Applied (${r.applied.length})`, "", ...r.applied.map((d) => `- ${describe(d)}: ${d.effect} (${stamp(d)})`));
  if (r.recorded.length) lines.push("", `## Recorded (${r.recorded.length})`, "", ...r.recorded.map((d) => `- ${describe(d)}: ${d.effect} (${stamp(d)})`));
  if (r.open.questions.length) {
    lines.push("", `## Open questions (${r.open.questions.length})`, "", "Each needs an answer from the team that owns the table; record it with about: key, time or type, the dataset, the answer and the owner.", "");
    r.open.questions.forEach((q, i) => lines.push(`${i + 1}. **${q.dataset}** (${q.about}): ${q.question}${q.options?.length ? ` Options: ${q.options.join("; ")}.` : ""} ${q.why}.`));
  }
  if (r.open.candidates.length) {
    lines.push("", `## Open candidates (${r.open.candidates.length})`, "", "Each needs an accept or a reject from the team that owns the source; record it with about: table or field, the dataset, the column, to and the owner.", "");
    for (const c of r.open.candidates) lines.push(`- ${c.source}${c.column ? `.${c.column}` : ""} → ${c.dataset}${c.field ? `.${c.field}` : ""} (${c.evidence}). To settle: ${c.settle}.`);
  }
  if (r.open.unowned.length) lines.push("", `## Covered metrics without an owner (${r.open.unowned.length})`, "", "Record an owner per metric (about: owner, metric, owner) or one for all Core metrics (metric: All Core metrics) so someone resolves definition disputes.", "", r.open.unowned.join(", "));
  if (!ran && !r.decisions.length) lines.push("", "No decision is on file. Pass decisions as a YAML or JSON list; each names what it is about, the subject by content and its owner.");
  lines.push("", "## Next", "", r.level2
    ? "Pass the mapping and the model to validate_mapping, then compile_model and score_drift. A key or time field decided here changes what propose_mapping would pair; to pick those pairs up, run it again on this model and record the same decisions."
    : "Take the open items to their owners and record the answers; a key or time field decided here changes what propose_mapping would pair, so run it again on this model afterwards and record the same decisions.");
  return lines.join("\n");
}

export interface DecideOptions {
  output?: "report" | "mapping" | "model" | "json";
}

/** Decisions as the tool receives them: a YAML or JSON list, an object holding `decisions`, or one decision. */
export function parseDecisions(text: string | undefined): { decisions: Decision[] } | { error: string } {
  if (!text?.trim()) return { decisions: [] };
  let v: unknown;
  try { v = JSON.parse(text); } catch {
    try { v = parseYaml(text); } catch (e) { return { error: `The decisions are neither JSON nor YAML: ${(e as Error).message.split("\n")[0]}` }; }
  }
  if (v && typeof v === "object" && !Array.isArray(v) && Array.isArray((v as { decisions?: unknown }).decisions)) v = (v as { decisions: unknown }).decisions;
  const list = Array.isArray(v) ? v : [v];
  if (!list.every((d) => d && typeof d === "object" && !Array.isArray(d))) return { error: "Each decision is an object with about, the subject (dataset, column, to, metric or topic) and owner." };
  return { decisions: list as Decision[] };
}

/** The tool: the model, the mapping and the decisions to the updated documents and the report. */
export function recordDecisionFromText(modelText: string | undefined, mappingText: string | undefined, decisionsText: string | undefined, data: StandardData, opts: DecideOptions = {}): string {
  if (!modelText?.trim()) return "Pass semantic_model: the Ossie semantic model the mapping reads (the one propose_mapping returned).";
  if (!mappingText?.trim()) return "Pass mapping: the Ossie mapping propose_mapping returned; the decisions are recorded in it.";
  const m = parseDocument(modelText);
  if (!m.doc) return `Invalid semantic model. ${m.error}`;
  if (!isOssieModel(m.doc)) return "The semantic model must be an Ossie semantic model document (an object with a \"datasets\" array).";
  const p = parseDocument(mappingText);
  if (!p.doc) return `Invalid mapping. ${p.error}`;
  if (!isOssieMapping(p.doc)) return "The mapping must be an Ossie mapping document (an object with \"concept_mappings\"), such as the one propose_mapping returns.";
  const parsed = parseDecisions(decisionsText);
  if ("error" in parsed) return parsed.error;
  const r = recordDecisions(m.doc, p.doc, parsed.decisions, data);
  if (opts.output === "json") return JSON.stringify({ organization: r.organization, applied: r.applied, recorded: r.recorded, decisions: r.decisions, open: r.open, level2: r.level2, modelChanged: r.modelChanged, gaps: r.gaps, problems: r.problems, mapping: r.mapping, model: r.model, adapter: r.adapter }, null, 2);
  if (opts.output === "mapping") return ossieYaml(r.mapping);
  if (opts.output === "model") return ossieYaml(r.model);
  const anyRecorded = r.applied.length > 0 || r.recorded.length > 0;
  return `${formatDecisionReport(r, parsed.decisions.length)}${anyRecorded ? `\n\n## Mapping\n\nThe mapping with the decisions on file in its GASP extension${r.applied.some((d) => ["table", "field"].includes(d.about)) ? " and the accepted pairs in place" : ""}.\n\n\`\`\`yaml\n${ossieYaml(r.mapping)}\`\`\`\n` : ""}${r.modelChanged ? `\n## Semantic model\n\nThe model with the decided keys, time fields, kinds, types and calculated fields.\n\n\`\`\`yaml\n${ossieYaml(r.model)}\`\`\`\n` : ""}`;
}
