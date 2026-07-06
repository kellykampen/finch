import { resolveAuthConfig, type FinchAuthConfig } from "../core/config";
import { createByokTransport, type XTransport, type FinchTweet } from "../core/transport";
import { FinchError } from "../core/errors";
import { parseArgs, resolveCount } from "../core/args";

export interface TimelineDeps {
  resolveAuth?: () => FinchAuthConfig | null;
  transportFactory?: (auth: FinchAuthConfig) => XTransport;
}

/** `finch timeline [-n]`: the authenticated user's home reverse-chronological timeline. */
export async function runTimeline(
  argv: string[],
  deps: TimelineDeps = {},
): Promise<{ data: { posts: FinchTweet[] }; human: string }> {
  const resolveAuth = deps.resolveAuth ?? resolveAuthConfig;
  const transportFactory = deps.transportFactory ?? createByokTransport;

  const { values } = parseArgs(argv, { valueFlags: ["-n"] });
  const count = resolveCount(values["-n"]);

  const auth = resolveAuth();
  if (!auth) {
    throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
  }

  const transport = transportFactory(auth);
  const me = await transport.getMe();
  const posts = await transport.homeTimeline(me.id, count);

  return { data: { posts }, human: formatPosts(posts) };
}

function formatPosts(posts: FinchTweet[]): string {
  if (posts.length === 0) return "(no posts)";
  return posts.map((p) => `${p.id}  ${p.text}`).join("\n");
}
