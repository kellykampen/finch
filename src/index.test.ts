import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_ENTRY = join(import.meta.dir, "index.ts");

function runCli(args: string[]) {
  const fakeHome = mkdtempSync(join(tmpdir(), "finch-cli-test-"));
  try {
    const result = Bun.spawnSync({
      cmd: ["bun", "run", CLI_ENTRY, ...args],
      env: {
        ...process.env,
        HOME: fakeHome,
        FINCH_API_KEY: "",
        FINCH_API_KEY_SECRET: "",
        FINCH_ACCESS_TOKEN: "",
        FINCH_ACCESS_TOKEN_SECRET: "",
      },
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
}

describe("finch CLI arg parsing / exit codes", () => {
  test("unknown command exits 2 with a JSON usage error", () => {
    const { exitCode, stdout } = runCli(["bogus-command", "--json"]);

    expect(exitCode).toBe(2);
    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("USAGE_ERROR");
  });

  test("non-TTY stdout emits JSON even without an explicit --json flag", () => {
    // Per PLAN.md: "--json (or non-TTY stdout) emits one JSON object" — a
    // piped/captured subprocess is never a TTY, so this is the path every
    // subprocess test in this file actually exercises.
    const { exitCode, stdout, stderr } = runCli(["bogus-command"]);

    expect(exitCode).toBe(2);
    expect(stderr).toBe("");
    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("USAGE_ERROR");
  });

  test("whoami with no config/env exits 3 with an AUTH_ERROR JSON envelope", () => {
    const { exitCode, stdout } = runCli(["whoami", "--json"]);

    expect(exitCode).toBe(3);
    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("AUTH_ERROR");
  });

  test("auth status with no config/env exits 0 reporting unconfigured", () => {
    const { exitCode, stdout } = runCli(["auth", "status", "--json"]);

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope).toEqual({
      ok: true,
      data: { configured: false, valid: false, username: null },
    });
  });

  test("config path prints the resolved path without requiring a config file", () => {
    const { exitCode, stdout } = runCli(["config", "path", "--json"]);

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.path).toMatch(/\.finch\/config$/);
  });

  test("config get with no config exits 3 with an AUTH_ERROR JSON envelope", () => {
    const { exitCode, stdout } = runCli(["config", "get", "transport", "--json"]);

    expect(exitCode).toBe(3);
    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("AUTH_ERROR");
  });

  test("schema outputs a JSON document describing every command", () => {
    const { exitCode, stdout } = runCli(["schema", "--json"]);

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(true);
    expect(Array.isArray(envelope.data.commands)).toBe(true);
    expect(envelope.data.commands.length).toBeGreaterThan(15);
    const names = envelope.data.commands.map((c: { name: string }) => c.name);
    expect(names).toContain("config get");
    expect(names).toContain("post");
  });

  test("--describe works as a global-flag alias for `finch schema`", () => {
    const { exitCode, stdout } = runCli(["--describe"]);

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(true);
    expect(Array.isArray(envelope.data.commands)).toBe(true);
  });

  test("a literal '--describe' positional after the `--` terminator is NOT hijacked into schema output", () => {
    // Mirrors the M3 flag-injection protection parseArgs already gives every
    // command: free-text/positional arguments after `--` must be taken
    // literally, even if they happen to equal a registered global flag
    // string. `finch like -- --describe` should fail extractTweetId's
    // validation (not a valid post ID/URL), not succeed as the schema doc.
    const { exitCode, stdout } = runCli(["like", "--", "--describe"]);

    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("USAGE_ERROR");
    expect(exitCode).toBe(2);
  });

  test("a literal '--json' positional after the `--` terminator is NOT silently stripped", () => {
    // Same terminator-boundary bug class as --describe above, but with a
    // data-loss consequence instead of a misrouted command: post text of
    // exactly "--json" (e.g. from an MCP tool call) must survive intact,
    // not get deleted by the global --json flag filter.
    const { exitCode, stdout } = runCli(["post", "--dry-run", "--", "--json"]);

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual({ dryRun: true, wouldSend: { text: "--json", media: [], alt: [] } });
  });
});
