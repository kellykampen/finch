import * as crypto from "node:crypto";
import { OAuth2, generateCodeChallenge, generateCodeVerifier, type OAuth2Token } from "@xdevplatform/xdk";
import { createPromptSession } from "../core/prompt";
import {
  readOAuth2Config,
  writeOAuth2Config,
  withConfigStoreLock,
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
  readOAuth2Config?: () => FinchOAuth2Config | null;
  promptClientId?: () => Promise<string>;
  createOAuth2Client?: (config: { clientId: string; redirectUri: string; scope: string[] }) => OAuth2ClientLike;
  startCallbackServer?: (redirectUri: string, expectedState: string) => Promise<CallbackServerLike>;
  openBrowser?: (url: string) => Promise<void>;
  createTransport?: (accessToken: string) => XTransport;
  writeOAuth2Config?: (config: FinchOAuth2Config) => void;
  /** Serialize the final config write against other config writers (default: store lock for the file store). */
  runExclusive?: <T>(fn: () => Promise<T>) => Promise<T>;
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
  // The Client ID is durable, non-secret X app metadata that never changes.
  // Reuse the one already stored in ~/.finch/config so re-authenticating after
  // a session ends is a one-command action — an operator should never have to
  // re-type it just because the refresh token finally expired (FIN-62).
  const persistedClientId = readPersistedClientId(deps);
  if (persistedClientId) return persistedClientId;
  return await (deps.promptClientId ?? promptClientIdInteractive)();
}

// Best-effort read of the stored config. `finch auth` is also the recovery
// path for a legacy (pre-OAuth2) or corrupt config, both of which make
// readOAuth2Config throw — so a failed read must degrade to "no prior config"
// rather than break re-authentication (PLAN.md hard-cutover note).
function readPersistedConfig(deps: OAuth2AuthDeps): FinchOAuth2Config | null {
  try {
    return (deps.readOAuth2Config ?? readOAuth2Config)();
  } catch {
    return null;
  }
}

function readPersistedClientId(deps: OAuth2AuthDeps): string | undefined {
  return readPersistedConfig(deps)?.auth?.clientId || undefined;
}

const FACTORY_DEFAULTS = { json: false, count: 10 };

function runInline<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

// Re-auth rewrites the whole config file; the operator's non-secret settings
// must survive it. Only adopt a persisted `defaults` block that matches the
// documented shape — the guarded read above swallows corruption, so this is
// the last line of defense against writing a malformed block back (FIN-78).
function persistedDefaults(deps: OAuth2AuthDeps): { json: boolean; count: number } {
  const defaults = readPersistedConfig(deps)?.defaults;
  if (defaults && typeof defaults.json === "boolean" && typeof defaults.count === "number") {
    return defaults;
  }
  return FACTORY_DEFAULTS;
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
    // Stop at the POSIX `--` terminator, consistent with assertKnownAuthFlags:
    // a `--client-id` appearing after it is positional free text, not a flag.
    if (arg === "--") {
      return undefined;
    }
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
 * FIN-81: reject any unrecognized flag passed to `finch auth`.
 *
 * The only flag `finch auth` accepts is `--client-id` (space- or `=`-separated).
 * Previously an unrecognized/misspelled flag (e.g. a typo'd `--clinet-id`) was
 * silently dropped, and `resolveClientId()` fell through to the persisted/env
 * client ID — producing a confusing downstream OAuth rejection with no hint the
 * flag was ignored. Reject it loudly instead of guessing.
 *
 * Called with the args AFTER `finch auth` (i.e. `argv.slice(1)` at the auth
 * dispatch). Stray non-flag positionals are left alone: `auth` takes none and
 * ignores them, and this change is scoped to flag typos, not positionals.
 */
export function assertKnownAuthFlags(args: string[]): void {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    // POSIX end-of-flags terminator: everything at or after `--` is positional
    // free text, never a flag (resolveDispatchArgs preserves it). `finch auth`
    // takes no positionals and ignores them, so stop flag-checking here.
    if (arg === "--") return;
    // `--client-id <value>` consumes the next token as its value. A missing
    // value (flag is the last arg) is a usage error, not a silent fall-through
    // to persisted/env creds — that silent fallback is exactly the FIN-81 bug.
    if (arg === "--client-id") {
      if (args[i + 1] === undefined) {
        throw new FinchError("USAGE_ERROR", "Missing value for --client-id (e.g. finch auth --client-id <id>).", {
          flag: "--client-id",
        });
      }
      i++; // consume the value, so a value that looks like a flag isn't reflagged
      continue;
    }
    if (arg.startsWith("--client-id=")) {
      if (arg.slice("--client-id=".length) === "") {
        throw new FinchError("USAGE_ERROR", "Missing value for --client-id (e.g. finch auth --client-id=<id>).", {
          flag: "--client-id",
        });
      }
      continue;
    }
    // A lone "-" is a conventional stdin placeholder, not a flag; anything else
    // starting with "-" is a flag `finch auth` does not recognize.
    if (arg.startsWith("-") && arg !== "-") {
      throw new FinchError(
        "USAGE_ERROR",
        `Unknown flag "${arg}" for 'finch auth'. The only flag it accepts is --client-id ` +
          "(e.g. finch auth --client-id <id>).",
        { flag: arg },
      );
    }
  }
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

  // Requesting offline.access does not guarantee X issued a refresh token
  // (the scope can be denied on the consent screen or by X app settings). A
  // grant without one cannot outlive its ~2h access token, so persisting it —
  // possibly over a previously refreshable session — would recreate the
  // FIN-78 "re-auth several times a day" failure. Fail before any validation
  // call or config write; the prior config (if any) stays untouched.
  if (!token.refresh_token) {
    throw new FinchError(
      "AUTH_ERROR",
      "X did not issue a refresh token, so this login could not stay signed in past its short-lived " +
        "access token. Nothing was saved — your previous credentials (if any) are untouched. Ensure the " +
        "offline.access scope is approved on the consent screen and allowed by your X app settings, then " +
        "run `finch auth` again.",
      { reason: "missing_refresh_token" },
    );
  }
  const refreshToken = token.refresh_token;

  const transport = (deps.createTransport ?? createOAuth2Transport)(token.access_token);
  const me = await transport.getMe();

  // The final write is a whole-config replacement, so it must run under the
  // shared store lock and re-read the freshest snapshot inside it: re-auth
  // owns `auth` (the newly issued credential wins) but must carry forward the
  // latest `defaults`, which a concurrent refresh or `config set` may have
  // just persisted (FIN-78 review blocker 1). Callers that inject their own
  // store own their own serialization.
  const usingFileStore = !deps.writeOAuth2Config;
  const runExclusive = deps.runExclusive ?? (usingFileStore ? withConfigStoreLock : runInline);
  await runExclusive(async () => {
    (deps.writeOAuth2Config ?? writeOAuth2Config)({
      auth: {
        clientId,
        accessToken: token.access_token,
        refreshToken,
        expiresAt: Date.now() + token.expires_in * 1000,
        scopes: (token.scope ?? OAUTH2_SCOPES.join(" ")).split(" ").filter(Boolean),
      },
      transport: "oauth2",
      defaults: persistedDefaults(deps),
    });
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
