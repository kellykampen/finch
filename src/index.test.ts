import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };

const CLI_ENTRY = join(import.meta.dir, "index.ts");

function runCli(args: string[]) {
  const fakeHome = mkdtempSync(join(tmpdir(), "finch-cli-test-"));
  try {
    // FIN-77: configPath() no longer defaults from $HOME (see
    // src/core/config.test.ts), so isolation must go through the documented
    // FINCH_CONFIG_PATH override — spoofing HOME alone would now be a no-op
    // and these subprocesses would read/write the real ~/.finch/config.
    const result = Bun.spawnSync({
      cmd: ["bun", "run", CLI_ENTRY, ...args],
      env: {
        ...process.env,
        HOME: fakeHome,
        FINCH_CONFIG_PATH: join(fakeHome, ".finch", "config"),
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

  test("bookmark folders is dispatched as a real auth-backed command", () => {
    const { exitCode, stdout } = runCli(["bookmark", "folders", "--json"]);

    expect(exitCode).toBe(3);
    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("AUTH_ERROR");
  });

  test("bookmark folder new is dispatched as a real auth-backed command", () => {
    const { exitCode, stdout } = runCli(["bookmark", "folder", "new", "Project notes", "--json"]);

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

  // FIN-81: a misspelled --client-id (CEO typo'd `--clinet-id`) used to be
  // silently dropped, then resolveClientId() fell through to persisted/env creds
  // and the auth flow proceeded with the wrong client_id. It must error instead.
  test("auth rejects a misspelled --client-id flag instead of silently proceeding (FIN-81)", () => {
    const { exitCode, stdout } = runCli(["auth", "--clinet-id", "abcd1234", "--json"]);

    expect(exitCode).toBe(2);
    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("USAGE_ERROR");
    expect(envelope.error.message).toContain("--clinet-id");
    expect(envelope.error.message).toContain("--client-id");
  });

  // FIN-82: an unrecognized flag on any command errors (before any network),
  // instead of being silently swallowed as a positional.
  test("an unrecognized flag on a command is rejected (FIN-82)", () => {
    const { exitCode, stdout } = runCli(["delete", "1234567890", "--bogus", "--json"]);
    expect(exitCode).toBe(2);
    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("USAGE_ERROR");
    expect(envelope.error.message).toContain("--bogus");
  });

  // FIN-82 review: the argument-less commands also reject unknown flags.
  for (const cmd of [["whoami"], ["version"], ["schema"], ["auth", "status"]]) {
    test(`'${cmd.join(" ")}' rejects an unrecognized flag`, () => {
      const { exitCode, stdout } = runCli([...cmd, "--bogus", "--json"]);
      expect(exitCode).toBe(2);
      expect(JSON.parse(stdout).error.code).toBe("USAGE_ERROR");
    });
  }

  // `help` is deliberately exempt — it is the usage command, so it shows help
  // rather than erroring on unexpected input.
  test("help is lenient with unknown flags (intentional exception)", () => {
    const { exitCode, stdout } = runCli(["help", "--bogus", "--json"]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).ok).toBe(true);
  });

  // FIN-82 review: `finch mcp --bogus` must error before starting the server
  // (this errors and exits, so it does not hang on a long-lived server).
  test("mcp rejects an unrecognized flag before starting the server", () => {
    const { exitCode, stdout } = runCli(["mcp", "--bogus"]);
    expect(exitCode).toBe(2);
    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("USAGE_ERROR");
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

  test("no arguments prints top-level help (exit 0) instead of an Unknown command error", () => {
    const { exitCode, stdout, stderr } = runCli([]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(true);
    expect(typeof envelope.data.usage).toBe("string");
    expect(Array.isArray(envelope.data.commands)).toBe(true);
    const names = envelope.data.commands.map((c: { name: string }) => c.name);
    expect(names).toContain("post");
    expect(names).toContain("schema");
  });

  test("finch help dispatches the help command (exit 0, JSON help document)", () => {
    const { exitCode, stdout } = runCli(["help"]);

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(true);
    expect(Array.isArray(envelope.data.commands)).toBe(true);
  });

  test("--help works as a global-flag alias for `finch help`", () => {
    const { exitCode, stdout } = runCli(["--help"]);

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(true);
    expect(Array.isArray(envelope.data.commands)).toBe(true);
  });

  test("-h behaves exactly like --help", () => {
    const dashH = runCli(["-h"]);
    const longHelp = runCli(["--help"]);

    expect(dashH.exitCode).toBe(0);
    expect(dashH.stdout).toBe(longHelp.stdout);
  });

  test("a literal '-h' positional after the `--` terminator is NOT hijacked into help output", () => {
    const { exitCode, stdout } = runCli(["like", "--", "-h"]);

    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("USAGE_ERROR");
    expect(exitCode).toBe(2);
  });

  test("version reports this binary's semver", () => {
    const { exitCode, stdout } = runCli(["version", "--json"]);

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope).toEqual({ ok: true, data: { version: pkg.version } });
  });

  test("--version works as a global-flag alias for `finch version`", () => {
    const { exitCode, stdout } = runCli(["--version"]);

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope).toEqual({ ok: true, data: { version: pkg.version } });
  });

  test("a literal '--version' positional after the `--` terminator is NOT hijacked into version output", () => {
    const { exitCode, stdout } = runCli(["like", "--", "--version"]);

    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("USAGE_ERROR");
    expect(exitCode).toBe(2);
  });

  test("-v works as a global-flag alias for `finch version`", () => {
    const { exitCode, stdout } = runCli(["-v"]);

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope).toEqual({ ok: true, data: { version: pkg.version } });
  });

  test("a literal '-v' positional after the `--` terminator is NOT hijacked into version output", () => {
    const { exitCode, stdout } = runCli(["like", "--", "-v"]);

    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("USAGE_ERROR");
    expect(exitCode).toBe(2);
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
