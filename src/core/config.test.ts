import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, statSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  configPath,
  readConfig,
  writeConfig,
  resolveAuthConfig,
  maskSecret,
} from "./config";
import { FinchError } from "./errors";

const ENV_KEYS = [
  "FINCH_API_KEY",
  "FINCH_API_KEY_SECRET",
  "FINCH_ACCESS_TOKEN",
  "FINCH_ACCESS_TOKEN_SECRET",
] as const;

let fakeHome: string;
let originalHome: string | undefined;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "finch-config-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = fakeHome;
  originalEnv = {};
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  process.env.HOME = originalHome;
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  rmSync(fakeHome, { recursive: true, force: true });
});

const sampleAuth = {
  apiKey: "key123",
  apiKeySecret: "secret123",
  accessToken: "token123",
  accessTokenSecret: "tokensecret123",
};

describe("configPath", () => {
  test("resolves to ~/.finch/config under the current home dir", () => {
    expect(configPath()).toBe(join(fakeHome, ".finch", "config"));
  });
});

describe("readConfig", () => {
  test("returns null when no config file exists", () => {
    expect(readConfig()).toBeNull();
  });

  test("returns the written config on round-trip", () => {
    writeConfig({
      auth: sampleAuth,
      transport: "byok",
      defaults: { json: false, count: 10 },
    });

    expect(readConfig()).toEqual({
      auth: sampleAuth,
      transport: "byok",
      defaults: { json: false, count: 10 },
    });
  });

  test("re-applies 0600 permissions if the file was loosened by another process", () => {
    writeConfig({
      auth: sampleAuth,
      transport: "byok",
      defaults: { json: false, count: 10 },
    });
    chmodSync(configPath(), 0o644);

    readConfig();

    const mode = statSync(configPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("throws AUTH_ERROR (not a raw SyntaxError) when the config file is corrupt", () => {
    mkdirSync(dirname(configPath()), { recursive: true });
    writeFileSync(configPath(), "{ not valid json", { mode: 0o600 });

    try {
      readConfig();
      throw new Error("expected readConfig to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
    }
  });
});

describe("writeConfig", () => {
  test("creates ~/.finch/config at mode 0600", () => {
    writeConfig({
      auth: sampleAuth,
      transport: "byok",
      defaults: { json: false, count: 10 },
    });

    const mode = statSync(configPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("creates ~/.finch itself at mode 0700", () => {
    writeConfig({
      auth: sampleAuth,
      transport: "byok",
      defaults: { json: false, count: 10 },
    });

    const mode = statSync(dirname(configPath())).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  test("overwrites all four auth fields on re-run", () => {
    writeConfig({
      auth: sampleAuth,
      transport: "byok",
      defaults: { json: false, count: 10 },
    });

    const newAuth = {
      apiKey: "new-key",
      apiKeySecret: "new-secret",
      accessToken: "new-token",
      accessTokenSecret: "new-token-secret",
    };
    writeConfig({ auth: newAuth, transport: "byok", defaults: { json: false, count: 10 } });

    expect(readConfig()?.auth).toEqual(newAuth);
  });
});

describe("resolveAuthConfig", () => {
  test("returns null when no env vars and no config file", () => {
    expect(resolveAuthConfig()).toBeNull();
  });

  test("returns config file auth when no env vars are set", () => {
    writeConfig({
      auth: sampleAuth,
      transport: "byok",
      defaults: { json: false, count: 10 },
    });

    expect(resolveAuthConfig()).toEqual(sampleAuth);
  });

  test("prefers env vars over the config file when all four are set", () => {
    writeConfig({
      auth: sampleAuth,
      transport: "byok",
      defaults: { json: false, count: 10 },
    });
    process.env.FINCH_API_KEY = "env-key";
    process.env.FINCH_API_KEY_SECRET = "env-key-secret";
    process.env.FINCH_ACCESS_TOKEN = "env-token";
    process.env.FINCH_ACCESS_TOKEN_SECRET = "env-token-secret";

    expect(resolveAuthConfig()).toEqual({
      apiKey: "env-key",
      apiKeySecret: "env-key-secret",
      accessToken: "env-token",
      accessTokenSecret: "env-token-secret",
    });
  });

  test("falls back to config file when only some env vars are set", () => {
    writeConfig({
      auth: sampleAuth,
      transport: "byok",
      defaults: { json: false, count: 10 },
    });
    process.env.FINCH_API_KEY = "env-key-only";

    expect(resolveAuthConfig()).toEqual(sampleAuth);
  });
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
