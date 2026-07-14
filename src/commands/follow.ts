import { resolveOAuth2Transport, type XTransport } from "../core/transport";
import { FinchError } from "../core/errors";
import { normalizeUsername } from "../core/ids";
import { parseArgs } from "../core/args";

export interface FollowResult {
  following: true;
  username: string;
}

export interface FollowDryRunResult {
  dryRun: true;
  wouldSend: { username: string };
}

export interface FollowDeps {
  getTransport?: () => XTransport;
}

/**
 * `finch follow <username>`: follows a user. Resolves the username to a user
 * id the same way `finch user`/`finch user-posts` do (`getUserByUsername`),
 * since the X API's follow endpoint takes ids, not usernames — dry-run stays
 * a pure/local check (no API call) by not resolving the id until after the
 * dry-run branch.
 */
export async function runFollow(
  argv: string[],
  deps: FollowDeps = {},
): Promise<{ data: FollowResult | FollowDryRunResult; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const { bools, positionals } = parseArgs(argv, { boolFlags: ["--dry-run"], rejectUnknownFlags: true });
  const usernameArg = positionals[0];
  if (!usernameArg) {
    throw new FinchError("USAGE_ERROR", "finch follow requires <username>");
  }
  const username = normalizeUsername(usernameArg);

  if (bools["--dry-run"]) {
    return {
      data: { dryRun: true, wouldSend: { username } },
      human: `Would follow @${username}`,
    };
  }

  const transport = getTransport();
  const me = await transport.getMe();
  const target = await transport.getUserByUsername(username);
  await transport.follow(me.id, target.id);
  return { data: { following: true, username }, human: `Followed @${username}` };
}
