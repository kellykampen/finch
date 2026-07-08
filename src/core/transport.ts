import { Client, OAuth1, ApiError } from "@xdevplatform/xdk";
import type { FinchAuthConfig } from "./config";
import { FinchError } from "./errors";

export interface FinchUser {
  id: string;
  username: string;
  name: string;
}

export interface FinchUserProfile {
  id: string;
  username: string;
  name: string;
  description: string;
  public_metrics: Record<string, unknown>;
}

export interface FinchTweet {
  id: string;
  text: string;
  author_id: string | null;
  created_at: string | null;
}

export interface CreatedTweet {
  id: string;
  text: string;
}

export interface LikeStatus {
  liked: boolean;
}

export interface RepostStatus {
  reposted: boolean;
}

export interface FollowStatus {
  following: boolean;
}

/**
 * Every core command function depends on this interface, never on the SDK
 * directly — ByokTransport is v1's only implementation; a phase-2
 * ProxyTransport slots in here without touching command handlers.
 */
export interface XTransport {
  getMe(): Promise<FinchUser>;
  createTweet(text: string, replyToId?: string): Promise<CreatedTweet>;
  getTweet(id: string): Promise<FinchTweet>;
  searchRecent(query: string, maxResults: number): Promise<FinchTweet[]>;
  userTweets(userId: string, maxResults: number): Promise<FinchTweet[]>;
  homeTimeline(userId: string, maxResults: number): Promise<FinchTweet[]>;
  getUserByUsername(username: string): Promise<FinchUserProfile>;
  like(userId: string, tweetId: string): Promise<LikeStatus>;
  unlike(userId: string, tweetId: string): Promise<LikeStatus>;
  retweet(userId: string, tweetId: string): Promise<RepostStatus>;
  unretweet(userId: string, tweetId: string): Promise<RepostStatus>;
  follow(userId: string, targetUserId: string): Promise<FollowStatus>;
  unfollow(userId: string, targetUserId: string): Promise<FollowStatus>;
}

interface GetMeResult {
  data?: { id: string; username: string; name: string };
  errors?: unknown;
}

// The SDK's own `Tweet`/`User` model types mark every field optional (they're
// shared across many partial-expansion contexts); these narrower shapes
// describe what's actually guaranteed given the `tweetFields`/`userFields` we
// always request below.
interface TweetLike {
  id: string;
  text: string;
  authorId?: string;
  createdAt?: string;
}

interface UserLike {
  id: string;
  username: string;
  name: string;
  description?: string;
  publicMetrics?: Record<string, unknown>;
}

interface ListResult<T> {
  data?: T[];
  errors?: unknown;
}

interface ItemResult<T> {
  data?: T;
  errors?: unknown;
}

interface ListOptions {
  maxResults?: number;
  tweetFields?: string[];
}

// The engagement endpoints' response `data` is untyped in the SDK
// (`Record<string, any>`) — X does return a `{liked: bool}`/`{retweeted:
// bool}`/`{following: bool}` field, but since it's unconfirmed at the type
// level, ByokTransport treats it as an existence check and falls back to the
// known post/pre-condition boolean when the field itself is absent.
interface EngageActionResult {
  data?: Record<string, unknown>;
  errors?: unknown;
}

interface UsersClientLike {
  getMe(): Promise<GetMeResult>;
  getByUsername(username: string, options?: { userFields?: string[] }): Promise<ItemResult<UserLike>>;
  getPosts(id: string, options?: ListOptions): Promise<ListResult<TweetLike>>;
  getTimeline(id: string, options?: ListOptions): Promise<ListResult<TweetLike>>;
  likePost(id: string, options: { body: { tweetId: string } }): Promise<EngageActionResult>;
  unlikePost(id: string, tweetId: string): Promise<EngageActionResult>;
  repostPost(id: string, options: { body: { tweetId: string } }): Promise<EngageActionResult>;
  unrepostPost(id: string, sourceTweetId: string): Promise<EngageActionResult>;
  followUser(id: string, options: { body: { targetUserId: string } }): Promise<EngageActionResult>;
  unfollowUser(sourceUserId: string, targetUserId: string): Promise<EngageActionResult>;
}

interface PostsClientLike {
  create(body: { text?: string; reply?: { in_reply_to_tweet_id: string } }): Promise<ItemResult<TweetLike>>;
  getById(id: string, options?: { tweetFields?: string[] }): Promise<ItemResult<TweetLike>>;
  searchRecent(query: string, options?: ListOptions): Promise<ListResult<TweetLike>>;
}

// Requested on every tweet-returning call so `author_id`/`created_at` are
// populated — the X API only returns `id`/`text` by default.
const TWEET_FIELDS = ["author_id", "created_at"];
// Requested on every user-profile call so `description`/`public_metrics` are
// populated — the X API only returns `id`/`username`/`name` by default.
const USER_FIELDS = ["description", "public_metrics"];

function shapeTweet(t: TweetLike): FinchTweet {
  return {
    id: t.id,
    text: t.text,
    author_id: t.authorId ?? null,
    created_at: t.createdAt ?? null,
  };
}

export class ByokTransport implements XTransport {
  constructor(
    private readonly usersClient: UsersClientLike,
    private readonly postsClient: PostsClientLike,
  ) {}

  async getMe(): Promise<FinchUser> {
    try {
      const res = await this.usersClient.getMe();
      if (!res.data) {
        throw new FinchError(
          "AUTH_ERROR",
          "X API returned no user data for the provided credentials",
          res.errors ?? null,
        );
      }
      return { id: res.data.id, username: res.data.username, name: res.data.name };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err);
    }
  }

  async createTweet(text: string, replyToId?: string): Promise<CreatedTweet> {
    try {
      const body = replyToId ? { text, reply: { in_reply_to_tweet_id: replyToId } } : { text };
      const res = await this.postsClient.create(body);
      if (!res.data) {
        throw new FinchError("CLIENT_ERROR", "X API did not return the created post", res.errors ?? null);
      }
      return { id: res.data.id, text: res.data.text };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err);
    }
  }

  async getTweet(id: string): Promise<FinchTweet> {
    try {
      const res = await this.postsClient.getById(id, { tweetFields: TWEET_FIELDS });
      if (!res.data) {
        throw new FinchError("CLIENT_ERROR", `Post ${id} not found`, res.errors ?? null);
      }
      return shapeTweet(res.data);
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err);
    }
  }

  async searchRecent(query: string, maxResults: number): Promise<FinchTweet[]> {
    try {
      const res = await this.postsClient.searchRecent(query, {
        maxResults,
        tweetFields: TWEET_FIELDS,
      });
      return (res.data ?? []).map(shapeTweet);
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err);
    }
  }

  async userTweets(userId: string, maxResults: number): Promise<FinchTweet[]> {
    try {
      const res = await this.usersClient.getPosts(userId, {
        maxResults,
        tweetFields: TWEET_FIELDS,
      });
      return (res.data ?? []).map(shapeTweet);
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err);
    }
  }

  async homeTimeline(userId: string, maxResults: number): Promise<FinchTweet[]> {
    try {
      const res = await this.usersClient.getTimeline(userId, {
        maxResults,
        tweetFields: TWEET_FIELDS,
      });
      return (res.data ?? []).map(shapeTweet);
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err);
    }
  }

  async getUserByUsername(username: string): Promise<FinchUserProfile> {
    try {
      const res = await this.usersClient.getByUsername(username, { userFields: USER_FIELDS });
      if (!res.data) {
        throw new FinchError("CLIENT_ERROR", `User @${username} not found`, res.errors ?? null);
      }
      return {
        id: res.data.id,
        username: res.data.username,
        name: res.data.name,
        description: res.data.description ?? "",
        public_metrics: res.data.publicMetrics ?? {},
      };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err);
    }
  }

  async like(userId: string, tweetId: string): Promise<LikeStatus> {
    try {
      const res = await this.usersClient.likePost(userId, { body: { tweetId } });
      if (!res.data) {
        throw new FinchError("CLIENT_ERROR", "X API did not confirm the like", res.errors ?? null);
      }
      return { liked: (res.data.liked as boolean | undefined) ?? true };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err);
    }
  }

  async unlike(userId: string, tweetId: string): Promise<LikeStatus> {
    try {
      const res = await this.usersClient.unlikePost(userId, tweetId);
      if (!res.data) {
        throw new FinchError("CLIENT_ERROR", "X API did not confirm the unlike", res.errors ?? null);
      }
      return { liked: (res.data.liked as boolean | undefined) ?? false };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err);
    }
  }

  async retweet(userId: string, tweetId: string): Promise<RepostStatus> {
    try {
      const res = await this.usersClient.repostPost(userId, { body: { tweetId } });
      if (!res.data) {
        throw new FinchError("CLIENT_ERROR", "X API did not confirm the repost", res.errors ?? null);
      }
      return { reposted: (res.data.retweeted as boolean | undefined) ?? true };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err);
    }
  }

  async unretweet(userId: string, tweetId: string): Promise<RepostStatus> {
    try {
      const res = await this.usersClient.unrepostPost(userId, tweetId);
      if (!res.data) {
        throw new FinchError("CLIENT_ERROR", "X API did not confirm the unrepost", res.errors ?? null);
      }
      return { reposted: (res.data.retweeted as boolean | undefined) ?? false };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err);
    }
  }

  async follow(userId: string, targetUserId: string): Promise<FollowStatus> {
    try {
      const res = await this.usersClient.followUser(userId, { body: { targetUserId } });
      if (!res.data) {
        throw new FinchError("CLIENT_ERROR", "X API did not confirm the follow", res.errors ?? null);
      }
      return { following: (res.data.following as boolean | undefined) ?? true };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err);
    }
  }

  async unfollow(userId: string, targetUserId: string): Promise<FollowStatus> {
    try {
      const res = await this.usersClient.unfollowUser(userId, targetUserId);
      if (!res.data) {
        throw new FinchError("CLIENT_ERROR", "X API did not confirm the unfollow", res.errors ?? null);
      }
      return { following: (res.data.following as boolean | undefined) ?? false };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err);
    }
  }
}

function mapSdkError(err: unknown): FinchError {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      return new FinchError("AUTH_ERROR", "X rejected the provided credentials", err.data ?? null);
    }
    if (err.status === 429) {
      return new FinchError("RATE_LIMITED", "Rate limited by the X API", {
        resetAt: parseRateLimitReset(err.headers),
      });
    }
    return new FinchError("CLIENT_ERROR", err.message, err.data ?? null);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new FinchError("NETWORK_ERROR", message, null);
}

function parseRateLimitReset(headers: Headers): string | null {
  const raw = headers.get("x-rate-limit-reset");
  if (!raw) return null;
  const unixSeconds = Number(raw);
  if (!Number.isFinite(unixSeconds)) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

/**
 * Constructs the real SDK-backed transport. `OAuth1Config.apiSecret` is the
 * SDK's name for Finch's own `auth.apiKeySecret` field — mapped here, not
 * renamed in Finch's config schema (which matches the X Developer Portal's
 * own field label).
 */
export function createByokTransport(auth: FinchAuthConfig): XTransport {
  const oauth1 = new OAuth1({
    apiKey: auth.apiKey,
    apiSecret: auth.apiKeySecret,
    accessToken: auth.accessToken,
    accessTokenSecret: auth.accessTokenSecret,
    // Only the redirect-based request-token flow uses this; OAuth1 in v1 is
    // constructed straight from already-issued user-context tokens.
    callback: "oob",
  });
  const client = new Client({ oauth1 });
  // The SDK's real client methods are overloaded (a `requestOptions.raw`
  // variant returning the raw `Response` alongside the parsed-JSON variant
  // ByokTransport actually uses) — TS can't structurally match an overloaded
  // method against our single-signature *ClientLike interfaces, so the cast
  // is required here even though the runtime shapes line up exactly.
  return new ByokTransport(client.users as unknown as UsersClientLike, client.posts as unknown as PostsClientLike);
}

/**
 * Constructs an OAuth2 user-context transport from a bearer access token.
 * Reuses ByokTransport because the SDK's users/posts clients are identical
 * once the Client is authenticated with OAuth2.
 */
export function createOAuth2Transport(accessToken: string): XTransport {
  const client = new Client({ accessToken });
  return new ByokTransport(client.users as unknown as UsersClientLike, client.posts as unknown as PostsClientLike);
}
