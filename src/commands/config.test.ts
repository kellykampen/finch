import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConfigGet, runConfigSet, runConfigPath } from "./config";
import { FinchError } from "../core/errors";
import { configPath } from "../core/config";
import { withFileLock } from "../core/refresh-lock";
import { readOAuth2Config, writeOAuth2Config, type FinchOAuth2Config } from "../core/oauth2-config";

const sampleAuth = {
  clientId: "client123456",
  accessToken: "token123456",
  refreshToken: "refresh123456",
  expiresAt: 1_700_000_000_000,
  scopes: ["tweet.read", "tweet.write"],
};

const sampleConfig: FinchOAuth2Config = {
  auth: sampleAuth,
  transport: "oauth2",
  defaults: { json: false, count: 10 },
};

describe("runConfigGet", () => {
  test("prints a non-secret string value (transport)", async () => {
    const result = await runConfigGet(["transport"], { readConfig: () => sampleConfig });
    expect(result.data).toEqual({ key: "transport", value: "oauth2" });
  });

  test("prints a non-secret number value as a string (defaults.count)", async () => {
    const result = await runConfigGet(["defaults.count"], { readConfig: () => sampleConfig });
    expect(result.data).toEqual({ key: "defaults.count", value: "10" });
  });

  test("prints a non-secret boolean value as a string (defaults.json)", async () => {
    const result = await runConfigGet(["defaults.json"], { readConfig: () => sampleConfig });
    expect(result.data).toEqual({ key: "defaults.json", value: "false" });
  });

  test("prints a non-secret numeric auth value (auth.expiresAt)", async () => {
    const result = await runConfigGet(["auth.expiresAt"], { readConfig: () => sampleConfig });
    expect(result.data).toEqual({ key: "auth.expiresAt", value: String(sampleAuth.expiresAt) });
  });

  test("prints a non-secret array auth value (auth.scopes)", async () => {
    const result = await runConfigGet(["auth.scopes"], { readConfig: () => sampleConfig });
    expect(result.data).toEqual({ key: "auth.scopes", value: sampleAuth.scopes.join(",") });
  });

  test("masks auth.* fields to all-but-last-4 characters", async () => {
    const result = await runConfigGet(["auth.clientId"], { readConfig: () => sampleConfig });
    expect(result.data).toEqual({ key: "auth.clientId", value: "********3456" });
    expect((result.data as { value: string }).value).not.toContain("client123456");
  });

  test("masks every secret auth.* field, never the full plaintext", async () => {
    for (const key of ["auth.clientId", "auth.accessToken", "auth.refreshToken"]) {
      const result = await runConfigGet([key], { readConfig: () => sampleConfig });
      const value = (result.data as { value: string }).value;
      expect(value).toMatch(/^\*+\w{4}$/);
    }
  });

  test("masking happens regardless of --json", async () => {
    // runConfigGet is JSON-shape-agnostic (the CLI layer decides --json vs
    // human output) — masking must apply to the returned data either way,
    // since the human formatter reads the same `value` field.
    const jsonResult = await runConfigGet(["auth.clientId"], { readConfig: () => sampleConfig });
    const humanResult = await runConfigGet(["auth.clientId"], { readConfig: () => sampleConfig });
    expect(jsonResult.data).toEqual(humanResult.data);
    expect((jsonResult.data as { value: string }).value).toBe("********3456");
  });

  test("throws USAGE_ERROR for an unknown key", async () => {
    await expect(runConfigGet(["bogus.key"], { readConfig: () => sampleConfig })).rejects.toThrow(FinchError);
  });

  test("throws AUTH_ERROR when no config exists", async () => {
    let thrown: unknown;
    try {
      await runConfigGet(["transport"], { readConfig: () => null });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FinchError);
    expect((thrown as FinchError).code).toBe("AUTH_ERROR");
  });

  test("throws USAGE_ERROR when no key is given", async () => {
    await expect(runConfigGet([], { readConfig: () => sampleConfig })).rejects.toThrow(FinchError);
  });

  test("throws a clean FinchError (not a raw TypeError) when a top-level section is missing from a corrupt config", async () => {
    const corrupt = { auth: sampleAuth, transport: "oauth2" } as unknown as FinchOAuth2Config;
    let thrown: unknown;
    try {
      await runConfigGet(["defaults.count"], { readConfig: () => corrupt });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FinchError);
  });

  test("throws USAGE_ERROR (not a crash) for a prototype-pollution key like __proto__", async () => {
    let thrown: unknown;
    try {
      await runConfigGet(["__proto__"], { readConfig: () => sampleConfig });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FinchError);
    expect((thrown as FinchError).code).toBe("USAGE_ERROR");
  });

  test("throws USAGE_ERROR (not a crash) for the 'constructor' key", async () => {
    let thrown: unknown;
    try {
      await runConfigGet(["constructor"], { readConfig: () => sampleConfig });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FinchError);
    expect((thrown as FinchError).code).toBe("USAGE_ERROR");
  });
});

describe("runConfigSet", () => {
  test("sets defaults.count and writes the updated config", async () => {
    const written: { config: FinchOAuth2Config | null } = { config: null };
    const result = await runConfigSet(["defaults.count", "25"], {
      readConfig: () => sampleConfig,
      writeConfig: (config) => {
        written.config = config;
      },
    });

    expect(result.data).toEqual({ key: "defaults.count", value: "25" });
    expect(written.config).toEqual({ ...sampleConfig, defaults: { json: false, count: 25 } });
  });

  test("sets defaults.json and writes the updated config", async () => {
    const written: { config: FinchOAuth2Config | null } = { config: null };
    const result = await runConfigSet(["defaults.json", "true"], {
      readConfig: () => sampleConfig,
      writeConfig: (config) => {
        written.config = config;
      },
    });

    expect(result.data).toEqual({ key: "defaults.json", value: "true" });
    expect(written.config).toEqual({ ...sampleConfig, defaults: { json: true, count: 10 } });
  });

  test("rejects setting any auth.* field with a clear USAGE_ERROR pointing at finch auth", async () => {
    let thrown: unknown;
    try {
      await runConfigSet(["auth.clientId", "newvalue"], {
        readConfig: () => sampleConfig,
        writeConfig: () => {
          throw new Error("should not write");
        },
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FinchError);
    expect((thrown as FinchError).code).toBe("USAGE_ERROR");
    expect((thrown as FinchError).message).toMatch(/finch auth/i);
  });

  test("rejects setting an unsupported non-secret key (e.g. transport)", async () => {
    await expect(
      runConfigSet(["transport", "proxy"], {
        readConfig: () => sampleConfig,
        writeConfig: () => {
          throw new Error("should not write");
        },
      }),
    ).rejects.toThrow(FinchError);
  });

  test("rejects an invalid value for defaults.count", async () => {
    await expect(
      runConfigSet(["defaults.count", "not-a-number"], {
        readConfig: () => sampleConfig,
        writeConfig: () => {
          throw new Error("should not write");
        },
      }),
    ).rejects.toThrow(FinchError);
  });

  test("throws AUTH_ERROR when no config exists", async () => {
    let thrown: unknown;
    try {
      await runConfigSet(["defaults.count", "5"], { readConfig: () => null });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FinchError);
    expect((thrown as FinchError).code).toBe("AUTH_ERROR");
  });

  test("throws USAGE_ERROR when key or value is missing", async () => {
    await expect(runConfigSet(["defaults.count"], { readConfig: () => sampleConfig })).rejects.toThrow(FinchError);
  });
});

describe("runConfigPath", () => {
  test("prints the resolved config path without requiring the file to exist", async () => {
    const result = await runConfigPath([], { configPath: () => "/home/fake/.finch/config" });
    expect(result.data).toEqual({ path: "/home/fake/.finch/config" });
  });

  // FIN-82 review: config path takes no flags — reject a typo'd one.
  test("rejects an unrecognized flag", async () => {
    await expect(runConfigPath(["--bogus"], { configPath: () => "/x" })).rejects.toMatchObject({
      code: "USAGE_ERROR",
    });
  });
});

// FIN-78 review blocker 1: `config set` used to read a whole-config snapshot
// and write it back without the credential store lock. If a refresh rotated
// the (single-use) refresh token in between, config set's write silently
// restored the stale credential and the next refresh would spend an
// already-rotated token. Deterministic interleaving: a "refresh" holds the
// store lock and persists a rotated credential; config set, started while the
// lock is held, must wait, re-read, and merge only the field it owns.
describe("FIN-78 regression: config set vs in-flight refresh", () => {
  let sandbox: string;
  let originalConfigPath: string | undefined;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "finch-fin78-config-test-"));
    originalConfigPath = process.env.FINCH_CONFIG_PATH;
    process.env.FINCH_CONFIG_PATH = join(sandbox, ".finch", "config");
  });

  afterEach(() => {
    if (originalConfigPath === undefined) delete process.env.FINCH_CONFIG_PATH;
    else process.env.FINCH_CONFIG_PATH = originalConfigPath;
    rmSync(sandbox, { recursive: true, force: true });
  });

  function storedConfig(refreshToken: string): FinchOAuth2Config {
    return {
      auth: { ...sampleAuth, refreshToken },
      transport: "oauth2",
      defaults: { json: false, count: 10 },
    };
  }

  test("config set waits for the store lock and merges onto the rotated credential", async () => {
    writeOAuth2Config(storedConfig("refresh-A"));

    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    // Simulated in-flight refresh: holds the store lock, then persists the
    // rotated credential B just before releasing — exactly what a concurrent
    // `RefreshingOAuth2Transport.performRefresh()` does.
    const refreshHolder = withFileLock(`${configPath()}.refresh.lock`, async () => {
      await refreshGate;
      writeOAuth2Config(storedConfig("refresh-B"));
    });

    const setPromise = runConfigSet(["defaults.count", "25"]);
    // Give an unserialized (broken) config set every chance to do its stale
    // read-modify-write while the refresh still holds the lock.
    await Bun.sleep(75);
    releaseRefresh();
    await refreshHolder;
    await setPromise;

    const final = readOAuth2Config();
    // The rotated credential must survive (config set does not own auth)…
    expect(final?.auth.refreshToken).toBe("refresh-B");
    // …and the operator's change must land (config set owns defaults).
    expect(final?.defaults.count).toBe(25);
  });
});
