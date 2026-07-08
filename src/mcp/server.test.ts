import { afterEach, beforeEach, describe, test, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createFinchMcpServer } from "./server";

describe("createFinchMcpServer", () => {
  test("builds an McpServer with every tool registered, without connecting a transport", () => {
    const server = createFinchMcpServer({});

    expect(server).toBeInstanceOf(McpServer);
    expect(server.isConnected()).toBe(false);
  });

  describe("skills tool", () => {
    let skillDir: string;
    let skillPath: string;

    async function connectedClient(deps: Parameters<typeof createFinchMcpServer>[0] = {}): Promise<Client> {
      const server = createFinchMcpServer(deps);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "test-client", version: "1.0.0" });
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      return client;
    }

    function firstText(result: Awaited<ReturnType<Client["callTool"]>>): string {
      const first = (result.content as Array<{ text: string }>)[0];
      if (!first) throw new Error("expected at least one content item");
      return first.text;
    }

    beforeEach(async () => {
      skillDir = await mkdtemp(path.join(os.tmpdir(), "finch-mcp-skill-"));
      skillPath = path.join(skillDir, "SKILL.md");
      await writeFile(skillPath, "# finch skill\n\nDISTINCTIVE-MARKER-abc\n", "utf8");
    });

    afterEach(async () => {
      await rm(skillDir, { recursive: true, force: true });
    });

    test("returns the real SKILL.md content when the file exists", async () => {
      const client = await connectedClient({ skillPath });

      const result = await client.callTool({ name: "skills", arguments: {} });

      expect(result.isError).toBeFalsy();
      expect(firstText(result)).toContain("DISTINCTIVE-MARKER-abc");
    });

    test("returns an isError result when the SKILL.md file is missing", async () => {
      const missingPath = path.join(skillDir, "does-not-exist", "SKILL.md");
      const client = await connectedClient({ skillPath: missingPath });

      const result = await client.callTool({ name: "skills", arguments: {} });

      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain(missingPath);
    });
  });
});
