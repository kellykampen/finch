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
  test("resolves to ~/.finch/config under the current home dir", () => {
    expect(configPath()).toBe(join(fakeHome, ".finch", "config"));
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
