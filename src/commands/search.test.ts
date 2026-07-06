import { describe, test, expect } from "bun:test";
import { runSearch } from "./search";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

const fakeAuth = { apiKey: "k", apiKeySecret: "ks", accessToken: "t", accessTokenSecret: "ts" };
const post = { id: "1", text: "match", author_id: "42", created_at: null };

describe("runSearch", () => {
  test("searches with the given query and default count", async () => {
    let capturedQuery: string | undefined;
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      searchRecent: async (query, count) => {
        capturedQuery = query;
        capturedCount = count;
        return [post];
      },
    });

    const result = await runSearch(["hello world"], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
    });

    expect(result.data).toEqual({ posts: [post] });
    expect(capturedQuery).toBe("hello world");
    expect(capturedCount).toBe(10);
  });

  test("passes -n through as the max result count", async () => {
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      searchRecent: async (_query, count) => {
        capturedCount = count;
        return [];
      },
    });

    await runSearch(["hello", "-n", "50"], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
    });

    expect(capturedCount).toBe(50);
  });

  test("throws USAGE_ERROR when the query is missing", async () => {
    await expect(
      runSearch([], { resolveAuth: () => fakeAuth, transportFactory: () => fakeTransport({}) }),
    ).rejects.toThrow(FinchError);
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    await expect(
      runSearch(["hello"], {
        resolveAuth: () => null,
        transportFactory: () => {
          throw new Error("should not be called");
        },
      }),
    ).rejects.toThrow(FinchError);
  });
});
