import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runArticleDraft } from "./article";
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
            depth: 0,
            inlineStyleRanges: [],
            entityRanges: [],
          },
          {
            key: "block_1",
            text: "This is a test article.",
            type: "unstyled",
            depth: 0,
            inlineStyleRanges: [],
            entityRanges: [],
          },
        ],
        entities: {},
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
});
