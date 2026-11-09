/**
 * GASP Workspace configuration: what the hosted server needs to know to sign
 * callers in and store their company's documents. The Workspace is on only
 * when `http.ts` builds a `WorkspaceOptions` from the environment
 * (`WORKSPACE_DATABASE_URL` and `WORKSPACE_ISSUER` both set); without it no
 * tool asks for a token and the workspace tools are not registered. The stdio
 * binary never builds one.
 */
import { pgRunner, WorkspaceStore, type SqlRunner } from "./store.js";
import type { AuthConfig } from "./auth.js";

export { verifyBearer, protectedResourceMetadata, metadataUrl, callerOf, AuthError, type AuthConfig } from "./auth.js";
export { WorkspaceStore, pgRunner, DOCUMENT_KINDS, type SqlRunner, type DocumentKind } from "./store.js";

/** The tools that read and write a workspace; registered only when the Workspace is on. */
export const WORKSPACE_TOOLS = ["save_workspace", "load_workspace"] as const;

/** The implementation tools that need a signed-in company on the hosted server when the Workspace is on (`DECISIONS.md` 2026-11-07), plus the workspace tools. */
export const DEFAULT_PROTECTED_TOOLS: readonly string[] = [
  "profile_schema", "propose_mapping", "record_decision", "compile_model", "compile_target",
  "score_drift", "derive_cel", "generate_checks", "plan_fixes", "readiness_report",
  ...WORKSPACE_TOOLS,
];

export const DEFAULT_RESOURCE = "https://mcp.koinedata.com/mcp";

export interface WorkspaceOptions extends AuthConfig {
  /** The canonical URL of this MCP resource, named in the metadata and the challenge. */
  resource: string;
  /** The tool names a call must carry a valid token for. */
  tools: readonly string[];
  /** The Postgres connection string; unused when `runner` is given. */
  databaseUrl?: string;
  /** The database's CA certificate (PEM), for a managed Postgres that signs with its own. */
  databaseCa?: string;
  /** A runner in place of the connection string (tests pass PGlite). */
  runner?: SqlRunner;
}

const stores = new WeakMap<WorkspaceOptions, Promise<WorkspaceStore>>();

/** The store for these options, connected and migrated once per process. */
export function storeFor(options: WorkspaceOptions): Promise<WorkspaceStore> {
  let store = stores.get(options);
  if (!store) {
    store = (async () => {
      const runner = options.runner ?? (options.databaseUrl ? await pgRunner(options.databaseUrl, options.databaseCa) : undefined);
      if (!runner) throw new Error("The Workspace has no database: set WORKSPACE_DATABASE_URL.");
      const s = new WorkspaceStore(runner);
      await s.migrate();
      return s;
    })();
    store.catch(() => stores.delete(options)); // a failed connection is retried on the next call
    stores.set(options, store);
  }
  return store;
}
