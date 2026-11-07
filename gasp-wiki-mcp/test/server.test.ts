/**
 * The server entry points: createServer registers the 22 tools, each with a
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
import { startHttpServer } from "../src/http.js";
import { TOOL_COUNT, TOOL_TITLES, createServer, type ToolCallRecord } from "../src/server.js";

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
      expect(t.title ?? t.annotations?.title).toBe(TOOL_TITLES[t.name as keyof typeof TOOL_TITLES]);
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
