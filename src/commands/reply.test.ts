import { describe, test, expect } from "bun:test";
import { runReply } from "./reply";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

const fakeAuth = { apiKey: "k", apiKeySecret: "ks", accessToken: "t", accessTokenSecret: "ts" };

describe("runReply", () => {
  test("replies to a bare id", async () => {
    let capturedReplyToId: string | undefined;
    const transport = fakeTransport({
      createTweet: async (text, replyToId) => {
        capturedReplyToId = replyToId;
        return { id: "2", text };
      },
    });

    const result = await runReply(["1", "a reply"], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
    });

    expect(result.data).toEqual({ id: "2", text: "a reply", in_reply_to: "1" });
    expect(capturedReplyToId).toBe("1");
  });

  test("extracts the id from a status URL", async () => {
    const transport = fakeTransport({
      createTweet: async (text) => ({ id: "2", text }),
    });

    const result = await runReply(["https://x.com/user/status/1", "a reply"], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
    });

    expect(result.data).toEqual({ id: "2", text: "a reply", in_reply_to: "1" });
  });

  test("--dry-run reports wouldSend without calling the transport", async () => {
    const result = await runReply(["1", "a reply", "--dry-run"], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => {
        throw new Error("should not be called");
      },
    });

    expect(result.data).toEqual({
      dryRun: true,
      wouldSend: { text: "a reply", reply: { in_reply_to_tweet_id: "1" } },
    });
  });

  test("throws USAGE_ERROR when text is missing", async () => {
    await expect(
      runReply(["1"], { resolveAuth: () => fakeAuth, transportFactory: () => fakeTransport({}) }),
    ).rejects.toThrow(FinchError);
  });

  test("throws USAGE_ERROR when the id-or-url argument is missing", async () => {
    await expect(
      runReply([], { resolveAuth: () => fakeAuth, transportFactory: () => fakeTransport({}) }),
    ).rejects.toThrow(FinchError);
  });
});
