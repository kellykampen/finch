import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAuth, runAuthStatus, parseClientIdFlag, startLocalCallbackServer } from "./auth";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";
import { createRefreshingOAuth2Transport } from "../core/transport";
import { readOAuth2Config, writeOAuth2Config } from "../core/oauth2-config";

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
    readOAuth2Config?: () => FinchOAuth2Config | null;
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
    readOAuth2Config: overrides.readOAuth2Config,
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

  // FIN-62: an operator reported having to re-enter the Client ID on every
  // `finch auth`. The Client ID is durable, non-secret app metadata already
  // stored in ~/.finch/config — re-auth must reuse it instead of dropping to
  // an interactive prompt, so re-authenticating is a one-command action.
  test("reuses the persisted client ID from ~/.finch/config when no flag or env var is provided", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });
    const written: { clientId: string | null } = { clientId: null };

    const result = await runAuth({
      deps: oauth2AuthDeps({
        readOAuth2Config: () => fakeOAuth2Config,
        // The prompt must never be reached when a Client ID is already on disk.
        promptClientId: () =>
          Promise.reject(new Error("promptClientId should not be invoked when a client ID is persisted in config")),
        createTransport: () => transport,
        writeOAuth2Config: (config) => {
          written.clientId = config.auth.clientId;
        },
      }),
    });

    expect(result.data).toEqual({ configured: true, username: "kelly" });
    expect(written.clientId).toBe("client-id");
  });

  // FIN-78: re-auth must not silently reset non-secret operator settings.
  // `runAuth` rewrites the whole config file on success; the CEO-reported
  // "something is overwriting the stored config between runs" symptom class
  // includes this: a re-auth that stomps `defaults` back to factory values.
  test("preserves existing defaults when re-authenticating over a prior config", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });
    const written: { config: FinchOAuth2Config | null } = { config: null };

    await runAuth({
      deps: oauth2AuthDeps({
        readOAuth2Config: () => ({
          ...fakeOAuth2Config,
          defaults: { json: true, count: 25 },
        }),
        promptClientId: rejectingPromptClientId(),
        createTransport: () => transport,
        writeOAuth2Config: (config) => {
          written.config = config;
        },
      }),
    });

    expect(written.config?.defaults).toEqual({ json: true, count: 25 });
  });

  // First-ever auth (no config on disk) still gets the documented factory defaults.
  test("writes factory defaults on first auth when no config exists", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });
    const written: { config: FinchOAuth2Config | null } = { config: null };

    await runAuth({
      deps: oauth2AuthDeps({
        readOAuth2Config: () => null,
        promptClientId: async () => "prompted-client-id",
        createTransport: () => transport,
        writeOAuth2Config: (config) => {
          written.config = config;
        },
      }),
    });

    expect(written.config?.defaults).toEqual({ json: false, count: 10 });
  });

  test("prefers the --client-id flag over a persisted client ID", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });
    const written: { clientId: string | null } = { clientId: null };

    await runAuth({
      clientId: "flag-client-id",
      deps: oauth2AuthDeps({
        readOAuth2Config: () => fakeOAuth2Config,
        promptClientId: rejectingPromptClientId(),
        createTransport: () => transport,
        writeOAuth2Config: (config) => {
          written.clientId = config.auth.clientId;
        },
      }),
    });

    expect(written.clientId).toBe("flag-client-id");
  });

  test("prefers FINCH_OAUTH2_CLIENT_ID over a persisted client ID", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });
    const written: { clientId: string | null } = { clientId: null };

    await runAuth({
      deps: oauth2AuthDeps({
        readEnv: (key) => (key === "FINCH_OAUTH2_CLIENT_ID" ? "env-client-id" : undefined),
        readOAuth2Config: () => fakeOAuth2Config,
        promptClientId: rejectingPromptClientId(),
        createTransport: () => transport,
        writeOAuth2Config: (config) => {
          written.clientId = config.auth.clientId;
        },
      }),
    });

    expect(written.clientId).toBe("env-client-id");
  });

  test("falls back to the interactive prompt when config has no persisted client ID", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });
    const written: { clientId: string | null } = { clientId: null };

    await runAuth({
      deps: oauth2AuthDeps({
        readOAuth2Config: () => null,
        promptClientId: async () => "prompted-client-id",
        createTransport: () => transport,
        writeOAuth2Config: (config) => {
          written.clientId = config.auth.clientId;
        },
      }),
    });

    expect(written.clientId).toBe("prompted-client-id");
  });

  test("falls back to the prompt when the persisted config is legacy/corrupt (readOAuth2Config throws)", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });
    const written: { clientId: string | null } = { clientId: null };

    // A pre-OAuth2 (apiKey) or malformed config makes readOAuth2Config throw.
    // `finch auth` is the hard-cutover recovery path (PLAN.md), so it must not
    // be broken by an unreadable config — it should reach the prompt instead.
    await runAuth({
      deps: oauth2AuthDeps({
        readOAuth2Config: () => {
          throw new FinchError(
            "AUTH_ERROR",
            "Detected a legacy OAuth 1.0a config at /home/x/.finch/config. Finch now uses OAuth 2.0 and cannot migrate it automatically — run `finch auth` to re-authenticate.",
            { reason: "legacy_oauth1_config", migration: "manual" },
          );
        },
        promptClientId: async () => "prompted-client-id",
        createTransport: () => transport,
        writeOAuth2Config: (config) => {
          written.clientId = config.auth.clientId;
        },
      }),
    });

    expect(written.clientId).toBe("prompted-client-id");
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

// FIN-78 regression suite: the CEO-reported production failure was
// "re-enter the Client ID on every `finch auth`" + "session dies daily".
// Root cause was the released v0.3.0 binary predating FIN-61/62/74/77 — but
// these tests pin the fixed behavior end-to-end through the REAL file store
// (via the documented FINCH_CONFIG_PATH isolation override, never the real
// ~/.finch/config), so a regression in any layer of the chain
// (configPath → write → read → reuse → refresh-persist) fails loudly.
describe("FIN-78 regression: auth persistence through the real config store", () => {
  let sandbox: string;
  let originalConfigPath: string | undefined;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "finch-fin78-auth-test-"));
    originalConfigPath = process.env.FINCH_CONFIG_PATH;
    process.env.FINCH_CONFIG_PATH = join(sandbox, ".finch", "config");
  });

  afterEach(() => {
    if (originalConfigPath === undefined) delete process.env.FINCH_CONFIG_PATH;
    else process.env.FINCH_CONFIG_PATH = originalConfigPath;
    rmSync(sandbox, { recursive: true, force: true });
  });

  // Deps that mock every network-touching seam but leave the config store
  // real, so the persistence chain under test is the production one.
  function fileStoreAuthDeps(promptClientId: () => Promise<string>) {
    return {
      promptClientId,
      createOAuth2Client: () => fakeOAuth2Client(),
      startCallbackServer: async (_redirectUri: string, expectedState: string) =>
        fakeCallbackServer("callback-code", expectedState),
      openBrowser: async () => {},
      createTransport: () => fakeTransport({ getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }) }),
    };
  }

  test("persists the client ID on first auth and never re-prompts on the next auth", async () => {
    await runAuth({ deps: fileStoreAuthDeps(async () => "portal-client-id") });

    const configFile = process.env.FINCH_CONFIG_PATH as string;
    expect(existsSync(configFile)).toBe(true);
    const persisted = readOAuth2Config();
    expect(persisted?.auth.clientId).toBe("portal-client-id");
    expect(persisted?.auth.refreshToken).toBe("refresh-token");
    expect(persisted?.auth.scopes).toContain("offline.access");

    // Second `finch auth`: the prompt must never fire — the CEO-reported
    // symptom was exactly this prompt reappearing on every invocation.
    const result = await runAuth({
      deps: fileStoreAuthDeps(() =>
        Promise.reject(new Error("promptClientId must not run when a client ID is persisted")),
      ),
    });
    expect(result.data).toEqual({ configured: true, username: "kelly" });
    expect(readOAuth2Config()?.auth.clientId).toBe("portal-client-id");
  });

  test("a transparent refresh rotates tokens in place without losing the client ID or defaults", async () => {
    await runAuth({ deps: fileStoreAuthDeps(async () => "portal-client-id") });

    const before = readOAuth2Config();
    if (!before) throw new Error("expected a persisted config after auth");

    // Simulate the 2-hour access-token expiry the CEO hits daily, with the
    // default (file-backed, lock-serialized) persist path doing the write.
    const transport = createRefreshingOAuth2Transport(before.auth, {
      nowFn: () => before.auth.expiresAt + 1,
      refreshFn: async () => fakeOAuth2Token({ access_token: "access-rotated", refresh_token: "refresh-rotated" }),
      buildTransportFn: () => fakeTransport({ getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }) }),
    });
    await transport.getMe();

    const after = readOAuth2Config();
    expect(after?.auth.accessToken).toBe("access-rotated");
    expect(after?.auth.refreshToken).toBe("refresh-rotated");
    // The refresh persists a full config rewrite — nothing else may be lost.
    expect(after?.auth.clientId).toBe("portal-client-id");
    expect(after?.defaults).toEqual(before.defaults);

    // And a later re-auth still finds the client ID — refresh cycles must
    // never push the operator back to the interactive prompt.
    await runAuth({
      deps: fileStoreAuthDeps(() => Promise.reject(new Error("promptClientId must not run after refresh cycles"))),
    });
  });

  test("re-auth over an existing config preserves operator-set defaults in the file", async () => {
    writeOAuth2Config({
      auth: {
        clientId: "portal-client-id",
        accessToken: "old-access",
        refreshToken: "old-refresh",
        expiresAt: Date.now() + 10_000,
        scopes: ["tweet.read"],
      },
      transport: "oauth2",
      defaults: { json: true, count: 25 },
    });

    await runAuth({
      deps: fileStoreAuthDeps(() =>
        Promise.reject(new Error("promptClientId must not run when a client ID is persisted")),
      ),
    });

    expect(readOAuth2Config()?.defaults).toEqual({ json: true, count: 25 });
  });

  test("the real OAuth2 client puts offline.access (and PKCE) in the authorization URL", async () => {
    // No createOAuth2Client override: this exercises the real
    // @xdevplatform/xdk OAuth2 client and Finch's real scope list, aborting
    // before any network I/O (getAuthorizationUrl is pure string-building).
    let capturedUrl: string | null = null;
    await expect(
      runAuth({
        clientId: "portal-client-id",
        deps: {
          openBrowser: async (url: string) => {
            capturedUrl = url;
          },
          startCallbackServer: async () => ({
            waitForCode: () => Promise.reject(new FinchError("AUTH_ERROR", "test abort before callback", null)),
            stop: () => {},
          }),
        },
      }),
    ).rejects.toThrow("test abort before callback");

    if (capturedUrl === null) throw new Error("expected runAuth to open the authorization URL");
    const url = new URL(capturedUrl);
    const scopes = (url.searchParams.get("scope") ?? "").split(" ");
    // offline.access is what makes X return a refresh token at all — without
    // it every session is a short-lived 2-hour token (FIN-78 symptom 2).
    expect(scopes).toContain("offline.access");
    expect(url.searchParams.get("client_id")).toBe("portal-client-id");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});
