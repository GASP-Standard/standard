/**
 * npm run conformance [--check]
 *
 * Writes standard/exports/ossie/conformance/ (see src/ossie/conformance.ts for
 * the shapes): for every case, runs the staged dataset's source on the GASP
 * fixture in PGlite for the June 2026 period to get the expected rows, slices
 * each dataset the cases read to the rows that reproduce those results, and
 * verifies the slice before writing. `--check` compares the files that would
 * be written with the files on disk and exits 1 on a difference, as
 * `npm run derive:check` does for the other derived artefacts.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { loadStandard } from "../src/loader.js";
import { exportOssie, ossieYaml } from "../src/ossie/index.js";
import {
  CONFORMANCE_PERIOD, buildConformanceCases, dataSql, expectedSql, manifest, periodSpineSql, readme, referenceSql, type ConformanceCase,
} from "../src/ossie/conformance.js";
import type { OntologyDataset, OntologyField } from "../src/types.js";
import { fixture } from "../test/fixture-db.js";

const root = resolve(new URL(".", import.meta.url).pathname, "..", "..");
export const CONFORMANCE_DIR = join(root, "standard", "exports", "ossie", "conformance");

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

/** Files on disk under CONFORMANCE_DIR, keyed like buildConformance's result. */
export function readConformance(): Record<string, string> {
  if (!existsSync(CONFORMANCE_DIR)) return {};
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(CONFORMANCE_DIR, p)] = readFileSync(p, "utf-8");
    }
  };
  walk(CONFORMANCE_DIR);
  return out;
}

const isMain = process.argv[1]?.endsWith("ossie-conformance.ts") || process.argv[1]?.endsWith("ossie-conformance.js");
if (isMain) {
  const check = process.argv.includes("--check");
  const files = await buildConformance();
  const current = readConformance();
  const changed = [...new Set([...Object.keys(files), ...Object.keys(current)])].filter((k) => files[k] !== current[k]).sort();
  const bytes = Object.values(files).reduce((n, s) => n + Buffer.byteLength(s), 0);
  if (check) {
    if (changed.length) { console.error(`Conformance set out of date: ${changed.join(", ")}. Run npm run conformance.`); process.exit(1); }
    console.log(`Conformance set is current (${Object.keys(files).length} files, ${Math.round(bytes / 1024)} KB).`);
  } else {
    for (const k of Object.keys(current)) if (!(k in files)) rmSync(join(CONFORMANCE_DIR, k));
    for (const k of changed) if (k in files) { mkdirSync(dirname(join(CONFORMANCE_DIR, k)), { recursive: true }); writeFileSync(join(CONFORMANCE_DIR, k), files[k]); }
    console.log(changed.length ? `Updated ${changed.length} file(s) (${Object.keys(files).length} files, ${Math.round(bytes / 1024)} KB).` : "No changes.");
  }
}
