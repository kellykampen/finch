import { resolveOAuth2Transport, type XTransport, type FinchTweet } from "../core/transport";
import { FinchError } from "../core/errors";
import { normalizeUsername } from "../core/ids";
import { parseArgs, resolveCount } from "../core/args";
import { formatPosts } from "../core/format";

export interface UserPostsDeps {
  getTransport?: () => XTransport;
}

/** `finch user-posts <username> [-n]`: a given user's recent posts. */
export async function runUserPosts(
  argv: string[],
  deps: UserPostsDeps = {},
): Promise<{ data: { posts: FinchTweet[] }; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const { values, positionals } = parseArgs(argv, { valueFlags: ["-n"] });
  const usernameArg = positionals[0];
  if (!usernameArg) {
    throw new FinchError("USAGE_ERROR", "finch user-posts requires <username>");
  }
  const username = normalizeUsername(usernameArg);
  const count = resolveCount(values["-n"]);

  const transport = getTransport();
  const profile = await transport.getUserByUsername(username);
  const posts = await transport.userTweets(profile.id, count);

  return { data: { posts }, human: formatPosts(posts) };
}
