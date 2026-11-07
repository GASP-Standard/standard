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
 * Every tool call is written to stderr as one JSON line, `{"event":"tool",
 * "tool":"lookup_metric","ms":12,"ok":true,"client":"claude-ai/1.0"}`, so the
 * host's log stream counts calls per tool. Arguments and results are never
 * logged, which is what the privacy policy at gaspwiki.com/privacy promises.
 */
import { createServer as createHttp, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { PKG_VERSION, TOOL_COUNT, createServer } from "./server.js";

export interface HttpOptions {
  port?: number;
  host?: string;
  /** The path the MCP endpoint answers on; everything else is the health page or 404. */
  path?: string;
  allowedHosts?: string[];
  allowedOrigins?: string[];
}

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
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
    if (url.pathname === path) {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, ...guard });
      const server = createServer({ onToolCall: (r) => console.error(JSON.stringify(r)) });
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

const invokedDirectly = (() => {
  try { return process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
})();

if (invokedDirectly) {
  const port = Number(process.env.PORT ?? 3000);
  const path = process.env.MCP_PATH ?? "/mcp";
  const server = startHttpServer({ port, host: process.env.HOST, path, allowedHosts: list(process.env.MCP_ALLOWED_HOSTS), allowedOrigins: list(process.env.MCP_ALLOWED_ORIGINS) });
  server.on("listening", () => console.error(`[gasp-standard-mcp-http] ${PKG_VERSION}: ${TOOL_COUNT} tools on port ${port}${path}`));
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
