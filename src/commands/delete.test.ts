import { describe, test, expect } from "bun:test";
import { runDelete } from "./delete";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

describe("runDelete", () => {
  test("deletes a bare id", async () => {
    let capturedId: string | undefined;
    const transport = fakeTransport({
      deleteTweet: async (id) => {
        capturedId = id;
        return { deleted: true };
      },
    });

    const result = await runDelete(["999"], { getTransport: () => transport });

    expect(result.data).toEqual({ deleted: true, tweet_id: "999" });
    expect(capturedId).toEqual("999");
  });

  test("extracts the id from a status URL", async () => {
    const transport = fakeTransport({
      deleteTweet: async () => ({ deleted: true }),
    });

    const result = await runDelete(["https://x.com/user/status/999"], { getTransport: () => transport });

    expect(result.data).toEqual({ deleted: true, tweet_id: "999" });
  });

  test("--dry-run reports wouldSend without calling the transport", async () => {
    const result = await runDelete(["999", "--dry-run"], {
      getTransport: () => {
        throw new Error("should not be called");
      },
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { tweet_id: "999" } });
  });

  test("throws USAGE_ERROR when the id-or-url argument is missing", async () => {
    await expect(runDelete([], { getTransport: () => fakeTransport({}) })).rejects.toThrow(FinchError);
  });

  test("propagates a delete failure from the transport", async () => {
    const transport = fakeTransport({
      deleteTweet: async () => {
        throw new FinchError("CLIENT_ERROR", "X API did not confirm the delete", null);
      },
    });

    await expect(runDelete(["999"], { getTransport: () => transport })).rejects.toThrow(FinchError);
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    await expect(
      runDelete(["999"], {
        getTransport: () => {
          throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
        },
      }),
    ).rejects.toThrow(FinchError);
  });
});
