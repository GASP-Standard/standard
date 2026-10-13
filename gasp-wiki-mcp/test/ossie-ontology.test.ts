import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { loadStandard } from "../src/loader.js";
import { exportOntology, unmappedEdges, edgesWithoutJoin, planOntology } from "../src/ossie/ontology.js";
import { exportMapping } from "../src/ossie/mapping.js";
import type { OssieConcept, OssieLinkMapping, OssieObjectMapping, OssieOntologyRelationship, OssieReferentMapping } from "../src/ossie/types.js";

const BUILT_INS = new Set(["Any", "Boolean", "Date", "DateTime", "Decimal", "Float", "Integer", "String"]);

const data = loadStandard();
const ontology = exportOntology(data);
const mapping = exportMapping(data);
const plan = planOntology(data);
const concepts = new Map<string, OssieConcept>(ontology.ontology.map((c) => [c.concept, c]));
const datasets = Object.entries(data.ontology!.datasets!);
const fields = data.ontology!.fields!;
const rel = (concept: string, name: string): OssieOntologyRelationship | undefined => concepts.get(concept)?.relationships?.find((r) => r.name === name);
const roleRef = (r: { concept: string; name?: string }) => (r.name ? `{${r.concept}:${r.name}}` : `{${r.concept}}`);

describe("Ossie ontology export", () => {
  it("emits one concept per dataset, GASP concept and non-date field", () => {
    for (const [id] of datasets) expect(concepts.get(plan.datasetConcept[id])?.type, id).toBe("EntityType");
    for (const c of data.ontology!.concepts ?? []) expect(concepts.get(plan.gaspConcept[c.id])?.type, c.id).toBe("EntityType");
    for (const f of fields) {
      const role = plan.roleConcept[f.id];
      if (f.type === "date" || f.type === "timestamp") expect(BUILT_INS.has(role), f.id).toBe(true);
      else expect(concepts.get(role)?.type, f.id).toBe("ValueType");
    }
  });

  it("has every field on every dataset it lives on, as a relationship or the snapshot date", () => {
    for (const f of fields)
      for (const ds of f.datasets ?? []) {
        const d = data.ontology!.datasets![ds];
        const concept = plan.datasetConcept[ds];
        if (f.id === d.date && d.kind !== "event" && d.key !== d.date) {
          // the snapshot or period date is the first role of every ternary relationship
          continue;
        }
        expect(rel(concept, f.id), `${concept}.${f.id}`).toBeDefined();
      }
  });

  it("has unique concept names and unique relationship names per concept", () => {
    const names = ontology.ontology.map((c) => c.concept);
    expect(names.length).toBe(new Set(names).size);
    for (const n of names) expect(BUILT_INS.has(n), n).toBe(false);
    for (const c of ontology.ontology) {
      const rels = (c.relationships ?? []).map((r) => r.name);
      expect(rels.length, c.concept).toBe(new Set(rels).size);
    }
  });

  it("resolves every role, extends and identify_by", () => {
    for (const c of ontology.ontology) {
      for (const e of c.extends ?? []) expect(BUILT_INS.has(e) || concepts.has(e), `${c.concept} extends ${e}`).toBe(true);
      for (const id of c.identify_by ?? []) {
        const r = rel(c.concept, id);
        expect(r, `${c.concept} identify_by ${id}`).toBeDefined();
        expect(r!.roles?.length, `${c.concept}.${id} is binary`).toBe(1);
      }
      for (const r of c.relationships ?? [])
        for (const role of r.roles ?? []) expect(BUILT_INS.has(role.concept) || concepts.has(role.concept), `${c.concept}.${r.name} role ${role.concept}`).toBe(true);
    }
  });

  it("names a role whenever its concept plays another role in the same relationship", () => {
    for (const c of ontology.ontology)
      for (const r of c.relationships ?? []) {
        const refs = [`{${c.concept}}`, ...(r.roles ?? []).map(roleRef)];
        expect(refs.length, `${c.concept}.${r.name}`).toBe(new Set(refs).size);
      }
  });

  it("mentions every role in every verbalization", () => {
    for (const c of ontology.ontology)
      for (const r of c.relationships ?? []) {
        expect(r.verbalizes.length).toBeGreaterThan(0);
        for (const v of r.verbalizes) {
          expect(v, `${c.concept}.${r.name}`).toContain(`{${c.concept}}`);
          for (const role of r.roles ?? []) expect(v, `${c.concept}.${r.name}`).toContain(roleRef(role));
        }
      }
  });

  it("puts a requires constraint with every declared value on each enum value type", () => {
    for (const f of fields.filter((x) => x.type === "enum")) {
      const vt = concepts.get(plan.roleConcept[f.id])!;
      expect(vt.requires, f.id).toHaveLength(1);
      for (const v of f.values ?? []) expect(vt.requires![0], f.id).toContain(`'${v}'`);
    }
  });

  it("spot checks", () => {
    expect(concepts.get("Customer")!.identify_by).toEqual(["customer_id"]);
    expect(rel("Customer", "customer_id")!.roles).toEqual([{ concept: "CustomerId" }]);
    expect(rel("Subscription", "customer_id")!.roles).toEqual([{ concept: "Customer" }]);
    expect(rel("Subscription", "customer_id")!.multiplicity).toBe("ManyToOne");
    expect(rel("Subscription", "mrr")!.roles).toEqual([{ concept: "Date" }, { concept: "Mrr" }]);
    expect(rel("Subscription", "snapshot_date")).toBeUndefined();
    const ec = rel("RevenueEvent", "expansion_classification")!;
    expect(ec.roles).toHaveLength(1);
    const ecType = concepts.get(ec.roles![0].concept)!;
    expect(ecType.requires![0].split(" OR ")).toHaveLength(6);
    expect(rel("RevenueEvent", "event_date")!.roles).toEqual([{ concept: "Date" }]);
    // financials and forecast are keyed by their own period date
    expect(rel("Financials", "period_start")!.roles).toEqual([{ concept: "Date" }]);
    expect(concepts.get("Forecast")!.identify_by).toEqual(["period_start"]);
    // subscription_id identifies two datasets; the foreign key resolves to Subscription
    expect(rel("RevenueEvent", "subscription_id")!.roles).toEqual([{ concept: "Subscription" }]);
    expect(rel("Customer", "owns")!.roles).toEqual([{ concept: "Subscription" }]);
  });

  it("reports renames and unmapped edges", () => {
    console.log(`[ossie] ${ontology.ontology.length} concepts: ${datasets.length} datasets, ${(data.ontology!.concepts ?? []).length} GASP concepts, ${ontology.ontology.filter((c) => c.type === "ValueType").length} value types; ${ontology.ontology.reduce((n, c) => n + (c.relationships?.length ?? 0), 0)} relationships`);
    console.log(`[ossie] renames: ${plan.renames.join("; ") || "none"}`);
    console.log(`[ossie] unmapped edges: ${unmappedEdges(data).join("; ") || "none"}`);
    console.log(`[ossie] edges with no join dataset: ${edgesWithoutJoin(data).join("; ") || "none"}`);
    expect(Array.isArray(unmappedEdges(data))).toBe(true);
  });
});

// ── mapping resolver ─────────────────────────────────────────────────────────

interface Visit {
  conceptMapping: string;
  relationship: string;
}

function checkReferents(concept: string, refs: OssieReferentMapping[] | undefined, where: string, errors: string[]) {
  const c = concepts.get(concept);
  if (!c) return errors.push(`${where}: unknown concept ${concept}`);
  for (const r of refs ?? []) {
    if (!c.identify_by?.includes(r.relationship)) errors.push(`${where}: ${concept}.${r.relationship} is not identifying`);
    if (!rel(concept, r.relationship)) errors.push(`${where}: no relationship ${concept}.${r.relationship}`);
    if (r.referent_mappings) {
      const player = rel(concept, r.relationship)?.roles?.[0]?.concept;
      if (player) checkReferents(player, r.referent_mappings, where, errors);
    }
  }
}

function checkObject(om: OssieObjectMapping, expected: string, where: string, errors: string[]) {
  if (om.concept && om.concept !== expected) errors.push(`${where}: object mapping concept ${om.concept}, role played by ${expected}`);
  if (!om.expression && !om.referent_mappings?.length) errors.push(`${where}: object mapping with neither expression nor referents`);
  if (om.expression && !/^[a-z_]+\.[a-z0-9_]+$/.test(om.expression)) errors.push(`${where}: expression ${om.expression}`);
  if (om.referent_mappings) checkReferents(expected, om.referent_mappings, where, errors);
}

/** Walks one link mapping tree. `path` is the concepts played so far (level 1 is the concept mapping's own concept). */
function walk(owner: string, node: OssieLinkMapping, path: OssieObjectMapping[], visits: Visit[], errors: string[]) {
  const here = [...path, node.object_mapping];
  const level = here.length;
  if (node.relationship) {
    const r = rel(owner, node.relationship);
    const where = `${owner}.${node.relationship}`;
    if (!r) errors.push(`${where}: relationship not in ontology`);
    else {
      const roles = [owner, ...(r.roles ?? []).map((x) => x.concept)];
      if (roles.length !== level) errors.push(`${where}: link at level ${level}, relationship arity ${roles.length}`);
      else here.forEach((om, i) => checkObject(om, roles[i], `${where} role ${i}`, errors));
      visits.push({ conceptMapping: owner, relationship: node.relationship });
    }
  }
  for (const child of node.children ?? []) walk(owner, child, here, visits, errors);
}

describe("Ossie reference mapping", () => {
  const visits: Visit[] = [];
  const errors: string[] = [];
  for (const cm of mapping.concept_mappings) {
    if (!concepts.has(cm.concept)) errors.push(`unknown concept ${cm.concept}`);
    for (const om of cm.object_mappings ?? []) checkObject(om, cm.concept, `${cm.concept} object mapping`, errors);
    for (const lm of cm.link_mappings ?? []) {
      checkObject(lm.object_mapping, cm.concept, `${cm.concept} link root`, errors);
      walk(cm.concept, lm, [], visits, errors);
    }
  }

  it("references the GASP ontology and the reference model", () => {
    expect(mapping.ontology_ref).toEqual({ name: ontology.name, iri: "./gasp.ontology.yaml" });
    expect(mapping.semantic_model_ref).toEqual({ name: "GASP reference model", iri: "./gasp.semantic_model.yaml" });
  });

  it("has one concept mapping per dataset concept", () => {
    expect(mapping.concept_mappings.map((c) => c.concept)).toEqual(datasets.map(([id]) => plan.datasetConcept[id]));
  });

  it("only names concepts and relationships the ontology declares, at the right level", () => {
    expect(errors).toEqual([]);
  });

  it("reaches every relationship on every dataset concept", () => {
    const reached = new Set(visits.map((v) => `${v.conceptMapping}.${v.relationship}`));
    const noJoin = new Set(edgesWithoutJoin(data).map((s) => s.split(" ")[0]));
    const missing: string[] = [];
    for (const [id] of datasets) {
      const c = concepts.get(plan.datasetConcept[id])!;
      for (const r of c.relationships ?? []) {
        const key = `${c.concept}.${r.name}`;
        // the identifying relationship is reached through the referent mappings
        if (c.identify_by?.includes(r.name)) {
          const cm = mapping.concept_mappings.find((m) => m.concept === c.concept)!;
          if (!cm.object_mappings?.some((om) => om.referent_mappings?.some((x) => x.relationship === r.name))) missing.push(key);
          continue;
        }
        // entityRelationships edges no reference dataset can populate are declared but unmapped
        if (noJoin.has(key)) continue;
        if (!reached.has(key)) missing.push(key);
      }
    }
    expect(missing).toEqual([]);
  });

  it("matches the spike mapping for subscription", () => {
    const sub = mapping.concept_mappings.find((c) => c.concept === "Subscription")!;
    expect(sub.object_mappings).toEqual([{ referent_mappings: [{ relationship: "subscription_id", expression: "subscription.subscription_id" }] }]);
    const root = sub.link_mappings![0];
    expect(root.children).toContainEqual({
      object_mapping: { concept: "Customer", referent_mappings: [{ relationship: "customer_id", expression: "subscription.customer_id" }] },
      relationship: "customer_id",
    });
    const date = root.children!.find((c) => c.object_mapping.concept === "Date")!;
    expect(date.object_mapping.expression).toBe("subscription.snapshot_date");
    expect(date.children).toContainEqual({ object_mapping: { concept: "Mrr", expression: "subscription.mrr" }, relationship: "mrr" });
  });
});

// ── upstream validator ───────────────────────────────────────────────────────

import { validateUpstream, uvAvailable } from "../src/ossie/validate.js";

const hasUv = uvAvailable();
if (!hasUv) console.warn("[ossie] skipping the upstream validator: uv is not on PATH");

describe.skipIf(!hasUv)("upstream Ossie validator", () => {
  const dir = mkdtempSync(join(tmpdir(), "gasp-ossie-"));
  const ontologyFile = join(dir, "gasp.ontology.yaml");
  const mappingFile = join(dir, "gasp.mapping.yaml");
  writeFileSync(ontologyFile, stringify(ontology, { lineWidth: 0 }));
  writeFileSync(mappingFile, stringify(mapping, { lineWidth: 0 }));

  it("validates the ontology", async () => {
    const r = await validateUpstream(ontologyFile, "ontology");
    expect(r.ok, r.output).toBe(true);
  }, 120_000);

  it("validates the mapping", async () => {
    const r = await validateUpstream(mappingFile, "mapping");
    expect(r.ok, r.output).toBe(true);
  }, 120_000);
});
