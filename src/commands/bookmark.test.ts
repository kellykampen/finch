import { describe, test, expect } from "bun:test";
import {
  runBookmarkList,
  runBookmarkAdd,
  runBookmarkRemove,
  runBookmarkFolders,
  runBookmarkFolderNew,
} from "./bookmark";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";
import type { FinchOAuth2Config } from "../core/oauth2-config";

const post = { id: "1", text: "hi", author_id: "42", created_at: null };

function fakeConfig(count: number): FinchOAuth2Config {
  return {
    auth: {
      clientId: "client123",
      accessToken: "token123",
      refreshToken: "refresh123",
      expiresAt: 1_700_000_000_000,
      scopes: ["tweet.read", "bookmark.read", "users.read"],
    },
    transport: "oauth2",
    defaults: { json: false, count },
  };
}

describe("runBookmarkList", () => {
  // FIN-82 review: flag validation must precede transport/auth, so a typo is a
  // clean USAGE_ERROR rather than a live network request.
  test("rejects an unrecognized flag before resolving the transport", async () => {
    await expect(
      runBookmarkList(["--bogus"], {
        getTransport: () => {
          throw new Error("transport must not be reached");
        },
      }),
    ).rejects.toMatchObject({ code: "USAGE_ERROR" });
  });

  test("resolves the authenticated user's id then fetches their bookmarks", async () => {
    let capturedUserId: string | undefined;
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      listBookmarks: async (userId, count) => {
        capturedUserId = userId;
        capturedCount = count;
        return [post];
      },
    });

    const result = await runBookmarkList([], { getTransport: () => transport, getConfig: () => fakeConfig(10) });

    expect(result.data).toEqual({ posts: [post] });
    expect(capturedUserId).toBe("42");
    expect(capturedCount).toBe(10);
  });

  test("passes -n through as the max result count", async () => {
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      listBookmarks: async (_userId, count) => {
        capturedCount = count;
        return [];
      },
    });

    await runBookmarkList(["-n", "25"], { getTransport: () => transport, getConfig: () => fakeConfig(10) });

    expect(capturedCount).toBe(25);
  });

  test("passes --count through as an alias for -n", async () => {
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      listBookmarks: async (_userId, count) => {
        capturedCount = count;
        return [];
      },
    });

    await runBookmarkList(["--count", "25"], { getTransport: () => transport, getConfig: () => fakeConfig(10) });

    expect(capturedCount).toBe(25);
  });

  test("uses the configured default count when -n is omitted", async () => {
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      listBookmarks: async (_userId, count) => {
        capturedCount = count;
        return [];
      },
    });

    await runBookmarkList([], { getTransport: () => transport, getConfig: () => fakeConfig(7) });

    expect(capturedCount).toBe(7);
  });

  test("clamps an oversized configured default count to the API max", async () => {
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      listBookmarks: async (_userId, count) => {
        capturedCount = count;
        return [];
      },
    });

    await runBookmarkList([], { getTransport: () => transport, getConfig: () => fakeConfig(500) });

    expect(capturedCount).toBe(100);
  });

  test("falls back to 10 when no configured default count exists", async () => {
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      listBookmarks: async (_userId, count) => {
        capturedCount = count;
        return [];
      },
    });

    await runBookmarkList([], { getTransport: () => transport, getConfig: () => null });

    expect(capturedCount).toBe(10);
  });

  test("uses folder-scoped list when --folder is provided", async () => {
    let capturedUserId: string | undefined;
    let capturedFolderId: string | undefined;
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      listBookmarksInFolder: async (userId, folderId, count) => {
        capturedUserId = userId;
        capturedFolderId = folderId;
        capturedCount = count;
        return [post];
      },
    });

    const result = await runBookmarkList(["--folder", "folder-123"], {
      getTransport: () => transport,
      getConfig: () => fakeConfig(10),
    });

    expect(result.data).toEqual({ posts: [post] });
    expect(capturedUserId).toBe("42");
    expect(capturedFolderId).toBe("folder-123");
    expect(capturedCount).toBe(10);
  });

  test("passes -n through on folder-scoped list", async () => {
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      listBookmarksInFolder: async (_userId, _folderId, count) => {
        capturedCount = count;
        return [];
      },
    });

    await runBookmarkList(["--folder", "folder-123", "-n", "25"], {
      getTransport: () => transport,
      getConfig: () => fakeConfig(10),
    });

    expect(capturedCount).toBe(25);
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    await expect(
      runBookmarkList([], {
        getTransport: () => {
          throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
        },
        getConfig: () => null,
      }),
    ).rejects.toThrow(FinchError);
  });
});

describe("runBookmarkAdd", () => {
  test("bookmarks a bare id", async () => {
    let capturedUserId: string | undefined;
    let capturedTweetId: string | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      addBookmark: async (userId, tweetId) => {
        capturedUserId = userId;
        capturedTweetId = tweetId;
        return { bookmarked: true };
      },
    });

    const result = await runBookmarkAdd(["999"], { getTransport: () => transport });

    expect(result.data).toEqual({ bookmarked: true, tweet_id: "999" });
    expect(capturedUserId).toBe("42");
    expect(capturedTweetId).toBe("999");
  });

  test("extracts the id from a status URL", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      addBookmark: async () => ({ bookmarked: true }),
    });

    const result = await runBookmarkAdd(["https://x.com/user/status/999"], { getTransport: () => transport });

    expect(result.data).toEqual({ bookmarked: true, tweet_id: "999" });
  });

  test("--dry-run reports wouldSend without calling the transport", async () => {
    const result = await runBookmarkAdd(["999", "--dry-run"], {
      getTransport: () => {
        throw new Error("should not be called");
      },
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { tweet_id: "999" } });
  });

  test("--dry-run doesn't require auth to be configured", async () => {
    const result = await runBookmarkAdd(["999", "--dry-run"], {
      getTransport: () => {
        throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
      },
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { tweet_id: "999" } });
  });

  test("throws USAGE_ERROR when the id-or-url argument is missing", async () => {
    await expect(runBookmarkAdd([], { getTransport: () => fakeTransport({}) })).rejects.toThrow(FinchError);
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    await expect(
      runBookmarkAdd(["999"], {
        getTransport: () => {
          throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
        },
      }),
    ).rejects.toThrow(FinchError);
  });

  test("surfaces a missing bookmark.write scope as a clear AUTH_ERROR", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      addBookmark: async () => {
        throw new FinchError(
          "AUTH_ERROR",
          "Your X API token is missing the bookmark.write scope. Run `finch auth` to re-authorize with bookmarks access.",
        );
      },
    });

    await expect(runBookmarkAdd(["999"], { getTransport: () => transport })).rejects.toThrow(FinchError);
  });

  test("adds a bookmark to a folder when --folder is provided", async () => {
    let capturedUserId: string | undefined;
    let capturedFolderId: string | undefined;
    let capturedTweetId: string | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      addBookmarkToFolder: async (userId, folderId, tweetId) => {
        capturedUserId = userId;
        capturedFolderId = folderId;
        capturedTweetId = tweetId;
        return { bookmarked: true };
      },
    });

    const result = await runBookmarkAdd(["999", "--folder", "folder-123"], { getTransport: () => transport });

    expect(result.data).toEqual({ bookmarked: true, tweet_id: "999" });
    expect(result.human).toBe("Bookmarked 999 in folder folder-123");
    expect(capturedUserId).toBe("42");
    expect(capturedFolderId).toBe("folder-123");
    expect(capturedTweetId).toBe("999");
  });

  test("--dry-run reports folder target without calling the transport", async () => {
    const result = await runBookmarkAdd(["999", "--folder", "folder-123", "--dry-run"], {
      getTransport: () => {
        throw new Error("should not be called");
      },
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { tweet_id: "999", folder_id: "folder-123" } });
    expect(result.human).toBe("Would bookmark 999 in folder folder-123");
  });
});

describe("runBookmarkRemove", () => {
  test("removes a bookmark for a bare id", async () => {
    let capturedUserId: string | undefined;
    let capturedTweetId: string | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      removeBookmark: async (userId, tweetId) => {
        capturedUserId = userId;
        capturedTweetId = tweetId;
        return { bookmarked: false };
      },
    });

    const result = await runBookmarkRemove(["999"], { getTransport: () => transport });

    expect(result.data).toEqual({ bookmarked: false, tweet_id: "999" });
    expect(capturedUserId).toBe("42");
    expect(capturedTweetId).toBe("999");
  });

  test("extracts the id from a status URL", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      removeBookmark: async () => ({ bookmarked: false }),
    });

    const result = await runBookmarkRemove(["https://x.com/user/status/999"], { getTransport: () => transport });

    expect(result.data).toEqual({ bookmarked: false, tweet_id: "999" });
  });

  test("--dry-run reports wouldSend without calling the transport", async () => {
    const result = await runBookmarkRemove(["999", "--dry-run"], {
      getTransport: () => {
        throw new Error("should not be called");
      },
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { tweet_id: "999" } });
  });

  test("--dry-run doesn't require auth to be configured", async () => {
    const result = await runBookmarkRemove(["999", "--dry-run"], {
      getTransport: () => {
        throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
      },
    });

    expect(result.data).toEqual({ dryRun: true, wouldSend: { tweet_id: "999" } });
  });

  test("throws USAGE_ERROR when the id-or-url argument is missing", async () => {
    await expect(runBookmarkRemove([], { getTransport: () => fakeTransport({}) })).rejects.toThrow(FinchError);
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    await expect(
      runBookmarkRemove(["999"], {
        getTransport: () => {
          throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
        },
      }),
    ).rejects.toThrow(FinchError);
  });
});

describe("runBookmarkFolders", () => {
  test("resolves the authenticated user's id then fetches their bookmark folders", async () => {
    let capturedUserId: string | undefined;
    const folders = [
      { id: "111", name: "Work" },
      { id: "222", name: "Read later" },
    ];
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      listBookmarkFolders: async (userId) => {
        capturedUserId = userId;
        return folders;
      },
    });

    const result = await runBookmarkFolders([], { getTransport: () => transport });

    expect(result.data).toEqual({ folders });
    expect(result.human).toBe("111\tWork\n222\tRead later");
    expect(capturedUserId).toBe("42");
  });

  test("renders a helpful empty-state message", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      listBookmarkFolders: async () => [],
    });

    const result = await runBookmarkFolders([], { getTransport: () => transport });

    expect(result.data).toEqual({ folders: [] });
    expect(result.human).toBe("No bookmark folders found.");
  });

  // FIN-82 review: rejects an unknown flag before touching the transport.
  test("rejects an unrecognized flag without hitting the network", async () => {
    await expect(
      runBookmarkFolders(["--bogus"], {
        getTransport: () => {
          throw new Error("transport must not be reached");
        },
      }),
    ).rejects.toMatchObject({ code: "USAGE_ERROR" });
  });
});

describe("runBookmarkFolderNew", () => {
  test("creates a bookmark folder for the authenticated user", async () => {
    let capturedUserId: string | undefined;
    let capturedName: string | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "42", username: "kelly", name: "Kelly" }),
      createBookmarkFolder: async (userId, name) => {
        capturedUserId = userId;
        capturedName = name;
        return { id: "333", name };
      },
    });

    const result = await runBookmarkFolderNew(["Project notes"], { getTransport: () => transport });

    expect(result.data).toEqual({ folder: { id: "333", name: "Project notes" } });
    expect(result.human).toBe("Created bookmark folder 333\tProject notes");
    expect(capturedUserId).toBe("42");
    expect(capturedName).toBe("Project notes");
  });

  test("throws USAGE_ERROR when the folder name is missing", async () => {
    await expect(runBookmarkFolderNew([], { getTransport: () => fakeTransport({}) })).rejects.toThrow(FinchError);
  });
});
