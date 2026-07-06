import { describe, test, expect } from "bun:test";
import { runUserPosts } from "./user-posts";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

const fakeAuth = { apiKey: "k", apiKeySecret: "ks", accessToken: "t", accessTokenSecret: "ts" };
const post = { id: "1", text: "a post", author_id: "42", created_at: null };

describe("runUserPosts", () => {
  test("resolves the username to an id then fetches their posts", async () => {
    let capturedUsername: string | undefined;
    let capturedUserId: string | undefined;
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      getUserByUsername: async (username) => {
        capturedUsername = username;
        return { id: "42", username, name: "Kelly", description: "", public_metrics: {} };
      },
      userTweets: async (userId, count) => {
        capturedUserId = userId;
        capturedCount = count;
        return [post];
      },
    });

    const result = await runUserPosts(["kelly"], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
    });

    expect(result.data).toEqual({ posts: [post] });
    expect(capturedUsername).toBe("kelly");
    expect(capturedUserId).toBe("42");
    expect(capturedCount).toBe(10);
  });

  test("strips a leading @ from the username", async () => {
    let capturedUsername: string | undefined;
    const transport = fakeTransport({
      getUserByUsername: async (username) => {
        capturedUsername = username;
        return { id: "42", username, name: "Kelly", description: "", public_metrics: {} };
      },
      userTweets: async () => [],
    });

    await runUserPosts(["@kelly"], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
    });

    expect(capturedUsername).toBe("kelly");
  });

  test("throws USAGE_ERROR when the username is missing", async () => {
    await expect(
      runUserPosts([], { resolveAuth: () => fakeAuth, transportFactory: () => fakeTransport({}) }),
    ).rejects.toThrow(FinchError);
  });

  test("propagates CLIENT_ERROR when the user isn't found", async () => {
    const transport = fakeTransport({
      getUserByUsername: async () => {
        throw new FinchError("CLIENT_ERROR", "User @ghost not found");
      },
    });

    await expect(
      runUserPosts(["ghost"], { resolveAuth: () => fakeAuth, transportFactory: () => transport }),
    ).rejects.toThrow(FinchError);
  });
});
