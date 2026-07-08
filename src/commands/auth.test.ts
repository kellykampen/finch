import { describe, test, expect } from "bun:test";
import { runAuth, runAuthStatus, parseClientIdFlag } from "./auth";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";
import type { FinchOAuth2Config } from "../core/oauth2-config";
import type { OAuth2Token } from "@xdevplatform/xdk";

const enteredAuth = { apiKey: "k", apiKeySecret: "ks", accessToken: "t", accessTokenSecret: "ts" };

function fakeOAuth2Token(overrides: Partial<OAuth2Token> = {}): OAuth2Token {
  return {
    access_token: "access-token",
    token_type: "Bearer",
    expires_in: 7200,
    refresh_token: "refresh-token",
    scope: "tweet.read tweet.write users.read like.write follows.write bookmark.read bookmark.write offline.access",
    ...overrides,
  };
}

function fakeOAuth2Client(
  overrides: {
    getAuthorizationUrl?: (state?: string) => Promise<string>;
    exchangeCode?: (code: string) => Promise<OAuth2Token>;
  } = {},
): {
  getAuthorizationUrl(state?: string): Promise<string>;
  exchangeCode(code: string, codeVerifier?: string): Promise<OAuth2Token>;
} {
  return {
    getAuthorizationUrl:
      overrides.getAuthorizationUrl ?? (async (state) => `https://x.com/i/oauth2/authorize?state=${state}`),
    exchangeCode: overrides.exchangeCode ?? (async () => fakeOAuth2Token()),
  };
}

function fakeCallbackServer(code: string, state: string) {
  return {
    waitForCode: async () => ({ code, state }),
    stop: () => {},
  };
}

function oauth2AuthDeps(
  overrides: {
    readEnv?: (key: string) => string | undefined;
    createOAuth2Client?: () => ReturnType<typeof fakeOAuth2Client>;
    startCallbackServer?: (
      redirectUri: string,
      expectedState: string,
    ) => Promise<{ waitForCode: () => Promise<{ code: string; state: string }>; stop: () => void }>;
    createTransport?: (accessToken: string) => import("../core/transport").XTransport;
    writeOAuth2Config?: (config: FinchOAuth2Config) => void;
  } = {},
) {
  return {
    readEnv: overrides.readEnv,
    createOAuth2Client: overrides.createOAuth2Client ?? (() => fakeOAuth2Client()),
    startCallbackServer:
      overrides.startCallbackServer ??
      (async (_redirectUri: string, expectedState: string) => fakeCallbackServer("callback-code", expectedState)),
    openBrowser: async () => {},
    createTransport: overrides.createTransport,
    writeOAuth2Config: overrides.writeOAuth2Config,
  };
}

describe("runAuth", () => {
  test("validates then writes the OAuth2 config on success", async () => {
    const written: { config: FinchOAuth2Config | null } = { config: null };
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });

    const result = await runAuth({
      clientId: "client-id",
      deps: oauth2AuthDeps({
        createTransport: () => transport,
        writeOAuth2Config: (config) => {
          written.config = config;
        },
      }),
    });

    expect(result.data).toEqual({ configured: true, username: "kelly" });
    expect(written.config).toEqual({
      auth: {
        clientId: "client-id",
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: expect.any(Number),
        scopes: [
          "tweet.read",
          "tweet.write",
          "users.read",
          "like.write",
          "follows.write",
          "bookmark.read",
          "bookmark.write",
          "offline.access",
        ],
      },
      transport: "oauth2",
      defaults: { json: false, count: 10 },
    });
  });

  test("falls back to FINCH_OAUTH2_CLIENT_ID env var when no flag is provided", async () => {
    const written: { clientId: string | null } = { clientId: null };
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });

    await runAuth({
      deps: oauth2AuthDeps({
        readEnv: (key) => (key === "FINCH_OAUTH2_CLIENT_ID" ? "env-client-id" : undefined),
        createTransport: () => transport,
        writeOAuth2Config: (config) => {
          written.clientId = config.auth.clientId;
        },
      }),
    });

    expect(written.clientId).toBe("env-client-id");
  });

  test("throws and does not write the config on CSRF state mismatch", async () => {
    let writeCalled = false;
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });

    await expect(
      runAuth({
        clientId: "client-id",
        deps: oauth2AuthDeps({
          createTransport: () => transport,
          startCallbackServer: async (_redirectUri, expectedState) =>
            fakeCallbackServer("callback-code", `not-${expectedState}`),
          writeOAuth2Config: () => {
            writeCalled = true;
          },
        }),
      }),
    ).rejects.toThrow(FinchError);

    expect(writeCalled).toBe(false);
  });

  test("does not write the config when validation fails", async () => {
    let writeCalled = false;
    const transport = fakeTransport({
      getMe: async () => {
        throw new FinchError("AUTH_ERROR", "X rejected the token");
      },
    });

    await expect(
      runAuth({
        clientId: "client-id",
        deps: oauth2AuthDeps({
          createTransport: () => transport,
          writeOAuth2Config: () => {
            writeCalled = true;
          },
        }),
      }),
    ).rejects.toThrow(FinchError);

    expect(writeCalled).toBe(false);
  });
});

describe("parseClientIdFlag", () => {
  test("returns undefined when the flag is absent", () => {
    expect(parseClientIdFlag(["auth", "--other", "value"])).toBeUndefined();
  });

  test("parses space-separated --client-id <id>", () => {
    expect(parseClientIdFlag(["auth", "--client-id", "abc123"])).toBe("abc123");
  });

  test("parses equals-syntax --client-id=<id>", () => {
    expect(parseClientIdFlag(["auth", "--client-id=abc123"])).toBe("abc123");
  });

  test("prefers equals-syntax over a following bare value", () => {
    expect(parseClientIdFlag(["--client-id=abc123", "--client-id", "def456"])).toBe("abc123");
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
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });

    const result = await runAuthStatus({
      resolveAuth: () => enteredAuth,
      transportFactory: () => transport,
    });

    expect(result.data).toEqual({ configured: true, valid: true, username: "kelly" });
  });

  test("reports configured but invalid when X rejects the credentials", async () => {
    const transport = fakeTransport({
      getMe: async () => {
        throw new FinchError("AUTH_ERROR", "X rejected the provided credentials");
      },
    });

    const result = await runAuthStatus({
      resolveAuth: () => enteredAuth,
      transportFactory: () => transport,
    });

    expect(result.data).toEqual({ configured: true, valid: false, username: null });
  });

  test("propagates non-auth errors (e.g. network failure) instead of masking them", async () => {
    const transport = fakeTransport({
      getMe: async () => {
        throw new FinchError("NETWORK_ERROR", "could not reach X");
      },
    });

    await expect(runAuthStatus({ resolveAuth: () => enteredAuth, transportFactory: () => transport })).rejects.toThrow(
      FinchError,
    );
  });
});
