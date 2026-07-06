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

  test("throws USAGE_ERROR for a value below 1", () => {
    expect(() => resolveCount("0")).toThrow(FinchError);
  });
});
