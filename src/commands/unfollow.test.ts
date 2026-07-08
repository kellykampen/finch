import { describe, test, expect } from "bun:test";
import { runUnfollow } from "./unfollow";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

describe("runUnfollow", () => {
  test("resolves the username to a user id before unfollowing", async () => {
    let capturedUsername: string | undefined;
    let capturedUnfollowArgs: [string, string] | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
      getUserByUsername: async (username) => {
        capturedUsername = username;
        return { id: "42", username, name: "Target", description: "", public_metrics: {} };
      },
      unfollow: async (userId, targetUserId) => {
        capturedUnfollowArgs = [userId, targetUserId];
        return { following: false };
      },
    });

    const result = await runUnfollow(["someuser"], { getTransport: () => transport });

    expect(result.data).toEqual({ following: false, username: "someuser" });
    expect(capturedUsername).toBe("someuser");
    expect(capturedUnfollowArgs).toEqual(["1", "42"]);
  });

  test("strips a leading '@' from the username", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
      getUserByUsername: async (username) => ({
        id: "42",
        username,
        name: "Target",
        description: "",
        public_metrics: {},
      }),
      unfollow: async () => ({ following: false }),
    });

    const result = await runUnfollow(["@someuser"], { getTransport: () => transport });

    expect(result.data).toEqual({ following: false, username: "someuser" });
  });

  test("--dry-run reports wouldSend without calling the transport", async () => {
    const result = await runUnfollow(["someuser", "--dry-run"], {
      getTransport: () => {
        throw new Error("should not be called");
      },
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { username: "someuser" } });
  });

  test("throws USAGE_ERROR when the username argument is missing", async () => {
    await expect(runUnfollow([], { getTransport: () => fakeTransport({}) })).rejects.toThrow(FinchError);
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    await expect(
      runUnfollow(["someuser"], {
        getTransport: () => {
          throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
        },
      }),
    ).rejects.toThrow(FinchError);
  });
});
