import { resolveAuthConfig, type FinchAuthConfig } from "../core/config";
import { createByokTransport, type XTransport, type FinchUserProfile } from "../core/transport";
import { FinchError } from "../core/errors";
import { normalizeUsername } from "../core/ids";
import { parseArgs } from "../core/args";

export interface UserDeps {
  resolveAuth?: () => FinchAuthConfig | null;
  transportFactory?: (auth: FinchAuthConfig) => XTransport;
}

/** `finch user <username>`: profile lookup. */
export async function runUser(argv: string[], deps: UserDeps = {}): Promise<{ data: FinchUserProfile; human: string }> {
  const resolveAuth = deps.resolveAuth ?? resolveAuthConfig;
  const transportFactory = deps.transportFactory ?? createByokTransport;

  const { positionals } = parseArgs(argv);
  const usernameArg = positionals[0];
  if (!usernameArg) {
    throw new FinchError("USAGE_ERROR", "finch user requires <username>");
  }
  const username = normalizeUsername(usernameArg);

  const auth = resolveAuth();
  if (!auth) {
    throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
  }

  const transport = transportFactory(auth);
  const profile = await transport.getUserByUsername(username);

  return { data: profile, human: `@${profile.username} (${profile.name}) — ${profile.description}` };
}
