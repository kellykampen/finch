import { resolveOAuth2Transport, type XTransport } from "../core/transport";
import { FinchError } from "../core/errors";
import { normalizeUsername } from "../core/ids";
import { parseArgs } from "../core/args";

export interface UnfollowResult {
  following: false;
  username: string;
}

export interface UnfollowDryRunResult {
  dryRun: true;
  wouldSend: { username: string };
}

export interface UnfollowDeps {
  getTransport?: () => XTransport;
}

/** `finch unfollow <username>`: unfollows a user (resolves username to id first, as `follow` does). */
export async function runUnfollow(
  argv: string[],
  deps: UnfollowDeps = {},
): Promise<{ data: UnfollowResult | UnfollowDryRunResult; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const { bools, positionals } = parseArgs(argv, { boolFlags: ["--dry-run"] });
  const usernameArg = positionals[0];
  if (!usernameArg) {
    throw new FinchError("USAGE_ERROR", "finch unfollow requires <username>");
  }
  const username = normalizeUsername(usernameArg);

  if (bools["--dry-run"]) {
    return {
      data: { dryRun: true, wouldSend: { username } },
      human: `Would unfollow @${username}`,
    };
  }

  const transport = getTransport();
  const me = await transport.getMe();
  const target = await transport.getUserByUsername(username);
  await transport.unfollow(me.id, target.id);
  return { data: { following: false, username }, human: `Unfollowed @${username}` };
}
