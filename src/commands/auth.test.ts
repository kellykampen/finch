import { describe, test, expect } from "bun:test";
import { runAuth, runAuthStatus, parseClientIdFlag, startLocalCallbackServer } from "./auth";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";
import type { FinchOAuth2Config } from "../core/oauth2-config";
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
    let transportCalled = false;
    const result = await runAuthStatus({
      readOAuth2Config: () => null,
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
      readOAuth2Config: () => fakeOAuth2Config,
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
      readOAuth2Config: () => fakeOAuth2Config,
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

    await expect(
      runAuthStatus({ readOAuth2Config: () => fakeOAuth2Config, transportFactory: () => transport }),
    ).rejects.toThrow(FinchError);
  });
});
