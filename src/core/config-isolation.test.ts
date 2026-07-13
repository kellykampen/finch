import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { assertConfigWriteIsolatedInTests } from "./config";
import { writeOAuth2Config, withConfigStoreLock, type FinchOAuth2Config } from "./oauth2-config";

// FIN-77 real-config-overwrite regression.
//
// The incident: `configPath()` resolves to the canonical real-user home
// regardless of $HOME (FIN-77), so a sandboxed HOME no longer isolates a test's
// config writes. A test that persisted config without setting FINCH_CONFIG_PATH
// overwrote the operator's real ~/.finch/config with test fixtures.
//
// These tests prove that failure mode is now impossible: (1) the test preload
// establishes isolation for every test process, and (2) if isolation is ever
// bypassed (FINCH_CONFIG_PATH unset during a test run), EVERY config mutation
// entry point fails closed instead of touching the real path.
//
// NOTE: none of these tests ever stat, read, or write the real ~/.finch/config
// — the whole point is that the guard throws BEFORE any filesystem access, so
// the real path is never even resolved. Asserting the throw is the proof.

const sampleConfig: FinchOAuth2Config = {
  auth: {
    clientId: "isolation-test-client",
    accessToken: "isolation-test-access",
    refreshToken: "isolation-test-refresh",
    expiresAt: Date.now() + 10_000,
    scopes: ["tweet.read"],
  },
  transport: "oauth2",
  defaults: { json: false, count: 10 },
};

describe("test-run config isolation (FIN-77 regression)", () => {
  test("the preload marks the process as a test run and provides an isolated config path", () => {
    // Set by src/test-preload.ts before any test file loads.
    expect(process.env.FINCH_TEST_RUNTIME).toBe("1");
    const isolated = process.env.FINCH_CONFIG_PATH;
    expect(isolated).toBeTruthy();
    // The isolated path lives under the OS temp dir — never the operator's real
    // home (~/.finch/config resolves under $HOME, not the temp dir).
    expect(isolated?.startsWith(tmpdir())).toBe(true);
  });

  describe("with FINCH_CONFIG_PATH unset during a test run", () => {
    let saved: string | undefined;

    beforeEach(() => {
      saved = process.env.FINCH_CONFIG_PATH;
      delete process.env.FINCH_CONFIG_PATH;
    });

    afterEach(() => {
      if (saved === undefined) delete process.env.FINCH_CONFIG_PATH;
      else process.env.FINCH_CONFIG_PATH = saved;
    });

    test("assertConfigWriteIsolatedInTests throws", () => {
      expect(() => assertConfigWriteIsolatedInTests()).toThrow(/FINCH_CONFIG_PATH is not set/);
    });

    test("writeOAuth2Config refuses to write (fails closed before any fs access)", () => {
      expect(() => writeOAuth2Config(sampleConfig)).toThrow(/FINCH_CONFIG_PATH is not set/);
    });

    test("withConfigStoreLock refuses to take the store lock (fails closed)", () => {
      // The guard runs synchronously before mkdir/lock, so the call itself throws.
      expect(() => withConfigStoreLock(async () => undefined)).toThrow(/FINCH_CONFIG_PATH is not set/);
    });
  });

  test("writes are allowed once an explicit isolated FINCH_CONFIG_PATH is set", () => {
    // Re-enable isolation (as the preload/every well-behaved test does) and the
    // guard is a no-op — real behavior for both production and isolated tests.
    expect(process.env.FINCH_CONFIG_PATH).toBeTruthy();
    expect(() => assertConfigWriteIsolatedInTests()).not.toThrow();
  });
});
