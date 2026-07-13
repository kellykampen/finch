import { Client, ApiError, OAuth2, type OAuth2Token } from "@xdevplatform/xdk";
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { FinchError } from "./errors";
import { readOAuth2Config, writeOAuth2Config, withConfigStoreLock } from "./oauth2-config";
import type { FinchOAuth2Config, OAuth2AuthConfig } from "./oauth2-config";

// Refresh the access token this many ms before its stated expiry, absorbing
// clock skew and request latency around the boundary.
const EXPIRY_BUFFER_MS = 60_000;
// Shown when the stored refresh token is missing or X refuses to refresh it —
// the only remaining recovery is a fresh interactive login.
const SESSION_EXPIRED_MESSAGE = "Your session has expired — run `finch auth` to log in again.";
// Shown when a refresh attempt failed without X definitively rejecting the
// token (network failure, timeout, 5xx, rate limit). The outcome is
// AMBIGUOUS: X may or may not have processed the refresh before the failure,
// so this message must advise a retry without guaranteeing the stored
// credential's state — and must not push the operator straight into a
// needless interactive re-login (FIN-78).
const REFRESH_UNCONFIRMED_MESSAGE =
  "Could not confirm a session refresh with X (network problem or temporary X failure) — retry shortly; " +
  "if this keeps failing, run `finch auth` to start a fresh session.";
// The generic credential-rejection message from a 401/403. Reused as the
// trigger for one reactive refresh+retry (a scope/tier error carries a
// different, more specific message and must NOT trigger a refresh).
const REJECTED_CREDENTIALS_MESSAGE = "X rejected the provided credentials";

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
  listBookmarksInFolder(userId: string, folderId: string, maxResults: number): Promise<FinchTweet[]>;
  addBookmarkToFolder(userId: string, folderId: string, tweetId: string): Promise<BookmarkStatus>;
  getUserByUsername(username: string): Promise<FinchUserProfile>;
  like(userId: string, tweetId: string): Promise<LikeStatus>;
  unlike(userId: string, tweetId: string): Promise<LikeStatus>;
  retweet(userId: string, tweetId: string): Promise<RepostStatus>;
  unretweet(userId: string, tweetId: string): Promise<RepostStatus>;
  follow(userId: string, targetUserId: string): Promise<FollowStatus>;
  unfollow(userId: string, targetUserId: string): Promise<FollowStatus>;
  deleteTweet(id: string): Promise<DeleteStatus>;
  uploadImage(path: string): Promise<{ media_id: string }>;
  uploadVideo(path: string, onStatus?: (message: string) => void): Promise<{ media_id: string }>;
  setMediaAltText(mediaId: string, altText: string): Promise<void>;
  createArticleDraft(title: string, contentState: object, coverMediaId?: string): Promise<{ id: string }>;
  publishArticleDraft(draftId: string): Promise<{ post_id: string }>;
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
  getBookmarksByFolderId(id: string, folderId: string, options?: ListOptions): Promise<ListResult<TweetLike>>;
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
  initializeUpload(options: {
    body: { mediaCategory: "tweet_gif" | "tweet_video"; mediaType: VideoMediaType; totalBytes: number };
  }): Promise<{ data?: Record<string, unknown>; errors?: unknown }>;
  appendUpload(
    id: string,
    options: { body: { media: string; segmentIndex: number } },
  ): Promise<{ data?: Record<string, unknown>; errors?: unknown }>;
  finalizeUpload(id: string): Promise<{ data?: Record<string, unknown>; errors?: unknown }>;
  getUploadStatus(
    mediaId: string,
    options?: { command?: "STATUS" },
  ): Promise<{ data?: Record<string, unknown>; errors?: unknown }>;
  createMetadata(options: {
    // Mirrors the SDK's `MetadataCreateRequest`: the media `id` is required and
    // all per-media fields (alt text, etc.) live under `metadata`. Typing it
    // here — rather than `Record<string, unknown>` — makes the compiler reject
    // any call that omits `id`, preventing the FIN-66 missing-`id` regression.
    body: { id: string; metadata: Record<string, unknown> };
  }): Promise<{ data?: Record<string, unknown>; errors?: unknown[] }>;
}

// Requested on every tweet-returning call so `author_id`/`created_at` are
// populated — the X API only returns `id`/`text` by default.
const TWEET_FIELDS = ["author_id", "created_at"];
// Requested on every user-profile call so `description`/`public_metrics` are
// populated — the X API only returns `id`/`username`/`name` by default.
const USER_FIELDS = ["description", "public_metrics"];

const VIDEO_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;
const VIDEO_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_STATUS_CHECK_AFTER_SECS = 5;
const MEDIA_WRITE_SCOPE = "media.write";
const MEDIA_WRITE_AUTH_ERROR =
  "Media upload requires the media.write OAuth2 scope. Run `finch auth` to re-authorize, then retry.";
const MEDIA_UPLOAD_FORBIDDEN_ERROR =
  "X denied media upload. The v2 media endpoints require OAuth2 user context with media.write. Run `finch auth` to re-authorize; if `finch config get auth.scopes` already includes media.write, verify your X app has v2 media endpoint access.";

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
    private readonly mediaClient: MediaClientLike = missingMediaClient,
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

  async listBookmarksInFolder(userId: string, folderId: string, maxResults: number): Promise<FinchTweet[]> {
    try {
      const res = await this.usersClient.getBookmarksByFolderId(userId, folderId, {
        maxResults,
        tweetFields: TWEET_FIELDS,
      });
      return (res.data ?? []).map(shapeTweet);
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err, "listBookmarksInFolder");
    }
  }

  async addBookmarkToFolder(userId: string, folderId: string, tweetId: string): Promise<BookmarkStatus> {
    if (!this.rawClient) {
      throw new FinchError("CLIENT_ERROR", "X SDK client does not expose bookmark folder membership", null);
    }

    try {
      const res = (await this.rawClient.request(
        "POST",
        `/2/users/${encodeURIComponent(userId)}/bookmarks/folders/${encodeURIComponent(folderId)}/bookmarks`,
        {
          body: JSON.stringify({ tweet_id: tweetId }),
          security: [{ OAuth2UserToken: ["bookmark.write", "tweet.read", "users.read"] }],
        },
      )) as ItemResult<Record<string, unknown>>;
      if (!res.data) {
        throw new FinchError("CLIENT_ERROR", "X API did not confirm the bookmark folder addition", res.errors ?? null);
      }
      return { bookmarked: (res.data.bookmarked as boolean | undefined) ?? true };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err, "addBookmarkToFolder");
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

  async uploadVideo(path: string, onStatus?: (message: string) => void): Promise<{ media_id: string }> {
    const mediaConfig = resolveVideoMediaConfig(path);
    if (!mediaConfig) {
      throw new FinchError(
        "USAGE_ERROR",
        `Unsupported GIF/video type for ${path}. Supported extensions: .gif, .mp4, .mov, .webm, .ts, .m2ts`,
      );
    }

    let totalBytes: number;
    try {
      totalBytes = statSync(path).size;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new FinchError("USAGE_ERROR", `Cannot read media file ${path}: ${message}`, null);
    }

    if (totalBytes > mediaConfig.maxBytes) {
      throw new FinchError(
        "USAGE_ERROR",
        `${path} is ${formatBytes(totalBytes)}, which exceeds the ${formatBytes(mediaConfig.maxBytes)} limit for ${mediaConfig.label}.`,
      );
    }

    try {
      onStatus?.(`Initializing ${mediaConfig.label} upload (${formatBytes(totalBytes)})`);
      const init = await this.mediaClient.initializeUpload({
        body: {
          mediaCategory: mediaConfig.mediaCategory,
          mediaType: mediaConfig.mediaType,
          totalBytes,
        },
      });
      const mediaId = extractMediaId(init.data);
      if (!mediaId) {
        throw new FinchError("CLIENT_ERROR", "X API did not return a media ID", init.errors ?? null);
      }

      await appendUploadChunks(this.mediaClient, mediaId, path, totalBytes, onStatus);

      onStatus?.("Finalizing media upload");
      const finalized = await this.mediaClient.finalizeUpload(mediaId);
      await waitForProcessing(this.mediaClient, mediaId, finalized.data, onStatus);

      return { media_id: mediaId };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err, "uploadVideo");
    }
  }

  async setMediaAltText(mediaId: string, altText: string): Promise<void> {
    try {
      // X's v2 POST /2/media/metadata requires the media `id` at the top level
      // and nests per-media fields under `metadata` (alt text as
      // `metadata.alt_text.text`). The SDK snake-cases keys before sending, so
      // these already-snake keys pass through unchanged. Sending `media_id` /
      // top-level `alt_text` (the previous shape) omitted the required `id` and
      // X silently dropped the alt text — see FIN-66.
      const res = await this.mediaClient.createMetadata({
        body: { id: mediaId, metadata: { alt_text: { text: altText } } },
      });
      if (res.errors && res.errors.length > 0) {
        throw new FinchError("CLIENT_ERROR", "X API did not confirm the media metadata", res.errors ?? null);
      }
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err, "setMediaAltText");
    }
  }

  async createArticleDraft(title: string, contentState: object, coverMediaId?: string): Promise<{ id: string }> {
    if (!this.rawClient) {
      throw new FinchError("CLIENT_ERROR", "X SDK client does not expose article draft creation", null);
    }

    const body: { title: string; content_state: object; cover_media?: { media_id: string } } = {
      title,
      content_state: contentState,
    };
    if (coverMediaId !== undefined) {
      body.cover_media = { media_id: coverMediaId };
    }

    try {
      const res = (await this.rawClient.request("POST", "/2/articles/draft", {
        body: JSON.stringify(body),
        security: [{ OAuth2UserToken: ["tweet.write"] }],
      })) as ItemResult<unknown>;
      if (!res.data || typeof (res.data as { id?: unknown }).id !== "string") {
        throw new FinchError("CLIENT_ERROR", "X API did not return the created article draft", res.errors ?? null);
      }
      return { id: (res.data as { id: string }).id };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err, "createArticleDraft");
    }
  }

  async publishArticleDraft(draftId: string): Promise<{ post_id: string }> {
    if (!this.rawClient) {
      throw new FinchError("CLIENT_ERROR", "X SDK client does not expose article draft publishing", null);
    }

    try {
      const res = (await this.rawClient.request("POST", `/2/articles/${encodeURIComponent(draftId)}/publish`, {
        security: [{ OAuth2UserToken: ["tweet.write"] }],
      })) as ItemResult<unknown>;
      if (!res.data || typeof (res.data as { post_id?: unknown }).post_id !== "string") {
        throw new FinchError(
          "CLIENT_ERROR",
          "X API did not return the published article's post ID",
          res.errors ?? null,
        );
      }
      return { post_id: (res.data as { post_id: string }).post_id };
    } catch (err) {
      if (err instanceof FinchError) throw err;
      throw mapSdkError(err, "publishArticleDraft");
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

type VideoMediaType = "video/mp4" | "video/webm" | "video/mp2t" | "video/quicktime" | "image/gif";

interface VideoMediaConfig {
  label: "GIF" | "video";
  mediaCategory: "tweet_gif" | "tweet_video";
  mediaType: VideoMediaType;
  maxBytes: number;
}

const missingMediaClient: MediaClientLike = {
  upload: async () => {
    throw new FinchError("CLIENT_ERROR", "Media upload client is not configured");
  },
  initializeUpload: async () => {
    throw new FinchError("CLIENT_ERROR", "Media upload client is not configured");
  },
  appendUpload: async () => {
    throw new FinchError("CLIENT_ERROR", "Media upload client is not configured");
  },
  finalizeUpload: async () => {
    throw new FinchError("CLIENT_ERROR", "Media upload client is not configured");
  },
  getUploadStatus: async () => {
    throw new FinchError("CLIENT_ERROR", "Media upload client is not configured");
  },
  createMetadata: async () => {
    throw new FinchError("CLIENT_ERROR", "Media upload client is not configured");
  },
};

const VIDEO_MEDIA_CONFIG_BY_EXTENSION: Record<string, VideoMediaConfig> = {
  gif: { label: "GIF", mediaCategory: "tweet_gif", mediaType: "image/gif", maxBytes: 15 * 1024 * 1024 },
  mp4: { label: "video", mediaCategory: "tweet_video", mediaType: "video/mp4", maxBytes: 512 * 1024 * 1024 },
  mov: { label: "video", mediaCategory: "tweet_video", mediaType: "video/quicktime", maxBytes: 512 * 1024 * 1024 },
  webm: { label: "video", mediaCategory: "tweet_video", mediaType: "video/webm", maxBytes: 512 * 1024 * 1024 },
  ts: { label: "video", mediaCategory: "tweet_video", mediaType: "video/mp2t", maxBytes: 512 * 1024 * 1024 },
  m2ts: { label: "video", mediaCategory: "tweet_video", mediaType: "video/mp2t", maxBytes: 512 * 1024 * 1024 },
};

function resolveVideoMediaConfig(path: string): VideoMediaConfig | undefined {
  const dotIndex = path.lastIndexOf(".");
  const ext = dotIndex === -1 ? "" : path.slice(dotIndex + 1).toLowerCase();
  return VIDEO_MEDIA_CONFIG_BY_EXTENSION[ext];
}

async function appendUploadChunks(
  mediaClient: MediaClientLike,
  mediaId: string,
  path: string,
  totalBytes: number,
  onStatus?: (message: string) => void,
): Promise<void> {
  const fd = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(Math.min(VIDEO_CHUNK_SIZE_BYTES, Math.max(totalBytes, 1)));
  let segmentIndex = 0;
  let uploadedBytes = 0;

  try {
    while (uploadedBytes < totalBytes) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      const media = buffer.subarray(0, bytesRead).toString("base64");
      await mediaClient.appendUpload(mediaId, {
        body: { media, segmentIndex },
      });
      uploadedBytes += bytesRead;
      segmentIndex++;
      onStatus?.(`Uploaded ${formatBytes(uploadedBytes)} of ${formatBytes(totalBytes)}`);
    }
  } finally {
    closeSync(fd);
  }
}

interface ProcessingInfo {
  state?: string;
  checkAfterSecs?: number;
  error?: unknown;
}

async function waitForProcessing(
  mediaClient: MediaClientLike,
  mediaId: string,
  initialData: Record<string, unknown> | undefined,
  onStatus?: (message: string) => void,
): Promise<void> {
  let processingInfo = extractProcessingInfo(initialData);
  const deadline = Date.now() + VIDEO_PROCESSING_TIMEOUT_MS;

  while (processingInfo) {
    const state = processingInfo.state;
    if (state === "succeeded") {
      onStatus?.("Media processing succeeded");
      return;
    }
    if (state === "failed") {
      throw new FinchError("CLIENT_ERROR", `Media processing failed${formatProcessingError(processingInfo.error)}`);
    }
    if (Date.now() >= deadline) {
      throw new FinchError("CLIENT_ERROR", "Timed out waiting for media processing to finish");
    }

    const waitSecs = processingInfo.checkAfterSecs ?? DEFAULT_STATUS_CHECK_AFTER_SECS;
    onStatus?.(`Media processing ${state ?? "pending"}; checking again in ${waitSecs}s`);
    await sleep(Math.max(0, waitSecs * 1000));
    const status = await mediaClient.getUploadStatus(mediaId, { command: "STATUS" });
    processingInfo = extractProcessingInfo(status.data);
    if (!processingInfo) return;
  }
}

function extractMediaId(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) return undefined;
  const id = data.id ?? data.media_id;
  return typeof id === "string" ? id : undefined;
}

function extractProcessingInfo(data: Record<string, unknown> | undefined): ProcessingInfo | undefined {
  const raw = data?.processing_info ?? data?.processingInfo;
  if (!raw || typeof raw !== "object") return undefined;
  const info = raw as Record<string, unknown>;
  const rawCheckAfterSecs = info.check_after_secs ?? info.checkAfterSecs;
  return {
    state: typeof info.state === "string" ? info.state : undefined,
    checkAfterSecs: typeof rawCheckAfterSecs === "number" ? rawCheckAfterSecs : undefined,
    error: info.error,
  };
}

function formatProcessingError(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return `: ${error}`;
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = record.message ?? record.name;
    if (typeof message === "string") return `: ${message}`;
  }
  return `: ${String(error)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    if (Number.isInteger(kb)) return `${kb} KB`;
    return `${kb.toFixed(1)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  if (Number.isInteger(mb)) return `${mb} MB`;
  return `${mb.toFixed(1)} MB`;
}

function mapSdkError(err: unknown, operation?: string): FinchError {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      if (operation === "searchRecent" && isSearchTierForbidden(err)) {
        return new FinchError("CLIENT_ERROR", "Your X API tier does not include search access.", err.data ?? null);
      }
      if (
        (operation === "listBookmarkFolders" ||
          operation === "createBookmarkFolder" ||
          operation === "listBookmarksInFolder" ||
          operation === "addBookmarkToFolder") &&
        isBookmarkFoldersPremiumForbidden(err)
      ) {
        return new FinchError("CLIENT_ERROR", "Bookmark folders require X Premium.", err.data ?? null);
      }
      if (
        (operation === "addBookmark" || operation === "removeBookmark" || operation === "addBookmarkToFolder") &&
        isBookmarkWriteForbidden(err)
      ) {
        return new FinchError(
          "AUTH_ERROR",
          "Your X API token is missing the bookmark.write scope. Run `finch auth` to re-authorize with bookmarks access.",
          err.data ?? null,
        );
      }
      if (operation === "uploadImage" || operation === "uploadVideo" || operation === "setMediaAltText") {
        return new FinchError("AUTH_ERROR", MEDIA_UPLOAD_FORBIDDEN_ERROR, err.data ?? null);
      }
      return new FinchError("AUTH_ERROR", REJECTED_CREDENTIALS_MESSAGE, err.data ?? null);
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
    client as unknown as UnderlyingClientLike,
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
  /** Re-read the persisted credential after acquiring the refresh lock (default: file store). */
  readConfigFn?: () => FinchOAuth2Config | null;
  /** Serialize refresh across processes/instances sharing the store (default: file lock). */
  runExclusive?: <T>(fn: () => Promise<T>) => Promise<T>;
}

class RefreshingOAuth2Transport implements XTransport {
  private cachedTransport: XTransport | undefined;
  private refreshLock: Promise<XTransport> | null = null;

  constructor(
    private readonly config: OAuth2AuthConfig,
    private readonly deps: Required<
      Pick<RefreshingOAuth2TransportDeps, "buildTransportFn" | "nowFn" | "runExclusive">
    > &
      RefreshingOAuth2TransportDeps,
  ) {}

  async getMe(): Promise<FinchUser> {
    return this.call((t) => t.getMe());
  }

  async createTweet(text: string, replyToId?: string, mediaIds?: string[]): Promise<CreatedTweet> {
    return this.call((t) => t.createTweet(text, replyToId, mediaIds));
  }

  async getTweet(id: string): Promise<FinchTweet> {
    return this.call((t) => t.getTweet(id));
  }

  async searchRecent(query: string, maxResults: number): Promise<FinchTweet[]> {
    return this.call((t) => t.searchRecent(query, maxResults));
  }

  async userTweets(userId: string, maxResults: number): Promise<FinchTweet[]> {
    return this.call((t) => t.userTweets(userId, maxResults));
  }

  async homeTimeline(userId: string, maxResults: number): Promise<FinchTweet[]> {
    return this.call((t) => t.homeTimeline(userId, maxResults));
  }

  async listBookmarks(userId: string, maxResults: number): Promise<FinchTweet[]> {
    return this.call((t) => t.listBookmarks(userId, maxResults));
  }

  async addBookmark(userId: string, tweetId: string): Promise<BookmarkStatus> {
    return this.call((t) => t.addBookmark(userId, tweetId));
  }

  async removeBookmark(userId: string, tweetId: string): Promise<BookmarkStatus> {
    return this.call((t) => t.removeBookmark(userId, tweetId));
  }

  async listBookmarkFolders(userId: string): Promise<FinchBookmarkFolder[]> {
    return this.call((t) => t.listBookmarkFolders(userId));
  }

  async createBookmarkFolder(userId: string, name: string): Promise<FinchBookmarkFolder> {
    return this.call((t) => t.createBookmarkFolder(userId, name));
  }

  async listBookmarksInFolder(userId: string, folderId: string, maxResults: number): Promise<FinchTweet[]> {
    return this.call((t) => t.listBookmarksInFolder(userId, folderId, maxResults));
  }

  async addBookmarkToFolder(userId: string, folderId: string, tweetId: string): Promise<BookmarkStatus> {
    return this.call((t) => t.addBookmarkToFolder(userId, folderId, tweetId));
  }

  async getUserByUsername(username: string): Promise<FinchUserProfile> {
    return this.call((t) => t.getUserByUsername(username));
  }

  async like(userId: string, tweetId: string): Promise<LikeStatus> {
    return this.call((t) => t.like(userId, tweetId));
  }

  async unlike(userId: string, tweetId: string): Promise<LikeStatus> {
    return this.call((t) => t.unlike(userId, tweetId));
  }

  async retweet(userId: string, tweetId: string): Promise<RepostStatus> {
    return this.call((t) => t.retweet(userId, tweetId));
  }

  async unretweet(userId: string, tweetId: string): Promise<RepostStatus> {
    return this.call((t) => t.unretweet(userId, tweetId));
  }

  async follow(userId: string, targetUserId: string): Promise<FollowStatus> {
    return this.call((t) => t.follow(userId, targetUserId));
  }

  async unfollow(userId: string, targetUserId: string): Promise<FollowStatus> {
    return this.call((t) => t.unfollow(userId, targetUserId));
  }

  async deleteTweet(id: string): Promise<DeleteStatus> {
    return this.call((t) => t.deleteTweet(id));
  }

  async uploadImage(path: string): Promise<{ media_id: string }> {
    this.requireMediaWriteScope();
    return this.call((t) => t.uploadImage(path));
  }

  async uploadVideo(path: string, onStatus?: (message: string) => void): Promise<{ media_id: string }> {
    this.requireMediaWriteScope();
    return this.call((t) => t.uploadVideo(path, onStatus));
  }

  async setMediaAltText(mediaId: string, altText: string): Promise<void> {
    this.requireMediaWriteScope();
    return this.call((t) => t.setMediaAltText(mediaId, altText));
  }

  private requireMediaWriteScope(): void {
    if (!this.config.scopes.includes(MEDIA_WRITE_SCOPE)) {
      throw new FinchError("AUTH_ERROR", MEDIA_WRITE_AUTH_ERROR);
    }
  }

  async createArticleDraft(title: string, contentState: object, coverMediaId?: string): Promise<{ id: string }> {
    return this.call((t) => t.createArticleDraft(title, contentState, coverMediaId));
  }

  async publishArticleDraft(draftId: string): Promise<{ post_id: string }> {
    return this.call((t) => t.publishArticleDraft(draftId));
  }

  /**
   * Runs one transport operation with a fresh access token, and — if X rejects
   * the credential outright (a 401/403 that maps to the generic
   * "credentials rejected" message) — refreshes once and retries. This covers
   * the case where the access token was invalidated server-side BEFORE its
   * stated expiry, which the proactive clock check in ensureFreshToken cannot
   * see. A 401 means the request was never executed, so retrying is safe.
   */
  private async call<T>(op: (transport: XTransport) => Promise<T>): Promise<T> {
    const transport = await this.ensureFreshToken();
    try {
      return await op(transport);
    } catch (err) {
      if (!this.shouldReactivelyRefresh(err)) throw err;
      const refreshed = await this.forceRefresh();
      return op(refreshed);
    }
  }

  private shouldReactivelyRefresh(err: unknown): boolean {
    return (
      err instanceof FinchError &&
      err.code === "AUTH_ERROR" &&
      err.message === REJECTED_CREDENTIALS_MESSAGE &&
      this.config.refreshToken.length > 0
    );
  }

  private async ensureFreshToken(): Promise<XTransport> {
    const now = this.deps.nowFn();
    if (now < this.config.expiresAt - EXPIRY_BUFFER_MS) {
      if (!this.cachedTransport) {
        this.cachedTransport = this.deps.buildTransportFn(this.config.accessToken);
      }
      return this.cachedTransport;
    }
    return this.refreshOnce();
  }

  /** Force a refresh regardless of the local clock (reactive 401 path). */
  private forceRefresh(): Promise<XTransport> {
    return this.refreshOnce();
  }

  /** Collapse concurrent refreshes within this instance onto one in-flight call. */
  private async refreshOnce(): Promise<XTransport> {
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

  private performRefresh(): Promise<XTransport> {
    // Serialize across every process/instance sharing this credential store so
    // X's single-use (rotating) refresh token is spent by at most one caller.
    return this.deps.runExclusive(async () => {
      // Another caller may have rotated the token while we waited for the lock.
      // Adopt their freshly persisted credential instead of spending ours a
      // second time (which X would reject and force a needless re-login).
      const persisted = this.deps.readConfigFn?.() ?? null;
      if (persisted && this.isAdoptable(persisted.auth)) {
        this.adopt(persisted.auth);
        this.cachedTransport = this.deps.buildTransportFn(this.config.accessToken);
        return this.cachedTransport;
      }

      const refreshToken = persisted?.auth.refreshToken || this.config.refreshToken;
      if (!refreshToken) {
        throw new FinchError("AUTH_ERROR", SESSION_EXPIRED_MESSAGE, null);
      }

      let token: OAuth2Token;
      try {
        token = await (this.deps.refreshFn
          ? this.deps.refreshFn(this.config.clientId, refreshToken)
          : new OAuth2({ clientId: this.config.clientId, redirectUri: OAUTH2_REDIRECT_URI }).refreshToken(
              refreshToken,
            ));
      } catch (err) {
        throw classifyRefreshFailure(err);
      }

      const now = this.deps.nowFn();
      this.config.accessToken = token.access_token;
      if (token.refresh_token) {
        this.config.refreshToken = token.refresh_token;
      }
      this.config.expiresAt = now + token.expires_in * 1000;
      await this.persist();

      this.cachedTransport = this.deps.buildTransportFn(this.config.accessToken);
      return this.cachedTransport;
    });
  }

  // A persisted credential is worth adopting only when it is a DIFFERENT access
  // token than the one we hold AND is still fresh — i.e. a concurrent caller
  // already refreshed. Same token, or a stale one, means we must refresh.
  private isAdoptable(auth: OAuth2AuthConfig): boolean {
    return auth.accessToken !== this.config.accessToken && this.deps.nowFn() < auth.expiresAt - EXPIRY_BUFFER_MS;
  }

  private adopt(auth: OAuth2AuthConfig): void {
    this.config.accessToken = auth.accessToken;
    this.config.refreshToken = auth.refreshToken;
    this.config.expiresAt = auth.expiresAt;
  }

  private async persist(): Promise<void> {
    if (this.deps.persistFn) {
      await this.deps.persistFn(this.config);
      return;
    }
    const current = readOAuth2Config();
    const defaults = current?.defaults ?? { json: false, count: 10 };
    writeOAuth2Config({ auth: this.config, transport: "oauth2", defaults });
  }
}

// Matches the plain-Error message @xdevplatform/xdk's OAuth2.refreshToken()
// throws for a non-ok token-endpoint response ("Failed to refresh token:
// <status>, body: ..."). Pinned by the FIN-78 regression tests so an xdk
// upgrade that changes this contract fails loudly instead of silently
// reclassifying refresh failures.
const XDK_REFRESH_FAILURE_STATUS = /^Failed to refresh token: (\d{3})\b/;

// RFC 6749 §5.2 error codes that mean the token endpoint REJECTED this
// refresh request outright — the credential (or client) is invalid and no
// retry can succeed. Matched against the failure's message/body text so the
// classification survives an XDK error-prefix change as long as X's response
// body is included (the mocked-fetch regression tests pin the current
// XDK 0.5.0 contract).
const OAUTH_TERMINAL_REFRESH_ERROR = /invalid_grant|invalid_client|unauthorized_client|unsupported_grant_type/i;

// 4xx statuses that are retry-oriented rather than "your credential is bad":
// request timeout, too-early, and rate limiting.
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429]);

/**
 * Decide whether a failed refresh means "the session is gone" (X answered
 * with an OAuth rejection — only a new interactive login recovers) or the
 * outcome is ambiguous/transient (network failure, timeout, 5xx, 429 — a
 * retry may recover, and X may or may not have processed the request).
 * Terminal means an explicit RFC 6749 error code in the response, or a
 * non-transient 4xx from the token endpoint. Everything else — including a
 * response that never arrived — maps to a retryable NETWORK_ERROR whose
 * message does not overclaim what happened to the stored credential. A
 * FinchError from an injected refreshFn already carries its own
 * classification and passes through untouched (FIN-78).
 */
function classifyRefreshFailure(err: unknown): FinchError {
  if (err instanceof FinchError) return err;

  let status: number | null = null;
  let detail = "";
  if (err instanceof ApiError) {
    status = err.status;
    detail = `${err.message} ${stringifyErrorData(err.data)}`;
  } else if (err instanceof Error) {
    detail = err.message;
    const match = err.message.match(XDK_REFRESH_FAILURE_STATUS);
    if (match) status = Number(match[1]);
  }

  if (OAUTH_TERMINAL_REFRESH_ERROR.test(detail)) {
    return new FinchError("AUTH_ERROR", SESSION_EXPIRED_MESSAGE, null);
  }
  if (status !== null && status >= 400 && status < 500 && !TRANSIENT_HTTP_STATUSES.has(status)) {
    return new FinchError("AUTH_ERROR", SESSION_EXPIRED_MESSAGE, null);
  }
  return new FinchError("NETWORK_ERROR", REFRESH_UNCONFIRMED_MESSAGE, null);
}

function runInline<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

// The shared store-wide writer lock (see withConfigStoreLock in
// oauth2-config.ts) — refresh, re-auth, and config set all serialize on it.

export function createRefreshingOAuth2Transport(
  config: OAuth2AuthConfig,
  deps?: RefreshingOAuth2TransportDeps,
): XTransport {
  // A caller that injects a custom persistFn owns its own store, so the default
  // file-based readback/lock are disabled unless it also injects them; the
  // default (file) store gets cross-process refresh coordination for free.
  const usingFileStore = !deps?.persistFn;
  return new RefreshingOAuth2Transport(config, {
    refreshFn: deps?.refreshFn,
    persistFn: deps?.persistFn,
    buildTransportFn: deps?.buildTransportFn ?? createOAuth2Transport,
    nowFn: deps?.nowFn ?? Date.now,
    readConfigFn: deps?.readConfigFn ?? (usingFileStore ? readOAuth2Config : undefined),
    runExclusive: deps?.runExclusive ?? (usingFileStore ? withConfigStoreLock : runInline),
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
