import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runThread } from "./thread";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

describe("runThread", () => {
  test("chains each post as a reply to the previous one", async () => {
    const replyToIds: Array<string | undefined> = [];
    let counter = 0;
    const transport = fakeTransport({
      createTweet: async (text, replyToId) => {
        replyToIds.push(replyToId);
        counter += 1;
        return { id: String(counter), text };
      },
    });

    const result = await runThread(["first", "second", "third"], { getTransport: () => transport });

    expect(result.data).toEqual({ ids: ["1", "2", "3"], count: 3 });
    expect(replyToIds).toEqual([undefined, "1", "2"]);
  });

  test("reads posts split on blank lines from --file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-thread-test-"));
    try {
      const path = join(dir, "thread.txt");
      writeFileSync(path, "first\nsecond\n\nthird\n");
      let counter = 0;
      const transport = fakeTransport({
        createTweet: async (text) => {
          counter += 1;
          return { id: String(counter), text };
        },
      });

      const result = await runThread(["--file", path], { getTransport: () => transport });

      expect(result.data).toEqual({ ids: ["1", "2"], count: 2 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("preserves multi-line paragraphs from --file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-thread-test-"));
    try {
      const path = join(dir, "thread.txt");
      writeFileSync(path, "line one\nline two\n\nparagraph two\n");
      const texts: string[] = [];
      let counter = 0;
      const transport = fakeTransport({
        createTweet: async (text) => {
          counter += 1;
          texts.push(text);
          return { id: String(counter), text };
        },
      });

      const result = await runThread(["--file", path], { getTransport: () => transport });

      expect(result.data).toEqual({ ids: ["1", "2"], count: 2 });
      expect(texts).toEqual(["line one\nline two", "paragraph two"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("collapses multiple blank lines between paragraphs from --file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-thread-test-"));
    try {
      const path = join(dir, "thread.txt");
      writeFileSync(path, "\n\nfirst\n\n\n\nsecond\n\n");
      const texts: string[] = [];
      let counter = 0;
      const transport = fakeTransport({
        createTweet: async (text) => {
          counter += 1;
          texts.push(text);
          return { id: String(counter), text };
        },
      });

      const result = await runThread(["--file", path], { getTransport: () => transport });

      expect(result.data).toEqual({ ids: ["1", "2"], count: 2 });
      expect(texts).toEqual(["first", "second"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("splits on --delimiter when provided with --file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-thread-test-"));
    try {
      const path = join(dir, "thread.txt");
      writeFileSync(path, "one<!--SPLIT-->two<!--SPLIT-->three");
      const texts: string[] = [];
      let counter = 0;
      const transport = fakeTransport({
        createTweet: async (text) => {
          counter += 1;
          texts.push(text);
          return { id: String(counter), text };
        },
      });

      const result = await runThread(["--file", path, "--delimiter", "<!--SPLIT-->"], {
        getTransport: () => transport,
      });

      expect(result.data).toEqual({ ids: ["1", "2", "3"], count: 3 });
      expect(texts).toEqual(["one", "two", "three"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws USAGE_ERROR when --delimiter is given without --file", async () => {
    await expect(runThread(["--delimiter", "<!--SPLIT-->"], { getTransport: () => fakeTransport({}) })).rejects.toThrow(
      FinchError,
    );
  });

  test("on partial failure, throws with what succeeded plus the failure in detail", async () => {
    let calls = 0;
    const transport = fakeTransport({
      createTweet: async (text) => {
        calls += 1;
        if (calls === 2) {
          throw new FinchError("RATE_LIMITED", "Rate limited", { resetAt: "later" });
        }
        return { id: String(calls), text };
      },
    });

    try {
      await runThread(["first", "second", "third"], { getTransport: () => transport });
      throw new Error("expected runThread to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      const finchErr = err as FinchError;
      expect(finchErr.code).toBe("RATE_LIMITED");
      expect(finchErr.detail).toEqual({ ids: ["1"], count: 1, failure: { resetAt: "later" } });
    }
    expect(calls).toBe(2);
  });

  test("--dry-run reports wouldSend for every post without calling the transport", async () => {
    const result = await runThread(["first", "second", "--dry-run"], {
      getTransport: () => {
        throw new Error("should not be called");
      },
    });

    expect(result.data).toEqual({
      dryRun: true,
      wouldSend: [{ text: "first" }, { text: "second" }],
    });
  });

  test("throws USAGE_ERROR when no posts are given", async () => {
    await expect(runThread([], { getTransport: () => fakeTransport({}) })).rejects.toThrow(FinchError);
  });

  test("throws USAGE_ERROR when both positional args and --file are given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-thread-test-"));
    try {
      const path = join(dir, "thread.txt");
      writeFileSync(path, "from file\n");

      await expect(runThread(["from arg", "--file", path], { getTransport: () => fakeTransport({}) })).rejects.toThrow(
        FinchError,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
