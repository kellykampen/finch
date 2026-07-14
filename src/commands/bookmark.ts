import { resolveOAuth2Transport, type XTransport, type FinchTweet, type FinchBookmarkFolder } from "../core/transport";
import { parseArgs, resolveCount } from "../core/args";
import { formatPosts } from "../core/format";
import { readOAuth2Config, type FinchOAuth2Config } from "../core/oauth2-config";
import { FinchError } from "../core/errors";
import { extractTweetId } from "../core/ids";

const MAX_COUNT = 100;
const DEFAULT_COUNT = 10;

export interface BookmarkListDeps {
  getTransport?: () => XTransport;
  getConfig?: () => FinchOAuth2Config | null;
}

/** `finch bookmark list [-n]`: the authenticated user's bookmarked posts. */
export async function runBookmarkList(
  argv: string[],
  deps: BookmarkListDeps = {},
): Promise<{ data: { posts: FinchTweet[] }; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;
  const getConfig = deps.getConfig ?? readOAuth2Config;

  // Parse AND fully validate flags (including the count value) BEFORE any
  // network/auth, so a typo'd flag OR a bad count value is a clean USAGE_ERROR
  // rather than triggering a live request (FIN-82 review). getConfig() is a
  // local file read, so computing the default here stays off the network.
  const { values } = parseArgs(argv, { valueFlags: ["-n", "--count", "--folder"], rejectUnknownFlags: true });
  const folderId = values["--folder"];

  const config = getConfig();
  const configuredDefault = config?.defaults?.count;
  const defaultCount =
    typeof configuredDefault === "number" && Number.isInteger(configuredDefault) && configuredDefault >= 1
      ? Math.min(configuredDefault, MAX_COUNT)
      : DEFAULT_COUNT;

  const countFlag = values["-n"] !== undefined ? "-n" : "--count";
  const count = resolveCount(values["-n"] ?? values["--count"], defaultCount, countFlag);

  const transport = getTransport();
  const me = await transport.getMe();

  const posts = folderId
    ? await transport.listBookmarksInFolder(me.id, folderId, count)
    : await transport.listBookmarks(me.id, count);
  return { data: { posts }, human: formatPosts(posts) };
}

export interface BookmarkStatusResult {
  bookmarked: boolean;
  tweet_id: string;
}

export interface BookmarkDryRunResult {
  dryRun: true;
  wouldSend: { tweet_id: string; folder_id?: string };
}

export interface BookmarkAddDeps {
  getTransport?: () => XTransport;
}

/** `finch bookmark add <id-or-url>`: bookmark a post. */
export async function runBookmarkAdd(
  argv: string[],
  deps: BookmarkAddDeps = {},
): Promise<{ data: BookmarkStatusResult | BookmarkDryRunResult; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const { bools, positionals, values } = parseArgs(argv, {
    boolFlags: ["--dry-run"],
    valueFlags: ["--folder"],
    rejectUnknownFlags: true,
  });
  const idOrUrl = positionals[0];
  if (!idOrUrl) {
    throw new FinchError("USAGE_ERROR", "finch bookmark add requires <id-or-url>");
  }
  const tweetId = extractTweetId(idOrUrl);
  const folderId = values["--folder"];

  if (bools["--dry-run"]) {
    return {
      data: { dryRun: true, wouldSend: { tweet_id: tweetId, ...(folderId && { folder_id: folderId }) } },
      human: folderId ? `Would bookmark ${tweetId} in folder ${folderId}` : `Would bookmark ${tweetId}`,
    };
  }

  const transport = getTransport();
  const me = await transport.getMe();
  if (folderId) {
    await transport.addBookmarkToFolder(me.id, folderId, tweetId);
  } else {
    await transport.addBookmark(me.id, tweetId);
  }
  return {
    data: { bookmarked: true, tweet_id: tweetId },
    human: folderId ? `Bookmarked ${tweetId} in folder ${folderId}` : `Bookmarked ${tweetId}`,
  };
}

export interface BookmarkRemoveDeps {
  getTransport?: () => XTransport;
}

/** `finch bookmark rm <id-or-url>`: remove a bookmark. */
export async function runBookmarkRemove(
  argv: string[],
  deps: BookmarkRemoveDeps = {},
): Promise<{ data: BookmarkStatusResult | BookmarkDryRunResult; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const { bools, positionals } = parseArgs(argv, { boolFlags: ["--dry-run"], rejectUnknownFlags: true });
  const idOrUrl = positionals[0];
  if (!idOrUrl) {
    throw new FinchError("USAGE_ERROR", "finch bookmark rm requires <id-or-url>");
  }
  const tweetId = extractTweetId(idOrUrl);

  if (bools["--dry-run"]) {
    return {
      data: { dryRun: true, wouldSend: { tweet_id: tweetId } },
      human: `Would remove bookmark ${tweetId}`,
    };
  }

  const transport = getTransport();
  const me = await transport.getMe();
  await transport.removeBookmark(me.id, tweetId);
  return { data: { bookmarked: false, tweet_id: tweetId }, human: `Removed bookmark ${tweetId}` };
}

export interface BookmarkFoldersDeps {
  getTransport?: () => XTransport;
}

function formatBookmarkFolders(folders: FinchBookmarkFolder[]): string {
  if (folders.length === 0) return "No bookmark folders found.";
  return folders.map((folder) => `${folder.id}\t${folder.name}`).join("\n");
}

/** `finch bookmark folders`: list the authenticated user's bookmark folders. */
export async function runBookmarkFolders(
  argv: string[],
  deps: BookmarkFoldersDeps = {},
): Promise<{ data: { folders: FinchBookmarkFolder[] }; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  // Takes no flags; reject a typo'd one before any network/auth (FIN-82).
  parseArgs(argv, { rejectUnknownFlags: true });

  const transport = getTransport();
  const me = await transport.getMe();
  const folders = await transport.listBookmarkFolders(me.id);

  return { data: { folders }, human: formatBookmarkFolders(folders) };
}

export interface BookmarkFolderNewDeps {
  getTransport?: () => XTransport;
}

/** `finch bookmark folder new <name>`: create a bookmark folder. */
export async function runBookmarkFolderNew(
  argv: string[],
  deps: BookmarkFolderNewDeps = {},
): Promise<{ data: { folder: FinchBookmarkFolder }; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const { positionals } = parseArgs(argv, { rejectUnknownFlags: true });
  const name = positionals[0];
  if (!name) {
    throw new FinchError("USAGE_ERROR", "finch bookmark folder new requires <name>");
  }

  const transport = getTransport();
  const me = await transport.getMe();
  const folder = await transport.createBookmarkFolder(me.id, name);

  return { data: { folder }, human: `Created bookmark folder ${folder.id}\t${folder.name}` };
}
