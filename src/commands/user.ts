import { resolveOAuth2Transport, type XTransport, type FinchUserProfile } from "../core/transport";
import { FinchError } from "../core/errors";
import { normalizeUsername } from "../core/ids";
import { parseArgs } from "../core/args";

export interface UserDeps {
  getTransport?: () => XTransport;
}

/** `finch user <username>`: profile lookup. */
export async function runUser(argv: string[], deps: UserDeps = {}): Promise<{ data: FinchUserProfile; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const { positionals } = parseArgs(argv, { rejectUnknownFlags: true });
  const usernameArg = positionals[0];
  if (!usernameArg) {
    throw new FinchError("USAGE_ERROR", "finch user requires <username>");
  }
  const username = normalizeUsername(usernameArg);

  const transport = getTransport();
  const profile = await transport.getUserByUsername(username);

  return { data: profile, human: `@${profile.username} (${profile.name}) — ${profile.description}` };
}
