import { describe, test, expect } from "bun:test";
import type { OAuth2Token } from "@xdevplatform/xdk";
import { runWhoami } from "./whoami";
import { FinchError } from "../core/errors";
import { createRefreshingOAuth2Transport } from "../core/transport";
import { fakeTransport } from "../core/transport.fixtures";

describe("runWhoami", () => {
  test("returns the authenticated user's id/username/name", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });

    const result = await runWhoami({ getTransport: () => transport });

    expect(result.data).toEqual({ id: "1", username: "kelly", name: "Kelly" });
  });

  test("silently refreshes an expired access token on the command path — no re-login", async () => {
    // A real data command (whoami) driven through the real refreshing transport
    // with an already-expired access token must refresh via the stored refresh
    // token and succeed, never surfacing a re-login prompt (FIN-62).
    const now = 5_000_000;
    const expiredAuth = {
      clientId: "client-abc",
      accessToken: "expired-access",
      refreshToken: "refresh-old",
      expiresAt: now - 1,
      scopes: ["tweet.read", "users.read", "offline.access"],
    };
    let refreshed = false;

    const transport = createRefreshingOAuth2Transport(expiredAuth, {
      nowFn: () => now,
      refreshFn: async (_clientId, refreshToken): Promise<OAuth2Token> => {
        refreshed = true;
        expect(refreshToken).toBe("refresh-old");
        return {
          access_token: "fresh-access",
          token_type: "bearer",
          expires_in: 7200,
          refresh_token: "refresh-new",
          scope: expiredAuth.scopes.join(" "),
        };
      },
      persistFn: () => {},
      buildTransportFn: (accessToken) =>
        fakeTransport({
          getMe: async () => ({
            id: "7",
            username: accessToken === "fresh-access" ? "kelly" : "stale",
            name: "Kelly",
          }),
        }),
    });

    const result = await runWhoami({ getTransport: () => transport });

    expect(refreshed).toBe(true);
    expect(result.data.username).toBe("kelly");
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    try {
      await runWhoami({
        getTransport: () => {
          throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
        },
      });
      throw new Error("expected runWhoami to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
    }
  });

  test("propagates transport errors (e.g. rejected credentials) as-is", async () => {
    const transport = fakeTransport({
      getMe: async () => {
        throw new FinchError("AUTH_ERROR", "X rejected the provided credentials");
      },
    });

    try {
      await runWhoami({ getTransport: () => transport });
      throw new Error("expected runWhoami to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
    }
  });
});
