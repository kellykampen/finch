import { describe, test, expect } from "bun:test";
import { parseArgs, resolveCount } from "./args";
import { FinchError } from "./errors";

describe("parseArgs", () => {
  test("collects positionals when no flags are declared", () => {
    expect(parseArgs(["a", "b"]).positionals).toEqual(["a", "b"]);
  });

  test("captures a value flag and excludes it from positionals", () => {
    const result = parseArgs(["hello", "--file", "path.txt"], { valueFlags: ["--file"] });
    expect(result.values["--file"]).toBe("path.txt");
    expect(result.positionals).toEqual(["hello"]);
  });

  test("captures a bool flag and excludes it from positionals", () => {
    const result = parseArgs(["hello", "--dry-run"], { boolFlags: ["--dry-run"] });
    expect(result.bools["--dry-run"]).toBe(true);
    expect(result.positionals).toEqual(["hello"]);
  });

  test("throws USAGE_ERROR when a value flag is missing its value", () => {
    expect(() => parseArgs(["--file"], { valueFlags: ["--file"] })).toThrow(FinchError);
  });

  test("without strict, a value flag consumes a literal value that looks like a flag (e.g. MCP-bridged input)", () => {
    const result = parseArgs(["--file", "--dry-run"], { valueFlags: ["--file"], boolFlags: ["--dry-run"] });
    expect(result.values["--file"]).toBe("--dry-run");
    expect(result.bools["--dry-run"]).toBeUndefined();
  });

  test("with strict, throws USAGE_ERROR when the next token is a registered bool flag", () => {
    expect(() =>
      parseArgs(["--file", "--dry-run"], { valueFlags: ["--file"], boolFlags: ["--dry-run"], strict: true }),
    ).toThrow(FinchError);
  });

  test("with strict, throws USAGE_ERROR when the next token is a registered value flag", () => {
    expect(() => parseArgs(["--title", "--cover"], { valueFlags: ["--title", "--cover"], strict: true })).toThrow(
      FinchError,
    );
  });

  test("with strict, a value that merely starts with '-' but isn't a registered flag is still accepted", () => {
    const result = parseArgs(["--title", "-unregistered"], { valueFlags: ["--title"], strict: true });
    expect(result.values["--title"]).toBe("-unregistered");
  });

  test("'--' forces everything after it to be positional, even a token matching a bool flag", () => {
    const result = parseArgs(["--", "--dry-run"], { boolFlags: ["--dry-run"] });
    expect(result.bools["--dry-run"]).toBeUndefined();
    expect(result.positionals).toEqual(["--dry-run"]);
  });

  test("'--' forces everything after it to be positional, even a token matching a value flag", () => {
    const result = parseArgs(["--", "--file", "path.txt"], { valueFlags: ["--file"] });
    expect(result.values["--file"]).toBeUndefined();
    expect(result.positionals).toEqual(["--file", "path.txt"]);
  });

  test("flags before '--' are still recognized normally", () => {
    const result = parseArgs(["-n", "5", "--", "hello"], { valueFlags: ["-n"] });
    expect(result.values["-n"]).toBe("5");
    expect(result.positionals).toEqual(["hello"]);
  });

  test("the '--' token itself is not included in positionals", () => {
    expect(parseArgs(["--", "a", "b"]).positionals).toEqual(["a", "b"]);
  });
});

describe("resolveCount", () => {
  test("defaults to 10 when unset", () => {
    expect(resolveCount(undefined)).toBe(10);
  });

  test("passes through a valid count", () => {
    expect(resolveCount("25")).toBe(25);
  });

  test("clamps to the 100 API tier max", () => {
    expect(resolveCount("500")).toBe(100);
  });

  test("throws USAGE_ERROR for a non-integer", () => {
    expect(() => resolveCount("abc")).toThrow(FinchError);
  });

  test("uses a custom default when provided and raw is unset", async () => {
    expect(resolveCount(undefined, 7)).toBe(7);
  });

  test("clamps a custom default to the API tier max", async () => {
    expect(resolveCount(undefined, 500)).toBe(100);
  });

  test("ignores the custom default when raw is provided", async () => {
    expect(resolveCount("25", 7)).toBe(25);
  });
});
