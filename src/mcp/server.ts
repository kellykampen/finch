import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTools, type McpToolDeps } from "./tools";

/** Builds the bundled MCP server, registering one tool per PLAN.md's MCP surface table. */
export function createFinchMcpServer(deps: McpToolDeps = {}): McpServer {
  const server = new McpServer({ name: "finch", version: "0.1.0" });
  for (const tool of createTools(deps)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      // The registry's tools share one handler signature (Record<string,
      // unknown> in, CallToolResult out) so they can be registered in a
      // loop — registerTool's generics instead expect each tool's own
      // zod-inferred argument type, which a homogeneous array can't carry.
      tool.handler as Parameters<McpServer["registerTool"]>[2],
    );
  }
  return server;
}

/** `finch mcp`: starts the bundled MCP server over stdio for local agent harnesses. */
export async function runMcp(): Promise<void> {
  const server = createFinchMcpServer();
  await server.connect(new StdioServerTransport());
}
