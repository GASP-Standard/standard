/**
 * GASP Workspace, step 1: identity and storage. The store over PGlite
 * (idempotent migration, companies and members created once, versions per
 * kind, the latest of each, every statement scoped to one company), the token
 * check against a local key set (a good token, and an expired one, a wrong
 * issuer, a wrong audience, a bad signature and no organisation each refused
 * with its own reason), and the HTTP server with the Workspace on: the
 * protected-resource metadata, anonymous use of the free tools, the 401
 * challenge for a protected call, a saved document read back by its own
 * company and by no other, and the tool call record carrying the company and
 * never the user. Nothing here touches the network.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHttpServer, workspaceFromEnv } from "../src/http.js";
import { TOOL_COUNT, WORKSPACE_TOOL_TITLES, createServer, toolCount, type ToolCallRecord } from "../src/server.js";
import { AuthError, DEFAULT_PROTECTED_TOOLS, protectedResourceMetadata, verifyBearer, WorkspaceStore, type WorkspaceOptions } from "../src/workspace/index.js";
import { QUERIES, SCHEMA } from "../src/workspace/store.js";

const ISSUER = "https://gasp-test.authkit.app";
const RESOURCE = "https://mcp.gaspwiki.com/mcp";
const text = (r: { content?: unknown }): string => (r.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
const listening = (s: Server): Promise<void> => new Promise((resolve) => (s.listening ? resolve() : s.once("listening", () => resolve())));
const auth = (org: string, sub: string, email?: string): AuthInfo => ({ token: "t", clientId: "c", scopes: [], extra: { org_id: org, sub, ...(email ? { email } : {}) } });

let keys: JWTVerifyGetKey;
let sign: (claims: JWTPayload, opts?: { issuer?: string; expires?: string | number; audience?: string }) => Promise<string>;
let foreignSign: (claims: JWTPayload) => Promise<string>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  keys = createLocalJWKSet({ keys: [jwk] });
  sign = (claims, opts = {}) => {
    const jwt = new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(opts.issuer ?? ISSUER).setIssuedAt().setExpirationTime(opts.expires ?? "1h");
    if (opts.audience) jwt.setAudience(opts.audience);
    return jwt.sign(pair.privateKey);
  };
  // Signed by another key under the same kid: the signature does not verify.
  foreignSign = (claims) => new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISSUER).setExpirationTime("1h").sign(other.privateKey);
});

describe("the workspace store", () => {
  let db: PGlite;
  let store: WorkspaceStore;
  beforeAll(async () => {
    db = new PGlite();
    store = new WorkspaceStore(db);
    await store.migrate();
  });
  afterAll(() => db.close());

  it("migrates idempotently", async () => {
    await store.migrate();
    const tables = await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
    expect(tables.rows.map((r) => r.table_name)).toEqual(["companies", "documents", "members"]);
  });

  it("creates a company once, its first member as admin and the next as member", async () => {
    const a = await store.ensureCompany(auth("org_store", "user_1", "a@example.com"));
    const again = await store.ensureCompany(auth("org_store", "user_1"));
    const b = await store.ensureCompany(auth("org_store", "user_2"));
    expect(a.member.role).toBe("admin");
    expect(again.member.role).toBe("admin");
    expect(b.member.role).toBe("member");
    expect(again.company.id).toBe(a.company.id);
    expect(b.company.id).toBe(a.company.id);
    expect(a.company.plan).toBe("trial");
    expect(a.company.trial_ends_at).toBeTruthy();
    const companies = await db.query("SELECT * FROM companies WHERE workos_org_id = 'org_store'");
    expect(companies.rows).toHaveLength(1);
    const members = await db.query<{ email: string | null }>("SELECT email FROM members WHERE workos_user_id = 'user_1'");
    expect(members.rows[0].email).toBe("a@example.com"); // a later token without the email keeps it
  });

  it("versions each kind separately and returns the latest of each", async () => {
    const { company } = await store.ensureCompany(auth("org_versions", "user_v"));
    expect(await store.saveDocument(company.id, "mapping", { v: 1 }, "user_v")).toBe(1);
    expect(await store.saveDocument(company.id, "mapping", { v: 2 }, "user_v")).toBe(2);
    expect(await store.saveDocument(company.id, "model", { m: 1 }, "user_v")).toBe(1);
    expect(await store.saveDocument(company.id, "mapping", { v: 3 }, null)).toBe(3);
    const latest = await store.latestDocuments(company.id);
    expect(latest.map((d) => [d.kind, d.version, d.body])).toEqual([["mapping", 3, { v: 3 }], ["model", 1, { m: 1 }]]);
    expect((await store.listVersions(company.id)).map((v) => `${v.kind}:${v.version}`)).toEqual(["mapping:3", "mapping:2", "mapping:1", "model:1"]);
    expect((await store.listVersions(company.id, "model")).map((v) => v.version)).toEqual([1]);
    const other = await store.ensureCompany(auth("org_other", "user_o"));
    expect(await store.latestDocuments(other.company.id)).toEqual([]);
    expect(await store.saveDocument(other.company.id, "mapping", { o: 1 }, "user_o")).toBe(1);
  });

  it("refuses a kind outside the four", async () => {
    const { company } = await store.ensureCompany(auth("org_versions", "user_v"));
    await expect(store.saveDocument(company.id, "secrets" as "mapping", {}, null)).rejects.toThrow();
  });

  it("scopes every statement to one company", () => {
    for (const [name, sql] of Object.entries(QUERIES)) {
      if (/\b(documents|members)\b/.test(sql)) expect(sql, name).toMatch(/company_id = \$1/);
      else expect(sql, name).toMatch(/workos_org_id/);
      // Every read of documents or members is filtered: no FROM without a WHERE on the company.
      for (const from of sql.match(/FROM (documents|members)\b[^)]*/g) ?? []) expect(from, name).toMatch(/WHERE company_id = \$1/);
    }
    expect(SCHEMA.every((s) => s.startsWith("CREATE TABLE IF NOT EXISTS"))).toBe(true);
  });
});

describe("verifyBearer", () => {
  const config = { issuer: ISSUER, keys: undefined as unknown as JWTVerifyGetKey };
  beforeAll(() => { config.keys = keys; });

  it("accepts a token naming a user and an organisation", async () => {
    const token = await sign({ sub: "user_1", org_id: "org_1", client_id: "client_x", scope: "openid profile", email: "u@example.com" });
    const info = await verifyBearer(token, config);
    expect(info).toMatchObject({ token, clientId: "client_x", scopes: ["openid", "profile"], extra: { sub: "user_1", org_id: "org_1", email: "u@example.com" } });
    expect(info.expiresAt).toBeGreaterThan(Date.now() / 1000);
    const azp = await verifyBearer(await sign({ sub: "u", org_id: "o", azp: "client_y" }), config);
    expect([azp.clientId, azp.scopes]).toEqual(["client_y", []]);
    expect((await verifyBearer(await sign({ sub: "u", org_id: "o" }), config)).clientId).toBe("unknown");
  });

  it("refuses each bad token with its own reason", async () => {
    const refusal = async (token: string, cfg: Parameters<typeof verifyBearer>[1] = config) => {
      try { await verifyBearer(token, cfg); } catch (e) { expect(e).toBeInstanceOf(AuthError); return (e as Error).message; }
      throw new Error("accepted");
    };
    const reasons = [
      await refusal(await sign({ sub: "u", org_id: "o" }, { expires: Math.floor(Date.now() / 1000) - 60 })),
      await refusal(await sign({ sub: "u", org_id: "o" }, { issuer: "https://elsewhere.authkit.app" })),
      await refusal(await sign({ sub: "u", org_id: "o" }, { audience: "https://other.example" }), { ...config, audience: RESOURCE }),
      await refusal(await foreignSign({ sub: "u", org_id: "o" })),
      await refusal(await sign({ sub: "u" })),
      await refusal("not-a-token"),
    ];
    expect(reasons[0]).toMatch(/expired/);
    expect(reasons[1]).toContain(ISSUER);
    expect(reasons[2]).toMatch(/audience/);
    expect(reasons[3]).toMatch(/signature/);
    expect(reasons[4]).toMatch(/organisation/);
    expect(new Set(reasons).size).toBe(reasons.length);
    // The audience is checked only when configured, and passes when it matches.
    expect((await verifyBearer(await sign({ sub: "u", org_id: "o" }, { audience: RESOURCE }), { ...config, audience: RESOURCE })).extra?.org_id).toBe("o");
  });

  it("describes the protected resource", () => {
    expect(protectedResourceMetadata({ issuer: ISSUER, resource: RESOURCE })).toEqual({
      resource: RESOURCE, authorization_servers: [ISSUER], bearer_methods_supported: ["header"], scopes_supported: [], resource_documentation: "https://gaspwiki.com/workspace",
    });
  });
});

describe("workspaceFromEnv", () => {
  it("is off unless both the database and the issuer are set", () => {
    expect(workspaceFromEnv({})).toBeUndefined();
    expect(workspaceFromEnv({ WORKSPACE_ISSUER: ISSUER })).toBeUndefined();
    expect(workspaceFromEnv({ WORKSPACE_DATABASE_URL: "postgres://x" })).toBeUndefined();
  });

  it("fills the defaults and keeps the workspace tools protected", () => {
    const ws = workspaceFromEnv({ WORKSPACE_ISSUER: ISSUER, WORKSPACE_DATABASE_URL: "postgres://x" })!;
    expect(ws).toMatchObject({ issuer: ISSUER, databaseUrl: "postgres://x", resource: RESOURCE });
    expect(ws.audience).toBeUndefined();
    expect(ws.tools).toEqual(DEFAULT_PROTECTED_TOOLS);
    expect([...ws.tools].sort()).toEqual(["compile_model", "compile_target", "derive_cel", "generate_checks", "load_workspace", "plan_fixes", "profile_schema", "propose_mapping", "readiness_report", "record_decision", "save_workspace", "score_drift"]);
    const narrowed = workspaceFromEnv({ WORKSPACE_ISSUER: ISSUER, WORKSPACE_DATABASE_URL: "postgres://x", WORKSPACE_TOOLS: "score_drift", WORKSPACE_AUDIENCE: "aud", WORKSPACE_JWKS_URL: "https://k/jwks", WORKSPACE_RESOURCE: "https://h/mcp" })!;
    expect(narrowed).toMatchObject({ audience: "aud", jwksUrl: "https://k/jwks", resource: "https://h/mcp", tools: ["score_drift", "save_workspace", "load_workspace"] });
  });
});

describe("the HTTP server with the Workspace on", () => {
  const db = new PGlite();
  const records: ToolCallRecord[] = [];
  let server: Server;
  const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  const call = (name: string, args: Record<string, unknown>, extra: Record<string, string> = {}) =>
    fetch(`${base()}/mcp`, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const client = async (token?: string) => {
    const c = new Client({ name: "ws-test", version: "1" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${base()}/mcp`), token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : {}));
    return c;
  };

  beforeAll(async () => {
    const workspace: WorkspaceOptions = { issuer: ISSUER, resource: RESOURCE, keys, runner: db, tools: DEFAULT_PROTECTED_TOOLS };
    server = startHttpServer({ port: 0, host: "127.0.0.1", maxBodyBytes: 1_048_576, workspace, onToolCall: (r) => records.push(r) });
    await listening(server);
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  });

  it("serves the protected-resource metadata at both well-known paths", async () => {
    for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const r = await fetch(`${base()}${p}`);
      expect(r.status).toBe(200);
      expect(r.headers.get("access-control-allow-origin")).toBe("*");
      expect(await r.json()).toEqual(protectedResourceMetadata({ issuer: ISSUER, resource: RESOURCE }));
    }
  });

  it("lists every tool and runs a free one with no token", async () => {
    const c = await client();
    const { tools } = await c.listTools();
    expect(tools).toHaveLength(TOOL_COUNT + Object.keys(WORKSPACE_TOOL_TITLES).length);
    const save = tools.find((t) => t.name === "save_workspace")!;
    expect(save.annotations).toMatchObject({ title: WORKSPACE_TOOL_TITLES.save_workspace, readOnlyHint: false, destructiveHint: false });
    expect(tools.find((t) => t.name === "load_workspace")!.annotations).toMatchObject({ readOnlyHint: true });
    expect(text(await c.callTool({ name: "lookup_metric", arguments: { name: "MRR" } }))).toContain("Monthly Recurring Revenue");
    await c.close();
    expect((await fetch(`${base()}/health`).then((r) => r.json())).tools).toBe(toolCount(true));
  });

  it("challenges a protected call without a token, and with a refused one", async () => {
    const missing = await call("save_workspace", { mapping: "{}" });
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe('Bearer resource_metadata="https://mcp.gaspwiki.com/.well-known/oauth-protected-resource"');
    expect(missing.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");
    const body = await missing.json();
    expect(body.error.message).toContain("save_workspace needs a signed-in GASP Workspace company");
    expect(body.error.message).toContain("npm package");
    const refused = await call("save_workspace", { mapping: "{}" }, { Authorization: `Bearer ${await foreignSign({ sub: "u", org_id: "o" })}` });
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toMatch(/^Bearer resource_metadata="[^"]+", error="invalid_token", error_description="[^"]*signature/);
    // An implementation tool is protected too; a free one with a bad token runs anonymously.
    expect((await call("profile_schema", { schema: "CREATE TABLE t (id int)" })).status).toBe(401);
    expect((await call("lookup_metric", { name: "MRR" }, { Authorization: "Bearer junk" })).status).toBe(200);
  });

  it("saves to the caller's company and reads back only there", async () => {
    records.length = 0;
    const tokenA = await sign({ sub: "user_a", org_id: "org_acme", email: "a@acme.example" });
    const a = await client(tokenA);
    const mapping = JSON.stringify({ version: "1.0", tables: { subscription: { table: "subs", columns: { mrr: "mrr" } } } });
    const saved = await a.callTool({ name: "save_workspace", arguments: { mapping, results: "check_id,violations\nunique_event_id,0" } });
    expect(saved.isError).toBeFalsy();
    expect(text(saved)).toContain("Mapping: version 1");
    expect(text(saved)).toContain("Check results: version 1");
    expect(text(await a.callTool({ name: "save_workspace", arguments: { mapping } }))).toContain("Mapping: version 2");
    const bad = await a.callTool({ name: "save_workspace", arguments: { mapping, semantic_model: "[1, 2" } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain("Nothing was saved");
    const loaded = text(await a.callTool({ name: "load_workspace", arguments: {} }));
    expect(loaded).toContain("## Mapping");
    expect(loaded).toContain("Version 2");
    expect(loaded).toContain('"subs"');
    expect(loaded).toContain('"check_id": "unique_event_id"');
    expect(text(await a.callTool({ name: "load_workspace", arguments: { versions: true, kind: "mapping" } }))).toMatch(/\| Mapping \| 2 \|[\s\S]*\| Mapping \| 1 \|/);
    await a.close();

    const rows = await db.query<{ kind: string; version: number }>("SELECT d.kind, d.version FROM documents d JOIN companies c ON c.id = d.company_id WHERE c.workos_org_id = 'org_acme' ORDER BY kind, version");
    expect(rows.rows).toEqual([{ kind: "mapping", version: 1 }, { kind: "mapping", version: 2 }, { kind: "results", version: 1 }]);

    const b = await client(await sign({ sub: "user_b", org_id: "org_globex" }));
    expect(text(await b.callTool({ name: "load_workspace", arguments: {} }))).toContain("no saved documents yet");
    await b.close();

    const authed = records.filter((r) => r.tool === "save_workspace" || r.tool === "load_workspace");
    expect(authed.length).toBeGreaterThan(0);
    expect(authed.filter((r) => r.company === "org_acme")).toHaveLength(5);
    expect(authed.some((r) => r.company === "org_globex")).toBe(true);
    const logged = JSON.stringify(records);
    for (const secret of ["user_a", "user_b", "a@acme.example", "subs"]) expect(logged).not.toContain(secret);
    // Over stateless HTTP each request has its own server, so a call carries no client name; the company is the only identity in the record.
    for (const r of authed) for (const k of Object.keys(r)) expect(["client", "company", "event", "ms", "ok", "tool"]).toContain(k);
  });
});

describe("the workspace tools without a signed-in caller", () => {
  it("refuse with the sign-in message and write nothing", async () => {
    const db = new PGlite();
    try {
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await createServer({ workspace: { issuer: ISSUER, resource: RESOURCE, keys, runner: db, tools: DEFAULT_PROTECTED_TOOLS } }).connect(serverSide);
      const c = new Client({ name: "t", version: "0" });
      await c.connect(clientSide);
      for (const [name, args] of [["save_workspace", { mapping: "{}" }], ["load_workspace", {}]] as const) {
        const r = await c.callTool({ name, arguments: args });
        expect(r.isError).toBe(true);
        expect(text(r)).toContain("needs a signed-in GASP Workspace company");
      }
      await c.close();
      expect((await db.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'documents'")).rows).toEqual([]);
    } finally {
      await db.close();
    }
  });
});

describe("the HTTP server with the Workspace off", () => {
  it("asks for no token and serves no workspace tool", async () => {
    const server = startHttpServer({ port: 0, host: "127.0.0.1" });
    await listening(server);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      expect((await fetch(`${base}/.well-known/oauth-protected-resource`)).status).toBe(404);
      const c = new Client({ name: "t", version: "0" });
      await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
      const { tools } = await c.listTools();
      expect(tools).toHaveLength(TOOL_COUNT);
      expect(tools.some((t) => t.name in WORKSPACE_TOOL_TITLES)).toBe(false);
      expect(text(await c.callTool({ name: "profile_schema", arguments: { schema: "CREATE TABLE t (id int)" } }))).not.toBe("");
      await c.close();
      expect((await fetch(`${base}/health`).then((r) => r.json())).tools).toBe(TOOL_COUNT);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
