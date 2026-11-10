/**
 * npm run conformance [--check]
 *
 * Writes standard/exports/ossie/conformance/ (see src/ossie/conformance.ts for
 * the shapes) and the example demo under standard/exports/ossie/example/demo/:
 * for every case, runs the staged dataset's source on the GASP fixture in PGlite
 * for the June 2026 period to get the expected rows, slices each dataset the
 * cases read to the rows that reproduce those results and
 * verifies the slice before writing. `--check` compares the files that would
 * be written with the files on disk and exits 1 on a difference, as
 * `npm run derive:check` does for the other derived artefacts.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { loadStandard } from "../src/loader.js";
import { compileMetric } from "../src/compile.js";
import { exportOssie, ossieYaml } from "../src/ossie/index.js";
import { exportExample } from "../src/ossie/example.js";
import { demoExpectedSql, demoMetrics, demoMetricsSql, DEMO_PERIOD } from "../src/ossie/demo.js";
import { stagedSource } from "../src/ossie/model.js";
import {
  CONFORMANCE_PERIOD, buildConformanceCases, dataSql, expectedSql, manifest, periodSpineSql, readme, referenceSql, type ConformanceCase,
} from "../src/ossie/conformance.js";
import type { OntologyDataset, OntologyField } from "../src/types.js";
import { addOssieViews, fixture, fixtureDb, scalar } from "../test/fixture-db.js";

const root = resolve(new URL(".", import.meta.url).pathname, "..", "..");
export const CONFORMANCE_DIR = join(root, "standard", "exports", "ossie", "conformance");
export const EXAMPLE_DEMO_DIR = join(root, "standard", "exports", "ossie", "example", "demo");

type Row = Record<string, unknown>;

const isMonthEnd = (d: string): boolean => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate() === day;
};
const isMonthStart = (d: string): boolean => d.endsWith("-01");
/** A date shifted back n months the way Postgres does it (the day clamped to the month's length). */
const monthsBack = (d: string, n: number): string => {
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 - n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(day, last))).toISOString().slice(0, 10);
};
/** The snapshot dates a staged source can read: period bounds and the day before, month starts and ends, and the bounds shifted back by the lag and window lengths. */
const SNAPSHOT_DATES = new Set<string>([
  ...[1, 3, 6, 12].flatMap((n) => [monthsBack(CONFORMANCE_PERIOD.start, n), monthsBack(CONFORMANCE_PERIOD.end, n), monthsBack(`${CONFORMANCE_PERIOD.start.slice(0, 8)}01`, n)]),
]);

/** A dataset's rows reduced to what the cases should need: snapshot rows on month boundaries and shifted period bounds, recent event and fact rows. */
function leanSlice(meta: OntologyDataset, rows: Row[]): { rows: Row[]; note: string } {
  const date = (r: Row) => String(r[meta.date] ?? "").slice(0, 10);
  if (meta.kind === "snapshot") {
    return { rows: rows.filter((r) => isMonthEnd(date(r)) || isMonthStart(date(r)) || SNAPSHOT_DATES.has(date(r))), note: "snapshot rows on month starts, month ends and the period bounds shifted back by one, three, six and twelve months" };
  }
  const since = monthsBack(CONFORMANCE_PERIOD.start, 1);
  return { rows: rows.filter((r) => r[meta.date] === null || r[meta.date] === undefined || date(r) >= since), note: `rows dated from ${since}` };
}

async function dbFrom(scripts: string[]): Promise<PGlite> {
  const db = new PGlite();
  for (const sql of scripts) await db.exec(sql);
  return db;
}

/** The reference query's rows with numeric text as numbers, so expected.sql and the manifest carry numbers. */
async function runCase(db: PGlite, c: ConformanceCase): Promise<Row[]> {
  const res = await db.query<Row>(referenceSql(c));
  return res.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v])));
}

const same = (a: Row[], b: Row[]) => JSON.stringify(a) === JSON.stringify(b);

/** Every file of the conformance set, keyed by path relative to CONFORMANCE_DIR. */
export async function buildConformance(): Promise<Record<string, string>> {
  const data = loadStandard();
  const exp = exportOssie(data);
  const cases = buildConformanceCases(data, exp);
  const fields = Object.fromEntries(data.ontology!.fields!.map((f) => [f.id, f])) as Record<string, OntologyField>;
  const datasets = data.ontology!.datasets!;
  const needed = [...new Set(cases.flatMap((c) => c.datasets))].sort();
  const fieldsOf = (ds: string) => data.ontology!.fields!.filter((f) => f.datasets?.includes(ds));
  const script = (ds: string, rows: Row[], note: string) => dataSql(ds, datasets[ds], fieldsOf(ds), rows, note);
  const spine = periodSpineSql();

  // Expected rows on the full fixture.
  const full = await dbFrom([spine, ...needed.map((ds) => script(ds, fixture.tables[ds], "all fixture rows"))]);
  const expected: Record<string, Row[]> = {};
  for (const c of cases) expected[c.id] = await runCase(full, c);
  await full.close();

  // Slice each dataset, falling back to the full rows for any dataset a case needs more of.
  const slices: Record<string, { rows: Row[]; note: string }> = Object.fromEntries(needed.map((ds) => [ds, leanSlice(datasets[ds], fixture.tables[ds])]));
  for (let round = 0; round < 3; round++) {
    const db = await dbFrom([spine, ...needed.map((ds) => script(ds, slices[ds].rows, slices[ds].note))]);
    const widen = new Set<string>();
    for (const c of cases) if (!same(await runCase(db, c), expected[c.id])) c.datasets.forEach((ds) => widen.add(ds));
    await db.close();
    if (widen.size === 0) break;
    for (const ds of widen) slices[ds] = { rows: fixture.tables[ds], note: "all fixture rows" };
    if (round === 2) throw new Error(`Conformance slices do not reproduce the full results for ${[...widen].join(", ")}`);
  }

  const files: Record<string, string> = {};
  files["data/period_spine.sql"] = spine;
  const dataIndex: Record<string, { rows: number; slice: string }> = {};
  for (const ds of needed) {
    files[`data/${ds}.sql`] = script(ds, slices[ds].rows, slices[ds].note);
    dataIndex[ds] = { rows: slices[ds].rows.length, slice: slices[ds].note };
  }
  for (const c of cases) {
    files[`cases/${c.id}/model.ossie.yaml`] = ossieYaml(c.model);
    files[`cases/${c.id}/reference.postgres.sql`] = referenceSql(c);
    files[`cases/${c.id}/expected.sql`] = expectedSql(c, expected[c.id]);
  }
  files["manifest.json"] = JSON.stringify(manifest(cases, expected, dataIndex), null, 2) + "\n";
  files["README.md"] = readme(cases, dataIndex);
  return files;
}

const close = (a: number | null, b: number | null): boolean =>
  a === null || b === null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Every file of the example demo, keyed by path relative to EXAMPLE_DEMO_DIR. */
export async function buildExampleDemo(): Promise<Record<string, string>> {
  const data = loadStandard();
  const exp = exportOssie(data);
  const ex = exportExample(data, exp);
  const fields = Object.fromEntries(data.ontology!.fields!.map((f) => [f.id, f])) as Record<string, OntologyField>;
  const datasets = data.ontology!.datasets!;
  const ctx = { fields, datasets, formulas: data.formulas! };
  const metrics = demoMetrics(ex.model, datasets, fields);

  // Expected values: the GASP compiled SQL per entry on the full fixture, through the gasp.<dataset> views.
  const full = await fixtureDb();
  await addOssieViews(full);
  await full.exec(`CREATE TABLE gasp.period_spine (period_start DATE, period_end DATE); INSERT INTO gasp.period_spine VALUES ('${DEMO_PERIOD.start}', '${DEMO_PERIOD.end}')`);
  const expected: Array<{ metric: string; value: number | null }> = [];
  for (const key of ex.entries) {
    const c = exp.coverage[key];
    if (c.kind === "notComputable") continue;
    const [id, variant] = key.split(":");
    const compiled = stagedSource(compileMetric(id, ctx, variant).sql);
    expected.push({ metric: c.ossieName, value: await scalar(full, `SELECT value FROM (${compiled}) s WHERE period_start = DATE '${DEMO_PERIOD.start}'`) });
  }
  expected.sort((a, b) => a.metric.localeCompare(b.metric));
  if (expected.length !== metrics.length) throw new Error(`${metrics.length} demo metrics but ${expected.length} expected values`);
  // The demo queries must give the same numbers on the full fixture.
  const check = async (db: PGlite, what: string) => {
    const res = await db.query<{ metric: string; value: unknown }>(demoMetricsSql(metrics));
    const got = res.rows.map((r) => ({ metric: r.metric, value: r.value === null ? null : Number(r.value) }));
    const bad = expected.filter((e, i) => got[i]?.metric !== e.metric || !close(got[i].value, e.value)).map((e) => e.metric);
    if (what === "full" && bad.length) throw new Error(`Demo queries disagree with the compiled SQL on the full fixture: ${bad.join(", ")}`);
    return bad;
  };
  await check(full, "full");
  await full.close();

  // Slice the datasets the example reads, widening any the slice does not reproduce.
  const fieldsOf = (ds: string) => data.ontology!.fields!.filter((f) => f.datasets?.includes(ds));
  const script = (ds: string, rows: Row[], note: string) => dataSql(ds, datasets[ds], fieldsOf(ds), rows, note);
  const slices: Record<string, { rows: Row[]; note: string }> = Object.fromEntries(ex.datasets.map((ds) => [ds, leanSlice(datasets[ds], fixture.tables[ds])]));
  const dataScript = () => [periodSpineSql(), ...ex.datasets.map((ds) => script(ds, slices[ds].rows, slices[ds].note))].join("\n");
  for (let round = 0; round < 3; round++) {
    const db = await dbFrom([dataScript()]);
    const bad = await check(db, "slice");
    await db.close();
    if (bad.length === 0) break;
    if (round === 2) throw new Error(`Demo slices do not reproduce the full results for ${bad.join(", ")}`);
    for (const ds of ex.datasets) slices[ds] = { rows: fixture.tables[ds], note: "all fixture rows" };
  }

  return {
    "data.sql": dataScript(),
    "metrics.sql": demoMetricsSql(metrics),
    "expected.sql": demoExpectedSql(expected),
  };
}

/** Files on disk under a directory, keyed by relative path. */
function readDir(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {};
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p)] = readFileSync(p, "utf-8");
    }
  };
  walk(dir);
  return out;
}

/** Files on disk under EXAMPLE_DEMO_DIR, keyed like buildExampleDemo's result. */
export const readExampleDemo = (): Record<string, string> => readDir(EXAMPLE_DEMO_DIR);

/** Files on disk under CONFORMANCE_DIR, keyed like buildConformance's result. */
export const readConformance = (): Record<string, string> => readDir(CONFORMANCE_DIR);

/** Write or check one generated directory; returns the number of files that differ. */
function sync(label: string, dir: string, files: Record<string, string>, current: Record<string, string>, check: boolean): number {
  const changed = [...new Set([...Object.keys(files), ...Object.keys(current)])].filter((k) => files[k] !== current[k]).sort();
  const bytes = Object.values(files).reduce((n, s) => n + Buffer.byteLength(s), 0);
  const size = `${Object.keys(files).length} files, ${Math.round(bytes / 1024)} KB`;
  if (check) {
    if (changed.length) console.error(`${label} out of date: ${changed.join(", ")}. Run npm run conformance.`);
    else console.log(`${label} is current (${size}).`);
    return changed.length;
  }
  for (const k of Object.keys(current)) if (!(k in files)) rmSync(join(dir, k));
  for (const k of changed) if (k in files) { mkdirSync(dirname(join(dir, k)), { recursive: true }); writeFileSync(join(dir, k), files[k]); }
  console.log(changed.length ? `${label}: updated ${changed.length} file(s) (${size}).` : `${label}: no changes.`);
  return changed.length;
}

const isMain = process.argv[1]?.endsWith("ossie-conformance.ts") || process.argv[1]?.endsWith("ossie-conformance.js");
if (isMain) {
  const check = process.argv.includes("--check");
  const stale = sync("Conformance set", CONFORMANCE_DIR, await buildConformance(), readConformance(), check)
    + sync("Example demo", EXAMPLE_DEMO_DIR, await buildExampleDemo(), readExampleDemo(), check);
  if (check && stale) process.exit(1);
}
