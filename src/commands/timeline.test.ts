import { describe, test, expect } from "bun:test";
import { runTimeline } from "./timeline";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

const fakeAuth = { apiKey: "k", apiKeySecret: "ks", accessToken: "t", accessTokenSecret: "ts" };
const post = { id: "1", text: "hi", author_id: "42", created_at: null };

describe("runTimeline", () => {
  test("resolves the authenticated user's id then fetches their timeline", async () => {
    let capturedUserId: string | undefined;
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      homeTimeline: async (userId, count) => {
        capturedUserId = userId;
        capturedCount = count;
        return [post];
      },
    });

    const result = await runTimeline([], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
    });

    expect(result.data).toEqual({ posts: [post] });
    expect(capturedUserId).toBe("42");
    expect(capturedCount).toBe(10);
  });

  test("passes -n through as the max result count", async () => {
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      homeTimeline: async (_userId, count) => {
        capturedCount = count;
        return [];
      },
    });

    await runTimeline(["-n", "25"], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
    });

    expect(capturedCount).toBe(25);
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    await expect(
      runTimeline([], {
        resolveAuth: () => null,
        transportFactory: () => {
          throw new Error("should not be called");
        },
      }),
    ).rejects.toThrow(FinchError);
  });
});
