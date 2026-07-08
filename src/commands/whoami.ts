import { resolveOAuth2Transport, type XTransport, type FinchUser } from "../core/transport";

export interface WhoamiDeps {
  getTransport?: () => XTransport;
}

export async function runWhoami(deps: WhoamiDeps = {}): Promise<{ data: FinchUser; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const transport = getTransport();
  const me = await transport.getMe();
  return { data: me, human: `@${me.username} (${me.name})` };
}
