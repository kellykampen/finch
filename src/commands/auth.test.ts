import { describe, test, expect } from "bun:test";
import { runAuth, runAuthStatus } from "./auth";
import { FinchError } from "../core/errors";
import type { XTransport } from "../core/transport";
import type { FinchConfig } from "../core/config";

const enteredAuth = { apiKey: "k", apiKeySecret: "ks", accessToken: "t", accessTokenSecret: "ts" };

describe("runAuth", () => {
  test("validates then writes the config on success", async () => {
    const written: { config: FinchConfig | null } = { config: null };
    const fakeTransport: XTransport = {
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    };

    const result = await runAuth({
      promptCredentials: async () => enteredAuth,
      transportFactory: () => fakeTransport,
      readConfig: () => null,
      writeConfig: (config) => {
        written.config = config;
      },
    });

    expect(result.data).toEqual({ configured: true, username: "kelly" });
    expect(written.config).toEqual({
      auth: enteredAuth,
      transport: "byok",
      defaults: { json: false, count: 10 },
    });
  });

  test("preserves existing defaults when re-run", async () => {
    const written: { config: FinchConfig | null } = { config: null };
    const fakeTransport: XTransport = {
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    };

    await runAuth({
      promptCredentials: async () => enteredAuth,
      transportFactory: () => fakeTransport,
      readConfig: () => ({
        auth: { apiKey: "old", apiKeySecret: "old", accessToken: "old", accessTokenSecret: "old" },
        transport: "byok",
        defaults: { json: true, count: 25 },
      }),
      writeConfig: (config) => {
        written.config = config;
      },
    });

    expect(written.config?.defaults).toEqual({ json: true, count: 25 });
    expect(written.config?.auth).toEqual(enteredAuth);
  });

  test("does not write the config when validation fails", async () => {
    let writeCalled = false;
    const fakeTransport: XTransport = {
      getMe: async () => {
        throw new FinchError("AUTH_ERROR", "X rejected the provided credentials");
      },
    };

    await expect(
      runAuth({
        promptCredentials: async () => enteredAuth,
        transportFactory: () => fakeTransport,
        readConfig: () => null,
        writeConfig: () => {
          writeCalled = true;
        },
      }),
    ).rejects.toThrow(FinchError);

    expect(writeCalled).toBe(false);
  });
});

describe("runAuthStatus", () => {
  test("reports unconfigured without calling the transport", async () => {
    let transportCalled = false;
    const result = await runAuthStatus({
      resolveAuth: () => null,
      transportFactory: () => {
        transportCalled = true;
        throw new Error("should not be called");
      },
    });

    expect(result.data).toEqual({ configured: false, valid: false, username: null });
    expect(transportCalled).toBe(false);
  });

  test("reports configured and valid when the live call succeeds", async () => {
    const fakeTransport: XTransport = {
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    };

    const result = await runAuthStatus({
      resolveAuth: () => enteredAuth,
      transportFactory: () => fakeTransport,
    });

    expect(result.data).toEqual({ configured: true, valid: true, username: "kelly" });
  });

  test("reports configured but invalid when X rejects the credentials", async () => {
    const fakeTransport: XTransport = {
      getMe: async () => {
        throw new FinchError("AUTH_ERROR", "X rejected the provided credentials");
      },
    };

    const result = await runAuthStatus({
      resolveAuth: () => enteredAuth,
      transportFactory: () => fakeTransport,
    });

    expect(result.data).toEqual({ configured: true, valid: false, username: null });
  });

  test("propagates non-auth errors (e.g. network failure) instead of masking them", async () => {
    const fakeTransport: XTransport = {
      getMe: async () => {
        throw new FinchError("NETWORK_ERROR", "could not reach X");
      },
    };

    await expect(
      runAuthStatus({ resolveAuth: () => enteredAuth, transportFactory: () => fakeTransport }),
    ).rejects.toThrow(FinchError);
  });
});
