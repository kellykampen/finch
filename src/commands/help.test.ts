import { describe, test, expect } from "bun:test";
import { runHelp } from "./help";
import { COMMAND_SCHEMAS } from "./schema";

describe("runHelp", () => {
  test("data.commands is derived from COMMAND_SCHEMAS (name + description), so it can't go stale", async () => {
    const result = await runHelp();
    expect(result.data.commands).toEqual(COMMAND_SCHEMAS.map((c) => ({ name: c.name, description: c.description })));
  });

  test("data.usage is a non-empty string naming the finch invocation form", async () => {
    const result = await runHelp();
    expect(typeof result.data.usage).toBe("string");
    expect(result.data.usage).toContain("finch");
    expect(result.data.usage.length).toBeGreaterThan(0);
  });

  test("human output has a Usage section and lists every command name from the schema", async () => {
    const result = await runHelp();
    expect(result.human).toContain("Usage:");
    for (const entry of COMMAND_SCHEMAS) {
      expect(result.human).toContain(entry.name);
    }
  });

  test("human output documents the global flags and the bundled MCP server", async () => {
    const result = await runHelp();
    expect(result.human).toContain("--help");
    expect(result.human).toContain("-h");
    expect(result.human).toContain("--version");
    expect(result.human).toContain("--describe");
    expect(result.human).toContain("--json");
    expect(result.human).toContain("finch mcp");
  });

  test("is deterministic — repeated calls produce identical output", async () => {
    const a = await runHelp();
    const b = await runHelp();
    expect(a.data).toEqual(b.data);
    expect(a.human).toBe(b.human);
  });
});
