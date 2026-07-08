import { resolveOAuth2Transport, type XTransport, type FinchTweet } from "../core/transport";
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

  const transport = getTransport();
  const me = await transport.getMe();

  const config = getConfig();
  const configuredDefault = config?.defaults?.count;
  const defaultCount =
    typeof configuredDefault === "number" && Number.isInteger(configuredDefault) && configuredDefault >= 1
      ? Math.min(configuredDefault, MAX_COUNT)
      : DEFAULT_COUNT;

  const { values } = parseArgs(argv, { valueFlags: ["-n", "--count"] });
  const countFlag = values["-n"] !== undefined ? "-n" : "--count";
  const count = resolveCount(values["-n"] ?? values["--count"], defaultCount, countFlag);

  const posts = await transport.listBookmarks(me.id, count);
  return { data: { posts }, human: formatPosts(posts) };
}

export interface BookmarkStatusResult {
  bookmarked: boolean;
  tweet_id: string;
}

export interface BookmarkDryRunResult {
  dryRun: true;
  wouldSend: { tweet_id: string };
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

  const { bools, positionals } = parseArgs(argv, { boolFlags: ["--dry-run"] });
  const idOrUrl = positionals[0];
  if (!idOrUrl) {
    throw new FinchError("USAGE_ERROR", "finch bookmark add requires <id-or-url>");
  }
  const tweetId = extractTweetId(idOrUrl);

  if (bools["--dry-run"]) {
    return {
      data: { dryRun: true, wouldSend: { tweet_id: tweetId } },
      human: `Would bookmark ${tweetId}`,
    };
  }

  const transport = getTransport();
  await transport.addBookmark(tweetId);
  return { data: { bookmarked: true, tweet_id: tweetId }, human: `Bookmarked ${tweetId}` };
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

  const { bools, positionals } = parseArgs(argv, { boolFlags: ["--dry-run"] });
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
  await transport.removeBookmark(tweetId);
  return { data: { bookmarked: false, tweet_id: tweetId }, human: `Removed bookmark ${tweetId}` };
}
