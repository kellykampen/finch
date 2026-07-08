import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, maskSecret } from "./config";

let fakeHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "finch-config-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = fakeHome;
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("configPath", () => {
  test("resolves to ~/.finch/config under the current home dir", () => {
    expect(configPath()).toBe(join(fakeHome, ".finch", "config"));
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
