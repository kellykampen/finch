import { describe, test, expect } from "bun:test";
import { ApiError } from "@xdevplatform/xdk";
import { ByokTransport } from "./transport";
import { FinchError } from "./errors";

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
    );

    const me = await transport.getMe();

    expect(me).toEqual({ id: "123", username: "kelly", name: "Kelly" });
  });

  test("throws AUTH_ERROR when the response has no data", async () => {
    const transport = new ByokTransport(
      { ...unusedUsersClient, getMe: async () => ({ errors: [{ detail: "no user" }] }) },
      unusedPostsClient,
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
    const transport = new ByokTransport(unusedUsersClient, {
      ...unusedPostsClient,
      create: async (body) => {
        capturedBody = body;
        return { data: { id: "1", text: "hello" } };
      },
    });

    const result = await transport.createTweet("hello");

    expect(result).toEqual({ id: "1", text: "hello" });
    expect(capturedBody).toEqual({ text: "hello" });
  });

  test("includes the reply field when replyToId is given", async () => {
    let capturedBody: unknown;
    const transport = new ByokTransport(unusedUsersClient, {
      ...unusedPostsClient,
      create: async (body) => {
        capturedBody = body;
        return { data: { id: "2", text: "a reply" } };
      },
    });

    await transport.createTweet("a reply", "999");

    expect(capturedBody).toEqual({ text: "a reply", reply: { in_reply_to_tweet_id: "999" } });
  });

  test("throws CLIENT_ERROR when the API returns no data", async () => {
    const transport = new ByokTransport(unusedUsersClient, {
      ...unusedPostsClient,
      create: async () => ({ errors: [{ detail: "duplicate content" }] }),
    });

    try {
      await transport.createTweet("dup");
      throw new Error("expected createTweet to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
    }
  });

  test("maps a 403 ApiError to AUTH_ERROR", async () => {
    const transport = new ByokTransport(unusedUsersClient, {
      ...unusedPostsClient,
      create: async () => {
        throw new ApiError("Forbidden", 403, "Forbidden", new Headers(), null);
      },
    });

    try {
      await transport.createTweet("hello");
      throw new Error("expected createTweet to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
    }
  });
});

describe("ByokTransport.getTweet", () => {
  test("shapes the tweet into the id/text/author_id/created_at contract", async () => {
    const transport = new ByokTransport(unusedUsersClient, {
      ...unusedPostsClient,
      getById: async () => ({
        data: { id: "1", text: "hi", authorId: "42", createdAt: "2026-01-01T00:00:00.000Z" },
      }),
    });

    const tweet = await transport.getTweet("1");

    expect(tweet).toEqual({
      id: "1",
      text: "hi",
      author_id: "42",
      created_at: "2026-01-01T00:00:00.000Z",
    });
  });

  test("throws CLIENT_ERROR when the post isn't found", async () => {
    const transport = new ByokTransport(unusedUsersClient, {
      ...unusedPostsClient,
      getById: async () => ({ errors: [{ detail: "not found" }] }),
    });

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
    const transport = new ByokTransport(unusedUsersClient, {
      ...unusedPostsClient,
      searchRecent: async (query, options) => {
        capturedOptions = options;
        return { data: [{ id: "1", text: "match", authorId: "7" }] };
      },
    });

    const posts = await transport.searchRecent("hello", 25);

    expect(posts).toEqual([{ id: "1", text: "match", author_id: "7", created_at: null }]);
    expect(capturedOptions).toEqual({ maxResults: 25, tweetFields: ["author_id", "created_at"] });
  });

  test("returns an empty array when the API omits data (zero results)", async () => {
    const transport = new ByokTransport(unusedUsersClient, {
      ...unusedPostsClient,
      searchRecent: async () => ({}),
    });

    expect(await transport.searchRecent("nothing", 10)).toEqual([]);
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
    );

    const posts = await transport.homeTimeline("42", 10);

    expect(posts).toEqual([{ id: "1", text: "home", author_id: null, created_at: null }]);
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
    );

    const result = await transport.like("1", "999");

    expect(result).toEqual({ liked: true });
    expect(capturedArgs).toEqual(["1", { body: { tweetId: "999" } }]);
  });

  test("falls back to liked: true when the API omits the field", async () => {
    const transport = new ByokTransport(
      { ...unusedUsersClient, likePost: async () => ({ data: {} }) },
      unusedPostsClient,
    );

    expect(await transport.like("1", "999")).toEqual({ liked: true });
  });

  test("throws CLIENT_ERROR when the API returns no data", async () => {
    const transport = new ByokTransport(
      { ...unusedUsersClient, likePost: async () => ({ errors: [{ detail: "not found" }] }) },
      unusedPostsClient,
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
    );

    const result = await transport.unlike("1", "999");

    expect(result).toEqual({ liked: false });
    expect(capturedArgs).toEqual(["1", "999"]);
  });

  test("falls back to liked: false when the API omits the field", async () => {
    const transport = new ByokTransport(
      { ...unusedUsersClient, unlikePost: async () => ({ data: {} }) },
      unusedPostsClient,
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
    );

    const result = await transport.retweet("1", "999");

    expect(result).toEqual({ reposted: true });
    expect(capturedArgs).toEqual(["1", { body: { tweetId: "999" } }]);
  });

  test("throws CLIENT_ERROR when the API returns no data", async () => {
    const transport = new ByokTransport(
      { ...unusedUsersClient, repostPost: async () => ({ errors: [{ detail: "duplicate" }] }) },
      unusedPostsClient,
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
    );

    const result = await transport.follow("1", "42");

    expect(result).toEqual({ following: true });
    expect(capturedArgs).toEqual(["1", { body: { targetUserId: "42" } }]);
  });

  test("throws CLIENT_ERROR when the API returns no data", async () => {
    const transport = new ByokTransport(
      { ...unusedUsersClient, followUser: async () => ({ errors: [{ detail: "blocked" }] }) },
      unusedPostsClient,
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
    );

    const result = await transport.unfollow("1", "42");

    expect(result).toEqual({ following: false });
    expect(capturedArgs).toEqual(["1", "42"]);
  });
});
