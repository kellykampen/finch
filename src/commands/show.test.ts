import { describe, test, expect } from "bun:test";
import { runShow } from "./show";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

const fakeAuth = { apiKey: "k", apiKeySecret: "ks", accessToken: "t", accessTokenSecret: "ts" };
const post = { id: "1", text: "hi", author_id: "42", created_at: "2026-01-01T00:00:00.000Z" };

describe("runShow", () => {
  test("fetches a post by bare id", async () => {
    let capturedId: string | undefined;
    const transport = fakeTransport({
      getTweet: async (id) => {
        capturedId = id;
        return post;
      },
    });

    const result = await runShow(["1"], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
    });

    expect(result.data).toEqual(post);
    expect(capturedId).toBe("1");
  });

  test("extracts the id from a status URL", async () => {
    let capturedId: string | undefined;
    const transport = fakeTransport({
      getTweet: async (id) => {
        capturedId = id;
        return post;
      },
    });

    await runShow(["https://x.com/user/status/1"], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
    });

    expect(capturedId).toBe("1");
  });

  test("throws USAGE_ERROR when the id-or-url argument is missing", async () => {
    await expect(
      runShow([], { resolveAuth: () => fakeAuth, transportFactory: () => fakeTransport({}) }),
    ).rejects.toThrow(FinchError);
  });

  test("propagates CLIENT_ERROR when the post isn't found", async () => {
    const transport = fakeTransport({
      getTweet: async () => {
        throw new FinchError("CLIENT_ERROR", "Post 999 not found");
      },
    });

    await expect(
      runShow(["999"], { resolveAuth: () => fakeAuth, transportFactory: () => transport }),
    ).rejects.toThrow(FinchError);
  });
});
