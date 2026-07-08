import { describe, test, expect } from "bun:test";
import { runFollow } from "./follow";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

describe("runFollow", () => {
  test("resolves the username to a user id before following", async () => {
    let capturedUsername: string | undefined;
    let capturedFollowArgs: [string, string] | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
      getUserByUsername: async (username) => {
        capturedUsername = username;
        return { id: "42", username, name: "Target", description: "", public_metrics: {} };
      },
      follow: async (userId, targetUserId) => {
        capturedFollowArgs = [userId, targetUserId];
        return { following: true };
      },
    });

    const result = await runFollow(["someuser"], { getTransport: () => transport });

    expect(result.data).toEqual({ following: true, username: "someuser" });
    expect(capturedUsername).toBe("someuser");
    expect(capturedFollowArgs).toEqual(["1", "42"]);
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
      follow: async () => ({ following: true }),
    });

    const result = await runFollow(["@someuser"], { getTransport: () => transport });

    expect(result.data).toEqual({ following: true, username: "someuser" });
  });

  test("--dry-run reports wouldSend without calling the transport", async () => {
    const result = await runFollow(["someuser", "--dry-run"], {
      getTransport: () => {
        throw new Error("should not be called");
      },
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { username: "someuser" } });
  });

  test("--dry-run doesn't require auth to be configured", async () => {
    const result = await runFollow(["someuser", "--dry-run"], {
      getTransport: () => {
        throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
      },
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { username: "someuser" } });
  });

  test("throws USAGE_ERROR when the username argument is missing", async () => {
    await expect(runFollow([], { getTransport: () => fakeTransport({}) })).rejects.toThrow(FinchError);
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    await expect(
      runFollow(["someuser"], {
        getTransport: () => {
          throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
        },
      }),
    ).rejects.toThrow(FinchError);
  });
});
