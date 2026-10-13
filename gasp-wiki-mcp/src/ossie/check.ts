/**
 * GASP's own cross-reference checks for an Ossie export. The upstream validator
 * checks document shape and the ontology's internal references; it does not check
 * that metrics, relationships and mappings point at things that exist.
 * See docs/ossie-spike.md (probe table).
 */
import type {
  OssieConcept,
  OssieLinkMapping,
  OssieMapping,
  OssieObjectMapping,
  OssieOntology,
  OssieOntologyRelationship,
  OssieReferentMapping,
  OssieSemanticModel,
} from "./types.js";
import { OSSIE_DIALECT } from "./types.js";

const BUILT_INS = new Set(["Any", "Boolean", "Date", "DateTime", "Decimal", "Float", "Integer", "String"]);

function dupes(names: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const n of names) (seen.has(n) ? out : seen).add(n);
  return [...out];
}

/** Replace the contents of single-quoted SQL string literals so they are never scanned. */
function stripLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

function refsIn(sql: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const re = /(?<![\w.])([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b/g;
  let m: RegExpExecArray | null;
  const s = stripLiterals(sql);
  while ((m = re.exec(s))) out.push([m[1], m[2]]);
  return out;
}

function concepts(ont: OssieOntology): Map<string, OssieConcept> {
  return new Map(ont.ontology.map((c) => [c.concept, c]));
}

function checkOntology(ont: OssieOntology, p: string[]): void {
  const byName = concepts(ont);
  for (const d of dupes(ont.ontology.map((c) => c.concept))) p.push(`Ontology: concept name "${d}" is declared more than once`);
  const known = (n: string) => BUILT_INS.has(n) || byName.has(n);

  for (const c of ont.ontology) {
    for (const e of c.extends ?? []) {
      if (!known(e)) {
        p.push(`Ontology: concept "${c.concept}" extends unknown concept "${e}"`);
        continue;
      }
      if (c.type === "EntityType" && byName.get(e)?.type !== "EntityType" && e !== "Any") {
        p.push(`Ontology: entity type "${c.concept}" extends "${e}", which is not an entity type`);
      }
    }
    if (c.type === "ValueType") {
      // chain must end in a built-in with no cycle and no entity type
      const walk = (n: string, seen: Set<string>): boolean => {
        if (BUILT_INS.has(n)) return true;
        const k = byName.get(n);
        if (!k || k.type !== "ValueType" || seen.has(n)) return false;
        seen.add(n);
        const ext = k.extends ?? [];
        return ext.length > 0 && ext.every((x) => walk(x, seen));
      };
      if (!walk(c.concept, new Set())) {
        p.push(`Ontology: value type "${c.concept}" does not extend a value type chain ending in a built-in type`);
      }
    }
    const relNames = new Set((c.relationships ?? []).map((r) => r.name));
    for (const id of c.identify_by ?? []) {
      if (!relNames.has(id)) p.push(`Ontology: concept "${c.concept}" identify_by names unknown relationship "${id}"`);
    }
    for (const r of c.relationships ?? []) {
      const where = `${c.concept}.${r.name}`;
      const roles = r.roles ?? [];
      const seen = new Set<string>([c.concept]);
      const tokens = [`{${c.concept}}`];
      roles.forEach((role, i) => {
        if (!known(role.concept)) p.push(`Ontology: relationship "${where}" role ${i + 2} plays unknown concept "${role.concept}"`);
        if (seen.has(role.concept) && !role.name) {
          p.push(`Ontology: relationship "${where}" has concept "${role.concept}" in more than one role but the extra role has no name`);
        }
        seen.add(role.concept);
        tokens.push(role.name ? `{${role.concept}:${role.name}}` : `{${role.concept}}`);
      });
      (r.verbalizes ?? []).forEach((v) => {
        for (const t of tokens) {
          if (!v.includes(t)) p.push(`Ontology: verbalization "${v}" of "${where}" does not mention ${t}`);
        }
      });
    }
  }
}

function checkModel(model: OssieSemanticModel, p: string[]): void {
  const datasets = new Map(model.datasets.map((d) => [d.name, d]));
  for (const d of dupes(model.datasets.map((d) => d.name))) p.push(`Model: dataset name "${d}" is declared more than once`);
  for (const ds of model.datasets) {
    for (const f of dupes((ds.fields ?? []).map((f) => f.name))) p.push(`Model: field "${f}" is declared more than once in dataset "${ds.name}"`);
    for (const f of ds.fields ?? []) {
      if (!f.expression.dialects.some((d) => d.dialect === OSSIE_DIALECT)) {
        p.push(`Model: field "${ds.name}.${f.name}" has no ${OSSIE_DIALECT} expression`);
      }
      checkExt(f.custom_extensions, `field "${ds.name}.${f.name}"`, p);
    }
    checkExt(ds.custom_extensions, `dataset "${ds.name}"`, p);
  }
  const fieldsOf = (n: string) => new Set((datasets.get(n)?.fields ?? []).map((f) => f.name));
  for (const d of dupes((model.metrics ?? []).map((m) => m.name))) p.push(`Model: metric name "${d}" is declared more than once`);

  for (const r of model.relationships ?? []) {
    let ok = true;
    for (const side of ["from", "to"] as const) {
      if (!datasets.has(r[side])) {
        p.push(`Model: relationship "${r.name}" ${side} names unknown dataset "${r[side]}"`);
        ok = false;
      }
    }
    if (r.from_columns.length !== r.to_columns.length) {
      p.push(`Model: relationship "${r.name}" has ${r.from_columns.length} from_columns but ${r.to_columns.length} to_columns`);
    }
    if (ok) {
      for (const c of r.from_columns) if (!fieldsOf(r.from).has(c)) p.push(`Model: relationship "${r.name}" from_columns names "${c}", which is not a field of dataset "${r.from}"`);
      for (const c of r.to_columns) if (!fieldsOf(r.to).has(c)) p.push(`Model: relationship "${r.name}" to_columns names "${c}", which is not a field of dataset "${r.to}"`);
    }
    checkExt(r.custom_extensions, `relationship "${r.name}"`, p);
  }

  for (const m of model.metrics ?? []) {
    const dialects = m.expression.dialects;
    if (!dialects.some((d) => d.dialect === OSSIE_DIALECT)) p.push(`Model: metric "${m.name}" has no ${OSSIE_DIALECT} expression`);
    for (const d of dialects) {
      if (d.expression.includes("{{")) p.push(`Model: metric "${m.name}" (${d.dialect}) contains a "{{" placeholder`);
      if (d.dialect !== OSSIE_DIALECT) continue;
      const s = stripLiterals(d.expression);
      if (/\bSELECT\b/i.test(s)) p.push(`Model: metric "${m.name}" contains SELECT; the portable expression language forbids subqueries`);
      if (/\bFROM\b/i.test(s)) p.push(`Model: metric "${m.name}" contains a FROM clause; the portable expression language forbids subqueries`);
      if (/\bWHERE\b/i.test(s)) p.push(`Model: metric "${m.name}" contains a WHERE clause; use CASE WHEN inside the aggregate`);
      const bad = new Set<string>();
      for (const [ds, f] of refsIn(d.expression)) {
        const key = `${ds}.${f}`;
        if (bad.has(key)) continue;
        if (!datasets.has(ds)) {
          bad.add(key);
          p.push(`Model: metric "${m.name}" references "${key}" but dataset "${ds}" does not exist`);
        } else if (!fieldsOf(ds).has(f)) {
          bad.add(key);
          p.push(`Model: metric "${m.name}" references "${key}" but dataset "${ds}" has no field "${f}"`);
        }
      }
    }
    checkExt(m.custom_extensions, `metric "${m.name}"`, p);
  }
  checkExt(model.custom_extensions, "model", p);
}

function checkExt(exts: Array<{ vendor_name: string; data: string }> | undefined, who: string, p: string[]): void {
  for (const e of exts ?? []) {
    try {
      JSON.parse(e.data);
    } catch {
      p.push(`Model: custom_extensions data of ${who} (vendor ${e.vendor_name}) is not valid JSON`);
    }
  }
}

function checkMapping(docs: { ontology: OssieOntology; model: OssieSemanticModel; mapping: OssieMapping }, p: string[]): void {
  const { ontology, model, mapping } = docs;
  const byName = concepts(ontology);
  const datasets = new Map(model.datasets.map((d) => [d.name, new Set((d.fields ?? []).map((f) => f.name))]));

  if (mapping.ontology_ref.name !== ontology.name) {
    p.push(`Mapping: ontology_ref.name "${mapping.ontology_ref.name}" does not equal the ontology name "${ontology.name}"`);
  }
  if (mapping.semantic_model_ref.name !== model.name) {
    p.push(`Mapping: semantic_model_ref.name "${mapping.semantic_model_ref.name}" does not equal the semantic model name "${model.name}"`);
  }

  /** Relationship lookup through the extends chain; accepts "Concept.rel" qualification. */
  const findRel = (concept: string, rel: string): OssieOntologyRelationship | undefined => {
    let name = rel;
    let from = concept;
    const dot = rel.indexOf(".");
    if (dot > 0) {
      from = rel.slice(0, dot);
      name = rel.slice(dot + 1);
    }
    const seen = new Set<string>();
    const walk = (c: string): OssieOntologyRelationship | undefined => {
      if (seen.has(c)) return undefined;
      seen.add(c);
      const k = byName.get(c);
      if (!k) return undefined;
      return k.relationships?.find((r) => r.name === name) ?? (k.extends ?? []).map(walk).find(Boolean);
    };
    return walk(from);
  };

  const checkExpr = (expr: string | undefined, where: string) => {
    if (!expr) return;
    const bad = new Set<string>();
    for (const [ds, f] of refsIn(expr)) {
      const key = `${ds}.${f}`;
      if (bad.has(key)) continue;
      const fields = datasets.get(ds);
      if (!fields) {
        bad.add(key);
        p.push(`Mapping: ${where} expression references "${key}" but dataset "${ds}" does not exist`);
      } else if (!fields.has(f)) {
        bad.add(key);
        p.push(`Mapping: ${where} expression references "${key}" but dataset "${ds}" has no field "${f}"`);
      }
    }
  };

  const checkReferents = (list: OssieReferentMapping[] | undefined, concept: string, where: string) => {
    for (const r of list ?? []) {
      const rel = findRel(concept, r.relationship);
      if (!rel) {
        p.push(`Mapping: ${where} referent mapping names relationship "${r.relationship}", which is not declared on concept "${concept}"`);
      }
      checkExpr(r.expression, `${where} referent "${r.relationship}"`);
      if (r.referent_mappings?.length) {
        const last = rel?.roles?.[rel.roles.length - 1]?.concept;
        if (rel && !last) p.push(`Mapping: ${where} nested referent mapping under "${r.relationship}", which has no role to nest into`);
        else if (last) checkReferents(r.referent_mappings, last, `${where} > ${r.relationship}`);
      }
    }
  };

  const checkObject = (om: OssieObjectMapping, enclosing: string, where: string) => {
    if (om.concept && !byName.has(om.concept) && !BUILT_INS.has(om.concept)) {
      p.push(`Mapping: ${where} object mapping names concept "${om.concept}", which is not in the ontology`);
    }
    checkExpr(om.expression, where);
    checkReferents(om.referent_mappings, om.concept && byName.has(om.concept) ? om.concept : enclosing, where);
  };

  const checkLink = (lm: OssieLinkMapping, root: string, level: number, where: string) => {
    checkObject(lm.object_mapping, root, where);
    if (lm.relationship) {
      const rel = findRel(root, lm.relationship);
      if (!rel) {
        p.push(`Mapping: ${where} link mapping names relationship "${lm.relationship}", which is not declared on concept "${root}"`);
      } else {
        const arity = (rel.roles?.length ?? 0) + 1;
        if (arity !== level) {
          p.push(`Mapping: ${where} link mapping at level ${level} names relationship "${root}.${rel.name}" of arity ${arity}`);
        }
      }
    }
    (lm.children ?? []).forEach((c, i) => checkLink(c, root, level + 1, `${where} > child ${i + 1}`));
  };

  for (const cm of mapping.concept_mappings) {
    if (!byName.has(cm.concept)) {
      p.push(`Mapping: concept mapping names concept "${cm.concept}", which is not in the ontology`);
      continue;
    }
    (cm.object_mappings ?? []).forEach((om, i) => checkObject(om, cm.concept, `concept "${cm.concept}" object mapping ${i + 1}`));
    (cm.link_mappings ?? []).forEach((lm, i) => checkLink(lm, cm.concept, 1, `concept "${cm.concept}" link mapping ${i + 1}`));
  }
  checkExt(mapping.custom_extensions, "mapping", p);
}

export function checkExport(docs: { ontology: OssieOntology; model: OssieSemanticModel; mapping: OssieMapping }): string[] {
  const problems: string[] = [];
  checkOntology(docs.ontology, problems);
  checkModel(docs.model, problems);
  checkMapping(docs, problems);
  return problems;
}
