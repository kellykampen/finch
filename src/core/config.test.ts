import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, maskSecret } from "./config";

let fakeHome: string;
let originalHome: string | undefined;
let originalConfigPath: string | undefined;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "finch-config-test-"));
  originalHome = process.env.HOME;
  originalConfigPath = process.env.FINCH_CONFIG_PATH;
  process.env.HOME = fakeHome;
  delete process.env.FINCH_CONFIG_PATH;
});

afterEach(() => {
  process.env.HOME = originalHome;
  if (originalConfigPath === undefined) delete process.env.FINCH_CONFIG_PATH;
  else process.env.FINCH_CONFIG_PATH = originalConfigPath;
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("configPath", () => {
  test("does not blindly trust a divergent caller-set HOME (FIN-77)", () => {
    // Regression for the FIN-74 bug: two callers with divergent HOME must not
    // silently resolve to two different default config snapshots. The real
    // OS home directory for the current user never changes mid-test, so
    // resolving with two different HOME values must yield the identical
    // path — proven here without ever depending on what that real path is.
    process.env.HOME = join(fakeHome, "worker-a");
    const pathA = configPath();

    process.env.HOME = join(fakeHome, "worker-b");
    const pathB = configPath();

    expect(pathA).toBe(pathB);
    expect(pathA).not.toBe(join(fakeHome, "worker-a", ".finch", "config"));
    expect(pathB).not.toBe(join(fakeHome, "worker-b", ".finch", "config"));
  });

  test("uses one explicit canonical path across divergent HOME values", () => {
    const canonicalPath = join(fakeHome, "canonical", "config");
    process.env.FINCH_CONFIG_PATH = canonicalPath;

    process.env.HOME = join(fakeHome, "worker-a");
    expect(configPath()).toBe(canonicalPath);

    process.env.HOME = join(fakeHome, "worker-b");
    expect(configPath()).toBe(canonicalPath);
  });

  test("rejects a relative FINCH_CONFIG_PATH", () => {
    process.env.FINCH_CONFIG_PATH = ".finch/config";
    expect(() => configPath()).toThrow("FINCH_CONFIG_PATH must be an absolute path");
  });
});

describe("concurrent divergent-HOME callers (FIN-74 AC #4 verification)", () => {
  test("two real processes with different HOME share one canonical config path and refresh-lock path", async () => {
    const fixture = join(import.meta.dir, "__fixtures__", "print-config-path.ts");
    const homeA = join(fakeHome, "concurrent-caller-a");
    const homeB = join(fakeHome, "concurrent-caller-b");

    const spawnCaller = (home: string) => {
      const env: Record<string, string | undefined> = { ...process.env, HOME: home };
      delete env.FINCH_CONFIG_PATH;
      return Bun.spawn(["bun", "run", fixture], { env, stdout: "pipe", stderr: "pipe" });
    };

    // Launched together (not awaited one at a time) so they genuinely
    // overlap, matching FIN-74's "concurrent callers" failure mode rather
    // than just two sequential env-var flips in one process.
    const procA = spawnCaller(homeA);
    const procB = spawnCaller(homeB);

    const [outA, outB, exitA, exitB] = await Promise.all([
      new Response(procA.stdout).text(),
      new Response(procB.stdout).text(),
      procA.exited,
      procB.exited,
    ]);

    expect(exitA).toBe(0);
    expect(exitB).toBe(0);

    const resultA = JSON.parse(outA);
    const resultB = JSON.parse(outB);

    expect(resultA.configPath).toBe(resultB.configPath);
    expect(resultA.lockPath).toBe(resultB.lockPath);
    expect(resultA.configPath).not.toBe(join(homeA, ".finch", "config"));
    expect(resultB.configPath).not.toBe(join(homeB, ".finch", "config"));
  }, 15_000);
});

describe("maskSecret", () => {
  test("masks all but the last 4 characters of a long secret", () => {
    expect(maskSecret("abcdefgh1234")).toBe("********1234");
  });

  test("masks a secret entirely when it's 4 characters or shorter", () => {
    expect(maskSecret("abcd")).toBe("****");
    expect(maskSecret("ab")).toBe("**");
  });

  test("masks an empty string to an empty string", () => {
    expect(maskSecret("")).toBe("");
  });
});
