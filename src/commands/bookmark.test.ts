import { describe, test, expect } from "bun:test";
import { runBookmarkList } from "./bookmark";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";
import type { FinchOAuth2Config } from "../core/oauth2-config";

const post = { id: "1", text: "hi", author_id: "42", created_at: null };

function fakeConfig(count: number): FinchOAuth2Config {
  return {
    auth: {
      clientId: "client123",
      accessToken: "token123",
      refreshToken: "refresh123",
      expiresAt: 1_700_000_000_000,
      scopes: ["tweet.read", "bookmark.read", "users.read"],
    },
    transport: "oauth2",
    defaults: { json: false, count },
  };
}

describe("runBookmarkList", () => {
  test("resolves the authenticated user's id then fetches their bookmarks", async () => {
    let capturedUserId: string | undefined;
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      listBookmarks: async (userId, count) => {
        capturedUserId = userId;
        capturedCount = count;
        return [post];
      },
    });

    const result = await runBookmarkList([], { getTransport: () => transport, getConfig: () => fakeConfig(10) });

    expect(result.data).toEqual({ posts: [post] });
    expect(capturedUserId).toBe("42");
    expect(capturedCount).toBe(10);
  });

  test("passes -n through as the max result count", async () => {
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      listBookmarks: async (_userId, count) => {
        capturedCount = count;
        return [];
      },
    });

    await runBookmarkList(["-n", "25"], { getTransport: () => transport, getConfig: () => fakeConfig(10) });

    expect(capturedCount).toBe(25);
  });

  test("uses the configured default count when -n is omitted", async () => {
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      listBookmarks: async (_userId, count) => {
        capturedCount = count;
        return [];
      },
    });

    await runBookmarkList([], { getTransport: () => transport, getConfig: () => fakeConfig(7) });

    expect(capturedCount).toBe(7);
  });

  test("falls back to 10 when no configured default count exists", async () => {
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      listBookmarks: async (_userId, count) => {
        capturedCount = count;
        return [];
      },
    });

    await runBookmarkList([], { getTransport: () => transport, getConfig: () => null });

    expect(capturedCount).toBe(10);
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    await expect(
      runBookmarkList([], {
        getTransport: () => {
          throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
        },
        getConfig: () => null,
      }),
    ).rejects.toThrow(FinchError);
  });
});
