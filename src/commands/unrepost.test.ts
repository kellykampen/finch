import { describe, test, expect } from "bun:test";
import { runUnrepost } from "./unrepost";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

const fakeAuth = { apiKey: "k", apiKeySecret: "ks", accessToken: "t", accessTokenSecret: "ts" };

describe("runUnrepost", () => {
  test("unreposts a bare id", async () => {
    let capturedArgs: [string, string] | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
      unretweet: async (userId, tweetId) => {
        capturedArgs = [userId, tweetId];
        return { reposted: false };
      },
    });

    const result = await runUnrepost(["999"], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
    });

    expect(result.data).toEqual({ reposted: false, tweet_id: "999" });
    expect(capturedArgs).toEqual(["1", "999"]);
  });

  test("extracts the id from a status URL", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
      unretweet: async () => ({ reposted: false }),
    });

    const result = await runUnrepost(["https://x.com/user/status/999"], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
    });

    expect(result.data).toEqual({ reposted: false, tweet_id: "999" });
  });

  test("--dry-run reports wouldSend without calling the transport", async () => {
    const result = await runUnrepost(["999", "--dry-run"], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => {
        throw new Error("should not be called");
      },
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { tweet_id: "999" } });
  });

  test("throws USAGE_ERROR when the id-or-url argument is missing", async () => {
    await expect(
      runUnrepost([], { resolveAuth: () => fakeAuth, transportFactory: () => fakeTransport({}) }),
    ).rejects.toThrow(FinchError);
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    await expect(
      runUnrepost(["999"], {
        resolveAuth: () => null,
        transportFactory: () => {
          throw new Error("should not be called");
        },
      }),
    ).rejects.toThrow(FinchError);
  });
});
