import { resolveOAuth2Transport, type XTransport, type FinchTweet } from "../core/transport";
import { parseArgs, resolveCount } from "../core/args";
import { formatPosts } from "../core/format";
import { readOAuth2Config, type FinchOAuth2Config } from "../core/oauth2-config";

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
    configuredDefault !== undefined && configuredDefault >= 1 && configuredDefault <= MAX_COUNT
      ? configuredDefault
      : DEFAULT_COUNT;

  const { values } = parseArgs(argv, { valueFlags: ["-n"] });
  const count = resolveCount(values["-n"], defaultCount);

  const posts = await transport.listBookmarks(me.id, count);
  return { data: { posts }, human: formatPosts(posts) };
}
