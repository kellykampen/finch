import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPost } from "./post";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

const fakeAuth = { apiKey: "k", apiKeySecret: "ks", accessToken: "t", accessTokenSecret: "ts" };

describe("runPost", () => {
  test("posts the positional text arg", async () => {
    const transport = fakeTransport({
      createTweet: async (text) => ({ id: "1", text }),
    });

    const result = await runPost(["hello world"], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
    });

    expect(result.data).toEqual({ id: "1", text: "hello world" });
  });

  test("reads text from --file when no positional arg is given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-post-test-"));
    try {
      const path = join(dir, "post.txt");
      writeFileSync(path, "from a file\n");
      const transport = fakeTransport({
        createTweet: async (text) => ({ id: "1", text }),
      });

      const result = await runPost(["--file", path], {
        resolveAuth: () => fakeAuth,
        transportFactory: () => transport,
      });

      expect(result.data).toEqual({ id: "1", text: "from a file" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reads text from stdin when no arg or --file is given", async () => {
    const transport = fakeTransport({
      createTweet: async (text) => ({ id: "1", text }),
    });

    const result = await runPost([], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
      readStdin: async () => "from stdin\n",
    });

    expect(result.data).toEqual({ id: "1", text: "from stdin" });
  });

  test("--dry-run reports wouldSend without calling the transport", async () => {
    let called = false;
    const transport = fakeTransport({
      createTweet: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });

    const result = await runPost(["hello", "--dry-run"], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { text: "hello" } });
    expect(called).toBe(false);
  });

  test("--dry-run doesn't require auth to be configured", async () => {
    const result = await runPost(["hello", "--dry-run"], {
      resolveAuth: () => null,
      transportFactory: () => {
        throw new Error("should not be called");
      },
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { text: "hello" } });
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    await expect(
      runPost(["hello"], {
        resolveAuth: () => null,
        transportFactory: () => {
          throw new Error("should not be called");
        },
      }),
    ).rejects.toThrow(FinchError);
  });

  test("rejects text containing disallowed control characters", async () => {
    await expect(
      runPost(["hello\x1Bworld"], {
        resolveAuth: () => fakeAuth,
        transportFactory: () => fakeTransport({}),
      }),
    ).rejects.toThrow(FinchError);
  });

  test("trims whitespace from a positional text arg, like --file/stdin", async () => {
    const transport = fakeTransport({
      createTweet: async (text) => ({ id: "1", text }),
    });

    const result = await runPost(["  hello world  "], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
    });

    expect(result.data).toEqual({ id: "1", text: "hello world" });
  });

  test("rejects a whitespace-only positional arg instead of posting blank text", async () => {
    await expect(
      runPost(["   "], {
        resolveAuth: () => fakeAuth,
        transportFactory: () => fakeTransport({}),
      }),
    ).rejects.toThrow(FinchError);
  });
});
