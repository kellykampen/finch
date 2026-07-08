import { describe, test, expect } from "bun:test";
import { runUnrepost } from "./unrepost";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

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

    const result = await runUnrepost(["999"], { getTransport: () => transport });

    expect(result.data).toEqual({ reposted: false, tweet_id: "999" });
    expect(capturedArgs).toEqual(["1", "999"]);
  });

  test("extracts the id from a status URL", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
      unretweet: async () => ({ reposted: false }),
    });

    const result = await runUnrepost(["https://x.com/user/status/999"], { getTransport: () => transport });

    expect(result.data).toEqual({ reposted: false, tweet_id: "999" });
  });

  test("--dry-run reports wouldSend without calling the transport", async () => {
    const result = await runUnrepost(["999", "--dry-run"], {
      getTransport: () => {
        throw new Error("should not be called");
      },
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { tweet_id: "999" } });
  });

  test("throws USAGE_ERROR when the id-or-url argument is missing", async () => {
    await expect(runUnrepost([], { getTransport: () => fakeTransport({}) })).rejects.toThrow(FinchError);
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    await expect(
      runUnrepost(["999"], {
        getTransport: () => {
          throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
        },
      }),
    ).rejects.toThrow(FinchError);
  });
});
