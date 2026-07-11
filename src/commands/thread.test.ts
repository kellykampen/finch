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

  test("throws USAGE_ERROR when both positional args and --file are given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-thread-test-"));
    try {
      const path = join(dir, "thread.txt");
      writeFileSync(path, "from file\n");
      await expect(
        runThread(["positional text", "--file", path], { getTransport: () => fakeTransport({}) }),
      ).rejects.toThrow(FinchError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
      wouldSend: [
        { text: "first", media: [], alt: [] },
        { text: "second", media: [], alt: [] },
      ],
    });
  });

  test("throws USAGE_ERROR when no posts are given", async () => {
    await expect(runThread([], { getTransport: () => fakeTransport({}) })).rejects.toThrow(FinchError);
  });

  test("--number prefixes each post with 1-indexed i/n", async () => {
    const sent: string[] = [];
    const transport = fakeTransport({
      createTweet: async (text) => {
        sent.push(text);
        return { id: String(sent.length), text };
      },
    });

    const result = await runThread(["--number", "first", "second"], { getTransport: () => transport });

    expect(result.data).toEqual({ ids: ["1", "2"], count: 2 });
    expect(sent).toEqual(["1/2 first", "2/2 second"]);
  });

  test("--number works for three or more posts", async () => {
    const sent: string[] = [];
    const transport = fakeTransport({
      createTweet: async (text) => {
        sent.push(text);
        return { id: String(sent.length), text };
      },
    });

    await runThread(["--number", "a", "b", "c"], { getTransport: () => transport });

    expect(sent).toEqual(["1/3 a", "2/3 b", "3/3 c"]);
  });

  test("numbering is off by default", async () => {
    const sent: string[] = [];
    const transport = fakeTransport({
      createTweet: async (text) => {
        sent.push(text);
        return { id: String(sent.length), text };
      },
    });

    await runThread(["first", "second"], { getTransport: () => transport });

    expect(sent).toEqual(["first", "second"]);
  });

  test("--dry-run reflects numbered text", async () => {
    const result = await runThread(["--number", "--dry-run", "first", "second"], {
      getTransport: () => {
        throw new Error("should not be called");
      },
    });

    expect(result.data).toEqual({
      dryRun: true,
      wouldSend: [
        { text: "1/2 first", media: [], alt: [] },
        { text: "2/2 second", media: [], alt: [] },
      ],
    });
  });

  test("numbering that pushes a near-limit post over the limit throws a USAGE_ERROR", async () => {
    const atLimit = "x".repeat(280);
    const transport = fakeTransport({
      createTweet: async () => {
        throw new Error("should not be called");
      },
    });

    await expect(runThread(["--number", atLimit, "second"], { getTransport: () => transport })).rejects.toThrow(
      FinchError,
    );

    try {
      await runThread(["--number", atLimit, "second"], { getTransport: () => transport });
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      const finchErr = err as FinchError;
      expect(finchErr.code).toBe("USAGE_ERROR");
      expect(finchErr.message).toContain("exceeds 280 characters");
    }
  });

  test("--continue with a bare id starts the thread as a reply to that id", async () => {
    const replyToIds: Array<string | undefined> = [];
    let counter = 0;
    const transport = fakeTransport({
      createTweet: async (text, replyToId) => {
        replyToIds.push(replyToId);
        counter += 1;
        return { id: String(counter), text };
      },
    });

    const result = await runThread(["--continue", "12345", "first", "second"], {
      getTransport: () => transport,
    });

    expect(result.data).toEqual({ ids: ["1", "2"], count: 2 });
    expect(replyToIds).toEqual(["12345", "1"]);
  });

  test("--continue with a URL resolves the id and starts the thread as a reply to it", async () => {
    const replyToIds: Array<string | undefined> = [];
    let counter = 0;
    const transport = fakeTransport({
      createTweet: async (text, replyToId) => {
        replyToIds.push(replyToId);
        counter += 1;
        return { id: String(counter), text };
      },
    });

    const result = await runThread(["--continue", "https://x.com/someone/status/67890", "first", "second", "third"], {
      getTransport: () => transport,
    });

    expect(result.data).toEqual({ ids: ["1", "2", "3"], count: 3 });
    expect(replyToIds).toEqual(["67890", "1", "2"]);
  });

  test("--dry-run with --continue notes the continuation target without calling transport", async () => {
    const result = await runThread(["--continue", "11111", "first", "second", "--dry-run"], {
      getTransport: () => {
        throw new Error("should not be called");
      },
    });

    expect(result.data).toEqual({
      dryRun: true,
      wouldSend: [
        { text: "first", media: [], alt: [] },
        { text: "second", media: [], alt: [] },
      ],
    });
    expect(result.human).toContain("continuing from 11111");
  });

  test("invalid --continue value throws USAGE_ERROR", async () => {
    try {
      await runThread(["--continue", "not-a-url", "first"], { getTransport: () => fakeTransport({}) });
      throw new Error("expected runThread to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      const finchErr = err as FinchError;
      expect(finchErr.code).toBe("USAGE_ERROR");
    }
  });

  test("--media <n>:<path> attaches media to a single tweet in a multi-tweet thread", async () => {
    const createTweetCalls: Array<{ text: string; replyToId?: string; mediaIds?: string[] }> = [];
    const transport = fakeTransport({
      uploadImage: async (path) => ({ media_id: `id-for-${path}` }),
      createTweet: async (text, replyToId, mediaIds) => {
        createTweetCalls.push({ text, replyToId, mediaIds });
        return { id: String(createTweetCalls.length), text };
      },
    });

    const result = await runThread(["first", "second", "--media", "1:pic.png"], { getTransport: () => transport });

    expect(result.data).toEqual({ ids: ["1", "2"], count: 2 });
    expect(createTweetCalls).toEqual([
      { text: "first", replyToId: undefined, mediaIds: undefined },
      { text: "second", replyToId: "1", mediaIds: ["id-for-pic.png"] },
    ]);
  });

  test("--media can attach media to multiple different tweets in a thread", async () => {
    const createTweetCalls: Array<{ text: string; replyToId?: string; mediaIds?: string[] }> = [];
    const transport = fakeTransport({
      uploadImage: async (path) => ({ media_id: `id-for-${path}` }),
      createTweet: async (text, replyToId, mediaIds) => {
        createTweetCalls.push({ text, replyToId, mediaIds });
        return { id: String(createTweetCalls.length), text };
      },
    });

    const result = await runThread(["one", "two", "three", "--media", "0:a.png", "--media", "2:b.png"], {
      getTransport: () => transport,
    });

    expect(result.data).toEqual({ ids: ["1", "2", "3"], count: 3 });
    expect(createTweetCalls).toEqual([
      { text: "one", replyToId: undefined, mediaIds: ["id-for-a.png"] },
      { text: "two", replyToId: "1", mediaIds: undefined },
      { text: "three", replyToId: "2", mediaIds: ["id-for-b.png"] },
    ]);
  });

  test("--alt <n>:<text> attaches alt text to the preceding --media at the same index", async () => {
    const calls: string[] = [];
    let tweetCounter = 0;
    const transport = fakeTransport({
      uploadImage: async (path) => {
        calls.push(`upload:${path}`);
        return { media_id: `id-for-${path}` };
      },
      setMediaAltText: async (mediaId, altText) => {
        calls.push(`alt:${mediaId}:${altText}`);
      },
      createTweet: async (text, _replyToId, mediaIds) => {
        tweetCounter += 1;
        calls.push(`tweet:${text}:${mediaIds?.join(",") ?? ""}`);
        return { id: String(tweetCounter), text };
      },
    });

    const result = await runThread(
      ["first", "second", "--media", "1:a.png", "--alt", "1:A alt", "--media", "1:b.png", "--alt", "1:B alt"],
      { getTransport: () => transport },
    );

    expect(result.data).toEqual({ ids: ["1", "2"], count: 2 });
    expect(calls).toEqual([
      "tweet:first:",
      "upload:a.png",
      "upload:b.png",
      "alt:id-for-a.png:A alt",
      "alt:id-for-b.png:B alt",
      "tweet:second:id-for-a.png,id-for-b.png",
    ]);
  });

  test("media index out of range throws a USAGE_ERROR", async () => {
    await expect(
      runThread(["first", "second", "--media", "2:pic.png"], { getTransport: () => fakeTransport({}) }),
    ).rejects.toThrow(FinchError);
    try {
      await runThread(["first", "second", "--media", "2:pic.png"], { getTransport: () => fakeTransport({}) });
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      const finchErr = err as FinchError;
      expect(finchErr.code).toBe("USAGE_ERROR");
      expect(finchErr.message).toContain("out of range");
    }
  });

  test("malformed --media value without colon throws a USAGE_ERROR", async () => {
    await expect(
      runThread(["first", "--media", "0pic.png"], { getTransport: () => fakeTransport({}) }),
    ).rejects.toThrow(FinchError);
    try {
      await runThread(["first", "--media", "0pic.png"], { getTransport: () => fakeTransport({}) });
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      const finchErr = err as FinchError;
      expect(finchErr.code).toBe("USAGE_ERROR");
      expect(finchErr.message).toContain("Invalid --media value");
    }
  });

  test("thread with no --media flags behaves exactly as before", async () => {
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

  test("--dry-run shows per-tweet media and alt text", async () => {
    const result = await runThread(["first", "second", "--media", "1:pic.png", "--alt", "1:my alt", "--dry-run"], {
      getTransport: () => {
        throw new Error("should not be called");
      },
    });

    expect(result.data).toEqual({
      dryRun: true,
      wouldSend: [
        { text: "first", media: [], alt: [] },
        { text: "second", media: ["pic.png"], alt: ["my alt"] },
      ],
    });
  });

  test("per-tweet media rules are enforced per index", async () => {
    await expect(
      runThread(["first", "second", "--media", "0:a.png", "--media", "0:b.mp4"], {
        getTransport: () => fakeTransport({}),
      }),
    ).rejects.toThrow(FinchError);
    try {
      await runThread(["first", "second", "--media", "0:a.png", "--media", "0:b.mp4"], {
        getTransport: () => fakeTransport({}),
      });
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      const finchErr = err as FinchError;
      expect(finchErr.code).toBe("USAGE_ERROR");
      expect(finchErr.message).toContain("Cannot mix images with GIF/video media");
    }
  });

  test("--help prints usage and does not call the transport", async () => {
    let called = false;
    let getTransportCalled = false;
    const transport = fakeTransport({
      createTweet: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });

    const result = await runThread(["--help"], {
      getTransport: () => {
        getTransportCalled = true;
        return transport;
      },
    });

    expect(result.data).toEqual({ help: true, text: expect.stringContaining("Usage: finch thread") });
    expect(result.human).toContain("Usage: finch thread");
    expect(called).toBe(false);
    expect(getTransportCalled).toBe(false);
  });

  test("-h prints usage and does not call the transport", async () => {
    let getTransportCalled = false;

    const result = await runThread(["-h"], {
      getTransport: () => {
        getTransportCalled = true;
        return fakeTransport({});
      },
    });

    expect(result.data).toEqual({ help: true, text: expect.stringContaining("Usage: finch thread") });
    expect(getTransportCalled).toBe(false);
  });

  test("unknown flag before the -- terminator is rejected instead of being posted as thread text", async () => {
    let called = false;
    const transport = fakeTransport({
      createTweet: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });

    await expect(runThread(["first", "--not-a-flag", "second"], { getTransport: () => transport })).rejects.toThrow(
      FinchError,
    );
    expect(called).toBe(false);
  });

  test("a bare positional starting with - is rejected as an unknown flag, not posted as text", async () => {
    let called = false;
    const transport = fakeTransport({
      createTweet: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });

    try {
      await runThread(["-1 isn't a bad take"], { getTransport: () => transport });
      throw new Error("expected runThread to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      const finchErr = err as FinchError;
      expect(finchErr.code).toBe("USAGE_ERROR");
    }
    expect(called).toBe(false);
  });

  test("--flag-shaped text is literal content when placed after the -- terminator", async () => {
    const texts: string[] = [];
    let counter = 0;
    const transport = fakeTransport({
      createTweet: async (text) => {
        counter += 1;
        texts.push(text);
        return { id: String(counter), text };
      },
    });

    const result = await runThread(["--", "-1 isn't a bad take", "--also literal"], {
      getTransport: () => transport,
    });

    expect(result.data).toEqual({ ids: ["1", "2"], count: 2 });
    expect(texts).toEqual(["-1 isn't a bad take", "--also literal"]);
  });

  test("--help after the -- terminator is treated as literal thread content, not the help flag", async () => {
    const transport = fakeTransport({
      createTweet: async (text) => ({ id: "1", text }),
    });

    const result = await runThread(["--", "--help"], { getTransport: () => transport });

    expect(result.data).toEqual({ ids: ["1"], count: 1 });
  });

  test("literal content beginning with - is preserved when read from --file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-thread-test-"));
    try {
      const path = join(dir, "thread.txt");
      writeFileSync(path, "-1 isn't a bad take\n\n--also literal\n");
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
      expect(texts).toEqual(["-1 isn't a bad take", "--also literal"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
