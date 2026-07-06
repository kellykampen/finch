import { resolveAuthConfig, type FinchAuthConfig } from "../core/config";
import { createByokTransport, type XTransport, type FinchTweet } from "../core/transport";
import { FinchError } from "../core/errors";
import { normalizeUsername } from "../core/ids";
import { parseArgs, resolveCount } from "../core/args";

export interface UserPostsDeps {
  resolveAuth?: () => FinchAuthConfig | null;
  transportFactory?: (auth: FinchAuthConfig) => XTransport;
}

/** `finch user-posts <username> [-n]`: a given user's recent posts. */
export async function runUserPosts(
  argv: string[],
  deps: UserPostsDeps = {},
): Promise<{ data: { posts: FinchTweet[] }; human: string }> {
  const resolveAuth = deps.resolveAuth ?? resolveAuthConfig;
  const transportFactory = deps.transportFactory ?? createByokTransport;

  const { values, positionals } = parseArgs(argv, { valueFlags: ["-n"] });
  const usernameArg = positionals[0];
  if (!usernameArg) {
    throw new FinchError("USAGE_ERROR", "finch user-posts requires <username>");
  }
  const username = normalizeUsername(usernameArg);
  const count = resolveCount(values["-n"]);

  const auth = resolveAuth();
  if (!auth) {
    throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
  }

  const transport = transportFactory(auth);
  const profile = await transport.getUserByUsername(username);
  const posts = await transport.userTweets(profile.id, count);

  return { data: { posts }, human: formatPosts(posts) };
}

function formatPosts(posts: FinchTweet[]): string {
  if (posts.length === 0) return "(no posts)";
  return posts.map((p) => `${p.id}  ${p.text}`).join("\n");
}
