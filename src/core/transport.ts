import { Client, ApiError, OAuth2, type OAuth2Token } from "@xdevplatform/xdk";
import { readFileSync } from "node:fs";
import { FinchError } from "./errors";
import { readOAuth2Config, writeOAuth2Config } from "./oauth2-config";
import type { OAuth2AuthConfig } from "./oauth2-config";

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

export interface DeleteStatus {
  deleted: boolean;
}

export interface BookmarkStatus {
  bookmarked: boolean;
}

export interface FinchBookmarkFolder {
  id: string;
  name: string;
}

/**
 * Every core command function depends on this interface, never on the SDK
 * directly — SdkTransport wraps the SDK's users/posts clients and is shared
 * by the OAuth2-backed transports below.
 */
export interface XTransport {
  getMe(): Promise<FinchUser>;
  createTweet(text: string, replyToId?: string, mediaIds?: string[]): Promise<CreatedTweet>;
  getTweet(id: string): Promise<FinchTweet>;
  searchRecent(query: string, maxResults: number): Promise<FinchTweet[]>;
  userTweets(userId: string, maxResults: number): Promise<FinchTweet[]>;
  homeTimeline(userId: string, maxResults: number): Promise<FinchTweet[]>;
  listBookmarks(userId: string, maxResults: number): Promise<FinchTweet[]>;
  addBookmark(userId: string, tweetId: string): Promise<BookmarkStatus>;
  removeBookmark(userId: string, tweetId: string): Promise<BookmarkStatus>;
  listBookmarkFolders(userId: string): Promise<FinchBookmarkFolder[]>;
  createBookmarkFolder(userId: string, name: string): Promise<FinchBookmarkFolder>;
  getUserByUsername(username: string): Promise<FinchUserProfile>;
  like(userId: string, tweetId: string): Promise<LikeStatus>;
  unlike(userId: string, tweetId: string): Promise<LikeStatus>;
  retweet(userId: string, tweetId: string): Promise<RepostStatus>;
  unretweet(userId: string, tweetId: string): Promise<RepostStatus>;
  follow(userId: string, targetUserId: string): Promise<FollowStatus>;
  unfollow(userId: string, targetUserId: string): Promise<FollowStatus>;
  deleteTweet(id: string): Promise<DeleteStatus>;
  uploadImage(path: string): Promise<{ media_id: string }>;
  setMediaAltText(mediaId: string, altText: string): Promise<void>;
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

interface BookmarkFolderLike {
  id: string;
  name: string;
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
  getBookmarks(id: string, options?: ListOptions): Promise<ListResult<TweetLike>>;
  getBookmarkFolders(
    id: string,
    options?: {
      maxResults?: number;
      paginationToken?: string;
      requestOptions?: unknown;
    },
  ): Promise<ListResult<Record<string, unknown>>>;
  createBookmark(id: string, body: { tweetId: string }): Promise<EngageActionResult>;
  deleteBookmark(id: string, tweetId: string): Promise<EngageActionResult>;
  likePost(id: string, options: { body: { tweetId: string } }): Promise<EngageActionResult>;
  unlikePost(id: string, tweetId: string): Promise<EngageActionResult>;
  repostPost(id: string, options: { body: { tweetId: string } }): Promise<EngageActionResult>;
  unrepostPost(id: string, sourceTweetId: string): Promise<EngageActionResult>;
  followUser(id: string, options: { body: { targetUserId: string } }): Promise<EngageActionResult>;
  unfollowUser(sourceUserId: string, targetUserId: string): Promise<EngageActionResult>;
  client?: UnderlyingClientLike;
}

interface UnderlyingClientLike {
  request(
    method: string,
    path: string,
    options?: { body?: string; security?: unknown; [key: string]: unknown },
  ): Promise<unknown>;
}

interface PostsClientLike {
  create(body: {
    text?: string;
    reply?: { in_reply_to_tweet_id: string };
    media?: { media_ids: string[] };
  }): Promise<ItemResult<TweetLike>>;
  getById(id: string, options?: { tweetFields?: string[] }): Promise<ItemResult<TweetLike>>;
  searchRecent(query: string, options?: ListOptions): Promise<ListResult<TweetLike>>;
  delete(id: string): Promise<ItemResult<{ deleted?: boolean }>>;
}

interface MediaClientLike {
  upload(options: {
    body: { media: string; mediaCategory: string; mediaType: string };
  }): Promise<{ data?: Record<string, unknown>; errors?: unknown }>;
  createMetadata(options: {
    body: Record<string, unknown>;
  }): Promise<{ data?: Record<string, unknown>; errors?: unknown[] }>;
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

function isBookmarkFolderLike(value: unknown): value is BookmarkFolderLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { name?: unknown }).name === "string"
  );
}

export class ByokTransport implements XTransport {
  constructor(
    private readonly usersClient: UsersClientLike,
    private readonly postsClient: PostsClientLike,
    private readonly mediaClient: MediaClientLike = {
      upload: async () => {
        throw new Error("media upload client not provided");
      },
    },
    private readonly rawClient: UnderlyingClientLike | undefined = usersClient.client,
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
      throw mapSdkError(err, "getMe");
    }
  }

  async createTweet(text: string, replyToId?: string, mediaIds?: string[]): Promise<CreatedTweet> {
    try {
      const body: { text: string; reply?: { in_reply_to_tweet_id: string }; media?: { media_ids: string[] } } = {
        text,
      };
      if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId };
      if (mediaIds && mediaIds.length > 0) body.media = { media_ids: mediaIds };
      const res = await this.postsClient.create(body);
      if (!res.data) {
        throw new FinchError("CLIENT_ERROR", "X API did not return the created post", res.errors ?? null);
      }
      return { id: res.data.id, text: res.data.text };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err, "createTweet");
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
      throw mapSdkError(err, "getTweet");
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
      throw mapSdkError(err, "searchRecent");
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
      throw mapSdkError(err, "userTweets");
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
      throw mapSdkError(err, "homeTimeline");
    }
  }

  async listBookmarks(userId: string, maxResults: number): Promise<FinchTweet[]> {
    try {
      const res = await this.usersClient.getBookmarks(userId, {
        maxResults,
        tweetFields: TWEET_FIELDS,
      });
      return (res.data ?? []).map(shapeTweet);
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err);
    }
  }

  async addBookmark(userId: string, tweetId: string): Promise<BookmarkStatus> {
    try {
      const res = await this.usersClient.createBookmark(userId, { tweetId });
      if (!res.data) {
        throw new FinchError("CLIENT_ERROR", "X API did not confirm the bookmark", res.errors ?? null);
      }
      return { bookmarked: (res.data.bookmarked as boolean | undefined) ?? true };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err, "addBookmark");
    }
  }

  async removeBookmark(userId: string, tweetId: string): Promise<BookmarkStatus> {
    try {
      const res = await this.usersClient.deleteBookmark(userId, tweetId);
      if (!res.data) {
        throw new FinchError("CLIENT_ERROR", "X API did not confirm the bookmark removal", res.errors ?? null);
      }
      return { bookmarked: (res.data.bookmarked as boolean | undefined) ?? false };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err, "removeBookmark");
    }
  }

  async listBookmarkFolders(userId: string): Promise<FinchBookmarkFolder[]> {
    try {
      const res = await this.usersClient.getBookmarkFolders(userId);
      const folders: FinchBookmarkFolder[] = [];
      for (const folder of res.data ?? []) {
        if (isBookmarkFolderLike(folder)) {
          folders.push({ id: folder.id, name: folder.name });
        }
      }
      return folders;
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err, "listBookmarkFolders");
    }
  }

  async createBookmarkFolder(userId: string, name: string): Promise<FinchBookmarkFolder> {
    if (!this.rawClient) {
      throw new FinchError("CLIENT_ERROR", "X SDK client does not expose bookmark folder creation", null);
    }

    try {
      const res = (await this.rawClient.request("POST", `/2/users/${encodeURIComponent(userId)}/bookmarks/folders`, {
        body: JSON.stringify({ name }),
        security: [{ OAuth2UserToken: ["bookmark.write", "users.read"] }],
      })) as ItemResult<unknown>;
      if (!isBookmarkFolderLike(res.data)) {
        throw new FinchError("CLIENT_ERROR", "X API did not return the created bookmark folder", res.errors ?? null);
      }
      return { id: res.data.id, name: res.data.name };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err, "createBookmarkFolder");
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
      throw mapSdkError(err, "getUserByUsername");
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
      throw mapSdkError(err, "like");
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
      throw mapSdkError(err, "unlike");
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
      throw mapSdkError(err, "retweet");
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
      throw mapSdkError(err, "unretweet");
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
      throw mapSdkError(err, "follow");
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
      throw mapSdkError(err, "unfollow");
    }
  }

  async deleteTweet(id: string): Promise<DeleteStatus> {
    try {
      const res = await this.postsClient.delete(id);
      if (!res.data) {
        throw new FinchError("CLIENT_ERROR", "X API did not confirm the delete", res.errors ?? null);
      }
      return { deleted: (res.data.deleted as boolean | undefined) ?? true };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err, "deleteTweet");
    }
  }

  async uploadImage(path: string): Promise<{ media_id: string }> {
    const mediaType = resolveMediaType(path);
    if (!mediaType) {
      throw new FinchError(
        "USAGE_ERROR",
        `Unsupported image type for ${path}. Supported extensions: .jpg, .jpeg, .png, .webp, .bmp, .tiff, .tif`,
      );
    }

    let media: string;
    try {
      media = readFileSync(path).toString("base64");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new FinchError("USAGE_ERROR", `Cannot read media file ${path}: ${message}`, null);
    }

    try {
      const res = await this.mediaClient.upload({
        body: { media, mediaCategory: "tweet_image", mediaType },
      });
      if (!res.data || typeof res.data.id !== "string") {
        throw new FinchError("CLIENT_ERROR", "X API did not return a media ID", res.errors ?? null);
      }
      return { media_id: res.data.id };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err, "uploadImage");
    }
  }

  async setMediaAltText(mediaId: string, altText: string): Promise<void> {
    try {
      const res = await this.mediaClient.createMetadata({
        body: { mediaId, altText: { text: altText } },
      });
      if (res.errors && res.errors.length > 0) {
        throw new FinchError("CLIENT_ERROR", "X API did not confirm the media metadata", res.errors ?? null);
      }
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err, "setMediaAltText");
    }
  }
}

const MEDIA_TYPE_BY_EXTENSION: Record<string, "image/jpeg" | "image/bmp" | "image/png" | "image/webp" | "image/tiff"> =
  {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    bmp: "image/bmp",
    png: "image/png",
    webp: "image/webp",
    tiff: "image/tiff",
    tif: "image/tiff",
  };

function resolveMediaType(
  path: string,
): "image/jpeg" | "image/bmp" | "image/png" | "image/webp" | "image/tiff" | undefined {
  const dotIndex = path.lastIndexOf(".");
  const ext = dotIndex === -1 ? "" : path.slice(dotIndex + 1).toLowerCase();
  return MEDIA_TYPE_BY_EXTENSION[ext];
}

function mapSdkError(err: unknown, operation?: string): FinchError {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      if (operation === "searchRecent" && isSearchTierForbidden(err)) {
        return new FinchError("CLIENT_ERROR", "Your X API tier does not include search access.", err.data ?? null);
      }
      if (
        (operation === "listBookmarkFolders" || operation === "createBookmarkFolder") &&
        isBookmarkFoldersPremiumForbidden(err)
      ) {
        return new FinchError("CLIENT_ERROR", "Bookmark folders require X Premium.", err.data ?? null);
      }
      if ((operation === "addBookmark" || operation === "removeBookmark") && isBookmarkWriteForbidden(err)) {
        return new FinchError(
          "AUTH_ERROR",
          "Your X API token is missing the bookmark.write scope. Run `finch auth` to re-authorize with bookmarks access.",
          err.data ?? null,
        );
      }
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

/**
 * Detects X's free/basic-tier search restriction. The X API returns a 403
 * with `reason: "search-access-level"` (or similar search/access language in
 * the error body) when the app tier does not include the recent-search
 * endpoint. This must be surfaced as a CLIENT_ERROR so the caller understands
 * the limit rather than seeing a generic auth/credential failure.
 */
function isSearchTierForbidden(err: ApiError): boolean {
  if (err.status !== 403) return false;
  const haystack = stringifyErrorData(err.data);
  if (haystack.includes("search-access-level")) return true;
  return haystack.includes("search") && /access|tier|enroll/.test(haystack);
}

/**
 * Detects a missing `bookmark.write` OAuth2 scope. The X API returns a 403
 * with `bookmark.write` in the error detail (and often a `missing-scope` or
 * scope-related reason) when the token is not authorized to mutate bookmarks.
 * This must be surfaced as a clear, actionable AUTH_ERROR rather than a
 * generic credential failure.
 */
function isBookmarkWriteForbidden(err: ApiError): boolean {
  if (err.status !== 403) return false;
  const haystack = stringifyErrorData(err.data);
  if (haystack.includes("bookmark.write")) return true;
  return haystack.includes("bookmark") && /missing|scope/.test(haystack);
}

/**
 * Detects X's Premium-gated bookmark-folder feature. This is intentionally
 * scoped by operation in mapSdkError so generic 403s on other endpoints keep
 * their normal auth/credential classification.
 */
function isBookmarkFoldersPremiumForbidden(err: ApiError): boolean {
  if (err.status !== 403) return false;
  const haystack = stringifyErrorData(err.data);
  if (haystack.includes("premium_required")) return true;
  return (
    haystack.includes("bookmark") && haystack.includes("folder") && /premium|paid|subscrib|tier|eligible/.test(haystack)
  );
}

function stringifyErrorData(data: unknown): string {
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return data.toLowerCase();
  try {
    return JSON.stringify(data).toLowerCase();
  } catch {
    return String(data).toLowerCase();
  }
}

function parseRateLimitReset(headers: Headers): string | null {
  const raw = headers.get("x-rate-limit-reset");
  if (!raw) return null;
  const unixSeconds = Number(raw);
  if (!Number.isFinite(unixSeconds)) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

/**
 * Constructs an OAuth2 user-context transport from a bearer access token.
 * Reuses ByokTransport because the SDK's users/posts clients are identical
 * once the Client is authenticated with OAuth2.
 */
export function createOAuth2Transport(accessToken: string): XTransport {
  const client = new Client({ accessToken });
  return new ByokTransport(
    client.users as unknown as UsersClientLike,
    client.posts as unknown as PostsClientLike,
    client.media as unknown as MediaClientLike,
  );
}

// Same redirect URI used by `finch auth`; duplicated here to avoid a circular
// dependency between transport.ts and commands/auth.ts.
const OAUTH2_REDIRECT_URI = "http://127.0.0.1:8765/callback";

export interface RefreshingOAuth2TransportDeps {
  refreshFn?: (clientId: string, refreshToken: string) => Promise<OAuth2Token>;
  persistFn?: (config: OAuth2AuthConfig) => void | Promise<void>;
  buildTransportFn?: (accessToken: string) => XTransport;
  nowFn?: () => number;
}

class RefreshingOAuth2Transport implements XTransport {
  private cachedTransport: XTransport | undefined;
  private refreshLock: Promise<XTransport> | null = null;

  constructor(
    private readonly config: OAuth2AuthConfig,
    private readonly deps: Required<Pick<RefreshingOAuth2TransportDeps, "buildTransportFn" | "nowFn">> &
      RefreshingOAuth2TransportDeps,
  ) {}

  async getMe(): Promise<FinchUser> {
    const t = await this.ensureFreshToken();
    return t.getMe();
  }

  async createTweet(text: string, replyToId?: string, mediaIds?: string[]): Promise<CreatedTweet> {
    const t = await this.ensureFreshToken();
    return t.createTweet(text, replyToId, mediaIds);
  }

  async getTweet(id: string): Promise<FinchTweet> {
    const t = await this.ensureFreshToken();
    return t.getTweet(id);
  }

  async searchRecent(query: string, maxResults: number): Promise<FinchTweet[]> {
    const t = await this.ensureFreshToken();
    return t.searchRecent(query, maxResults);
  }

  async userTweets(userId: string, maxResults: number): Promise<FinchTweet[]> {
    const t = await this.ensureFreshToken();
    return t.userTweets(userId, maxResults);
  }

  async homeTimeline(userId: string, maxResults: number): Promise<FinchTweet[]> {
    const t = await this.ensureFreshToken();
    return t.homeTimeline(userId, maxResults);
  }

  async listBookmarks(userId: string, maxResults: number): Promise<FinchTweet[]> {
    const t = await this.ensureFreshToken();
    return t.listBookmarks(userId, maxResults);
  }

  async addBookmark(userId: string, tweetId: string): Promise<BookmarkStatus> {
    const t = await this.ensureFreshToken();
    return t.addBookmark(userId, tweetId);
  }

  async removeBookmark(userId: string, tweetId: string): Promise<BookmarkStatus> {
    const t = await this.ensureFreshToken();
    return t.removeBookmark(userId, tweetId);
  }

  async listBookmarkFolders(userId: string): Promise<FinchBookmarkFolder[]> {
    const t = await this.ensureFreshToken();
    return t.listBookmarkFolders(userId);
  }

  async createBookmarkFolder(userId: string, name: string): Promise<FinchBookmarkFolder> {
    const t = await this.ensureFreshToken();
    return t.createBookmarkFolder(userId, name);
  }

  async getUserByUsername(username: string): Promise<FinchUserProfile> {
    const t = await this.ensureFreshToken();
    return t.getUserByUsername(username);
  }

  async like(userId: string, tweetId: string): Promise<LikeStatus> {
    const t = await this.ensureFreshToken();
    return t.like(userId, tweetId);
  }

  async unlike(userId: string, tweetId: string): Promise<LikeStatus> {
    const t = await this.ensureFreshToken();
    return t.unlike(userId, tweetId);
  }

  async retweet(userId: string, tweetId: string): Promise<RepostStatus> {
    const t = await this.ensureFreshToken();
    return t.retweet(userId, tweetId);
  }

  async unretweet(userId: string, tweetId: string): Promise<RepostStatus> {
    const t = await this.ensureFreshToken();
    return t.unretweet(userId, tweetId);
  }

  async follow(userId: string, targetUserId: string): Promise<FollowStatus> {
    const t = await this.ensureFreshToken();
    return t.follow(userId, targetUserId);
  }

  async unfollow(userId: string, targetUserId: string): Promise<FollowStatus> {
    const t = await this.ensureFreshToken();
    return t.unfollow(userId, targetUserId);
  }

  async deleteTweet(id: string): Promise<DeleteStatus> {
    const t = await this.ensureFreshToken();
    return t.deleteTweet(id);
  }

  async uploadImage(path: string): Promise<{ media_id: string }> {
    const t = await this.ensureFreshToken();
    return t.uploadImage(path);
  }

  async setMediaAltText(mediaId: string, altText: string): Promise<void> {
    const t = await this.ensureFreshToken();
    return t.setMediaAltText(mediaId, altText);
  }

  private async ensureFreshToken(): Promise<XTransport> {
    const now = this.deps.nowFn();
    if (now < this.config.expiresAt - 60_000) {
      if (!this.cachedTransport) {
        this.cachedTransport = this.deps.buildTransportFn(this.config.accessToken);
      }
      return this.cachedTransport;
    }

    if (this.refreshLock) {
      return await this.refreshLock;
    }

    this.refreshLock = this.performRefresh();
    try {
      return await this.refreshLock;
    } finally {
      this.refreshLock = null;
    }
  }

  private async performRefresh(): Promise<XTransport> {
    let token: OAuth2Token;
    try {
      token = await (this.deps.refreshFn
        ? this.deps.refreshFn(this.config.clientId, this.config.refreshToken)
        : new OAuth2({ clientId: this.config.clientId, redirectUri: OAUTH2_REDIRECT_URI }).refreshToken(
            this.config.refreshToken,
          ));
    } catch {
      throw new FinchError("AUTH_ERROR", "Your session has expired — run `finch auth` to log in again.", null);
    }

    const now = this.deps.nowFn();
    this.config.accessToken = token.access_token;
    if (token.refresh_token) {
      this.config.refreshToken = token.refresh_token;
    }
    this.config.expiresAt = now + token.expires_in * 1000;

    if (this.deps.persistFn) {
      await this.deps.persistFn(this.config);
    } else {
      const current = readOAuth2Config();
      const defaults = current?.defaults ?? { json: false, count: 10 };
      writeOAuth2Config({ auth: this.config, transport: "oauth2", defaults });
    }

    this.cachedTransport = this.deps.buildTransportFn(this.config.accessToken);
    return this.cachedTransport;
  }
}

export function createRefreshingOAuth2Transport(
  config: OAuth2AuthConfig,
  deps?: RefreshingOAuth2TransportDeps,
): XTransport {
  return new RefreshingOAuth2Transport(config, {
    refreshFn: deps?.refreshFn,
    persistFn: deps?.persistFn,
    buildTransportFn: deps?.buildTransportFn ?? createOAuth2Transport,
    nowFn: deps?.nowFn ?? Date.now,
  });
}

/**
 * Resolves the active OAuth2 transport from the user's config file.
 * Throws a FinchError if the user has not yet run `finch auth`.
 */
export function resolveOAuth2Transport(): XTransport {
  const config = readOAuth2Config();
  if (!config) {
    throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
  }
  return createRefreshingOAuth2Transport(config.auth);
}
