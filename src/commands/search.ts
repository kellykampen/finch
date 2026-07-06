import { resolveAuthConfig, type FinchAuthConfig } from "../core/config";
import { createByokTransport, type XTransport, type FinchTweet } from "../core/transport";
import { FinchError } from "../core/errors";
import { parseArgs, resolveCount } from "../core/args";
import { formatPosts } from "../core/format";

export interface SearchDeps {
  resolveAuth?: () => FinchAuthConfig | null;
  transportFactory?: (auth: FinchAuthConfig) => XTransport;
}

/** `finch search "<query>" [-n]`: recent search (free/basic tiers cover ~7 days). */
export async function runSearch(
  argv: string[],
  deps: SearchDeps = {},
): Promise<{ data: { posts: FinchTweet[] }; human: string }> {
  const resolveAuth = deps.resolveAuth ?? resolveAuthConfig;
  const transportFactory = deps.transportFactory ?? createByokTransport;

  const { values, positionals } = parseArgs(argv, { valueFlags: ["-n"] });
  const query = positionals[0];
  if (!query) {
    throw new FinchError("USAGE_ERROR", "finch search requires <query>");
  }
  const count = resolveCount(values["-n"]);

  const auth = resolveAuth();
  if (!auth) {
    throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
  }

  const transport = transportFactory(auth);
  const posts = await transport.searchRecent(query, count);

  return { data: { posts }, human: formatPosts(posts) };
}
