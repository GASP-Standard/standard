#!/usr/bin/env node

/** The GASP Standard MCP server over stdio, for Claude Desktop, Claude Code, Cursor and any client that runs `npx gasp-standard-mcp`. */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  await createServer().connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
