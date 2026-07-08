import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPost } from "./post";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

describe("runPost", () => {
  test("posts the positional text arg", async () => {
    const transport = fakeTransport({
      createTweet: async (text) => ({ id: "1", text }),
    });

    const result = await runPost(["hello world"], { getTransport: () => transport });

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

      const result = await runPost(["--file", path], { getTransport: () => transport });

      expect(result.data).toEqual({ id: "1", text: "from a file" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reads text from stdin when no arg or --file is given", async () => {
    const transport = fakeTransport({
      createTweet: async (text) => ({ id: "1", text }),
    });

    const result = await runPost([], { getTransport: () => transport, readStdin: async () => "from stdin\n" });

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

    const result = await runPost(["hello", "--dry-run"], { getTransport: () => transport });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { text: "hello" } });
    expect(called).toBe(false);
  });

  test("--dry-run doesn't require auth to be configured", async () => {
    const result = await runPost(["hello", "--dry-run"], {
      getTransport: () => {
        throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
      },
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { text: "hello" } });
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    await expect(
      runPost(["hello"], {
        getTransport: () => {
          throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
        },
      }),
    ).rejects.toThrow(FinchError);
  });

  test("rejects text containing disallowed control characters", async () => {
    await expect(runPost(["hello\x1Bworld"], { getTransport: () => fakeTransport({}) })).rejects.toThrow(FinchError);
  });

  test("trims whitespace from a positional text arg, like --file/stdin", async () => {
    const transport = fakeTransport({
      createTweet: async (text) => ({ id: "1", text }),
    });

    const result = await runPost(["  hello world  "], { getTransport: () => transport });

    expect(result.data).toEqual({ id: "1", text: "hello world" });
  });

  test("rejects a whitespace-only positional arg instead of posting blank text", async () => {
    await expect(runPost(["   "], { getTransport: () => fakeTransport({}) })).rejects.toThrow(FinchError);
  });

  test("--help prints usage and does not call the transport", async () => {
    let called = false;
    const transport = fakeTransport({
      createTweet: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });

    const result = await runPost(["--help"], { getTransport: () => transport });

    expect(result.data).toEqual({ help: true, text: expect.stringContaining("Usage: finch post") });
    expect(result.human).toContain("Usage: finch post");
    expect(called).toBe(false);
  });

  test("-h prints usage and does not call the transport", async () => {
    let called = false;
    const transport = fakeTransport({
      createTweet: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });

    const result = await runPost(["-h"], { getTransport: () => transport });

    expect(result.data).toEqual({ help: true, text: expect.stringContaining("Usage: finch post") });
    expect(called).toBe(false);
  });

  test("unknown flag is rejected instead of being posted as content", async () => {
    let called = false;
    const transport = fakeTransport({
      createTweet: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });

    await expect(runPost(["--not-a-flag"], { getTransport: () => transport })).rejects.toThrow(FinchError);
    expect(called).toBe(false);
  });

  test("--flag-shaped text is literal content when placed after the -- terminator", async () => {
    const transport = fakeTransport({
      createTweet: async (text) => ({ id: "1", text }),
    });

    const result = await runPost(["--", "-1 isn't a bad take"], { getTransport: () => transport });

    expect(result.data).toEqual({ id: "1", text: "-1 isn't a bad take" });
  });

  test("--help after the -- terminator is treated as literal content", async () => {
    const transport = fakeTransport({
      createTweet: async (text) => ({ id: "1", text }),
    });

    const result = await runPost(["--", "--help"], { getTransport: () => transport });

    expect(result.data).toEqual({ id: "1", text: "--help" });
  });
});
