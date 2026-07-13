import { describe, test, expect } from "bun:test";
import { resolveDispatchArgs } from "./dispatch-args";

describe("resolveDispatchArgs", () => {
  test("a global --json before any terminator forces jsonMode and is stripped from args", () => {
    const result = resolveDispatchArgs(["auth", "status", "--json"], true);
    expect(result.jsonMode).toBe(true);
    expect(result.args).toEqual(["auth", "status"]);
  });

  test("isTTY alone (no --json) still yields human mode when isTTY is true", () => {
    const result = resolveDispatchArgs(["auth", "status"], true);
    expect(result.jsonMode).toBe(false);
    expect(result.args).toEqual(["auth", "status"]);
  });

  test("non-TTY forces jsonMode even without an explicit --json flag", () => {
    const result = resolveDispatchArgs(["auth", "status"], false);
    expect(result.jsonMode).toBe(true);
  });

  test("a literal '--json' positional after `--` does NOT force jsonMode on", () => {
    const result = resolveDispatchArgs(["like", "--", "--json"], true);
    expect(result.jsonMode).toBe(false);
  });

  test("a literal '--json' positional after `--` is NOT stripped from args", () => {
    const result = resolveDispatchArgs(["like", "--", "--json"], true);
    expect(result.args).toEqual(["like", "--", "--json"]);
  });

  test("--describe before a terminator is recognized as the global schema alias", () => {
    const result = resolveDispatchArgs(["--describe"], true);
    expect(result.args).toEqual(["schema"]);
  });

  test("a literal '--describe' positional after `--` is NOT hijacked into the schema alias", () => {
    const result = resolveDispatchArgs(["like", "--", "--describe"], true);
    expect(result.args).toEqual(["like", "--", "--describe"]);
  });

  test("--version before a terminator is recognized as the global version alias", () => {
    const result = resolveDispatchArgs(["--version"], true);
    expect(result.args).toEqual(["version"]);
  });

  test("a literal '--version' positional after `--` is NOT hijacked into the version alias", () => {
    const result = resolveDispatchArgs(["like", "--", "--version"], true);
    expect(result.args).toEqual(["like", "--", "--version"]);
  });

  test("-v before a terminator is recognized as the global version alias", () => {
    const result = resolveDispatchArgs(["-v"], true);
    expect(result.args).toEqual(["version"]);
  });

  test("a literal '-v' positional after `--` is NOT hijacked into the version alias", () => {
    const result = resolveDispatchArgs(["like", "--", "-v"], true);
    expect(result.args).toEqual(["like", "--", "-v"]);
  });

  test("multiple caller-text values after `--` are all preserved untouched", () => {
    const result = resolveDispatchArgs(["thread", "--", "--json", "--describe", "hello"], true);
    expect(result.args).toEqual(["thread", "--", "--json", "--describe", "hello"]);
    expect(result.jsonMode).toBe(false);
  });
});
