import * as crypto from "node:crypto";
import { OAuth2, type OAuth2Token } from "@xdevplatform/xdk";
import { createPromptSession } from "../core/prompt";
import { resolveAuthConfig } from "../core/config";
import { writeOAuth2Config, type FinchOAuth2Config } from "../core/oauth2-config";
import { createByokTransport, createOAuth2Transport, type XTransport } from "../core/transport";
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
  "offline.access",
] as const;

// Register this exact redirect URI in the X Developer Portal.
const OAUTH2_REDIRECT_URI = "http://127.0.0.1:8765/callback";

const AUTH_SUCCESS_HTML = "<html><body>Authenticated — you can close this tab.</body></html>";

interface OAuth2ClientLike {
  getAuthorizationUrl(state?: string): Promise<string>;
  exchangeCode(code: string, codeVerifier?: string): Promise<OAuth2Token>;
}

interface CallbackCode {
  code: string;
  state: string;
}

interface CallbackServerLike {
  waitForCode(): Promise<CallbackCode>;
  stop(): void | Promise<void>;
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

async function startLocalCallbackServer(redirectUri: string, expectedState: string): Promise<CallbackServerLike> {
  const url = new URL(redirectUri);
  const port = Number(url.port);
  if (!Number.isFinite(port)) {
    throw new FinchError("INTERNAL_ERROR", `Invalid redirect URI port: ${url.port}`);
  }

  let resolveCode: ((value: CallbackCode) => void) | null = null;
  let rejectCode: ((err: Error) => void) | null = null;
  const codePromise = new Promise<CallbackCode>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = Bun.serve({
    port,
    fetch(req) {
      const reqUrl = new URL(req.url);
      if (reqUrl.pathname !== url.pathname) {
        return new Response("Not found", { status: 404 });
      }
      const code = reqUrl.searchParams.get("code");
      const state = reqUrl.searchParams.get("state") ?? "";
      if (!code) {
        const err = new FinchError("AUTH_ERROR", "OAuth callback missing authorization code");
        rejectCode?.(err);
        return new Response("Error: missing authorization code", { status: 400 });
      }
      if (state !== expectedState) {
        const err = new FinchError("AUTH_ERROR", "OAuth callback state mismatch — possible CSRF attack");
        rejectCode?.(err);
        return new Response("Error: state mismatch", { status: 403 });
      }
      resolveCode?.({ code, state });
      return new Response(AUTH_SUCCESS_HTML, { headers: { "Content-Type": "text/html" } });
    },
  });

  return {
    waitForCode: () => codePromise,
    stop: () => server.stop(true),
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
  const idx = args.indexOf("--client-id");
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
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

  const token = await oauth2.exchangeCode(callback.code);

  const transport = (deps.createTransport ?? createOAuth2Transport)(token.access_token);
  const me = await transport.getMe();

  (deps.writeOAuth2Config ?? writeOAuth2Config)({
    auth: {
      clientId,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? "",
      expiresAt: Date.now() + token.expires_in * 1000,
      scopes: (token.scope ?? "").split(" ").filter(Boolean),
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
  resolveAuth?: () => import("../core/config").FinchAuthConfig | null;
  transportFactory?: (auth: import("../core/config").FinchAuthConfig) => XTransport;
}

/**
 * `finch auth status`: reports configuration state without ever throwing for
 * "not configured" or "X rejected the credentials" — those are the normal
 * answers this command exists to report, not command failures. Only a
 * genuine failure to check (network, rate-limit) propagates as an error.
 */
export async function runAuthStatus(deps: AuthStatusDeps = {}): Promise<{ data: AuthStatusResult; human: string }> {
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
