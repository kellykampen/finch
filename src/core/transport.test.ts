import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, type OAuth2Token } from "@xdevplatform/xdk";
import { ByokTransport, createRefreshingOAuth2Transport } from "./transport";
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

    expect(capturedBody).toEqual({
      mediaId: "media-123",
      altText: { text: "A useful description" },
    });
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

  describe("default persist path", () => {
    let fakeHome: string;
    let originalHome: string | undefined;

    beforeEach(() => {
      fakeHome = mkdtempSync(join(tmpdir(), "finch-transport-test-"));
      originalHome = process.env.HOME;
      process.env.HOME = fakeHome;
    });

    afterEach(() => {
      process.env.HOME = originalHome;
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
});
