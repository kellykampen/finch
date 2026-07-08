import { resolveOAuth2Transport, type XTransport, type FinchTweet } from "../core/transport";
import { parseArgs, resolveCount } from "../core/args";
import { formatPosts } from "../core/format";

export interface TimelineDeps {
  getTransport?: () => XTransport;
}

/** `finch timeline [-n]`: the authenticated user's home reverse-chronological timeline. */
export async function runTimeline(
  argv: string[],
  deps: TimelineDeps = {},
): Promise<{ data: { posts: FinchTweet[] }; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const { values } = parseArgs(argv, { valueFlags: ["-n"] });
  const count = resolveCount(values["-n"]);

  const transport = getTransport();
  const me = await transport.getMe();
  const posts = await transport.homeTimeline(me.id, count);

  return { data: { posts }, human: formatPosts(posts) };
}
