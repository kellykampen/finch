import { createPromptSession } from "../core/prompt";
import {
  readConfig,
  writeConfig,
  resolveAuthConfig,
  type FinchAuthConfig,
  type FinchConfig,
} from "../core/config";
import { createByokTransport, type XTransport } from "../core/transport";
import { FinchError } from "../core/errors";

export interface AuthResult {
  configured: true;
  username: string;
}

export interface AuthDeps {
  promptCredentials?: () => Promise<FinchAuthConfig>;
  transportFactory?: (auth: FinchAuthConfig) => XTransport;
  readConfig?: () => FinchConfig | null;
  writeConfig?: (config: FinchConfig) => void;
}

async function promptCredentialsInteractive(): Promise<FinchAuthConfig> {
  const session = createPromptSession();
  try {
    return {
      apiKey: await session.promptSecret("API Key: "),
      apiKeySecret: await session.promptSecret("API Key Secret: "),
      accessToken: await session.promptSecret("Access Token: "),
      accessTokenSecret: await session.promptSecret("Access Token Secret: "),
    };
  } finally {
    session.close();
  }
}

/**
 * `finch auth`: prompts for the four credentials, validates them with one
 * live call, and only writes `~/.finch/config` on success — a typo'd key
 * fails loudly instead of leaving a silently-broken config file.
 */
export async function runAuth(
  deps: AuthDeps = {},
): Promise<{ data: AuthResult; human: string }> {
  const promptCredentials = deps.promptCredentials ?? promptCredentialsInteractive;
  const transportFactory = deps.transportFactory ?? createByokTransport;
  const readConfigFn = deps.readConfig ?? readConfig;
  const writeConfigFn = deps.writeConfig ?? writeConfig;

  const auth = await promptCredentials();
  const transport = transportFactory(auth);
  const me = await transport.getMe();

  const existing = readConfigFn();
  const config: FinchConfig = {
    auth,
    transport: "byok",
    defaults: existing?.defaults ?? { json: false, count: 10 },
  };
  writeConfigFn(config);

  return {
    data: { configured: true, username: me.username },
    human: `Configured. Logged in as @${me.username}.`,
  };
}

export interface AuthStatusResult {
  configured: boolean;
  valid: boolean;
  username: string | null;
}

export interface AuthStatusDeps {
  resolveAuth?: () => FinchAuthConfig | null;
  transportFactory?: (auth: FinchAuthConfig) => XTransport;
}

/**
 * `finch auth status`: reports configuration state without ever throwing for
 * "not configured" or "X rejected the credentials" — those are the normal
 * answers this command exists to report, not command failures. Only a
 * genuine failure to check (network, rate-limit) propagates as an error.
 */
export async function runAuthStatus(
  deps: AuthStatusDeps = {},
): Promise<{ data: AuthStatusResult; human: string }> {
  const resolveAuth = deps.resolveAuth ?? resolveAuthConfig;
  const transportFactory = deps.transportFactory ?? createByokTransport;

  const auth = resolveAuth();
  if (!auth) {
    return {
      data: { configured: false, valid: false, username: null },
      human: "Not configured. Run `finch auth`.",
    };
  }

  const transport = transportFactory(auth);
  try {
    const me = await transport.getMe();
    return {
      data: { configured: true, valid: true, username: me.username },
      human: `Configured and valid. Logged in as @${me.username}.`,
    };
  } catch (err) {
    if (err instanceof FinchError && err.code === "AUTH_ERROR") {
      return {
        data: { configured: true, valid: false, username: null },
        human: "Configured, but X rejected the credentials.",
      };
    }
    throw err;
  }
}
