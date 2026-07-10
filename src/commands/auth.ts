import * as crypto from "node:crypto";
import { OAuth2, generateCodeChallenge, generateCodeVerifier, type OAuth2Token } from "@xdevplatform/xdk";
import { createPromptSession } from "../core/prompt";
import {
  readOAuth2Config,
  writeOAuth2Config,
  type FinchOAuth2Config,
  type OAuth2AuthConfig,
} from "../core/oauth2-config";
import { createOAuth2Transport, createRefreshingOAuth2Transport, type XTransport } from "../core/transport";
import { FinchError } from "../core/errors";

export interface AuthResult {
  configured: true;
  username: string;
}

// Full OAuth 2.0 scope superset requested during the browser auth flow.
const OAUTH2_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "like.write",
  "follows.write",
  "bookmark.read",
  "bookmark.write",
  "media.write",
  "offline.access",
] as const;

// Register this exact redirect URI in the X Developer Portal.
const OAUTH2_REDIRECT_URI = "http://127.0.0.1:8765/callback";

const AUTH_SUCCESS_HTML = "<html><body>Authenticated — you can close this tab.</body></html>";

interface OAuth2ClientLike {
  getAuthorizationUrl(state?: string): Promise<string>;
  exchangeCode(code: string, codeVerifier?: string): Promise<OAuth2Token>;
  setPkceParameters(codeVerifier: string, codeChallenge?: string): Promise<void>;
}

interface CallbackCode {
  code: string;
  state: string;
}

interface CallbackServerLike {
  waitForCode(): Promise<CallbackCode>;
  stop(): void | Promise<void>;
  port?: number;
}

export interface OAuth2AuthDeps {
  clientId?: string;
  readEnv?: (key: string) => string | undefined;
  promptClientId?: () => Promise<string>;
  createOAuth2Client?: (config: { clientId: string; redirectUri: string; scope: string[] }) => OAuth2ClientLike;
  startCallbackServer?: (redirectUri: string, expectedState: string) => Promise<CallbackServerLike>;
  openBrowser?: (url: string) => Promise<void>;
  createTransport?: (accessToken: string) => XTransport;
  writeOAuth2Config?: (config: FinchOAuth2Config) => void;
}

export interface RunAuthOptions {
  clientId?: string;
  deps?: OAuth2AuthDeps;
}

async function promptClientIdInteractive(): Promise<string> {
  const session = createPromptSession();
  try {
    return await session.promptSecret("Client ID: ");
  } finally {
    session.close();
  }
}

async function resolveClientId(deps: OAuth2AuthDeps): Promise<string> {
  if (deps.clientId) return deps.clientId;
  const envClientId = deps.readEnv?.("FINCH_OAUTH2_CLIENT_ID") ?? process.env.FINCH_OAUTH2_CLIENT_ID;
  if (envClientId) return envClientId;
  return await (deps.promptClientId ?? promptClientIdInteractive)();
}

function createRealOAuth2Client(config: { clientId: string; redirectUri: string; scope: string[] }): OAuth2ClientLike {
  return new OAuth2(config);
}

export async function startLocalCallbackServer(
  redirectUri: string,
  expectedState: string,
): Promise<CallbackServerLike> {
  const url = new URL(redirectUri);
  const port = Number(url.port);
  if (!Number.isFinite(port)) {
    throw new FinchError("INTERNAL_ERROR", `Invalid redirect URI port: ${url.port}`);
  }

  const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

  let resolveCode: ((value: CallbackCode) => void) | null = null;
  let rejectCode: ((err: Error) => void) | null = null;
  const codePromise = new Promise<CallbackCode>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const timeoutId = setTimeout(() => {
    rejectCode?.(new FinchError("AUTH_ERROR", "OAuth callback timed out waiting for authorization code"));
  }, CALLBACK_TIMEOUT_MS);

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(req) {
      const reqUrl = new URL(req.url);
      if (reqUrl.pathname !== url.pathname) {
        return new Response("Not found", { status: 404 });
      }
      const code = reqUrl.searchParams.get("code");
      const state = reqUrl.searchParams.get("state") ?? "";
      if (!code) {
        return new Response("Error: missing authorization code", { status: 400 });
      }
      if (state !== expectedState) {
        return new Response("Error: state mismatch", { status: 403 });
      }
      clearTimeout(timeoutId);
      // Resolve the code after a short delay so the success Response has time
      // to flush to the browser before runAuth() stops the server.
      setTimeout(() => resolveCode?.({ code, state }), 250);
      return new Response(AUTH_SUCCESS_HTML, { headers: { "Content-Type": "text/html" } });
    },
  });

  return {
    waitForCode: () => codePromise,
    stop: () => {
      clearTimeout(timeoutId);
      server.stop(true);
    },
    port: server.port,
  };
}

async function openSystemBrowser(url: string): Promise<void> {
  const command = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : null;
  if (!command) {
    console.error(`Please open this URL in your browser: ${url}`);
    return;
  }
  try {
    const proc = Bun.spawn([command, url]);
    await proc.exited;
  } catch {
    console.error(`Please open this URL in your browser: ${url}`);
  }
}

/**
 * Parse `--client-id <id>` from the remaining args after `finch auth`.
 * Returns `undefined` when the flag is absent or has no value.
 */
export function parseClientIdFlag(args: string[]): string | undefined {
  let i = 0;
  for (const arg of args) {
    if (arg === "--client-id") {
      return args[i + 1];
    }
    if (arg.startsWith("--client-id=")) {
      return arg.slice("--client-id=".length);
    }
    i++;
  }
  return undefined;
}

/**
 * `finch auth`: OAuth 2.0 PKCE browser + local-callback flow. Generates an
 * authorization URL, starts a one-shot local HTTP server, opens the system
 * browser, exchanges the returned authorization code, validates the token
 * with one live call, and only writes `~/.finch/config` on success.
 */
export async function runAuth(options: RunAuthOptions = {}): Promise<{ data: AuthResult; human: string }> {
  const deps = options.deps ?? {};
  const clientId = options.clientId ?? (await resolveClientId(deps));

  const oauth2 = (deps.createOAuth2Client ?? createRealOAuth2Client)({
    clientId,
    redirectUri: OAUTH2_REDIRECT_URI,
    scope: [...OAUTH2_SCOPES],
  });

  const state = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  await oauth2.setPkceParameters(codeVerifier, codeChallenge);
  const authorizationUrl = await oauth2.getAuthorizationUrl(state);

  const server = await (deps.startCallbackServer ?? startLocalCallbackServer)(OAUTH2_REDIRECT_URI, state);

  // Launch the browser without blocking the callback wait; opener failures are
  // non-fatal because the URL is also printed to stderr as a fallback.
  (deps.openBrowser ?? openSystemBrowser)(authorizationUrl).catch(() => {
    // Swallow — the helper already logs the fallback URL to stderr on error.
  });

  let callback: CallbackCode;
  try {
    callback = await server.waitForCode();
  } finally {
    await server.stop();
  }

  if (callback.state !== state) {
    throw new FinchError("AUTH_ERROR", "OAuth callback state mismatch — possible CSRF attack");
  }

  const token = await oauth2.exchangeCode(callback.code, codeVerifier);

  const transport = (deps.createTransport ?? createOAuth2Transport)(token.access_token);
  const me = await transport.getMe();

  (deps.writeOAuth2Config ?? writeOAuth2Config)({
    auth: {
      clientId,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? "",
      expiresAt: Date.now() + token.expires_in * 1000,
      scopes: (token.scope ?? OAUTH2_SCOPES.join(" ")).split(" ").filter(Boolean),
    },
    transport: "oauth2",
    defaults: { json: false, count: 10 },
  });

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
  readOAuth2Config?: () => FinchOAuth2Config | null;
  createRefreshingTransport?: (config: OAuth2AuthConfig) => XTransport;
}

/**
 * `finch auth status`: reports configuration state without ever throwing for
 * "not configured" or "X rejected the credentials" — those are the normal
 * answers this command exists to report, not command failures. Only a
 * genuine failure to check (network, rate-limit) propagates as an error.
 */
export async function runAuthStatus(deps: AuthStatusDeps = {}): Promise<{ data: AuthStatusResult; human: string }> {
  const readConfig = deps.readOAuth2Config ?? readOAuth2Config;
  const createRefreshing = deps.createRefreshingTransport ?? createRefreshingOAuth2Transport;

  const config = readConfig();
  if (!config) {
    return {
      data: { configured: false, valid: false, username: null },
      human: "Not configured. Run `finch auth`.",
    };
  }

  // Use a refreshing transport so an expired access token is refreshed using the
  // stored refresh token/client ID before declaring credentials invalid. On
  // successful refresh the transport persists the new tokens via writeOAuth2Config.
  const transport = createRefreshing(config.auth);
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
        human: "Configured, but credentials are expired or invalid.",
      };
    }
    throw err;
  }
}
