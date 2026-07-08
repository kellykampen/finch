import { describe, test, expect } from "bun:test";
import { runLike } from "./like";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

describe("runLike", () => {
  test("likes a bare id", async () => {
    let capturedArgs: [string, string] | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
      like: async (userId, tweetId) => {
        capturedArgs = [userId, tweetId];
        return { liked: true };
      },
    });

    const result = await runLike(["999"], { getTransport: () => transport });

    expect(result.data).toEqual({ liked: true, tweet_id: "999" });
    expect(capturedArgs).toEqual(["1", "999"]);
  });

  test("extracts the id from a status URL", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
      like: async () => ({ liked: true }),
    });

    const result = await runLike(["https://x.com/user/status/999"], { getTransport: () => transport });

    expect(result.data).toEqual({ liked: true, tweet_id: "999" });
  });

  test("--dry-run reports wouldSend without calling the transport", async () => {
    const result = await runLike(["999", "--dry-run"], {
      getTransport: () => {
        throw new Error("should not be called");
      },
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { tweet_id: "999" } });
  });

  test("--dry-run doesn't require auth to be configured", async () => {
    const result = await runLike(["999", "--dry-run"], {
      getTransport: () => {
        throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
      },
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { tweet_id: "999" } });
  });

  test("throws USAGE_ERROR when the id-or-url argument is missing", async () => {
    await expect(runLike([], { getTransport: () => fakeTransport({}) })).rejects.toThrow(FinchError);
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    await expect(
      runLike(["999"], {
        getTransport: () => {
          throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
        },
      }),
    ).rejects.toThrow(FinchError);
  });
});
