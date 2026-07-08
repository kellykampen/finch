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

    expect(result.data).toEqual({ dryRun: true, wouldSend: { text: "hello", media: [] } });
    expect(called).toBe(false);
  });

  test("--dry-run doesn't require auth to be configured", async () => {
    const result = await runPost(["hello", "--dry-run"], {
      getTransport: () => {
        throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
      },
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { text: "hello", media: [] } });
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
    let getTransportCalled = false;
    const transport = fakeTransport({
      createTweet: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });

    const result = await runPost(["--help"], {
      getTransport: () => {
        getTransportCalled = true;
        return transport;
      },
    });

    expect(result.data).toEqual({ help: true, text: expect.stringContaining("Usage: finch post") });
    expect(result.human).toContain("Usage: finch post");
    expect(called).toBe(false);
    expect(getTransportCalled).toBe(false);
  });

  test("-h prints usage and does not call the transport", async () => {
    let called = false;
    let getTransportCalled = false;
    const transport = fakeTransport({
      createTweet: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });

    const result = await runPost(["-h"], {
      getTransport: () => {
        getTransportCalled = true;
        return transport;
      },
    });

    expect(result.data).toEqual({ help: true, text: expect.stringContaining("Usage: finch post") });
    expect(called).toBe(false);
    expect(getTransportCalled).toBe(false);
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

  test("--media <path> uploads the image and attaches it to the post", async () => {
    const uploadedPaths: string[] = [];
    let createdWith: { text?: string; mediaIds?: string[] } = {};
    const transport = fakeTransport({
      uploadImage: async (path) => {
        uploadedPaths.push(path);
        return { media_id: `id-for-${path}` };
      },
      createTweet: async (text, _replyToId, mediaIds) => {
        createdWith = { text, mediaIds };
        return { id: "1", text };
      },
    });

    const result = await runPost(["hello", "--media", "pic.png"], { getTransport: () => transport });

    expect(result.data).toEqual({ id: "1", text: "hello" });
    expect(uploadedPaths).toEqual(["pic.png"]);
    expect(createdWith).toEqual({ text: "hello", mediaIds: ["id-for-pic.png"] });
  });

  test("--media is repeatable to attach up to 4 images", async () => {
    let createdWith: { text?: string; mediaIds?: string[] } = {};
    const transport = fakeTransport({
      uploadImage: async (path) => ({ media_id: `id-for-${path}` }),
      createTweet: async (text, _replyToId, mediaIds) => {
        createdWith = { text, mediaIds };
        return { id: "1", text };
      },
    });

    const result = await runPost(["hello", "--media", "a.png", "--media", "b.png", "--media", "c.png,d.png"], {
      getTransport: () => transport,
    });

    expect(result.data).toEqual({ id: "1", text: "hello" });
    expect(createdWith.mediaIds).toEqual(["id-for-a.png", "id-for-b.png", "id-for-c.png", "id-for-d.png"]);
  });

  test("more than 4 images are rejected with a USAGE_ERROR", async () => {
    const transport = fakeTransport({
      uploadImage: async () => ({ media_id: "x" }),
      createTweet: async () => ({ id: "1", text: "nope" }),
    });

    await expect(
      runPost(["hello", "--media", "a.png,b.png,c.png,d.png,e.png"], { getTransport: () => transport }),
    ).rejects.toThrow(FinchError);
    try {
      await runPost(["hello", "--media", "a.png,b.png,c.png,d.png,e.png"], { getTransport: () => transport });
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("USAGE_ERROR");
      expect((err as FinchError).message).toContain("maximum 4");
    }
  });

  test("--media alone posts a media-only post without requiring text", async () => {
    let createdWith: { text?: string; mediaIds?: string[] } = {};
    const transport = fakeTransport({
      uploadImage: async (path) => ({ media_id: `id-for-${path}` }),
      createTweet: async (text, _replyToId, mediaIds) => {
        createdWith = { text, mediaIds };
        return { id: "1", text };
      },
    });

    const result = await runPost(["--media", "pic.jpg"], { getTransport: () => transport });

    expect(result.data).toEqual({ id: "1", text: "" });
    expect(createdWith).toEqual({ text: "", mediaIds: ["id-for-pic.jpg"] });
  });

  test("--dry-run with media reports the paths without uploading", async () => {
    let uploaded = false;
    const transport = fakeTransport({
      uploadImage: async () => {
        uploaded = true;
        return { media_id: "x" };
      },
    });

    const result = await runPost(["hello", "--media", "a.png,b.png", "--dry-run"], {
      getTransport: () => transport,
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { text: "hello", media: ["a.png", "b.png"] } });
    expect(uploaded).toBe(false);
  });

  test("--media after the -- terminator is treated as literal text", async () => {
    const transport = fakeTransport({
      createTweet: async (text) => ({ id: "1", text }),
    });

    const result = await runPost(["--", "--media literal"], { getTransport: () => transport });

    expect(result.data).toEqual({ id: "1", text: "--media literal" });
  });
});
