/**
 * npm run conformance [--check]
 *
 * Writes standard/exports/ossie/conformance/ (see src/ossie/conformance.ts for
 * the shapes) and the example demo under standard/exports/ossie/example/demo/:
 * for every case, runs the reference query (the staged dataset's source, or the
 * direct expression on the last snapshot date) on the GASP fixture in PGlite
 * for the case's period to get the expected rows, runs each listed reading the
 * same way, slices each dataset the cases read to the rows that reproduce those
 * results and verifies the slice before writing. `--check` compares the files that would
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
  CONFORMANCE_CASES, CONFORMANCE_PERIOD, buildConformanceCases, dataSql, displayValue, expectedSql, manifest, periodSpineSql, readingsSql, readme, referenceSql,
  type ConformanceCase, type ConformancePeriod, type ReadingValues,
} from "../src/ossie/conformance.js";
import { buildSnapshotCases } from "../src/ossie/conformance-snapshot.js";
import type { OntologyDataset, OntologyField } from "../src/types.js";
import { addOssieViews, fixture, fixtureDb, scalar } from "../test/fixture-db.js";

const root = resolve(new URL(".", import.meta.url).pathname, "..", "..");
export const CONFORMANCE_DIR = join(root, "standard", "exports", "ossie", "conformance");
export const EXAMPLE_DEMO_DIR = join(root, "standard", "exports", "ossie", "example", "demo");

type Row = Record<string, unknown>;

const close = (a: number | null, b: number | null): boolean =>
  a === null || b === null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

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

const dayBefore = (d: string): string => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

/** What the cases reading one dataset need beyond the lean slice: single snapshot dates and ranges kept on every date. */
interface Keep { dates: string[]; daily: ConformancePeriod[] }

/** The bounds of each case period off the default one and the ranges a reading sums across, per snapshot dataset the case reads. */
function keepFor(cases: ConformanceCase[]): Record<string, Keep> {
  const out: Record<string, Keep> = {};
  for (const c of cases) for (const ds of c.datasets) {
    const k = (out[ds] ??= { dates: [], daily: [] });
    if (c.period.start !== CONFORMANCE_PERIOD.start || c.period.end !== CONFORMANCE_PERIOD.end) {
      for (const d of [dayBefore(c.period.start), c.period.start, c.period.end]) if (!k.dates.includes(d)) k.dates.push(d);
    }
    if (c.daily && !k.daily.some((p) => p.start === c.daily!.start && p.end === c.daily!.end)) k.daily.push(c.daily);
  }
  return out;
}

/** A dataset's rows reduced to what the cases should need: snapshot rows on month boundaries, shifted period bounds and the dates in `keep`, recent event and fact rows. */
function leanSlice(meta: OntologyDataset, rows: Row[], keep: Keep = { dates: [], daily: [] }): { rows: Row[]; note: string } {
  const date = (r: Row) => String(r[meta.date] ?? "").slice(0, 10);
  if (meta.kind === "snapshot") {
    const plain = (d: string) => isMonthEnd(d) || isMonthStart(d) || SNAPSHOT_DATES.has(d);
    const dates = keep.dates.filter((d) => !plain(d)).sort();
    const kept = (d: string) => plain(d) || dates.includes(d) || keep.daily.some((p) => d >= p.start && d <= p.end);
    const note = "snapshot rows on month starts, month ends and the period bounds shifted back by one, three, six and twelve months"
      + (dates.length ? `; on ${dates.join(", ")}, which a case off the calendar month reads` : "")
      + keep.daily.map((p) => `; on every date from ${p.start} to ${p.end}, which a listed reading sums across`).join("");
    return { rows: rows.filter((r) => kept(date(r))), note };
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

/** The value of each listed reading of a case. */
async function runReadings(db: PGlite, c: ConformanceCase): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  for (const r of c.readings) out[r.name] = await scalar(db, `SELECT ${r.query}`);
  return out;
}

/** Every file of the conformance set, keyed by path relative to CONFORMANCE_DIR. */
export async function buildConformance(): Promise<Record<string, string>> {
  const data = loadStandard();
  const exp = exportOssie(data);
  const cases = [...buildConformanceCases(data, exp), ...buildSnapshotCases(data, exp, CONFORMANCE_CASES.length)];
  const datasets = data.ontology!.datasets!;
  const needed = [...new Set(cases.flatMap((c) => c.datasets))].sort();
  const fieldsOf = (ds: string) => data.ontology!.fields!.filter((f) => f.datasets?.includes(ds));
  const script = (ds: string, rows: Row[], note: string) => dataSql(ds, datasets[ds], fieldsOf(ds), rows, note);
  // One spine row per period a staged case is evaluated for.
  const periods = cases.filter((c) => c.kind === "staged").map((c) => c.period).filter((p, i, all) => all.findIndex((q) => q.start === p.start && q.end === p.end) === i);
  const spine = periodSpineSql(periods);

  // Expected rows and reading values on the full fixture.
  const full = await dbFrom([spine, ...needed.map((ds) => script(ds, fixture.tables[ds], "all fixture rows"))]);
  const expected: Record<string, Row[]> = {};
  const readings: ReadingValues = {};
  for (const c of cases) {
    expected[c.id] = await runCase(full, c);
    readings[c.id] = await runReadings(full, c);
    // A reading that gives the expected value on this data grades nothing, and two that give one value cannot be told apart.
    const right = c.readings.length ? Number(expected[c.id][0]?.value) : NaN;
    const seen = new Map<string, string>();
    for (const r of c.readings) {
      const v = readings[c.id][r.name];
      if (v !== null && close(v, right)) throw new Error(`Conformance case ${c.id}: the reading ${r.name} returns the expected value ${displayValue(v)} on the fixture`);
      const twin = seen.get(displayValue(v));
      if (twin) throw new Error(`Conformance case ${c.id}: the readings ${twin} and ${r.name} both return ${displayValue(v)} on the fixture`);
      seen.set(displayValue(v), r.name);
    }
  }
  await full.close();

  // Slice each dataset, falling back to the full rows for any dataset a case needs more of.
  const keep = keepFor(cases);
  const slices: Record<string, { rows: Row[]; note: string }> = Object.fromEntries(needed.map((ds) => [ds, leanSlice(datasets[ds], fixture.tables[ds], keep[ds])]));
  for (let round = 0; round < 3; round++) {
    const db = await dbFrom([spine, ...needed.map((ds) => script(ds, slices[ds].rows, slices[ds].note))]);
    const widen = new Set<string>();
    for (const c of cases) {
      if (!same(await runCase(db, c), expected[c.id]) || JSON.stringify(await runReadings(db, c)) !== JSON.stringify(readings[c.id])) c.datasets.forEach((ds) => widen.add(ds));
    }
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
    if (c.readings.length) files[`cases/${c.id}/readings.sql`] = readingsSql(c, readings[c.id]);
  }
  files["manifest.json"] = JSON.stringify(manifest(cases, expected, readings, dataIndex), null, 2) + "\n";
  files["README.md"] = readme(cases, dataIndex, expected, readings);
  return files;
}

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
