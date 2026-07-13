import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { configPath, CONFIG_MODE, CONFIG_DIR_MODE } from "./config";
import { withFileLock } from "./refresh-lock";
import { FinchError } from "./errors";

export interface OAuth2AuthConfig {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

export interface FinchOAuth2Config {
  auth: OAuth2AuthConfig;
  transport: "oauth2";
  defaults: {
    json: boolean;
    count: number;
  };
}

// A pre-OAuth2 config is a legacy OAuth 1.0a "BYOK" file whose `auth` block holds
// long-lived API-key credentials (apiKey/apiKeySecret/accessTokenSecret) and whose
// `transport` is "byok", rather than an OAuth 2.0 clientId + refreshable token.
// Finch dropped OAuth 1.0a in the hard cutover and cannot migrate these
// automatically, so we surface a clear, actionable remediation instead of a raw
// parse/shape failure. SECURITY: the message and `detail` reference only the
// non-secret config path and the recovery command — never a credential value.
// The remediation itself already works: `finch auth` catches this error and falls
// through to a fresh browser login (see auth.ts:readPersistedClientId).
function legacyConfigError(path: string): FinchError {
  return new FinchError(
    "AUTH_ERROR",
    `Detected a legacy OAuth 1.0a config at ${path}. Finch now uses OAuth 2.0 and ` +
      "cannot migrate it automatically — run `finch auth` to re-authenticate. This " +
      "overwrites the old config; none of its credentials are carried over.",
    {
      reason: "legacy_oauth1_config",
      migration: "manual",
      remediation: "run `finch auth`",
      legacyConfigPath: path,
    },
  );
}

// True for a legacy OAuth 1.0a config. A valid OAuth 2.0 config always carries a
// `clientId` in `auth` and `transport: "oauth2"`, so either an `apiKey` field or a
// `"byok"` transport unambiguously marks the old format — the transport check also
// catches a truncated legacy file whose `auth.apiKey` has gone missing, which would
// otherwise slip through and fail later with a far more confusing error.
function isLegacyConfig(parsed: unknown): boolean {
  const record = parsed as Record<string, unknown> | undefined;
  const auth = record?.auth;
  if (auth && typeof auth === "object" && "apiKey" in auth) return true;
  return record?.transport === "byok";
}

export function readOAuth2Config(): FinchOAuth2Config | null {
  const path = configPath();
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  chmodSync(path, CONFIG_MODE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new FinchError("AUTH_ERROR", `${path} is not valid JSON`, null);
  }

  if (isLegacyConfig(parsed)) {
    throw legacyConfigError(path);
  }

  return parsed as FinchOAuth2Config;
}

export function writeOAuth2Config(config: FinchOAuth2Config): void {
  const path = configPath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, CONFIG_DIR_MODE);
  // Atomic replacement: write a same-directory temp file and rename it over
  // the target, so no reader (or crash) ever observes a truncated/partial
  // config. Note this only guarantees each write is all-or-nothing — writers
  // must still serialize whole read-modify-write cycles via
  // withConfigStoreLock, or a stale snapshot can overwrite newer state.
  const tempPath = `${path}.tmp.${process.pid}`;
  try {
    writeFileSync(tempPath, JSON.stringify(config, null, 2), { mode: CONFIG_MODE });
    chmodSync(tempPath, CONFIG_MODE);
    renameSync(tempPath, path);
  } catch (err) {
    rmSync(tempPath, { force: true });
    throw err;
  }
}

/**
 * The single store-wide writer lock. EVERY whole-config read-modify-write —
 * token refresh, `finch auth`'s final write, `finch config set` — must run
 * inside it, re-read the freshest snapshot while holding it, and merge only
 * the fields that operation owns (refresh/re-auth own `auth`; config set
 * owns `defaults`). Otherwise a writer holding a pre-refresh snapshot can
 * silently resurrect an already-rotated refresh token (FIN-78 review
 * blocker 1). Kept at the historical `.refresh.lock` filename so binaries
 * from before and after this change still serialize against each other.
 */
export function withConfigStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const path = configPath();
  // The lock file lives next to the config; on a first-ever auth the store
  // directory does not exist yet, so create it before taking the lock.
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, CONFIG_DIR_MODE);
  return withFileLock(`${path}.refresh.lock`, fn);
}
