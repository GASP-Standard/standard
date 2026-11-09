#!/usr/bin/env node

/**
 * The GASP Standard MCP server over Streamable HTTP, for a hosted endpoint
 * such as https://mcp.koinedata.com/mcp that Claude connects to as a remote
 * server. Stateless: every request gets its own transport and server over the
 * data loaded once, so any number of instances can sit behind one hostname.
 * No authentication unless GASP Workspace is configured: the standard is
 * public and every standard tool is read-only.
 *
 * Run `gasp-standard-mcp-http` (or `node build/http.js`). Environment:
 * `PORT` (default 3000), `HOST` (default 0.0.0.0), `MCP_PATH` (default /mcp),
 * `MCP_ALLOWED_HOSTS` and `MCP_ALLOWED_ORIGINS` (comma-separated; when either
 * is set, requests whose Host or Origin header is not listed are refused, the
 * DNS-rebinding guard for a server reachable from a browser).
 *
 * Three guards for a public endpoint, each off when set to 0: `MCP_RATE_LIMIT`
 * (requests per minute per client address, default 60; the address is the first
 * entry of `X-Forwarded-For` behind a proxy, else the socket; beyond it a 429
 * with `Retry-After`), `MCP_MAX_BODY_BYTES` (default 1048576; a larger
 * `Content-Length` is a 413 and a body without one a 411) and
 * `MCP_HEAVY_CONCURRENCY` (default 2; how many `score_drift` and
 * `readiness_report` calls run at once across the process, the rest get a busy
 * error they can retry).
 *
 * Every tool call is written to stderr as one JSON line, `{"event":"tool",
 * "tool":"lookup_metric","ms":12,"ok":true,"client":"claude-ai/1.0"}`, so the
 * host's log stream counts calls per tool. Arguments and results are never
 * logged, which is what the privacy policy at koinedata.com/privacy promises.
 *
 * GASP Workspace, on only when `WORKSPACE_DATABASE_URL` and `WORKSPACE_ISSUER`
 * are both set (`workspaceFromEnv`). The server is then an OAuth resource
 * server in the MCP authorization flow: it serves the protected-resource
 * metadata at `/.well-known/oauth-protected-resource` (and with the MCP path
 * appended), reads each POST body before the transport sees it, and answers a
 * `tools/call` for a protected tool (`WORKSPACE_TOOLS`, default the
 * implementation tools and the workspace tools) that carries no valid bearer
 * token with a 401 whose `WWW-Authenticate` header names the metadata, which
 * sends the client through sign-in at the issuer. A valid token rides on the
 * request as `auth`, which the SDK hands the tool as `extra.authInfo`, and the
 * tool call record gains `company`, the organisation id. Every other request
 * is untouched, so anonymous use of the free tools stays anonymous. Other
 * variables: `WORKSPACE_JWKS_URL` (default `<issuer>/oauth2/jwks`),
 * `WORKSPACE_AUDIENCE` (the `aud` a token must carry, unchecked when unset),
 * `WORKSPACE_RESOURCE` (default https://mcp.koinedata.com/mcp) and
 * `WORKSPACE_DATABASE_CA` (the database's CA certificate in PEM).
 */
import { createServer as createHttp, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { PKG_VERSION, createServer, toolCount, type HeavyLimit, type ToolCallRecord } from "./server.js";
import { AuthError, DEFAULT_PROTECTED_TOOLS, DEFAULT_RESOURCE, metadataUrl, protectedResourceMetadata, verifyBearer, WORKSPACE_TOOLS, type WorkspaceOptions } from "./workspace/index.js";

export interface HttpOptions {
  port?: number;
  host?: string;
  /** The path the MCP endpoint answers on; everything else is the health page or 404. */
  path?: string;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  /** Requests per minute per client address on the MCP path; 0 or unset disables. */
  rateLimitPerMinute?: number;
  /** The largest request body accepted on the MCP path, in bytes; 0 or unset disables. */
  maxBodyBytes?: number;
  /** How many heavy tool calls run at once across the process; 0 or unset disables. */
  heavyConcurrency?: number;
  /** GASP Workspace; unset, nothing asks for a token and the workspace tools are not served. */
  workspace?: WorkspaceOptions;
  /** Where tool call records go; default one JSON line each on stderr. */
  onToolCall?: (record: ToolCallRecord) => void;
}

/** GASP Workspace from the environment, or undefined when `WORKSPACE_DATABASE_URL` or `WORKSPACE_ISSUER` is unset. */
export function workspaceFromEnv(env: NodeJS.ProcessEnv): WorkspaceOptions | undefined {
  const databaseUrl = env.WORKSPACE_DATABASE_URL?.trim();
  const issuer = env.WORKSPACE_ISSUER?.trim();
  if (!databaseUrl || !issuer) return undefined;
  const tools = list(env.WORKSPACE_TOOLS);
  return {
    issuer,
    databaseUrl,
    ...(env.WORKSPACE_DATABASE_CA?.trim() ? { databaseCa: env.WORKSPACE_DATABASE_CA } : {}),
    ...(env.WORKSPACE_JWKS_URL?.trim() ? { jwksUrl: env.WORKSPACE_JWKS_URL.trim() } : {}),
    ...(env.WORKSPACE_AUDIENCE?.trim() ? { audience: env.WORKSPACE_AUDIENCE.trim() } : {}),
    resource: env.WORKSPACE_RESOURCE?.trim() || DEFAULT_RESOURCE,
    // The workspace tools always need a company, whatever the list says.
    tools: tools?.length ? [...new Set([...tools, ...WORKSPACE_TOOLS])] : DEFAULT_PROTECTED_TOOLS,
  };
}

/** The body read in full, or `null` when it passed the cap on the way in. */
async function readBody(req: IncomingMessage, max: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (max && size > max) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/** The protected tool a JSON-RPC message (or batch) calls, if any. */
function protectedCall(body: unknown, tools: ReadonlySet<string>): string | undefined {
  for (const m of Array.isArray(body) ? body : [body]) {
    const msg = m as { method?: unknown; params?: { name?: unknown } } | null;
    if (msg?.method === "tools/call" && typeof msg.params?.name === "string" && tools.has(msg.params.name)) return msg.params.name;
  }
  return undefined;
}

const bearer = (req: IncomingMessage): string | undefined => /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? "")?.[1];

/** A fixed one-minute window per client address, swept as it is read; enough for one process behind one hostname. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();
  constructor(private readonly perMinute: number, private readonly now: () => number = Date.now) {}
  /** Seconds to wait when the client is over its limit, or 0 when the request may proceed (and is counted). */
  retryAfter(client: string): number {
    const t = this.now();
    const w = this.hits.get(client);
    if (!w || t - w.windowStart >= 60_000) {
      if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (t - v.windowStart >= 60_000) this.hits.delete(k);
      this.hits.set(client, { count: 1, windowStart: t });
      return 0;
    }
    if (w.count >= this.perMinute) return Math.max(1, Math.ceil((w.windowStart + 60_000 - t) / 1000));
    w.count++;
    return 0;
  }
}

/** The client address: the first entry of X-Forwarded-For when a proxy set it, else the socket's. */
export function clientAddress(req: IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "unknown";
}

const rpcError = (res: ServerResponse, status: number, code: number, message: string, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS, ...headers });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
};

/** The listening server. `port: 0` picks a free port (tests). */
export function startHttpServer(options: HttpOptions = {}): Server {
  const path = options.path ?? "/mcp";
  const guard = options.allowedHosts?.length || options.allowedOrigins?.length
    ? { enableDnsRebindingProtection: true, allowedHosts: options.allowedHosts, allowedOrigins: options.allowedOrigins }
    : {};
  const limiter = options.rateLimitPerMinute ? new RateLimiter(options.rateLimitPerMinute) : undefined;
  const maxBody = options.maxBodyBytes || 0;
  const heavy: HeavyLimit | undefined = options.heavyConcurrency ? { limit: options.heavyConcurrency, running: 0 } : undefined;
  const ws = options.workspace;
  const protectedTools = new Set(ws?.tools ?? []);
  const metadataPaths = ws ? new Set(["/.well-known/oauth-protected-resource", `/.well-known/oauth-protected-resource${path}`, `/.well-known/oauth-protected-resource${new URL(ws.resource).pathname}`]) : new Set<string>();
  const onToolCall = options.onToolCall ?? ((r: ToolCallRecord) => console.error(JSON.stringify(r)));
  /** The sign-in challenge: a 401 naming the metadata, with the reason when a token was sent and refused. */
  const challenge = (res: ServerResponse, tool: string, refused?: string): void => {
    const quoted = (v: string) => `"${v.replace(/["\\]/g, "")}"`;
    const header = `Bearer resource_metadata=${quoted(metadataUrl(ws!.resource))}${refused ? `, error="invalid_token", error_description=${quoted(refused)}` : ""}`;
    const message = `${refused ? `${refused} ` : ""}${tool} needs a signed-in GASP Workspace company on the hosted server: sign in when your client asks (https://koinedata.com/workspace). The same tool runs free, without sign-in, in the npm package gasp-standard-mcp.`;
    rpcError(res, 401, -32001, message, { "WWW-Authenticate": header, "Access-Control-Expose-Headers": `${CORS["Access-Control-Expose-Headers"]}, WWW-Authenticate` });
  };
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
    if (url.pathname === path) {
      if (limiter) {
        const wait = limiter.retryAfter(clientAddress(req));
        if (wait > 0) { rpcError(res, 429, -32000, `Rate limit: retry in ${wait}s`, { "Retry-After": String(wait) }); return; }
      }
      if (maxBody && req.method === "POST") {
        const length = req.headers["content-length"];
        if (length === undefined) { rpcError(res, 411, -32600, "Content-Length required"); return; }
        if (Number(length) > maxBody) { rpcError(res, 413, -32600, `Request body over ${maxBody} bytes`); return; }
      }
      // With the Workspace on, the body is read here so a protected tool call can be challenged before the transport runs it.
      let parsedBody: unknown;
      if (ws && req.method === "POST") {
        const raw = await readBody(req, maxBody);
        if (raw === null) { rpcError(res, 413, -32600, `Request body over ${maxBody} bytes`); return; }
        try { parsedBody = JSON.parse(raw); } catch { rpcError(res, 400, -32700, "Parse error: Invalid JSON"); return; }
        const needs = protectedCall(parsedBody, protectedTools);
        const token = bearer(req);
        if (token) {
          try {
            (req as IncomingMessage & { auth?: AuthInfo }).auth = await verifyBearer(token, ws);
          } catch (err) {
            if (!(err instanceof AuthError)) throw err;
            if (needs) { challenge(res, needs, err.message); return; }
            // A refused token on a free call: the call proceeds anonymously, as it would without one.
          }
        } else if (needs) { challenge(res, needs); return; }
      }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, ...guard });
      const server = createServer({ onToolCall, heavy, ...(ws ? { workspace: ws } : {}) });
      res.on("close", () => { void transport.close(); void server.close(); });
      for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
      await server.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
      return;
    }
    if (ws && req.method === "GET" && metadataPaths.has(url.pathname)) {
      res.writeHead(200, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify(protectedResourceMetadata(ws)));
      return;
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      res.writeHead(200, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify({ name: "gasp-standard", version: PKG_VERSION, tools: toolCount(!!ws), endpoint: path, documentation: "https://koinedata.com/v1/tools" }));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(`Not found. The MCP endpoint is ${path}.`);
  };
  const server = createHttp((req, res) => {
    handle(req, res).catch((err: unknown) => {
      console.error("[gasp-standard-mcp-http]", err);
      if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json" }); }
      if (!res.writableEnded) res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
    });
  });
  server.listen(options.port ?? 3000, options.host ?? "0.0.0.0");
  return server;
}

const list = (v: string | undefined): string[] | undefined => v?.split(",").map((s) => s.trim()).filter(Boolean);
const num = (v: string | undefined, fallback: number): number => (v === undefined || v === "" ? fallback : Number(v));

const invokedDirectly = (() => {
  try { return process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
})();

if (invokedDirectly) {
  const port = Number(process.env.PORT ?? 3000);
  const path = process.env.MCP_PATH ?? "/mcp";
  const workspace = workspaceFromEnv(process.env);
  const server = startHttpServer({
    port, host: process.env.HOST, path,
    allowedHosts: list(process.env.MCP_ALLOWED_HOSTS), allowedOrigins: list(process.env.MCP_ALLOWED_ORIGINS),
    rateLimitPerMinute: num(process.env.MCP_RATE_LIMIT, 60),
    maxBodyBytes: num(process.env.MCP_MAX_BODY_BYTES, 1_048_576),
    heavyConcurrency: num(process.env.MCP_HEAVY_CONCURRENCY, 2),
    workspace,
  });
  server.on("listening", () => console.error(`[gasp-standard-mcp-http] ${PKG_VERSION}: ${toolCount(!!workspace)} tools on port ${port}${path}${workspace ? `, GASP Workspace on (issuer ${workspace.issuer})` : ""}`));
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
