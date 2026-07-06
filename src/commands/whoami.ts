import { resolveAuthConfig, type FinchAuthConfig } from "../core/config";
import { createByokTransport, type XTransport, type FinchUser } from "../core/transport";
import { FinchError } from "../core/errors";

export interface WhoamiDeps {
  resolveAuth?: () => FinchAuthConfig | null;
  transportFactory?: (auth: FinchAuthConfig) => XTransport;
}

export async function runWhoami(
  deps: WhoamiDeps = {},
): Promise<{ data: FinchUser; human: string }> {
  const resolveAuth = deps.resolveAuth ?? resolveAuthConfig;
  const transportFactory = deps.transportFactory ?? createByokTransport;

  const auth = resolveAuth();
  if (!auth) {
    throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
  }

  const transport = transportFactory(auth);
  const me = await transport.getMe();
  return { data: me, human: `@${me.username} (${me.name})` };
}
