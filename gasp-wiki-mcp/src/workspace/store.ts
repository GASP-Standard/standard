/**
 * GASP Workspace storage: one row per company (a WorkOS organisation), its
 * members and its documents (the mapping, the semantic model, the decisions,
 * the pasted check results and the schema snapshots), each kind versioned so
 * the history is kept.
 * The store runs over any `SqlRunner`: `pg` against the managed Postgres in
 * production, PGlite in the tests. Every statement that reads or writes a
 * company's rows filters by its company id; there is no cross-company read.
 *
 * Later steps add `snapshots` (step 3), `share_links` (step 3) and
 * `certifications` (step 5) with their own migrations; they are not created
 * here so their columns are decided with the code that writes them.
 */
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { callerOf } from "./auth.js";

/** The one thing the store needs from a database: a parameterised query returning rows. PGlite has this shape; `pgRunner` wraps a `pg` pool to it. */
export interface SqlRunner {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export const DOCUMENT_KINDS = ["mapping", "model", "decisions", "results", "schema"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface Company {
  id: string;
  workos_org_id: string;
  name: string | null;
  plan: string;
  trial_ends_at: string | null;
}

export interface Member {
  role: "admin" | "member";
}

export interface StoredDocument {
  kind: DocumentKind;
  version: number;
  body: unknown;
  author_user_id: string | null;
  created_at: string;
}

export interface DocumentVersion {
  kind: DocumentKind;
  version: number;
  author_user_id: string | null;
  created_at: string;
}

/** The schema, applied in order; every statement is idempotent. */
export const SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS companies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workos_org_id text UNIQUE NOT NULL,
    name text,
    plan text NOT NULL DEFAULT 'trial',
    trial_ends_at timestamptz,
    terms_accepted_at timestamptz,
    benchmarks_consent boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS members (
    company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    workos_user_id text NOT NULL,
    email text,
    role text NOT NULL DEFAULT 'member',
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (company_id, workos_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    kind text NOT NULL,
    version integer NOT NULL,
    body jsonb NOT NULL,
    author_user_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (company_id, kind, version)
  )`,
  // The kinds live in one named constraint, replaced on every migration so a new kind needs no other step.
  `ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_kind_check`,
  `ALTER TABLE documents ADD CONSTRAINT documents_kind_check CHECK (kind IN (${DOCUMENT_KINDS.map((k) => `'${k}'`).join(", ")}))`,
];

/**
 * Every statement the store runs after the migration. The company upsert is
 * keyed by the WorkOS organisation id; every other statement filters by
 * `company_id = $1`, which `test/workspace.test.ts` checks.
 */
export const QUERIES = {
  upsertCompany: `INSERT INTO companies (workos_org_id, trial_ends_at) VALUES ($1, now() + interval '30 days')
    ON CONFLICT (workos_org_id) DO UPDATE SET workos_org_id = EXCLUDED.workos_org_id
    RETURNING id, workos_org_id, name, plan, trial_ends_at`,
  upsertMember: `INSERT INTO members (company_id, workos_user_id, email, role)
    VALUES ($1::uuid, $2::text, $3::text, CASE WHEN EXISTS (SELECT 1 FROM members WHERE company_id = $1::uuid) THEN 'member' ELSE 'admin' END)
    ON CONFLICT (company_id, workos_user_id) DO UPDATE SET email = COALESCE(EXCLUDED.email, members.email)
    RETURNING role`,
  insertDocument: `INSERT INTO documents (company_id, kind, version, body, author_user_id)
    SELECT $1::uuid, $2::text, COALESCE(MAX(version), 0) + 1, $3::jsonb, $4::text FROM documents WHERE company_id = $1::uuid AND kind = $2::text
    RETURNING version`,
  latestDocuments: `SELECT DISTINCT ON (kind) kind, version, body, author_user_id, created_at FROM documents
    WHERE company_id = $1::uuid ORDER BY kind, version DESC`,
  listVersions: `SELECT kind, version, author_user_id, created_at FROM documents
    WHERE company_id = $1::uuid AND ($2::text IS NULL OR kind = $2::text) ORDER BY kind, version DESC`,
} as const;

/** A unique violation: two saves of one kind racing for the same version. */
const isUniqueViolation = (e: unknown): boolean => (e as { code?: string }).code === "23505";

export class WorkspaceStore {
  constructor(private readonly db: SqlRunner) {}

  /** Applies the schema; safe to run on every start. */
  async migrate(): Promise<void> {
    for (const sql of SCHEMA) await this.db.query(sql);
  }

  /** The caller's company, created on first sight with a thirty-day trial, and the caller as a member (the company's first member is its admin). */
  async ensureCompany(auth: AuthInfo): Promise<{ company: Company; member: Member }> {
    const caller = callerOf(auth);
    if (!caller) throw new Error("The call carries no signed-in organisation.");
    const company = (await this.db.query<Company>(QUERIES.upsertCompany, [caller.orgId])).rows[0];
    const member = (await this.db.query<Member>(QUERIES.upsertMember, [company.id, caller.userId, caller.email ?? null])).rows[0];
    return { company, member };
  }

  /** Writes the next version of one kind of document and returns its version number. */
  async saveDocument(companyId: string, kind: DocumentKind, body: unknown, authorUserId: string | null): Promise<number> {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await this.db.query<{ version: number }>(QUERIES.insertDocument, [companyId, kind, JSON.stringify(body), authorUserId]);
        return Number(r.rows[0].version);
      } catch (e) {
        if (attempt < 2 && isUniqueViolation(e)) continue;
        throw e;
      }
    }
  }

  /** The latest version of each kind the company has saved. */
  async latestDocuments(companyId: string): Promise<StoredDocument[]> {
    return (await this.db.query<StoredDocument>(QUERIES.latestDocuments, [companyId])).rows.map(normalise);
  }

  /** Every version saved, newest first per kind; one kind when given. */
  async listVersions(companyId: string, kind?: DocumentKind): Promise<DocumentVersion[]> {
    return (await this.db.query<DocumentVersion>(QUERIES.listVersions, [companyId, kind ?? null])).rows.map(normalise);
  }
}

/** Drivers differ on numbers and timestamps; the tools read one shape. */
function normalise<T extends { version: number; created_at: string | Date }>(row: T): T {
  const created = row.created_at as unknown;
  return { ...row, version: Number(row.version), created_at: created instanceof Date ? created.toISOString() : String(created) };
}

/**
 * The production runner: a `pg` pool, imported on first use so the stdio
 * binary never loads it. `ca` is the database's CA certificate (DigitalOcean
 * managed Postgres signs with its own); when given, the connection verifies
 * against it and any `sslmode` in the URL is dropped so the certificate rules.
 */
export async function pgRunner(connectionString: string, ca?: string): Promise<SqlRunner & { end(): Promise<void> }> {
  const { default: pg } = await import("pg");
  let url = connectionString;
  if (ca) { const u = new URL(connectionString); u.searchParams.delete("sslmode"); url = u.toString(); }
  const pool = new pg.Pool({ connectionString: url, max: 5, ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}) });
  return {
    query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await pool.query(sql, params as unknown[])).rows as T[] }),
    end: () => pool.end(),
  };
}
