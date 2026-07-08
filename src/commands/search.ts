import { resolveOAuth2Transport, type XTransport, type FinchTweet } from "../core/transport";
import { FinchError } from "../core/errors";
import { parseArgs, resolveCount } from "../core/args";
import { formatPosts } from "../core/format";

export interface SearchDeps {
  getTransport?: () => XTransport;
}

/** `finch search "<query>" [-n]`: recent search (free/basic tiers cover ~7 days). */
export async function runSearch(
  argv: string[],
  deps: SearchDeps = {},
): Promise<{ data: { posts: FinchTweet[] }; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const { values, positionals } = parseArgs(argv, { valueFlags: ["-n"] });
  const query = positionals[0];
  if (!query) {
    throw new FinchError("USAGE_ERROR", "finch search requires <query>");
  }
  const count = resolveCount(values["-n"]);

  const transport = getTransport();
  const posts = await transport.searchRecent(query, count);

  return { data: { posts }, human: formatPosts(posts) };
}
