import { describe, test, expect } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createFinchMcpServer } from "./server";

describe("createFinchMcpServer", () => {
  test("builds an McpServer with every tool registered, without connecting a transport", () => {
    const server = createFinchMcpServer({ resolveAuth: () => null });

    expect(server).toBeInstanceOf(McpServer);
    expect(server.isConnected()).toBe(false);
  });
});
