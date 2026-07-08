import { describe, test, expect } from "bun:test";
import { runSchema, COMMAND_SCHEMAS } from "./schema";

const ALL_COMMANDS = [
  "auth",
  "auth status",
  "whoami",
  "post",
  "reply",
  "thread",
  "timeline",
  "search",
  "user-posts",
  "user",
  "show",
  "like",
  "unlike",
  "repost",
  "unrepost",
  "follow",
  "unfollow",
  "delete",
  "config get",
  "config set",
  "config path",
  "schema",
];

describe("COMMAND_SCHEMAS", () => {
  test("lists every command Finch currently ships, by name", () => {
    const names = COMMAND_SCHEMAS.map((c) => c.name);
    for (const expected of ALL_COMMANDS) {
      expect(names).toContain(expected);
    }
    expect(names.length).toBe(ALL_COMMANDS.length);
  });

  test("every entry has a name, flags, endpoint, and dataShape", () => {
    for (const entry of COMMAND_SCHEMAS) {
      expect(typeof entry.name).toBe("string");
      expect(Array.isArray(entry.flags)).toBe(true);
      expect(typeof entry.endpoint).toBe("string");
      expect(typeof entry.dataShape).toBe("string");
    }
  });

  test("never includes secret auth field values", () => {
    const serialized = JSON.stringify(COMMAND_SCHEMAS);
    expect(serialized).not.toMatch(/(clientId|accessToken|refreshToken)":\s*"(?!string)/);
  });
});

describe("runSchema", () => {
  test("returns the full command list as JSON data", async () => {
    const result = await runSchema();
    expect(result.data).toEqual({ commands: COMMAND_SCHEMAS });
  });
});
