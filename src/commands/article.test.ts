import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runArticleDraft, runArticlePublish, runArticlePost } from "./article";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

describe("runArticleDraft", () => {
  test("creates a draft from a markdown file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-article-test-"));
    try {
      const path = join(dir, "article.md");
      writeFileSync(path, "# Hello\n\nThis is a test article.\n");

      let createdWith: { title?: string; contentState?: object; coverMediaId?: string } = {};
      const transport = fakeTransport({
        createArticleDraft: async (title, contentState, coverMediaId) => {
          createdWith = { title, contentState, coverMediaId };
          return { id: "draft-1" };
        },
      });

      const result = await runArticleDraft(["My Title", path], { getTransport: () => transport });

      expect(result.data).toEqual({ id: "draft-1" });
      expect(result.human).toBe("Created article draft draft-1");
      expect(createdWith.title).toBe("My Title");
      expect(createdWith.contentState).toEqual({
        blocks: [
          {
            key: "block_0",
            text: "Hello",
            type: "header-one",
            data: {},
            entity_ranges: [],
            inline_style_ranges: [],
          },
          {
            key: "block_1",
            text: "This is a test article.",
            type: "unstyled",
            data: {},
            entity_ranges: [],
            inline_style_ranges: [],
          },
        ],
        entities: [],
      });
      expect(createdWith.coverMediaId).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("uploads a cover image and passes its media id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-article-test-"));
    try {
      const mdPath = join(dir, "article.md");
      const coverPath = join(dir, "cover.png");
      writeFileSync(mdPath, "Article body\n");
      writeFileSync(coverPath, "fake-image-data");

      const uploadedPaths: string[] = [];
      let createdWith: { title?: string; contentState?: object; coverMediaId?: string } = {};
      const transport = fakeTransport({
        uploadImage: async (path) => {
          uploadedPaths.push(path);
          return { media_id: `id-for-${path}` };
        },
        createArticleDraft: async (title, contentState, coverMediaId) => {
          createdWith = { title, contentState, coverMediaId };
          return { id: "draft-2" };
        },
      });

      const result = await runArticleDraft(["Cover Story", mdPath, "--cover", coverPath], {
        getTransport: () => transport,
      });

      expect(result.data).toEqual({ id: "draft-2" });
      expect(uploadedPaths).toEqual([coverPath]);
      expect(createdWith.title).toBe("Cover Story");
      expect(createdWith.coverMediaId).toBe(`id-for-${coverPath}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws USAGE_ERROR when the markdown file is missing", async () => {
    const transport = fakeTransport({
      createArticleDraft: async () => ({ id: "x" }),
    });

    await expect(runArticleDraft(["Title", "/does/not/exist.md"], { getTransport: () => transport })).rejects.toThrow(
      FinchError,
    );
    try {
      await runArticleDraft(["Title", "/does/not/exist.md"], { getTransport: () => transport });
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("USAGE_ERROR");
      expect((err as FinchError).message).toContain("Cannot read markdown file");
    }
  });

  test("throws USAGE_ERROR when title or markdown path is missing", async () => {
    const transport = fakeTransport({
      createArticleDraft: async () => ({ id: "x" }),
    });

    await expect(runArticleDraft(["Title"], { getTransport: () => transport })).rejects.toThrow(FinchError);
    try {
      await runArticleDraft(["Title"], { getTransport: () => transport });
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("USAGE_ERROR");
      expect((err as FinchError).message).toContain("requires <title> and <markdown-file-path>");
    }

    await expect(runArticleDraft([], { getTransport: () => transport })).rejects.toThrow(FinchError);
  });

  test("--dry-run validates and returns plan without calling transport", async () => {
    let called = false;
    const transport = fakeTransport({
      createArticleDraft: async () => {
        called = true;
        return { id: "x" };
      },
    });

    const result = await runArticleDraft(["My Title", "/some/path.md", "--cover", "/cover.png", "--dry-run"], {
      getTransport: () => transport,
    });

    expect(called).toBe(false);
    expect(result.data).toEqual({
      dryRun: true,
      wouldSend: { title: "My Title", markdownPath: "/some/path.md", coverPath: "/cover.png" },
    });
    expect(result.human).toBe("Would create article draft: My Title from /some/path.md with cover: /cover.png");
  });
});

describe("runArticlePublish", () => {
  test("publishes a draft and returns the post URL", async () => {
    const transport = fakeTransport({
      publishArticleDraft: async (draftId) => {
        expect(draftId).toBe("draft-123");
        return { post_id: "9876543210" };
      },
    });

    const result = await runArticlePublish(["draft-123"], { getTransport: () => transport });

    expect(result.data).toEqual({
      post_id: "9876543210",
      url: "https://x.com/i/web/status/9876543210",
    });
    expect(result.human).toBe("Published article as https://x.com/i/web/status/9876543210");
  });

  test("throws USAGE_ERROR when draft_id is missing", async () => {
    const transport = fakeTransport({
      publishArticleDraft: async () => ({ post_id: "x" }),
    });

    await expect(runArticlePublish([], { getTransport: () => transport })).rejects.toThrow(FinchError);
    try {
      await runArticlePublish([], { getTransport: () => transport });
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("USAGE_ERROR");
      expect((err as FinchError).message).toContain("requires <draft_id>");
    }
  });

  test("--dry-run validates and returns plan without calling transport", async () => {
    let called = false;
    const transport = fakeTransport({
      publishArticleDraft: async () => {
        called = true;
        return { post_id: "x" };
      },
    });

    const result = await runArticlePublish(["draft-123", "--dry-run"], { getTransport: () => transport });

    expect(called).toBe(false);
    expect(result.data).toEqual({
      dryRun: true,
      wouldSend: { draftId: "draft-123" },
    });
    expect(result.human).toBe("Would publish article draft: draft-123");
  });
});

describe("runArticlePost", () => {
  test("creates a draft from markdown and publishes it, returning the post URL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-article-post-test-"));
    try {
      const path = join(dir, "article.md");
      writeFileSync(path, "# Published\n\nVia post command.\n");

      let createdWith: { title?: string; contentState?: object; coverMediaId?: string } = {};
      const transport = fakeTransport({
        createArticleDraft: async (title, contentState, coverMediaId) => {
          createdWith = { title, contentState, coverMediaId };
          return { id: "draft-post-1" };
        },
        publishArticleDraft: async (draftId) => {
          expect(draftId).toBe("draft-post-1");
          return { post_id: "1122334455" };
        },
      });

      const result = await runArticlePost([path, "--title", "My Post"], { getTransport: () => transport });

      expect(result.data).toEqual({
        post_id: "1122334455",
        url: "https://x.com/i/web/status/1122334455",
      });
      expect(result.human).toBe("Published article as https://x.com/i/web/status/1122334455");
      expect(createdWith.title).toBe("My Post");
      expect(createdWith.coverMediaId).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("uploads a cover image and flows the media id through to the draft", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-article-post-cover-test-"));
    try {
      const mdPath = join(dir, "article.md");
      const coverPath = join(dir, "cover.png");
      writeFileSync(mdPath, "Covered article\n");
      writeFileSync(coverPath, "fake-image-data");

      const uploadedPaths: string[] = [];
      let createdWith: { title?: string; contentState?: object; coverMediaId?: string } = {};
      const transport = fakeTransport({
        uploadImage: async (path) => {
          uploadedPaths.push(path);
          return { media_id: `id-for-${path}` };
        },
        createArticleDraft: async (title, contentState, coverMediaId) => {
          createdWith = { title, contentState, coverMediaId };
          return { id: "draft-post-cover" };
        },
        publishArticleDraft: async () => ({ post_id: "5566778899" }),
      });

      const result = await runArticlePost([mdPath, "--title", "Covered Post", "--cover", coverPath], {
        getTransport: () => transport,
      });

      expect(result.data).toEqual({ post_id: "5566778899", url: "https://x.com/i/web/status/5566778899" });
      expect(uploadedPaths).toEqual([coverPath]);
      expect(createdWith.title).toBe("Covered Post");
      expect(createdWith.coverMediaId).toBe(`id-for-${coverPath}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws USAGE_ERROR when markdown file or --title is missing", async () => {
    const transport = fakeTransport({
      createArticleDraft: async () => ({ id: "x" }),
      publishArticleDraft: async () => ({ post_id: "x" }),
    });

    await expect(runArticlePost([], { getTransport: () => transport })).rejects.toThrow(FinchError);
    try {
      await runArticlePost([], { getTransport: () => transport });
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("USAGE_ERROR");
      expect((err as FinchError).message).toContain("requires <markdown-file> and --title <title>");
    }

    await expect(runArticlePost(["--title", "Title Only"], { getTransport: () => transport })).rejects.toThrow(
      FinchError,
    );
  });

  test("--dry-run validates and returns plan without calling transport", async () => {
    let called = false;
    const transport = fakeTransport({
      createArticleDraft: async () => {
        called = true;
        return { id: "x" };
      },
      publishArticleDraft: async () => {
        called = true;
        return { post_id: "x" };
      },
    });

    const result = await runArticlePost(
      ["/some/path.md", "--title", "My Title", "--cover", "/cover.png", "--dry-run"],
      {
        getTransport: () => transport,
      },
    );

    expect(called).toBe(false);
    expect(result.data).toEqual({
      dryRun: true,
      wouldSend: { title: "My Title", markdownPath: "/some/path.md", coverPath: "/cover.png" },
    });
    expect(result.human).toBe("Would post article: My Title from /some/path.md with cover: /cover.png");
  });
});
