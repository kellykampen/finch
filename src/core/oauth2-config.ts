import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { configPath, CONFIG_MODE, CONFIG_DIR_MODE } from "./config";
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
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: CONFIG_MODE });
  chmodSync(path, CONFIG_MODE);
}
