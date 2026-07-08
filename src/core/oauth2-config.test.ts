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

  test("throws AUTH_ERROR with a clear message when the config is a legacy OAuth 1.0a shape", () => {
    const legacyConfig = {
      auth: {
        apiKey: "key123",
        accessToken: "token123",
      },
      transport: "byok",
      defaults: { json: false, count: 10 },
    };
    mkdirSync(dirname(configPath()), { recursive: true });
    writeFileSync(configPath(), JSON.stringify(legacyConfig, null, 2), {
      mode: 0o600,
    });

    try {
      readOAuth2Config();
      throw new Error("expected readOAuth2Config to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
      expect((err as FinchError).message).toBe("Finch now uses OAuth 2.0 — run `finch auth`");
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
