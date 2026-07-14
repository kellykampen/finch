import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, type OAuth2Token } from "@xdevplatform/xdk";
import { ByokTransport, createOAuth2Transport, createRefreshingOAuth2Transport, type XTransport } from "./transport";
import { FinchError } from "./errors";
import { fakeTransport } from "./transport.fixtures";
import { readOAuth2Config, writeOAuth2Config } from "./oauth2-config";
import type { OAuth2AuthConfig } from "./oauth2-config";

const unusedUsersClient = {
  getMe: async () => {
    throw new Error("getMe not stubbed for this test");
  },
  getByUsername: async () => {
    throw new Error("getByUsername not stubbed for this test");
  },
  getPosts: async () => {
    throw new Error("getPosts not stubbed for this test");
  },
  getTimeline: async () => {
    throw new Error("getTimeline not stubbed for this test");
  },
  getBookmarks: async () => {
    throw new Error("getBookmarks not stubbed for this test");
  },
  getBookmarksByFolderId: async () => {
    throw new Error("getBookmarksByFolderId not stubbed for this test");
  },
  getBookmarkFolders: async () => {
    throw new Error("getBookmarkFolders not stubbed for this test");
  },
  createBookmark: async () => {
    throw new Error("createBookmark not stubbed for this test");
  },
  deleteBookmark: async () => {
    throw new Error("deleteBookmark not stubbed for this test");
  },
  likePost: async () => {
    throw new Error("likePost not stubbed for this test");
  },
  unlikePost: async () => {
    throw new Error("unlikePost not stubbed for this test");
  },
  repostPost: async () => {
    throw new Error("repostPost not stubbed for this test");
  },
  unrepostPost: async () => {
    throw new Error("unrepostPost not stubbed for this test");
  },
  followUser: async () => {
    throw new Error("followUser not stubbed for this test");
  },
  unfollowUser: async () => {
    throw new Error("unfollowUser not stubbed for this test");
  },
};

const unusedPostsClient = {
  create: async () => {
    throw new Error("create not stubbed for this test");
  },
  getById: async () => {
    throw new Error("getById not stubbed for this test");
  },
  searchRecent: async () => {
    throw new Error("searchRecent not stubbed for this test");
  },
  delete: async () => {
    throw new Error("delete not stubbed for this test");
  },
};

const unusedMediaClient = {
  upload: async () => {
    throw new Error("upload not stubbed for this test");
  },
  initializeUpload: async () => {
    throw new Error("initializeUpload not stubbed for this test");
  },
  appendUpload: async () => {
    throw new Error("appendUpload not stubbed for this test");
  },
  finalizeUpload: async () => {
    throw new Error("finalizeUpload not stubbed for this test");
  },
  getUploadStatus: async () => {
    throw new Error("getUploadStatus not stubbed for this test");
  },
  createMetadata: async () => {
    throw new Error("createMetadata not stubbed for this test");
  },
};

describe("ByokTransport.getMe", () => {
  test("returns id/username/name on a successful call", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getMe: async () => ({
          data: { id: "123", username: "kelly", name: "Kelly" },
        }),
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    const me = await transport.getMe();

    expect(me).toEqual({ id: "123", username: "kelly", name: "Kelly" });
  });

  test("throws AUTH_ERROR when the response has no data", async () => {
    const transport = new ByokTransport(
      { ...unusedUsersClient, getMe: async () => ({ errors: [{ detail: "no user" }] }) },
      unusedPostsClient,
      unusedMediaClient,
    );

    await expect(transport.getMe()).rejects.toThrow(FinchError);
    try {
      await transport.getMe();
      throw new Error("expected getMe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
    }
  });

  test("maps a 401 ApiError to AUTH_ERROR", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getMe: async () => {
          throw new ApiError("Unauthorized", 401, "Unauthorized", new Headers(), { detail: "bad token" });
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.getMe();
      throw new Error("expected getMe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
    }
  });

  test("maps a 429 ApiError to RATE_LIMITED with resetAt: null when no reset header is present", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getMe: async () => {
          throw new ApiError("Too Many Requests", 429, "Too Many Requests", new Headers(), null);
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.getMe();
      throw new Error("expected getMe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("RATE_LIMITED");
      expect((err as FinchError).detail).toEqual({ resetAt: null });
    }
  });

  test("maps a 429 ApiError's x-rate-limit-reset header to an ISO8601 resetAt", async () => {
    const resetUnixSeconds = 1735689600; // 2025-01-01T00:00:00.000Z
    const headers = new Headers({ "x-rate-limit-reset": String(resetUnixSeconds) });
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getMe: async () => {
          throw new ApiError("Too Many Requests", 429, "Too Many Requests", headers, null);
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.getMe();
      throw new Error("expected getMe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("RATE_LIMITED");
      expect((err as FinchError).detail).toEqual({ resetAt: "2025-01-01T00:00:00.000Z" });
    }
  });

  test("maps a 404 ApiError to CLIENT_ERROR", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getMe: async () => {
          throw new ApiError("Not Found", 404, "Not Found", new Headers(), null);
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.getMe();
      throw new Error("expected getMe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
    }
  });

  test("maps a non-ApiError (e.g. network failure) to NETWORK_ERROR", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getMe: async () => {
          throw new TypeError("fetch failed");
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.getMe();
      throw new Error("expected getMe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("NETWORK_ERROR");
    }
  });
});

describe("ByokTransport.createTweet", () => {
  test("posts a top-level tweet with no reply field", async () => {
    let capturedBody: unknown;
    const transport = new ByokTransport(
      unusedUsersClient,
      {
        ...unusedPostsClient,
        create: async (body) => {
          capturedBody = body;
          return { data: { id: "1", text: "hello" } };
        },
      },
      unusedMediaClient,
    );

    const result = await transport.createTweet("hello");

    expect(result).toEqual({ id: "1", text: "hello" });
    expect(capturedBody).toEqual({ text: "hello" });
  });

  test("includes the reply field when replyToId is given", async () => {
    let capturedBody: unknown;
    const transport = new ByokTransport(
      unusedUsersClient,
      {
        ...unusedPostsClient,
        create: async (body) => {
          capturedBody = body;
          return { data: { id: "2", text: "a reply" } };
        },
      },
      unusedMediaClient,
    );

    await transport.createTweet("a reply", "999");

    expect(capturedBody).toEqual({ text: "a reply", reply: { in_reply_to_tweet_id: "999" } });
  });

  test("throws CLIENT_ERROR when the API returns no data", async () => {
    const transport = new ByokTransport(
      unusedUsersClient,
      {
        ...unusedPostsClient,
        create: async () => ({ errors: [{ detail: "duplicate content" }] }),
      },
      unusedMediaClient,
    );

    try {
      await transport.createTweet("dup");
      throw new Error("expected createTweet to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
    }
  });

  test("maps a 403 ApiError to AUTH_ERROR", async () => {
    const transport = new ByokTransport(
      unusedUsersClient,
      {
        ...unusedPostsClient,
        create: async () => {
          throw new ApiError("Forbidden", 403, "Forbidden", new Headers(), null);
        },
      },
      unusedMediaClient,
    );

    try {
      await transport.createTweet("hello");
      throw new Error("expected createTweet to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
    }
  });

  test("does not misclassify a search-tier 403 on a non-search endpoint as CLIENT_ERROR", async () => {
    const transport = new ByokTransport(
      unusedUsersClient,
      {
        ...unusedPostsClient,
        create: async () => {
          throw new ApiError("Forbidden", 403, "Forbidden", new Headers(), {
            detail: "You must enroll in a tier to access search features.",
          });
        },
      },
      unusedMediaClient,
    );

    try {
      await transport.createTweet("hello");
      throw new Error("expected createTweet to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
      expect((err as FinchError).message).toBe("X rejected the provided credentials");
    }
  });

  test("includes media_ids in the request body when mediaIds are provided", async () => {
    let capturedBody: unknown;
    const transport = new ByokTransport(
      unusedUsersClient,
      {
        ...unusedPostsClient,
        create: async (body) => {
          capturedBody = body;
          return { data: { id: "3", text: "hello media" } };
        },
      },
      unusedMediaClient,
    );

    await transport.createTweet("hello media", undefined, ["111", "222"]);

    expect(capturedBody).toEqual({ text: "hello media", media: { media_ids: ["111", "222"] } });
  });
});

describe("ByokTransport.uploadImage", () => {
  test("reads a file, base64-encodes it, and returns the media ID", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-upload-test-"));
    try {
      const path = join(dir, "image.png");
      writeFileSync(path, Buffer.from("fake-image-bytes"));

      let capturedBody: unknown;
      const transport = new ByokTransport(unusedUsersClient, unusedPostsClient, {
        ...unusedMediaClient,
        upload: async (options) => {
          capturedBody = options.body;
          return { data: { id: "media-123", media_key: "3_media-123" } };
        },
      });

      const result = await transport.uploadImage(path);

      expect(result).toEqual({ media_id: "media-123" });
      expect(capturedBody).toEqual({
        media: Buffer.from("fake-image-bytes").toString("base64"),
        mediaCategory: "tweet_image",
        mediaType: "image/png",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects unsupported image extensions", async () => {
    const transport = new ByokTransport(unusedUsersClient, unusedPostsClient, unusedMediaClient);

    await expect(transport.uploadImage("image.gif")).rejects.toThrow(FinchError);
    try {
      await transport.uploadImage("image.gif");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("USAGE_ERROR");
      expect((err as FinchError).message).toContain("Unsupported image type");
    }
  });

  test("rejects missing files", async () => {
    const transport = new ByokTransport(unusedUsersClient, unusedPostsClient, unusedMediaClient);

    await expect(transport.uploadImage("/does/not/exist.png")).rejects.toThrow(FinchError);
    try {
      await transport.uploadImage("/does/not/exist.png");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("USAGE_ERROR");
      expect((err as FinchError).message).toContain("Cannot read media file");
    }
  });

  test("maps a 403 ApiError to AUTH_ERROR", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-upload-test-"));
    try {
      const path = join(dir, "image.png");
      writeFileSync(path, Buffer.from("fake-image-bytes"));

      const transport = new ByokTransport(unusedUsersClient, unusedPostsClient, {
        ...unusedMediaClient,
        upload: async () => {
          throw new ApiError("Forbidden", 403, "Forbidden", new Headers(), null);
        },
      });

      await expect(transport.uploadImage(path)).rejects.toThrow(FinchError);
      try {
        await transport.uploadImage(path);
      } catch (err) {
        expect(err).toBeInstanceOf(FinchError);
        expect((err as FinchError).code).toBe("AUTH_ERROR");
        expect((err as FinchError).message).toBe(
          "X denied media upload. The v2 media endpoints require OAuth2 user context with media.write. Run `finch auth` to re-authorize; if `finch config get auth.scopes` already includes media.write, verify your X app has v2 media endpoint access.",
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws CLIENT_ERROR when the API response has no id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-upload-test-"));
    try {
      const path = join(dir, "image.png");
      writeFileSync(path, Buffer.from("fake-image-bytes"));

      const transport = new ByokTransport(unusedUsersClient, unusedPostsClient, {
        ...unusedMediaClient,
        upload: async () => ({ errors: [{ detail: "media rejected" }] }),
      });

      await expect(transport.uploadImage(path)).rejects.toThrow(FinchError);
      try {
        await transport.uploadImage(path);
      } catch (err) {
        expect(err).toBeInstanceOf(FinchError);
        expect((err as FinchError).code).toBe("CLIENT_ERROR");
        expect((err as FinchError).message).toBe("X API did not return a media ID");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ByokTransport.uploadVideo", () => {
  test("runs the chunked upload lifecycle and polls until processing succeeds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-video-upload-test-"));
    try {
      const path = join(dir, "clip.mp4");
      writeFileSync(path, Buffer.from("fake-video-bytes"));

      const calls: unknown[] = [];
      const statuses: string[] = [];
      const transport = new ByokTransport(unusedUsersClient, unusedPostsClient, {
        ...unusedMediaClient,
        initializeUpload: async (options) => {
          calls.push(["init", options.body]);
          return { data: { id: "media-123", media_key: "13_media-123" } };
        },
        appendUpload: async (id, options) => {
          calls.push(["append", id, options.body]);
          return { data: {} };
        },
        finalizeUpload: async (id) => {
          calls.push(["finalize", id]);
          return { data: { id, processing_info: { state: "pending", check_after_secs: 0 } } };
        },
        getUploadStatus: async (id, options) => {
          calls.push(["status", id, options]);
          return { data: { id, processing_info: { state: "succeeded" } } };
        },
      });

      const result = await transport.uploadVideo(path, (message) => statuses.push(message));

      expect(result).toEqual({ media_id: "media-123" });
      expect(statuses).toEqual([
        "Initializing video upload (16 bytes)",
        "Uploaded 16 bytes of 16 bytes",
        "Finalizing media upload",
        "Media processing pending; checking again in 0s",
        "Media processing succeeded",
      ]);
      expect(calls).toEqual([
        [
          "init",
          {
            mediaCategory: "tweet_video",
            mediaType: "video/mp4",
            totalBytes: Buffer.byteLength("fake-video-bytes"),
          },
        ],
        [
          "append",
          "media-123",
          {
            media: Buffer.from("fake-video-bytes").toString("base64"),
            segmentIndex: 0,
          },
        ],
        ["finalize", "media-123"],
        ["status", "media-123", { command: "STATUS" }],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("maps an initialize-upload 403 to an actionable media.write error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-video-upload-test-"));
    try {
      const path = join(dir, "clip.gif");
      writeFileSync(path, Buffer.from("fake-gif-bytes"));
      const transport = new ByokTransport(unusedUsersClient, unusedPostsClient, {
        ...unusedMediaClient,
        initializeUpload: async () => {
          throw new ApiError("Forbidden", 403, "Forbidden", new Headers(), null);
        },
      });

      try {
        await transport.uploadVideo(path);
        throw new Error("expected uploadVideo to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(FinchError);
        expect((err as FinchError).code).toBe("AUTH_ERROR");
        expect((err as FinchError).message).toBe(
          "X denied media upload. The v2 media endpoints require OAuth2 user context with media.write. Run `finch auth` to re-authorize; if `finch config get auth.scopes` already includes media.write, verify your X app has v2 media endpoint access.",
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws CLIENT_ERROR when processing status fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-video-upload-test-"));
    try {
      const path = join(dir, "clip.gif");
      writeFileSync(path, Buffer.from("fake-gif-bytes"));

      const transport = new ByokTransport(unusedUsersClient, unusedPostsClient, {
        ...unusedMediaClient,
        initializeUpload: async () => ({ data: { id: "media-456" } }),
        appendUpload: async () => ({ data: {} }),
        finalizeUpload: async () => ({
          data: { id: "media-456", processing_info: { state: "in_progress", check_after_secs: 0 } },
        }),
        getUploadStatus: async () => ({
          data: {
            id: "media-456",
            processing_info: {
              state: "failed",
              error: { name: "InvalidMedia", message: "transcode failed" },
            },
          },
        }),
      });

      await expect(transport.uploadVideo(path)).rejects.toThrow(FinchError);
      try {
        await transport.uploadVideo(path);
      } catch (err) {
        expect(err).toBeInstanceOf(FinchError);
        expect((err as FinchError).code).toBe("CLIENT_ERROR");
        expect((err as FinchError).message).toContain("Media processing failed");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects oversized media before starting upload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finch-video-upload-test-"));
    try {
      const path = join(dir, "too-big.gif");
      writeFileSync(path, Buffer.alloc(16 * 1024 * 1024));
      let initialized = false;
      const transport = new ByokTransport(unusedUsersClient, unusedPostsClient, {
        ...unusedMediaClient,
        initializeUpload: async () => {
          initialized = true;
          return { data: { id: "nope" } };
        },
      });

      await expect(transport.uploadVideo(path)).rejects.toThrow(FinchError);
      expect(initialized).toBe(false);
      try {
        await transport.uploadVideo(path);
      } catch (err) {
        expect(err).toBeInstanceOf(FinchError);
        expect((err as FinchError).code).toBe("USAGE_ERROR");
        expect((err as FinchError).message).toContain("exceeds the 15 MB limit");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ByokTransport.setMediaAltText", () => {
  test("sends alt text through the SDK metadata endpoint", async () => {
    let capturedBody: unknown;
    const transport = new ByokTransport(unusedUsersClient, unusedPostsClient, {
      ...unusedMediaClient,
      createMetadata: async (options) => {
        capturedBody = options.body;
        return {};
      },
    });

    await transport.setMediaAltText("media-123", "A useful description");

    // X's v2 POST /2/media/metadata requires the media `id` at the top level and
    // nests alt text under `metadata.alt_text.text`. The previous shape
    // (`mediaId` + top-level `altText`) omitted the required `id`, so X dropped
    // the alt text (FIN-66). Asserting the exact body guards that regression.
    expect(capturedBody).toEqual({
      id: "media-123",
      metadata: { alt_text: { text: "A useful description" } },
    });
  });

  test("includes the required media id so X can attach the metadata (FIN-66 regression)", async () => {
    let capturedBody: { id?: unknown; metadata?: unknown } | undefined;
    const transport = new ByokTransport(unusedUsersClient, unusedPostsClient, {
      ...unusedMediaClient,
      createMetadata: async (options) => {
        capturedBody = options.body;
        return {};
      },
    });

    await transport.setMediaAltText("media-456", "Another description");

    expect(capturedBody?.id).toBe("media-456");
    expect(capturedBody).not.toHaveProperty("mediaId");
    expect(capturedBody).not.toHaveProperty("altText");
    expect(capturedBody?.metadata).toEqual({ alt_text: { text: "Another description" } });
  });

  test("throws CLIENT_ERROR when the metadata response has errors", async () => {
    const transport = new ByokTransport(unusedUsersClient, unusedPostsClient, {
      ...unusedMediaClient,
      createMetadata: async () => ({ errors: [{ detail: "metadata rejected" }] }),
    });

    await expect(transport.setMediaAltText("media-123", "bad")).rejects.toThrow(FinchError);
    try {
      await transport.setMediaAltText("media-123", "bad");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
      expect((err as FinchError).message).toBe("X API did not confirm the media metadata");
    }
  });

  test("maps a 403 ApiError to AUTH_ERROR", async () => {
    const transport = new ByokTransport(unusedUsersClient, unusedPostsClient, {
      ...unusedMediaClient,
      createMetadata: async () => {
        throw new ApiError("Forbidden", 403, "Forbidden", new Headers(), null);
      },
    });

    await expect(transport.setMediaAltText("media-123", "description")).rejects.toThrow(FinchError);
    try {
      await transport.setMediaAltText("media-123", "description");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
      expect((err as FinchError).message).toBe(
        "X denied media upload. The v2 media endpoints require OAuth2 user context with media.write. Run `finch auth` to re-authorize; if `finch config get auth.scopes` already includes media.write, verify your X app has v2 media endpoint access.",
      );
    }
  });
});

describe("ByokTransport.getTweet", () => {
  test("shapes the tweet into the id/text/author_id/created_at contract", async () => {
    const transport = new ByokTransport(
      unusedUsersClient,
      {
        ...unusedPostsClient,
        getById: async () => ({
          data: { id: "1", text: "hi", authorId: "42", createdAt: "2026-01-01T00:00:00.000Z" },
        }),
      },
      unusedMediaClient,
    );

    const tweet = await transport.getTweet("1");

    expect(tweet).toEqual({
      id: "1",
      text: "hi",
      author_id: "42",
      created_at: "2026-01-01T00:00:00.000Z",
    });
  });

  test("throws CLIENT_ERROR when the post isn't found", async () => {
    const transport = new ByokTransport(
      unusedUsersClient,
      {
        ...unusedPostsClient,
        getById: async () => ({ errors: [{ detail: "not found" }] }),
      },
      unusedMediaClient,
    );

    try {
      await transport.getTweet("999");
      throw new Error("expected getTweet to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
    }
  });
});

describe("ByokTransport.searchRecent", () => {
  test("shapes each result and passes maxResults through", async () => {
    let capturedOptions: unknown;
    const transport = new ByokTransport(
      unusedUsersClient,
      {
        ...unusedPostsClient,
        searchRecent: async (_query, options) => {
          capturedOptions = options;
          return { data: [{ id: "1", text: "match", authorId: "7" }] };
        },
      },
      unusedMediaClient,
    );

    const posts = await transport.searchRecent("hello", 25);

    expect(posts).toEqual([{ id: "1", text: "match", author_id: "7", created_at: null }]);
    expect(capturedOptions).toEqual({ maxResults: 25, tweetFields: ["author_id", "created_at"] });
  });

  test("returns an empty array when the API omits data (zero results)", async () => {
    const transport = new ByokTransport(
      unusedUsersClient,
      {
        ...unusedPostsClient,
        searchRecent: async () => ({}),
      },
      unusedMediaClient,
    );

    expect(await transport.searchRecent("nothing", 10)).toEqual([]);
  });

  test("maps a 429 ApiError to RATE_LIMITED with resetAt", async () => {
    const resetUnixSeconds = 1735689600; // 2025-01-01T00:00:00.000Z
    const headers = new Headers({ "x-rate-limit-reset": String(resetUnixSeconds) });
    const transport = new ByokTransport(
      unusedUsersClient,
      {
        ...unusedPostsClient,
        searchRecent: async () => {
          throw new ApiError("Too Many Requests", 429, "Too Many Requests", headers, null);
        },
      },
      unusedMediaClient,
    );

    try {
      await transport.searchRecent("hello", 10);
      throw new Error("expected searchRecent to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("RATE_LIMITED");
      expect((err as FinchError).detail).toEqual({ resetAt: "2025-01-01T00:00:00.000Z" });
    }
  });

  test("maps a free-tier search 403 ApiError to CLIENT_ERROR", async () => {
    const transport = new ByokTransport(
      unusedUsersClient,
      {
        ...unusedPostsClient,
        searchRecent: async () => {
          throw new ApiError("Forbidden", 403, "Forbidden", new Headers(), {
            title: "Client Forbidden",
            detail: "This client is not allowed to perform this operation.",
            type: "https://api.twitter.com/2/problems/client-forbidden",
            status: 403,
            reason: "search-access-level",
          });
        },
      },
      unusedMediaClient,
    );

    try {
      await transport.searchRecent("hello", 10);
      throw new Error("expected searchRecent to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
      expect((err as FinchError).message).toBe("Your X API tier does not include search access.");
    }
  });

  test("maps a non-tier 403 ApiError to AUTH_ERROR", async () => {
    const transport = new ByokTransport(
      unusedUsersClient,
      {
        ...unusedPostsClient,
        searchRecent: async () => {
          throw new ApiError("Forbidden", 403, "Forbidden", new Headers(), {
            detail: "some other credentials issue",
          });
        },
      },
      unusedMediaClient,
    );

    try {
      await transport.searchRecent("hello", 10);
      throw new Error("expected searchRecent to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
    }
  });
});

describe("ByokTransport.userTweets", () => {
  test("shapes each result", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getPosts: async () => ({ data: [{ id: "1", text: "a post", createdAt: "2026-01-01T00:00:00.000Z" }] }),
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    const posts = await transport.userTweets("42", 10);

    expect(posts).toEqual([{ id: "1", text: "a post", author_id: null, created_at: "2026-01-01T00:00:00.000Z" }]);
  });
});

describe("ByokTransport.homeTimeline", () => {
  test("shapes each result", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getTimeline: async () => ({ data: [{ id: "1", text: "home" }] }),
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    const posts = await transport.homeTimeline("42", 10);

    expect(posts).toEqual([{ id: "1", text: "home", author_id: null, created_at: null }]);
  });
});

describe("ByokTransport.listBookmarks", () => {
  test("shapes each result", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getBookmarks: async () => ({ data: [{ id: "1", text: "saved" }] }),
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    const posts = await transport.listBookmarks("42", 10);

    expect(posts).toEqual([{ id: "1", text: "saved", author_id: null, created_at: null }]);
  });

  test("passes maxResults and tweetFields to the SDK", async () => {
    let capturedOptions: unknown;
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getBookmarks: async (_id, options) => {
          capturedOptions = options;
          return { data: [] };
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    await transport.listBookmarks("42", 25);

    expect(capturedOptions).toEqual({ maxResults: 25, tweetFields: ["author_id", "created_at"] });
  });

  test("maps a 401 ApiError to AUTH_ERROR", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getBookmarks: async () => {
          throw new ApiError("Unauthorized", 401, "Unauthorized", new Headers(), null);
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    await expect(transport.listBookmarks("42", 10)).rejects.toThrow(FinchError);
    try {
      await transport.listBookmarks("42", 10);
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
    }
  });
});

describe("ByokTransport.addBookmark", () => {
  test("passes the userId and tweetId through and bookmarks the tweet", async () => {
    let capturedArgs: unknown[] = [];
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        createBookmark: async (...args: unknown[]) => {
          capturedArgs = args;
          return { data: { bookmarked: true } };
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    const result = await transport.addBookmark("42", "999");

    expect(result).toEqual({ bookmarked: true });
    expect(capturedArgs).toEqual(["42", { tweetId: "999" }]);
  });

  test("falls back to bookmarked: true when the API omits the field", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        createBookmark: async () => ({ data: {} }),
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    expect(await transport.addBookmark("42", "999")).toEqual({ bookmarked: true });
  });

  test("throws CLIENT_ERROR when the API returns no data", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        createBookmark: async () => ({ errors: [{ detail: "not found" }] }),
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.addBookmark("42", "999");
      throw new Error("expected addBookmark to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
    }
  });

  test("maps a missing bookmark.write 403 to a clear AUTH_ERROR", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        createBookmark: async () => {
          throw new ApiError("Forbidden", 403, "Forbidden", new Headers(), {
            title: "Client Forbidden",
            detail: "Missing required scopes: bookmark.write",
            type: "https://api.twitter.com/2/problems/client-forbidden",
            status: 403,
            reason: "missing-scope",
          });
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.addBookmark("42", "999");
      throw new Error("expected addBookmark to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
      expect((err as FinchError).message).toBe(
        "Your X API token is missing the bookmark.write scope. Run `finch auth` to re-authorize with bookmarks access.",
      );
    }
  });
});

describe("ByokTransport.removeBookmark", () => {
  test("passes the userId and tweetId through and removes the bookmark", async () => {
    let capturedArgs: unknown[] = [];
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        deleteBookmark: async (...args: unknown[]) => {
          capturedArgs = args;
          return { data: { bookmarked: false } };
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    const result = await transport.removeBookmark("42", "999");

    expect(result).toEqual({ bookmarked: false });
    expect(capturedArgs).toEqual(["42", "999"]);
  });

  test("falls back to bookmarked: false when the API omits the field", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        deleteBookmark: async () => ({ data: {} }),
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    expect(await transport.removeBookmark("42", "999")).toEqual({ bookmarked: false });
  });

  test("throws CLIENT_ERROR when the API returns no data", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        deleteBookmark: async () => ({ errors: [{ detail: "not found" }] }),
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.removeBookmark("42", "999");
      throw new Error("expected removeBookmark to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
    }
  });

  test("maps a missing bookmark.write 403 to a clear AUTH_ERROR", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        deleteBookmark: async () => {
          throw new ApiError("Forbidden", 403, "Forbidden", new Headers(), {
            errors: [{ message: "Missing required scopes: bookmark.write", code: 37 }],
          });
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.removeBookmark("42", "999");
      throw new Error("expected removeBookmark to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
      expect((err as FinchError).message).toBe(
        "Your X API token is missing the bookmark.write scope. Run `finch auth` to re-authorize with bookmarks access.",
      );
    }
  });
});

describe("ByokTransport.listBookmarkFolders", () => {
  test("uses the SDK getBookmarkFolders method and shapes folder records", async () => {
    let capturedArgs: unknown[] = [];
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getBookmarkFolders: async (...args: unknown[]) => {
          capturedArgs = args;
          return {
            data: [
              { id: "111", name: "Work" },
              { id: "222", name: "Read later", extra: "ignored" },
              { id: 333, name: "bad id" },
            ],
          };
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    const result = await transport.listBookmarkFolders("42");

    expect(result).toEqual([
      { id: "111", name: "Work" },
      { id: "222", name: "Read later" },
    ]);
    expect(capturedArgs).toEqual(["42"]);
  });

  test("maps a Premium-gated 403 to a clear CLIENT_ERROR", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getBookmarkFolders: async () => {
          throw new ApiError("Forbidden", 403, "Forbidden", new Headers(), {
            detail: "Bookmark folders are only available to Premium subscribers.",
          });
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.listBookmarkFolders("42");
      throw new Error("expected listBookmarkFolders to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
      expect((err as FinchError).message).toBe("Bookmark folders require X Premium.");
    }
  });

  test("does not misclassify an unrelated 403 as the Premium folder caveat", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getBookmarkFolders: async () => {
          throw new ApiError("Forbidden", 403, "Forbidden", new Headers(), {
            detail: "Missing required scopes: bookmark.read",
          });
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.listBookmarkFolders("42");
      throw new Error("expected listBookmarkFolders to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
      expect((err as FinchError).message).toBe("X rejected the provided credentials");
    }
  });
});

describe("ByokTransport.createBookmarkFolder", () => {
  test("posts the folder name through the underlying SDK client request", async () => {
    let capturedRequest: unknown[] = [];
    const rawClient = {
      request: async (...args: unknown[]) => {
        capturedRequest = args;
        return { data: { id: "333", name: "Project notes" } };
      },
    };
    const transport = new ByokTransport(
      { ...unusedUsersClient, client: rawClient } as typeof unusedUsersClient,
      unusedPostsClient,
      unusedMediaClient,
    );

    const result = await transport.createBookmarkFolder("42", "Project notes");

    expect(result).toEqual({ id: "333", name: "Project notes" });
    expect(capturedRequest).toEqual([
      "POST",
      "/2/users/42/bookmarks/folders",
      {
        body: JSON.stringify({ name: "Project notes" }),
        security: [{ OAuth2UserToken: ["bookmark.write", "users.read"] }],
      },
    ]);
  });

  test("throws CLIENT_ERROR when create returns no folder data", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        client: { request: async () => ({ errors: [{ detail: "nope" }] }) },
      } as typeof unusedUsersClient,
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.createBookmarkFolder("42", "Project notes");
      throw new Error("expected createBookmarkFolder to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
    }
  });

  test("maps a Premium-gated 403 to a clear CLIENT_ERROR", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        client: {
          request: async () => {
            throw new ApiError("Forbidden", 403, "Forbidden", new Headers(), {
              reason: "premium_required",
              detail: "Creating bookmark folders requires Premium.",
            });
          },
        },
      } as typeof unusedUsersClient,
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.createBookmarkFolder("42", "Project notes");
      throw new Error("expected createBookmarkFolder to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
      expect((err as FinchError).message).toBe("Bookmark folders require X Premium.");
    }
  });

  test("does not misclassify an unrelated 403 as the Premium folder caveat", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        client: {
          request: async () => {
            throw new ApiError("Forbidden", 403, "Forbidden", new Headers(), {
              detail: "Missing required scopes: bookmark.write",
            });
          },
        },
      } as typeof unusedUsersClient,
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.createBookmarkFolder("42", "Project notes");
      throw new Error("expected createBookmarkFolder to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
      expect((err as FinchError).message).toBe("X rejected the provided credentials");
    }
  });
});

describe("ByokTransport.createArticleDraft", () => {
  test("posts title and content_state through the underlying SDK client request", async () => {
    let capturedRequest: unknown[] = [];
    const rawClient = {
      request: async (...args: unknown[]) => {
        capturedRequest = args;
        return { data: { id: "article-1" } };
      },
    };
    const transport = new ByokTransport(
      { ...unusedUsersClient, client: rawClient } as typeof unusedUsersClient,
      unusedPostsClient,
      unusedMediaClient,
    );

    const contentState = { blocks: [], entities: [] };
    const result = await transport.createArticleDraft("My Article", contentState);

    expect(result).toEqual({ id: "article-1" });
    expect(capturedRequest).toEqual([
      "POST",
      "/2/articles/draft",
      {
        body: JSON.stringify({ title: "My Article", content_state: contentState }),
        security: [{ OAuth2UserToken: ["tweet.write"] }],
      },
    ]);
  });

  test("includes cover_media when a cover media id is provided", async () => {
    let capturedRequest: unknown[] = [];
    const rawClient = {
      request: async (...args: unknown[]) => {
        capturedRequest = args;
        return { data: { id: "article-2" } };
      },
    };
    const transport = new ByokTransport(
      { ...unusedUsersClient, client: rawClient } as typeof unusedUsersClient,
      unusedPostsClient,
      unusedMediaClient,
    );

    const contentState = { blocks: [], entities: [] };
    await transport.createArticleDraft("Covered Article", contentState, "media-123");

    const body = JSON.parse((capturedRequest[2] as { body: string }).body);
    expect(body).toEqual({
      title: "Covered Article",
      content_state: contentState,
      cover_media: { media_id: "media-123" },
    });
  });

  test("throws CLIENT_ERROR when the API returns no article data", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        client: { request: async () => ({ errors: [{ detail: "invalid content_state" }] }) },
      } as typeof unusedUsersClient,
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.createArticleDraft("Bad Article", { blocks: [], entities: [] });
      throw new Error("expected createArticleDraft to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
    }
  });

  test("throws CLIENT_ERROR when the underlying client is not available", async () => {
    const transport = new ByokTransport(unusedUsersClient, unusedPostsClient, unusedMediaClient);

    try {
      await transport.createArticleDraft("No Client", { blocks: [], entities: [] });
      throw new Error("expected createArticleDraft to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
      expect((err as FinchError).message).toBe("X SDK client does not expose article draft creation");
    }
  });
});

// FIN-83: a real publish succeeded on X but returned a shape publishArticleDraft
// couldn't parse, so it reported CLIENT_ERROR while the article was live
// (orphaned post). These exercise the raw-response parsing directly (mocking
// rawClient.request), which the command-level tests fake away entirely.
describe("ByokTransport.publishArticleDraft", () => {
  function transportReturning(response: unknown, captured?: (args: unknown[]) => void): ByokTransport {
    return new ByokTransport(
      {
        ...unusedUsersClient,
        client: {
          request: async (...args: unknown[]) => {
            captured?.(args);
            return response;
          },
        },
      } as typeof unusedUsersClient,
      unusedPostsClient,
      unusedMediaClient,
    );
  }

  test("parses the documented { data: { post_id } } shape and posts to the publish endpoint", async () => {
    let capturedArgs: unknown[] = [];
    const transport = transportReturning({ data: { post_id: "1346889436626259968" } }, (a) => {
      capturedArgs = a;
    });

    const result = await transport.publishArticleDraft("draft-42");

    expect(result).toEqual({ post_id: "1346889436626259968" });
    expect(capturedArgs[0]).toBe("POST");
    expect(capturedArgs[1]).toBe("/2/articles/draft-42/publish");
  });

  test("falls back to data.id when the id is under the standard X v2 field, not post_id", async () => {
    const transport = transportReturning({ data: { id: "1799999999999999999" } });
    const result = await transport.publishArticleDraft("draft-1");
    expect(result).toEqual({ post_id: "1799999999999999999" });
  });

  test("falls back to data.tweet_id", async () => {
    const transport = transportReturning({ data: { tweet_id: "1800000000000000000" } });
    const result = await transport.publishArticleDraft("draft-1");
    expect(result).toEqual({ post_id: "1800000000000000000" });
  });

  test("throws CLIENT_ERROR and surfaces the response's structural keys (no values) when no string id is present", async () => {
    // e.g. a numeric id (JS would already have lost snowflake precision) or an
    // unexpected envelope — the error must name the keys so the real shape is
    // diagnosable, without leaking any values.
    const transport = transportReturning({ data: { post_id: 12345, foo: "bar" } });
    try {
      await transport.publishArticleDraft("draft-1");
      throw new Error("expected publishArticleDraft to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
      const detail = (err as FinchError).detail as { responseKeys: string[] };
      expect(detail.responseKeys).toEqual(["post_id", "foo"]);
    }
  });

  test("throws CLIENT_ERROR when the underlying client is not available", async () => {
    const transport = new ByokTransport(unusedUsersClient, unusedPostsClient, unusedMediaClient);
    try {
      await transport.publishArticleDraft("draft-1");
      throw new Error("expected publishArticleDraft to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
      expect((err as FinchError).message).toBe("X SDK client does not expose article draft publishing");
    }
  });
});

describe("ByokTransport.listBookmarksInFolder", () => {
  test("uses the SDK getBookmarksByFolderId method and shapes tweet records", async () => {
    let capturedArgs: unknown[] = [];
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getBookmarksByFolderId: async (...args: unknown[]) => {
          capturedArgs = args;
          return {
            data: [
              { id: "1", text: "saved in folder", authorId: "7", createdAt: "2026-01-01T00:00:00.000Z" },
              { id: "2", text: "minimal" },
            ],
          };
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    const result = await transport.listBookmarksInFolder("42", "folder-123", 10);

    expect(result).toEqual([
      { id: "1", text: "saved in folder", author_id: "7", created_at: "2026-01-01T00:00:00.000Z" },
      { id: "2", text: "minimal", author_id: null, created_at: null },
    ]);
    expect(capturedArgs).toEqual(["42", "folder-123", { maxResults: 10, tweetFields: ["author_id", "created_at"] }]);
  });

  test("passes maxResults through to the SDK", async () => {
    let capturedOptions: unknown;
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getBookmarksByFolderId: async (_id, _folderId, options) => {
          capturedOptions = options;
          return { data: [] };
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    await transport.listBookmarksInFolder("42", "folder-123", 25);

    expect(capturedOptions).toEqual({ maxResults: 25, tweetFields: ["author_id", "created_at"] });
  });

  test("maps a Premium-gated 403 to a clear CLIENT_ERROR", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getBookmarksByFolderId: async () => {
          throw new ApiError("Forbidden", 403, "Forbidden", new Headers(), {
            detail: "Bookmark folders are only available to Premium subscribers.",
          });
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.listBookmarksInFolder("42", "folder-123", 10);
      throw new Error("expected listBookmarksInFolder to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
      expect((err as FinchError).message).toBe("Bookmark folders require X Premium.");
    }
  });

  test("maps a 401 ApiError to AUTH_ERROR", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getBookmarksByFolderId: async () => {
          throw new ApiError("Unauthorized", 401, "Unauthorized", new Headers(), null);
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    await expect(transport.listBookmarksInFolder("42", "folder-123", 10)).rejects.toThrow(FinchError);
    try {
      await transport.listBookmarksInFolder("42", "folder-123", 10);
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
    }
  });
});

describe("ByokTransport.addBookmarkToFolder", () => {
  test("posts the tweet id through the underlying SDK client request", async () => {
    let capturedRequest: unknown[] = [];
    const rawClient = {
      request: async (...args: unknown[]) => {
        capturedRequest = args;
        return { data: { bookmarked: true } };
      },
    };
    const transport = new ByokTransport(
      { ...unusedUsersClient, client: rawClient } as typeof unusedUsersClient,
      unusedPostsClient,
      unusedMediaClient,
    );

    const result = await transport.addBookmarkToFolder("42", "folder-123", "999");

    expect(result).toEqual({ bookmarked: true });
    expect(capturedRequest).toEqual([
      "POST",
      "/2/users/42/bookmarks/folders/folder-123/bookmarks",
      {
        body: JSON.stringify({ tweet_id: "999" }),
        security: [{ OAuth2UserToken: ["bookmark.write", "tweet.read", "users.read"] }],
      },
    ]);
  });

  test("falls back to bookmarked: true when the API omits the field", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        client: { request: async () => ({ data: {} }) },
      } as typeof unusedUsersClient,
      unusedPostsClient,
      unusedMediaClient,
    );

    expect(await transport.addBookmarkToFolder("42", "folder-123", "999")).toEqual({ bookmarked: true });
  });

  test("throws CLIENT_ERROR when the API returns no data", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        client: { request: async () => ({ errors: [{ detail: "not found" }] }) },
      } as typeof unusedUsersClient,
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.addBookmarkToFolder("42", "folder-123", "999");
      throw new Error("expected addBookmarkToFolder to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
    }
  });

  test("maps a missing bookmark.write 403 to a clear AUTH_ERROR", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        client: {
          request: async () => {
            throw new ApiError("Forbidden", 403, "Forbidden", new Headers(), {
              title: "Client Forbidden",
              detail: "Missing required scopes: bookmark.write",
              type: "https://api.twitter.com/2/problems/client-forbidden",
              status: 403,
              reason: "missing-scope",
            });
          },
        },
      } as typeof unusedUsersClient,
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.addBookmarkToFolder("42", "folder-123", "999");
      throw new Error("expected addBookmarkToFolder to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
      expect((err as FinchError).message).toBe(
        "Your X API token is missing the bookmark.write scope. Run `finch auth` to re-authorize with bookmarks access.",
      );
    }
  });

  test("maps a Premium-gated 403 to a clear CLIENT_ERROR", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        client: {
          request: async () => {
            throw new ApiError("Forbidden", 403, "Forbidden", new Headers(), {
              reason: "premium_required",
              detail: "Bookmark folders require Premium.",
            });
          },
        },
      } as typeof unusedUsersClient,
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.addBookmarkToFolder("42", "folder-123", "999");
      throw new Error("expected addBookmarkToFolder to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
      expect((err as FinchError).message).toBe("Bookmark folders require X Premium.");
    }
  });
});

describe("ByokTransport.getUserByUsername", () => {
  test("shapes the profile into the id/username/name/description/public_metrics contract", async () => {
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        getByUsername: async () => ({
          data: {
            id: "1",
            username: "kelly",
            name: "Kelly",
            description: "bio text",
            publicMetrics: { followersCount: 10 },
          },
        }),
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    const profile = await transport.getUserByUsername("kelly");

    expect(profile).toEqual({
      id: "1",
      username: "kelly",
      name: "Kelly",
      description: "bio text",
      public_metrics: { followersCount: 10 },
    });
  });

  test("throws CLIENT_ERROR when the user isn't found", async () => {
    const transport = new ByokTransport(
      { ...unusedUsersClient, getByUsername: async () => ({ errors: [{ detail: "not found" }] }) },
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.getUserByUsername("ghost");
      throw new Error("expected getUserByUsername to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
    }
  });
});

describe("ByokTransport.like", () => {
  test("sends the tweetId in the request body and reports liked: true", async () => {
    let capturedArgs: unknown[] = [];
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        likePost: async (...args: unknown[]) => {
          capturedArgs = args;
          return { data: { liked: true } };
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    const result = await transport.like("1", "999");

    expect(result).toEqual({ liked: true });
    expect(capturedArgs).toEqual(["1", { body: { tweetId: "999" } }]);
  });

  test("falls back to liked: true when the API omits the field", async () => {
    const transport = new ByokTransport(
      { ...unusedUsersClient, likePost: async () => ({ data: {} }) },
      unusedPostsClient,
      unusedMediaClient,
    );

    expect(await transport.like("1", "999")).toEqual({ liked: true });
  });

  test("throws CLIENT_ERROR when the API returns no data", async () => {
    const transport = new ByokTransport(
      { ...unusedUsersClient, likePost: async () => ({ errors: [{ detail: "not found" }] }) },
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.like("1", "999");
      throw new Error("expected like to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
    }
  });
});

describe("ByokTransport.unlike", () => {
  test("passes the userId/tweetId through and reports liked: false", async () => {
    let capturedArgs: unknown[] = [];
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        unlikePost: async (...args: unknown[]) => {
          capturedArgs = args;
          return { data: { liked: false } };
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    const result = await transport.unlike("1", "999");

    expect(result).toEqual({ liked: false });
    expect(capturedArgs).toEqual(["1", "999"]);
  });

  test("falls back to liked: false when the API omits the field", async () => {
    const transport = new ByokTransport(
      { ...unusedUsersClient, unlikePost: async () => ({ data: {} }) },
      unusedPostsClient,
      unusedMediaClient,
    );

    expect(await transport.unlike("1", "999")).toEqual({ liked: false });
  });
});

describe("ByokTransport.retweet", () => {
  test("sends the tweetId in the request body and reports reposted: true", async () => {
    let capturedArgs: unknown[] = [];
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        repostPost: async (...args: unknown[]) => {
          capturedArgs = args;
          return { data: { retweeted: true } };
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    const result = await transport.retweet("1", "999");

    expect(result).toEqual({ reposted: true });
    expect(capturedArgs).toEqual(["1", { body: { tweetId: "999" } }]);
  });

  test("throws CLIENT_ERROR when the API returns no data", async () => {
    const transport = new ByokTransport(
      { ...unusedUsersClient, repostPost: async () => ({ errors: [{ detail: "duplicate" }] }) },
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.retweet("1", "999");
      throw new Error("expected retweet to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
    }
  });
});

describe("ByokTransport.unretweet", () => {
  test("passes the userId/sourceTweetId through and reports reposted: false", async () => {
    let capturedArgs: unknown[] = [];
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        unrepostPost: async (...args: unknown[]) => {
          capturedArgs = args;
          return { data: { retweeted: false } };
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    const result = await transport.unretweet("1", "999");

    expect(result).toEqual({ reposted: false });
    expect(capturedArgs).toEqual(["1", "999"]);
  });
});

describe("ByokTransport.follow", () => {
  test("sends the targetUserId in the request body and reports following: true", async () => {
    let capturedArgs: unknown[] = [];
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        followUser: async (...args: unknown[]) => {
          capturedArgs = args;
          return { data: { following: true } };
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    const result = await transport.follow("1", "42");

    expect(result).toEqual({ following: true });
    expect(capturedArgs).toEqual(["1", { body: { targetUserId: "42" } }]);
  });

  test("throws CLIENT_ERROR when the API returns no data", async () => {
    const transport = new ByokTransport(
      { ...unusedUsersClient, followUser: async () => ({ errors: [{ detail: "blocked" }] }) },
      unusedPostsClient,
      unusedMediaClient,
    );

    try {
      await transport.follow("1", "42");
      throw new Error("expected follow to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
    }
  });
});

describe("ByokTransport.unfollow", () => {
  test("passes the sourceUserId/targetUserId through and reports following: false", async () => {
    let capturedArgs: unknown[] = [];
    const transport = new ByokTransport(
      {
        ...unusedUsersClient,
        unfollowUser: async (...args: unknown[]) => {
          capturedArgs = args;
          return { data: { following: false } };
        },
      },
      unusedPostsClient,
      unusedMediaClient,
    );

    const result = await transport.unfollow("1", "42");

    expect(result).toEqual({ following: false });
    expect(capturedArgs).toEqual(["1", "42"]);
  });
});

function createOAuth2AuthConfig(overrides: Partial<OAuth2AuthConfig> = {}): OAuth2AuthConfig {
  return {
    clientId: "client-123",
    accessToken: "access-old",
    refreshToken: "refresh-old",
    expiresAt: 2_000_000,
    scopes: ["tweet.read"],
    ...overrides,
  };
}

function createRefreshToken(overrides: Partial<OAuth2Token> = {}): OAuth2Token {
  return {
    access_token: "access-new",
    token_type: "Bearer",
    expires_in: 7200,
    refresh_token: "refresh-new",
    scope: "tweet.read",
    ...overrides,
  };
}

describe("createRefreshingOAuth2Transport", () => {
  test("rejects media upload before an API call when the stored token lacks media.write", async () => {
    const config = createOAuth2AuthConfig({ scopes: ["tweet.read", "tweet.write"] });
    let uploadCalled = false;
    const transport = createRefreshingOAuth2Transport(config, {
      nowFn: () => 1_000,
      buildTransportFn: () =>
        fakeTransport({
          uploadImage: async () => {
            uploadCalled = true;
            return { media_id: "unexpected" };
          },
        }),
    });

    try {
      await transport.uploadImage("image.png");
      throw new Error("expected uploadImage to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
      expect((err as FinchError).message).toBe(
        "Media upload requires the media.write OAuth2 scope. Run `finch auth` to re-authorize, then retry.",
      );
    }
    expect(uploadCalled).toBe(false);
  });

  test("does not refresh when the token is far from expiry", async () => {
    const config = createOAuth2AuthConfig();
    const calls = {
      refreshCalled: false,
      persistCalled: false,
      builtWithAccessToken: null as string | null,
    };

    const transport = createRefreshingOAuth2Transport(config, {
      nowFn: () => 1_000,
      refreshFn: async () => {
        calls.refreshCalled = true;
        return createRefreshToken();
      },
      persistFn: () => {
        calls.persistCalled = true;
      },
      buildTransportFn: (accessToken) => {
        calls.builtWithAccessToken = accessToken;
        return fakeTransport({
          getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
        });
      },
    });

    const me = await transport.getMe();

    expect(me).toEqual({ id: "1", username: "kelly", name: "Kelly" });
    expect(calls.refreshCalled).toBe(false);
    expect(calls.persistCalled).toBe(false);
    expect(calls.builtWithAccessToken).toEqual("access-old");
  });

  test("refreshes an expired token, uses the new token, and persists the updated config", async () => {
    const config = createOAuth2AuthConfig({ expiresAt: 2_000_000 });
    const now = 2_000_000;
    const calls = {
      builtWithAccessToken: null as string | null,
      persistedConfig: null as OAuth2AuthConfig | null,
    };

    const transport = createRefreshingOAuth2Transport(config, {
      nowFn: () => now,
      refreshFn: async (clientId, refreshToken) => {
        expect(clientId).toBe("client-123");
        expect(refreshToken).toBe("refresh-old");
        return createRefreshToken({ access_token: "access-refreshed", refresh_token: "refresh-rotated" });
      },
      persistFn: (updatedConfig) => {
        calls.persistedConfig = updatedConfig;
      },
      buildTransportFn: (accessToken) => {
        calls.builtWithAccessToken = accessToken;
        return fakeTransport({
          getMe: async () => ({ id: "2", username: "refreshed", name: "Refreshed" }),
        });
      },
    });

    const me = await transport.getMe();

    expect(me).toEqual({ id: "2", username: "refreshed", name: "Refreshed" });
    expect(calls.builtWithAccessToken).toEqual("access-refreshed");
    expect(calls.persistedConfig).toEqual({
      clientId: "client-123",
      accessToken: "access-refreshed",
      refreshToken: "refresh-rotated",
      expiresAt: now + 7200 * 1000,
      scopes: ["tweet.read"],
    });
  });

  test("preserves the old refresh token when the refresh response omits one", async () => {
    const config = createOAuth2AuthConfig();
    const now = config.expiresAt;
    const calls = { persistedConfig: null as OAuth2AuthConfig | null };

    const transport = createRefreshingOAuth2Transport(config, {
      nowFn: () => now,
      refreshFn: async () => createRefreshToken({ access_token: "access-refreshed", refresh_token: undefined }),
      persistFn: (updatedConfig) => {
        calls.persistedConfig = updatedConfig;
      },
      buildTransportFn: (_accessToken) =>
        fakeTransport({
          getMe: async () => ({ id: "3", username: "same-refresh", name: "Same Refresh" }),
        }),
    });

    await transport.getMe();

    expect(calls.persistedConfig).toEqual({
      clientId: "client-123",
      accessToken: "access-refreshed",
      refreshToken: "refresh-old",
      expiresAt: now + 7200 * 1000,
      scopes: ["tweet.read"],
    });
  });

  test("throws a clean AUTH_ERROR when the refresh call fails", async () => {
    const config = createOAuth2AuthConfig();
    let apiCallMade = false;

    const transport = createRefreshingOAuth2Transport(config, {
      nowFn: () => config.expiresAt,
      refreshFn: async () => {
        throw new ApiError("Unauthorized", 401, "Unauthorized", new Headers(), null);
      },
      // Custom (in-memory) store so this failure-path test never touches the
      // real ~/.finch/config via the default file-backed readback/lock.
      persistFn: () => {},
      buildTransportFn: () =>
        fakeTransport({
          getMe: async () => {
            apiCallMade = true;
            return { id: "1", username: "x", name: "X" };
          },
        }),
    });

    try {
      await transport.getMe();
      throw new Error("expected getMe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
      expect((err as FinchError).message).toBe("Your session has expired — run `finch auth` to log in again.");
    }
    expect(apiCallMade).toBe(false);
  });

  // FIN-78: a refresh attempt that never reached X (offline, DNS failure, X
  // outage) must NOT masquerade as an expired session. The stored refresh
  // token was not spent, so telling the operator to run `finch auth` forces a
  // needless interactive re-login — the exact "aggressive re-prompt instead of
  // transparent refresh" symptom. Only X actually rejecting the token (4xx
  // from the token endpoint) means the session is gone.
  test("maps a network failure during refresh to NETWORK_ERROR, not session-expired", async () => {
    const config = createOAuth2AuthConfig();

    const transport = createRefreshingOAuth2Transport(config, {
      nowFn: () => config.expiresAt,
      refreshFn: async () => {
        // What fetch() throws when the network is down.
        throw new TypeError("fetch failed");
      },
      persistFn: () => {},
      buildTransportFn: () => fakeTransport({}),
    });

    try {
      await transport.getMe();
      throw new Error("expected getMe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("NETWORK_ERROR");
      expect((err as FinchError).message).not.toContain("session has expired");
    }
  });

  test("maps an X 5xx during refresh to NETWORK_ERROR, not session-expired", async () => {
    const config = createOAuth2AuthConfig();

    const transport = createRefreshingOAuth2Transport(config, {
      nowFn: () => config.expiresAt,
      refreshFn: async () => {
        // The exact error shape @xdevplatform/xdk's OAuth2.refreshToken()
        // throws for a non-ok token-endpoint response.
        throw new Error('Failed to refresh token: 503, body: "Service Unavailable"');
      },
      persistFn: () => {},
      buildTransportFn: () => fakeTransport({}),
    });

    try {
      await transport.getMe();
      throw new Error("expected getMe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("NETWORK_ERROR");
    }
  });

  test("maps an xdk-shaped 400 token-endpoint rejection to session-expired", async () => {
    const config = createOAuth2AuthConfig();

    const transport = createRefreshingOAuth2Transport(config, {
      nowFn: () => config.expiresAt,
      refreshFn: async () => {
        throw new Error('Failed to refresh token: 400, body: {"error":"invalid_request"}');
      },
      persistFn: () => {},
      buildTransportFn: () => fakeTransport({}),
    });

    try {
      await transport.getMe();
      throw new Error("expected getMe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
      expect((err as FinchError).message).toBe("Your session has expired — run `finch auth` to log in again.");
    }
  });

  test("propagates a FinchError thrown by an injected refreshFn unchanged", async () => {
    const config = createOAuth2AuthConfig();

    const transport = createRefreshingOAuth2Transport(config, {
      nowFn: () => config.expiresAt,
      refreshFn: async () => {
        throw new FinchError("RATE_LIMITED", "Rate limited by the X API", null);
      },
      persistFn: () => {},
      buildTransportFn: () => fakeTransport({}),
    });

    try {
      await transport.getMe();
      throw new Error("expected getMe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("RATE_LIMITED");
    }
  });

  describe("default persist path", () => {
    let fakeHome: string;
    let originalConfigPath: string | undefined;

    // FIN-77: configPath() no longer defaults from $HOME, so isolation here
    // uses the documented FINCH_CONFIG_PATH override instead — spoofing HOME
    // would now be a no-op and this suite would silently read/write the
    // real ~/.finch/config.
    beforeEach(() => {
      fakeHome = mkdtempSync(join(tmpdir(), "finch-transport-test-"));
      originalConfigPath = process.env.FINCH_CONFIG_PATH;
      process.env.FINCH_CONFIG_PATH = join(fakeHome, ".finch", "config");
    });

    afterEach(() => {
      if (originalConfigPath === undefined) delete process.env.FINCH_CONFIG_PATH;
      else process.env.FINCH_CONFIG_PATH = originalConfigPath;
      rmSync(fakeHome, { recursive: true, force: true });
    });

    test("preserves user-configured defaults when persisting after refresh", async () => {
      const now = 2_000_000;
      const authConfig = createOAuth2AuthConfig({ expiresAt: now });
      writeOAuth2Config({
        auth: authConfig,
        transport: "oauth2",
        defaults: { json: true, count: 50 },
      });

      const transport = createRefreshingOAuth2Transport(authConfig, {
        nowFn: () => now,
        refreshFn: async () =>
          createRefreshToken({ access_token: "access-refreshed", refresh_token: "refresh-rotated" }),
        buildTransportFn: () =>
          fakeTransport({
            getMe: async () => ({ id: "5", username: "defaults-saver", name: "Defaults Saver" }),
          }),
      });

      await transport.getMe();

      const persisted = readOAuth2Config();
      expect(persisted?.defaults).toEqual({ json: true, count: 50 });
      expect(persisted?.auth).toEqual({
        clientId: "client-123",
        accessToken: "access-refreshed",
        refreshToken: "refresh-rotated",
        expiresAt: now + 7200 * 1000,
        scopes: ["tweet.read"],
      });
    });

    test("concurrent refreshes consume the single-use refresh token once; losers reuse the rotated credential", async () => {
      const now = 2_000_000;
      const authConfig = createOAuth2AuthConfig({ expiresAt: now });
      writeOAuth2Config({
        auth: authConfig,
        transport: "oauth2",
        defaults: { json: false, count: 10 },
      });

      const refreshTokensSeen: string[] = [];
      const refreshFn = async (_clientId: string, refreshToken: string): Promise<OAuth2Token> => {
        refreshTokensSeen.push(refreshToken);
        // X invalidates a rotating refresh token after its first use.
        if (refreshToken !== "refresh-old") {
          throw new ApiError("Unauthorized", 401, "invalid_grant", new Headers(), null);
        }
        return createRefreshToken({ access_token: "access-rotated", refresh_token: "refresh-rotated" });
      };

      // Two independent transport instances share the same on-disk store, as
      // two concurrent commands / MCP tool calls would.
      const makeTransport = () =>
        createRefreshingOAuth2Transport(
          { ...authConfig },
          {
            nowFn: () => now,
            refreshFn,
            buildTransportFn: (accessToken) =>
              fakeTransport({
                getMe: async () => ({ id: "1", username: accessToken, name: "Concurrent" }),
              }),
          },
        );

      const [a, b] = await Promise.all([makeTransport().getMe(), makeTransport().getMe()]);

      // The old, single-use refresh token was presented to X exactly once.
      expect(refreshTokensSeen.filter((t) => t === "refresh-old")).toHaveLength(1);
      expect(refreshTokensSeen).not.toContain("refresh-rotated");
      // Both callers end up authenticated with the rotated access token.
      expect(a.username).toBe("access-rotated");
      expect(b.username).toBe("access-rotated");

      const persisted = readOAuth2Config();
      expect(persisted?.auth.accessToken).toBe("access-rotated");
      expect(persisted?.auth.refreshToken).toBe("refresh-rotated");
    });
  });

  test("reuses the cached transport on subsequent calls", async () => {
    const config = createOAuth2AuthConfig();
    let buildCount = 0;

    const transport = createRefreshingOAuth2Transport(config, {
      nowFn: () => 1_000,
      buildTransportFn: (accessToken) => {
        buildCount++;
        return fakeTransport({
          getMe: async () => ({ id: String(buildCount), username: accessToken, name: "Name" }),
        });
      },
    });

    await transport.getMe();
    await transport.getMe();

    expect(buildCount).toBe(1);
  });

  test("reactively refreshes and retries once when a live call is rejected as unauthorized", async () => {
    // Access token still looks fresh locally, but X has invalidated it early
    // (e.g. server-side revocation). The proactive clock check won't fire, so
    // the transport must react to the credential-rejection and refresh once.
    const config = createOAuth2AuthConfig({ expiresAt: 10_000_000 });
    let refreshCalls = 0;
    let getMeAttempts = 0;

    const transport = createRefreshingOAuth2Transport(config, {
      nowFn: () => 1_000,
      refreshFn: async (_clientId, refreshToken) => {
        refreshCalls++;
        expect(refreshToken).toBe("refresh-old");
        return createRefreshToken({ access_token: "access-reactive", refresh_token: "refresh-reactive" });
      },
      persistFn: () => {},
      buildTransportFn: (accessToken) =>
        fakeTransport({
          getMe: async () => {
            getMeAttempts++;
            if (accessToken !== "access-reactive") {
              throw new FinchError("AUTH_ERROR", "X rejected the provided credentials");
            }
            return { id: "9", username: "reactive", name: "Reactive" };
          },
        }),
    });

    const me = await transport.getMe();

    expect(me).toEqual({ id: "9", username: "reactive", name: "Reactive" });
    expect(refreshCalls).toBe(1);
    expect(getMeAttempts).toBe(2);
  });

  test("does not reactively refresh on a non-credential AUTH_ERROR (e.g. missing scope)", async () => {
    const config = createOAuth2AuthConfig({ expiresAt: 10_000_000 });
    let refreshCalls = 0;

    const transport = createRefreshingOAuth2Transport(config, {
      nowFn: () => 1_000,
      refreshFn: async () => {
        refreshCalls++;
        return createRefreshToken();
      },
      persistFn: () => {},
      buildTransportFn: () =>
        fakeTransport({
          addBookmark: async () => {
            throw new FinchError(
              "AUTH_ERROR",
              "Your X API token is missing the bookmark.write scope. Run `finch auth` to re-authorize with bookmarks access.",
            );
          },
        }),
    });

    await expect(transport.addBookmark("u1", "t1")).rejects.toThrow("missing the bookmark.write scope");
    expect(refreshCalls).toBe(0);
  });

  test("throws session-expired without a network call when no refresh token is stored", async () => {
    const config = createOAuth2AuthConfig({ refreshToken: "", expiresAt: 2_000_000 });
    let refreshCalls = 0;

    const transport = createRefreshingOAuth2Transport(config, {
      nowFn: () => 2_000_000,
      refreshFn: async () => {
        refreshCalls++;
        return createRefreshToken();
      },
      persistFn: () => {},
      buildTransportFn: () => fakeTransport({}),
    });

    try {
      await transport.getMe();
      throw new Error("expected getMe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
      expect((err as FinchError).message).toBe("Your session has expired — run `finch auth` to log in again.");
    }
    expect(refreshCalls).toBe(0);
  });
});

describe("FIN-78: refresh classification through the real XDK refresh path (mocked fetch)", () => {
  // No injected refreshFn: these tests run @xdevplatform/xdk's real
  // OAuth2.refreshToken() against a mocked global fetch, so they pin the
  // actual XDK error/response contract the classifier depends on. If an XDK
  // upgrade changes its error text or token shape, these fail loudly instead
  // of silently reclassifying a dead credential as a network problem.
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  interface CapturedTokenRequest {
    url: string;
    body: string;
  }

  function mockTokenEndpoint(respond: () => Response | Promise<Response>, captured?: CapturedTokenRequest[]): void {
    globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
      captured?.push({ url: String(url), body: String(init?.body ?? "") });
      return respond();
    }) as typeof fetch;
  }

  function expiredRefreshingTransport(persisted?: OAuth2AuthConfig[]) {
    const config = createOAuth2AuthConfig();
    return createRefreshingOAuth2Transport(config, {
      nowFn: () => config.expiresAt,
      persistFn: (persistedConfig) => {
        persisted?.push({ ...persistedConfig });
      },
      buildTransportFn: () => fakeTransport({ getMe: async () => ({ id: "1", username: "x", name: "X" }) }),
    });
  }

  async function classifiedFailure(transport: XTransport): Promise<FinchError> {
    try {
      await transport.getMe();
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      return err as FinchError;
    }
    throw new Error("expected getMe to throw");
  }

  function tokenEndpointResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  test("a 400 invalid_grant from the token endpoint is a terminal session-expired AUTH_ERROR", async () => {
    mockTokenEndpoint(() => tokenEndpointResponse(400, { error: "invalid_grant", error_description: "revoked" }));
    const err = await classifiedFailure(expiredRefreshingTransport());
    expect(err.code).toBe("AUTH_ERROR");
    expect(err.message).toBe("Your session has expired \u2014 run `finch auth` to log in again.");
  });

  test("a 401 invalid_client from the token endpoint is a terminal session-expired AUTH_ERROR", async () => {
    mockTokenEndpoint(() => tokenEndpointResponse(401, { error: "invalid_client" }));
    const err = await classifiedFailure(expiredRefreshingTransport());
    expect(err.code).toBe("AUTH_ERROR");
  });

  test("a 408 from the token endpoint is retryable, not session-expired", async () => {
    mockTokenEndpoint(() => tokenEndpointResponse(408, { title: "Request Timeout" }));
    const err = await classifiedFailure(expiredRefreshingTransport());
    expect(err.code).toBe("NETWORK_ERROR");
  });

  test("a 425 from the token endpoint is retryable, not session-expired", async () => {
    mockTokenEndpoint(() => tokenEndpointResponse(425, { title: "Too Early" }));
    const err = await classifiedFailure(expiredRefreshingTransport());
    expect(err.code).toBe("NETWORK_ERROR");
  });

  test("a 429 from the token endpoint is retryable, not session-expired", async () => {
    mockTokenEndpoint(() => tokenEndpointResponse(429, { title: "Too Many Requests" }));
    const err = await classifiedFailure(expiredRefreshingTransport());
    expect(err.code).toBe("NETWORK_ERROR");
  });

  test("a 503 from the token endpoint is retryable, not session-expired", async () => {
    mockTokenEndpoint(() => tokenEndpointResponse(503, { title: "Service Unavailable" }));
    const err = await classifiedFailure(expiredRefreshingTransport());
    expect(err.code).toBe("NETWORK_ERROR");
  });

  test("a network-level fetch failure is retryable and its message never overclaims the outcome", async () => {
    mockTokenEndpoint(() => {
      throw new TypeError("fetch failed");
    });
    const err = await classifiedFailure(expiredRefreshingTransport());
    expect(err.code).toBe("NETWORK_ERROR");
    // The outcome is ambiguous: X may or may not have processed the refresh
    // before the connection died, and a rotating refresh token may have been
    // spent. The message must advise a retry without guaranteeing that the
    // stored credential is still valid.
    expect(err.message).toContain("retry");
    expect(err.message).not.toContain("still valid");
    expect(err.message).not.toContain("session has expired");
  });

  test("a successful token response persists the rotated credential and pins the public-client request shape", async () => {
    const captured: CapturedTokenRequest[] = [];
    const persisted: OAuth2AuthConfig[] = [];
    mockTokenEndpoint(
      () =>
        tokenEndpointResponse(200, {
          access_token: "access-xdk-rotated",
          token_type: "bearer",
          expires_in: 7200,
          refresh_token: "refresh-xdk-rotated",
          scope: "tweet.read",
        }),
      captured,
    );

    const transport = expiredRefreshingTransport(persisted);
    const me = await transport.getMe();
    expect(me.username).toBe("x");

    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.accessToken).toBe("access-xdk-rotated");
    expect(persisted[0]?.refreshToken).toBe("refresh-xdk-rotated");

    // Public-client refresh request contract (X token endpoint): form-encoded
    // grant_type + refresh_token + client_id (no client secret in Finch).
    expect(captured).toHaveLength(1);
    const request = captured[0] as CapturedTokenRequest;
    expect(request.url).toContain("/2/oauth2/token");
    const params = new URLSearchParams(request.body);
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("refresh-old");
    expect(params.get("client_id")).toBe("client-123");
  });
});

describe("createOAuth2Transport", () => {
  test("wires the underlying XDK client as the raw client", () => {
    const transport = createOAuth2Transport("user-context-token") as ByokTransport;
    const rawClient = (transport as unknown as { rawClient: { accessToken?: string; bearerToken?: string } }).rawClient;

    expect(rawClient).toBeDefined();
    expect(rawClient.accessToken).toBe("user-context-token");
    expect(rawClient.bearerToken).toBeUndefined();
  });

  test("sends the user-context bearer token when creating an article draft", async () => {
    const transport = createOAuth2Transport("user-context-token") as ByokTransport;
    const rawClient = (
      transport as unknown as {
        rawClient: {
          httpClient: {
            request: (
              url: string,
              options: { method?: string; headers?: Headers; body?: string; signal?: AbortSignal; timeout?: number },
            ) => Promise<unknown>;
          };
        };
      }
    ).rawClient;

    let captured: { url?: string; authorization?: string } = {};
    const originalRequest = rawClient.httpClient.request.bind(rawClient.httpClient);
    rawClient.httpClient.request = async (
      url: string,
      options: { method?: string; headers?: Headers; body?: string; signal?: AbortSignal; timeout?: number },
    ) => {
      const headers = new Headers(options.headers);
      captured = {
        url,
        authorization: headers.get("authorization") ?? undefined,
      };
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        url,
        json: async () => ({ data: { id: "draft-123" } }),
        text: async () => "",
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    };

    try {
      const result = await transport.createArticleDraft("Test", { blocks: [], entities: [] });

      expect(result).toEqual({ id: "draft-123" });
      expect(captured.url).toBe("https://api.x.com/2/articles/draft");
      expect(captured.authorization).toBe("Bearer user-context-token");
    } finally {
      rawClient.httpClient.request = originalRequest;
    }
  });
});
