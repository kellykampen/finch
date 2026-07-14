import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readSkillMarkdown } from "../core/skills";
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

  // Registered directly (not via createTools/the generic registry above) —
  // it has no core command counterpart to bridge argv through, unlike every
  // other tool in the loop.
  server.registerTool(
    "skills",
    {
      description:
        "Self-describing onboarding: returns the real content of the finch skill's SKILL.md, " +
        "so any MCP client can learn how/when to use Finch's tools without the skill " +
        "pre-installed anywhere.",
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      try {
        // Shared with the `finch skills` CLI command via core/skills, so the
        // MCP and CLI skill surfaces can never diverge (FIN-75).
        const content = await readSkillMarkdown(deps.skillPath);
        return { content: [{ type: "text", text: content }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `skills: ${(err as Error).message}` }],
        };
      }
    },
  );

  return server;
}

/** `finch mcp`: starts the bundled MCP server over stdio for local agent harnesses. */
export async function runMcp(): Promise<void> {
  const server = createFinchMcpServer();
  await server.connect(new StdioServerTransport());
}
