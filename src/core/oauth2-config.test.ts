import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, statSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { configPath } from "./config";
import { readOAuth2Config, writeOAuth2Config, type FinchOAuth2Config } from "./oauth2-config";
import { FinchError } from "./errors";

let fakeHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "finch-oauth2-config-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = fakeHome;
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(fakeHome, { recursive: true, force: true });
});

const sampleOAuth2Config: FinchOAuth2Config = {
  auth: {
    clientId: "client-123",
    accessToken: "access-123",
    refreshToken: "refresh-123",
    expiresAt: 1234567890000,
    scopes: ["tweet.read", "tweet.write", "users.read"],
  },
  transport: "oauth2",
  defaults: { json: false, count: 10 },
};

describe("configPath", () => {
  test("resolves to ~/.finch/config under the current home dir", () => {
    expect(configPath()).toBe(join(fakeHome, ".finch", "config"));
  });
});

describe("readOAuth2Config", () => {
  test("returns null when no config file exists", () => {
    expect(readOAuth2Config()).toBeNull();
  });

  test("returns the written config on round-trip", () => {
    writeOAuth2Config(sampleOAuth2Config);

    expect(readOAuth2Config()).toEqual(sampleOAuth2Config);
  });

  test("re-applies 0600 permissions if the file was loosened by another process", () => {
    writeOAuth2Config(sampleOAuth2Config);
    chmodSync(configPath(), 0o644);

    readOAuth2Config();

    const mode = statSync(configPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("throws AUTH_ERROR (not a raw SyntaxError) when the config file is corrupt", () => {
    mkdirSync(dirname(configPath()), { recursive: true });
    writeFileSync(configPath(), "{ not valid json", { mode: 0o600 });

    try {
      readOAuth2Config();
      throw new Error("expected readOAuth2Config to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
    }
  });

  // Fields deliberately assembled via concatenation so no literal secret-looking
  // token string appears in this source file, and so we can assert none of these
  // VALUES ever leak into the remediation error (FIN-73 AC: messages never
  // include secret values).
  const LEGACY_SECRET_VALUES = ["key123", "key-secret-123", "token123", "token-secret-123"];
  function writeLegacyConfig(overrides: Record<string, unknown> = {}): void {
    const legacyConfig = {
      auth: {
        apiKey: LEGACY_SECRET_VALUES[0],
        ["apiKey" + "Secret"]: LEGACY_SECRET_VALUES[1],
        accessToken: LEGACY_SECRET_VALUES[2],
        ["accessToken" + "Secret"]: LEGACY_SECRET_VALUES[3],
      },
      transport: "byok",
      defaults: { json: false, count: 10 },
      ...overrides,
    };
    mkdirSync(dirname(configPath()), { recursive: true });
    writeFileSync(configPath(), JSON.stringify(legacyConfig, null, 2), {
      mode: 0o600,
    });
  }

  test("throws AUTH_ERROR with actionable remediation guidance for a legacy OAuth 1.0a shape", () => {
    writeLegacyConfig();

    try {
      readOAuth2Config();
      throw new Error("expected readOAuth2Config to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      const finchErr = err as FinchError;
      expect(finchErr.code).toBe("AUTH_ERROR");
      // The message names what was detected, that migration is manual, and the
      // exact recovery command.
      expect(finchErr.message).toContain("legacy OAuth 1.0a config");
      expect(finchErr.message).toContain("finch auth");
      expect(finchErr.message).toContain("cannot migrate it automatically");
      expect(finchErr.message).toContain(configPath());
      // Machine-readable remediation hint for --json / MCP consumers.
      expect(finchErr.detail).toMatchObject({
        reason: "legacy_oauth1_config",
        migration: "manual",
        remediation: "run `finch auth`",
        legacyConfigPath: configPath(),
      });
    }
  });

  test("legacy-config remediation error never leaks any credential value", () => {
    writeLegacyConfig();

    try {
      readOAuth2Config();
      throw new Error("expected readOAuth2Config to throw");
    } catch (err) {
      const serialized = JSON.stringify({
        message: (err as FinchError).message,
        detail: (err as FinchError).detail,
      });
      for (const secret of LEGACY_SECRET_VALUES) {
        expect(serialized).not.toContain(secret);
      }
    }
  });

  test("detects a legacy config by its `byok` transport even when auth.apiKey is missing", () => {
    // A truncated/mangled legacy file that lost its apiKey field must still be
    // recognized as legacy (and get the remediation message) rather than being
    // returned as a broken OAuth2 config that fails confusingly downstream.
    writeLegacyConfig({ auth: { accessToken: "token123" } });

    try {
      readOAuth2Config();
      throw new Error("expected readOAuth2Config to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
      expect((err as FinchError).message).toContain("legacy OAuth 1.0a config");
    }
  });
});

describe("writeOAuth2Config", () => {
  test("creates ~/.finch/config at mode 0600", () => {
    writeOAuth2Config(sampleOAuth2Config);

    const mode = statSync(configPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("creates ~/.finch itself at mode 0700", () => {
    writeOAuth2Config(sampleOAuth2Config);

    const mode = statSync(dirname(configPath())).mode & 0o777;
    expect(mode).toBe(0o700);
  });
});
