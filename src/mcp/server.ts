import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createTools, type McpToolDeps } from "./tools";

/**
 * Default location of the Finch skill's SKILL.md, the onboarding payload the
 * `skills` tool returns verbatim. Sibling repo to `finch` itself, same layout
 * peek's own MCP server uses for its skill file.
 */
function defaultSkillPath(): string {
  return path.join(os.homedir(), "code", "agent-skills", "skills", "agents", "finch", "SKILL.md");
}

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
      const skillPath = deps.skillPath ?? defaultSkillPath();
      try {
        const content = await readFile(skillPath, "utf8");
        return { content: [{ type: "text", text: content }] };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `skills: failed to read SKILL.md at ${skillPath}: ${(err as Error).message}`,
            },
          ],
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
