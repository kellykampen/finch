import { describe, test, expect } from "bun:test";
import { runAuth, runAuthStatus, parseClientIdFlag, startLocalCallbackServer } from "./auth";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";
import { createRefreshingOAuth2Transport } from "../core/transport";

import type { FinchOAuth2Config, OAuth2AuthConfig } from "../core/oauth2-config";
import type { OAuth2Token } from "@xdevplatform/xdk";

const fakeOAuth2Config: FinchOAuth2Config = {
  auth: {
    clientId: "client-id",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: Date.now() + 10_000,
    scopes: ["tweet.read"],
  },
  transport: "oauth2",
  defaults: { json: false, count: 10 },
};

function fakeOAuth2Token(overrides: Partial<OAuth2Token> = {}): OAuth2Token {
  return {
    access_token: "access-token",
    token_type: "Bearer",
    expires_in: 7200,
    refresh_token: "refresh-token",
    scope:
      "tweet.read tweet.write users.read like.write follows.write bookmark.read bookmark.write media.write offline.access",
    ...overrides,
  };
}

function fakeOAuth2Client(
  overrides: {
    getAuthorizationUrl?: (state?: string) => Promise<string>;
    exchangeCode?: (code: string, codeVerifier?: string) => Promise<OAuth2Token>;
    setPkceParameters?: (codeVerifier: string, codeChallenge?: string) => Promise<void>;
  } = {},
): {
  getAuthorizationUrl(state?: string): Promise<string>;
  exchangeCode(code: string, codeVerifier?: string): Promise<OAuth2Token>;
  setPkceParameters(codeVerifier: string, codeChallenge?: string): Promise<void>;
} {
  return {
    getAuthorizationUrl:
      overrides.getAuthorizationUrl ?? (async (state) => `https://x.com/i/oauth2/authorize?state=${state}`),
    exchangeCode: overrides.exchangeCode ?? (async () => fakeOAuth2Token()),
    setPkceParameters: overrides.setPkceParameters ?? (async () => {}),
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
    promptClientId?: () => Promise<string>;
    createOAuth2Client?: (config: {
      clientId: string;
      redirectUri: string;
      scope: string[];
    }) => ReturnType<typeof fakeOAuth2Client>;
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
    promptClientId: overrides.promptClientId,
    createOAuth2Client: overrides.createOAuth2Client ?? (() => fakeOAuth2Client()),
    startCallbackServer:
      overrides.startCallbackServer ??
      (async (_redirectUri: string, expectedState: string) => fakeCallbackServer("callback-code", expectedState)),
    openBrowser: async () => {},
    createTransport: overrides.createTransport,
    writeOAuth2Config: overrides.writeOAuth2Config,
  };
}

function rejectingPromptClientId(): () => Promise<string> {
  return () =>
    Promise.reject(
      new Error("promptClientId should not be invoked when a --client-id flag or env var was already resolved"),
    );
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
          "media.write",
          "offline.access",
        ],
      },
      transport: "oauth2",
      defaults: { json: false, count: 10 },
    });
  });

  test("requests the media.write scope required by X media upload endpoints", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });
    let requestedScopes: string[] = [];

    await runAuth({
      clientId: "client-id",
      deps: oauth2AuthDeps({
        createOAuth2Client: (config) => {
          requestedScopes = config.scope;
          return fakeOAuth2Client();
        },
        createTransport: () => transport,
      }),
    });

    expect(requestedScopes).toContain("media.write");
  });

  test("stores requested scopes including media.write when the token response omits scope", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });
    let requestedScopes: string[] = [];
    let writtenScopes: string[] = [];

    await runAuth({
      clientId: "client-id",
      deps: oauth2AuthDeps({
        createOAuth2Client: (config) => {
          requestedScopes = config.scope;
          return fakeOAuth2Client({
            exchangeCode: async () => fakeOAuth2Token({ scope: undefined }),
          });
        },
        createTransport: () => transport,
        writeOAuth2Config: (config) => {
          writtenScopes = config.auth.scopes;
        },
      }),
    });

    expect(writtenScopes).toEqual(requestedScopes);
    expect(writtenScopes).toContain("media.write");
  });

  test("generates PKCE parameters, sets them before building the authorization URL, and passes the verifier on exchange", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });

    let setParams = { verifier: "", challenge: "" };
    let exchangeVerifier: string | undefined;
    const events: string[] = [];

    await runAuth({
      clientId: "client-id",
      deps: oauth2AuthDeps({
        createOAuth2Client: () =>
          fakeOAuth2Client({
            setPkceParameters: async (verifier, challenge) => {
              events.push("setPkceParameters");
              setParams = { verifier, challenge: challenge ?? "" };
            },
            getAuthorizationUrl: async (state) => {
              events.push("getAuthorizationUrl");
              return `https://x.com/i/oauth2/authorize?state=${state}`;
            },
            exchangeCode: async (_code, verifier) => {
              events.push("exchangeCode");
              exchangeVerifier = verifier;
              return fakeOAuth2Token();
            },
          }),
        createTransport: () => transport,
      }),
    });

    expect(events[0]).toBe("setPkceParameters");
    expect(events[1]).toBe("getAuthorizationUrl");
    expect(events[events.length - 1]).toBe("exchangeCode");
    expect(setParams.verifier.length).toBeGreaterThan(0);
    expect(setParams.challenge.length).toBeGreaterThan(0);
    expect(exchangeVerifier).toBe(setParams.verifier);
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

  // FIN-59: an operator reported `finch auth --client-id ...` still prompting
  // for a Client ID even though the flag was passed. Source-level tracing
  // shows resolveClientId() only ever calls promptClientId as its last
  // resort — but that guarantee is only as good as this test staying green,
  // so assert the prompt is never reached whenever a clientId is already
  // resolvable via the flag or the env var.
  test("never invokes the interactive prompt when --client-id is provided", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });

    const result = await runAuth({
      clientId: parseClientIdFlag(["--client-id", "abc123"]),
      deps: oauth2AuthDeps({
        promptClientId: rejectingPromptClientId(),
        createTransport: () => transport,
      }),
    });

    expect(result.data).toEqual({ configured: true, username: "kelly" });
  });

  test("never invokes the interactive prompt when --client-id=<id> is provided", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });

    const result = await runAuth({
      clientId: parseClientIdFlag(["--client-id=abc123"]),
      deps: oauth2AuthDeps({
        promptClientId: rejectingPromptClientId(),
        createTransport: () => transport,
      }),
    });

    expect(result.data).toEqual({ configured: true, username: "kelly" });
  });

  test("never invokes the interactive prompt when FINCH_OAUTH2_CLIENT_ID is set and no flag is passed", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });

    const result = await runAuth({
      clientId: parseClientIdFlag(["--other", "value"]),
      deps: oauth2AuthDeps({
        readEnv: (key) => (key === "FINCH_OAUTH2_CLIENT_ID" ? "env-client-id" : undefined),
        promptClientId: rejectingPromptClientId(),
        createTransport: () => transport,
      }),
    });

    expect(result.data).toEqual({ configured: true, username: "kelly" });
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

describe("startLocalCallbackServer", () => {
  test("serves the full success response for a valid callback and captures the code", async () => {
    const state = "test-state-valid";
    const server = await startLocalCallbackServer("http://127.0.0.1:0/callback", state);
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/callback?code=valid-code&state=${state}`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Authenticated");
    } finally {
      await server.stop();
    }

    const code = await server.waitForCode();
    expect(code).toEqual({ code: "valid-code", state });
  });

  test("returns 400 when the authorization code is missing", async () => {
    const state = "test-state-missing";
    const server = await startLocalCallbackServer("http://127.0.0.1:0/callback", state);
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/callback?state=${state}`);
      expect(res.status).toBe(400);
      const body = await res.text();
      expect(body).toContain("missing");
    } finally {
      await server.stop();
    }
  });

  test("returns 403 when the state does not match", async () => {
    const state = "test-state-match";
    const server = await startLocalCallbackServer("http://127.0.0.1:0/callback", state);
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/callback?code=valid-code&state=wrong`);
      expect(res.status).toBe(403);
      const body = await res.text();
      expect(body).toContain("state mismatch");
    } finally {
      await server.stop();
    }
  });

  test("returns 404 for an unknown path", async () => {
    const state = "test-state-path";
    const server = await startLocalCallbackServer("http://127.0.0.1:0/callback", state);
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/not-callback?code=valid-code&state=${state}`);
      expect(res.status).toBe(404);
    } finally {
      await server.stop();
    }
  });
});

describe("runAuthStatus", () => {
  test("reports unconfigured without calling the transport", async () => {
    const result = await runAuthStatus({
      readOAuth2Config: () => null,
    });

    expect(result.data).toEqual({ configured: false, valid: false, username: null });
  });

  test("reports configured and valid when the live call succeeds", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });

    const result = await runAuthStatus({
      readOAuth2Config: () => fakeOAuth2Config,
      createRefreshingTransport: () => transport,
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
      readOAuth2Config: () => fakeOAuth2Config,
      createRefreshingTransport: () => transport,
    });

    expect(result.data).toEqual({ configured: true, valid: false, username: null });
  });

  test("propagates non-auth errors (e.g. network failure) instead of masking them", async () => {
    const transport = fakeTransport({
      getMe: async () => {
        throw new FinchError("NETWORK_ERROR", "could not reach X");
      },
    });

    await expect(
      runAuthStatus({ readOAuth2Config: () => fakeOAuth2Config, createRefreshingTransport: () => transport }),
    ).rejects.toThrow(FinchError);
  });

  test("refreshes an expired access token via refresh token before reporting valid", async () => {
    const expiredConfig: FinchOAuth2Config = {
      auth: {
        clientId: "client-id",
        accessToken: "expired-access",
        refreshToken: "refresh-token",
        expiresAt: Date.now() - 1000, // already expired
        scopes: ["tweet.read"],
      },
      transport: "oauth2",
      defaults: { json: false, count: 10 },
    };

    const refreshedTransport = fakeTransport({
      getMe: async () => ({ id: "1", username: "refreshed-user", name: "Refreshed" }),
    });

    let capturedRefreshingConfig: OAuth2AuthConfig | undefined;
    const result = await runAuthStatus({
      readOAuth2Config: () => expiredConfig,
      createRefreshingTransport: (authConfig) => {
        capturedRefreshingConfig = authConfig;
        return refreshedTransport;
      },
    });

    expect(result.data).toEqual({ configured: true, valid: true, username: "refreshed-user" });
    expect(capturedRefreshingConfig).toBeDefined();
    expect(capturedRefreshingConfig?.clientId).toBe("client-id");
    expect(capturedRefreshingConfig?.refreshToken).toBe("refresh-token");
  });

  test("persists rotated refresh token from successful refresh during status check", async () => {
    const expiredConfig: FinchOAuth2Config = {
      auth: {
        clientId: "client-id",
        accessToken: "expired-access",
        refreshToken: "old-refresh",
        expiresAt: Date.now() - 1000,
        scopes: ["tweet.read"],
      },
      transport: "oauth2",
      defaults: { json: false, count: 10 },
    };

    const persisted: { config: OAuth2AuthConfig | null } = { config: null };
    const result = await runAuthStatus({
      readOAuth2Config: () => expiredConfig,
      createRefreshingTransport: (authConfig) =>
        createRefreshingOAuth2Transport(authConfig, {
          refreshFn: async () =>
            fakeOAuth2Token({
              access_token: "new-access",
              refresh_token: "new-rotated-refresh",
            }),
          persistFn: async (cfg) => {
            persisted.config = cfg;
          },
          buildTransportFn: () =>
            fakeTransport({
              getMe: async () => ({ id: "2", username: "rotated", name: "Rotated" }),
            }),
        }),
    });

    expect(result.data).toEqual({ configured: true, valid: true, username: "rotated" });
    expect(persisted.config).not.toBeNull();
    expect(persisted.config?.clientId).toBe("client-id");
    expect(persisted.config?.accessToken).toBe("new-access");
    expect(persisted.config?.refreshToken).toBe("new-rotated-refresh");
    expect(persisted.config?.scopes).toEqual(["tweet.read"]);
  });

  test("reports invalid when refresh fails and does not leak secrets", async () => {
    const expiredConfig: FinchOAuth2Config = {
      auth: {
        clientId: "client-id",
        accessToken: "expired-access",
        refreshToken: "refresh-token",
        expiresAt: Date.now() - 1000,
        scopes: ["tweet.read"],
      },
      transport: "oauth2",
      defaults: { json: false, count: 10 },
    };

    const result = await runAuthStatus({
      readOAuth2Config: () => expiredConfig,
      createRefreshingTransport: (_authConfig) => {
        // simulate refresh failure inside the refreshing transport by throwing AUTH_ERROR
        return fakeTransport({
          getMe: async () => {
            throw new FinchError("AUTH_ERROR", "Your session has expired — run `finch auth` to log in again.");
          },
        });
      },
    });

    expect(result.data).toEqual({ configured: true, valid: false, username: null });
    expect(result.human).toBe("Configured, but credentials are expired or invalid.");
    // ensure no tokens appear in human message
    expect(result.human).not.toContain("refresh");
    expect(result.human).not.toContain("access");
    expect(result.human).not.toContain("client-id");
  });
});
