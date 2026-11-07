#!/usr/bin/env node

/**
 * The GASP Standard MCP server over Streamable HTTP, for a hosted endpoint
 * such as https://mcp.gaspwiki.com/mcp that Claude connects to as a remote
 * server. Stateless: every request gets its own transport and server over the
 * data loaded once, so any number of instances can sit behind one hostname.
 * No authentication: the standard is public and every tool is read-only.
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
 * logged, which is what the privacy policy at gaspwiki.com/privacy promises.
 */
import { createServer as createHttp, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { PKG_VERSION, TOOL_COUNT, createServer, type HeavyLimit } from "./server.js";

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
}

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
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, ...guard });
      const server = createServer({ onToolCall: (r) => console.error(JSON.stringify(r)), heavy });
      res.on("close", () => { void transport.close(); void server.close(); });
      for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
      await server.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      res.writeHead(200, { "Content-Type": "application/json", ...CORS });
      res.end(JSON.stringify({ name: "gasp-standard", version: PKG_VERSION, tools: TOOL_COUNT, endpoint: path, documentation: "https://gaspwiki.com/v1/tools" }));
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
  const server = startHttpServer({
    port, host: process.env.HOST, path,
    allowedHosts: list(process.env.MCP_ALLOWED_HOSTS), allowedOrigins: list(process.env.MCP_ALLOWED_ORIGINS),
    rateLimitPerMinute: num(process.env.MCP_RATE_LIMIT, 60),
    maxBodyBytes: num(process.env.MCP_MAX_BODY_BYTES, 1_048_576),
    heavyConcurrency: num(process.env.MCP_HEAVY_CONCURRENCY, 2),
  });
  server.on("listening", () => console.error(`[gasp-standard-mcp-http] ${PKG_VERSION}: ${TOOL_COUNT} tools on port ${port}${path}`));
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
