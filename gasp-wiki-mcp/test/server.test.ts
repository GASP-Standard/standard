/**
 * The server entry points: createServer registers the 23 tools, each with a
 * title and the read-only annotations the Claude connectors directory
 * requires, and answers over an in-memory transport; the Streamable HTTP
 * server answers the same tools over HTTP, serves a health page, and refuses a
 * request from an origin it was not told to allow.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RateLimiter, startHttpServer } from "../src/http.js";
import { BUSY_TEXT, HEAVY_TOOLS, TOOL_COUNT, TOOL_TITLES, createServer, type ToolCallRecord } from "../src/server.js";

const listening = (s: Server): Promise<void> => new Promise((resolve) => (s.listening ? resolve() : s.once("listening", () => resolve())));
const text = (r: { content?: unknown }): string => (r.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");

describe("createServer", () => {
  it("registers every tool with a title and read-only annotations", async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverSide);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(TOOL_TITLES).sort());
    expect(tools).toHaveLength(TOOL_COUNT);
    for (const t of tools) {
      expect(t.name.length).toBeLessThanOrEqual(64);
      expect(t.description?.length ?? 0).toBeGreaterThan(40);
      expect(t.title).toBe(TOOL_TITLES[t.name as keyof typeof TOOL_TITLES]);
      expect(t.annotations?.title).toBe(t.title);
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.annotations?.destructiveHint).toBe(false);
    }
    const r = await client.callTool({ name: "lookup_metric", arguments: { name: "MRR" } });
    expect(text(r)).toContain("Monthly Recurring Revenue");
    await client.close();
  });
});

describe("tool call records", () => {
  it("record the tool, the time, the outcome and the client, never the arguments", async () => {
    const records: ToolCallRecord[] = [];
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer({ onToolCall: (r) => records.push(r) }).connect(serverSide);
    const client = new Client({ name: "record-test", version: "1.2.3" });
    await client.connect(clientSide);
    await client.callTool({ name: "lookup_metric", arguments: { name: "MRR" } });
    await client.callTool({ name: "lookup_metric", arguments: { name: "no such metric anywhere" } });
    await client.callTool({ name: "validate_mapping", arguments: { adapter: "{not json" } });
    expect(records.map((r) => [r.event, r.tool, r.client])).toEqual([
      ["tool", "lookup_metric", "record-test/1.2.3"],
      ["tool", "lookup_metric", "record-test/1.2.3"],
      ["tool", "validate_mapping", "record-test/1.2.3"],
    ]);
    for (const r of records) expect(r.ms).toBeGreaterThanOrEqual(0);
    expect(records[0].ok).toBe(true);
    expect(JSON.stringify(records)).not.toContain("MRR");
    expect(Object.keys(records[0]).sort()).toEqual(["client", "event", "ms", "ok", "tool"]);
    await client.close();
  });

  it("are not kept without a handler", async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverSide);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(clientSide);
    expect(text(await client.callTool({ name: "lookup_metric", arguments: { name: "MRR" } }))).toContain("Monthly Recurring Revenue");
    await client.close();
  });
});

describe("the Streamable HTTP server", () => {
  const server = startHttpServer({ port: 0, host: "127.0.0.1" });
  const port = () => (server.address() as AddressInfo).port;
  beforeAll(() => listening(server));
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("serves the tools to an MCP client", async () => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port()}/mcp`)));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(TOOL_COUNT);
    const r = await client.callTool({ name: "search", arguments: { query: "net revenue retention" } });
    expect(text(r)).toContain("Net Revenue Retention");
    await client.close();
  });

  it("answers a health request and nothing else off the endpoint", async () => {
    const health = await fetch(`http://127.0.0.1:${port()}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ name: "gasp-standard", tools: TOOL_COUNT, endpoint: "/mcp" });
    expect((await fetch(`http://127.0.0.1:${port()}/other`)).status).toBe(404);
  });

  it("refuses an origin it was not told to allow", async () => {
    const guarded = startHttpServer({ port: 0, host: "127.0.0.1", allowedOrigins: ["https://gaspwiki.com"] });
    await listening(guarded);
    try {
      const p = (guarded.address() as AddressInfo).port;
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
      const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
      expect((await fetch(`http://127.0.0.1:${p}/mcp`, { method: "POST", headers: { ...headers, Origin: "https://evil.example" }, body })).status).toBe(403);
      expect((await fetch(`http://127.0.0.1:${p}/mcp`, { method: "POST", headers: { ...headers, Origin: "https://gaspwiki.com" }, body })).status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => guarded.close(() => resolve()));
    }
  });
});

describe("the guards for a public endpoint", () => {
  const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  const post = (port: number, body: string, extra: Record<string, string> = {}) => fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { ...headers, ...extra }, body });

  it("limits requests per minute per client address and keeps clients apart", async () => {
    const server = startHttpServer({ port: 0, host: "127.0.0.1", rateLimitPerMinute: 3 });
    await listening(server);
    try {
      const p = (server.address() as AddressInfo).port;
      const codes = [];
      for (let i = 0; i < 4; i++) codes.push((await post(p, init, { "X-Forwarded-For": "203.0.113.7, 10.0.0.1" })).status);
      expect(codes).toEqual([200, 200, 200, 429]);
      const limited = await post(p, init, { "X-Forwarded-For": "203.0.113.7" });
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect((await limited.json()).error.message).toContain("Rate limit");
      expect((await post(p, init, { "X-Forwarded-For": "203.0.113.8" })).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${p}/health`)).status).toBe(200); // the health page is never limited
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("RateLimiter opens a new window after a minute", () => {
    let t = 0;
    const r = new RateLimiter(2, () => t);
    expect([r.retryAfter("a"), r.retryAfter("a"), r.retryAfter("a")]).toEqual([0, 0, 60]);
    t = 30_000;
    expect(r.retryAfter("a")).toBe(30);
    t = 60_000;
    expect(r.retryAfter("a")).toBe(0);
  });

  it("refuses a body over the cap or without a length", async () => {
    const server = startHttpServer({ port: 0, host: "127.0.0.1", maxBodyBytes: 512 });
    await listening(server);
    try {
      const p = (server.address() as AddressInfo).port;
      expect((await post(p, init)).status).toBe(200);
      const big = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "validate_mapping", arguments: { adapter: "x".repeat(600) } } });
      expect((await post(p, big)).status).toBe(413);
      const chunked = await fetch(`http://127.0.0.1:${p}/mcp`, { method: "POST", headers, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(init)); c.close(); } }), duplex: "half" } as RequestInit);
      expect(chunked.status).toBe(411);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("caps the heavy tools at the shared limit and releases the slot afterwards", async () => {
    expect([...HEAVY_TOOLS].sort()).toEqual(["readiness_report", "score_drift"]);
    const heavy = { limit: 1, running: 1 };
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer({ heavy }).connect(serverSide);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(clientSide);
    const busy = await client.callTool({ name: "score_drift", arguments: { adapter: "{}", semantic_model: "{}" } });
    expect(busy.isError).toBe(true);
    expect(text(busy)).toBe(BUSY_TEXT);
    expect(text(await client.callTool({ name: "lookup_metric", arguments: { name: "MRR" } }))).toContain("Monthly Recurring Revenue"); // light tools are never capped
    heavy.running = 0;
    const ran = await client.callTool({ name: "score_drift", arguments: { adapter: "{not json", semantic_model: "{}" } });
    expect(text(ran)).not.toBe(BUSY_TEXT);
    expect(heavy.running).toBe(0);
    await client.close();
  });
});
