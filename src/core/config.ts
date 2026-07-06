import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { FinchError } from "./errors";

export interface FinchAuthConfig {
  apiKey: string;
  apiKeySecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface FinchConfig {
  auth: FinchAuthConfig;
  transport: "byok";
  defaults: {
    json: boolean;
    count: number;
  };
}

const CONFIG_MODE = 0o600;

// Bun's os.homedir() snapshots $HOME at process start rather than reading it
// live, so this reads process.env.HOME directly (falling back to os.homedir()
// for the case where HOME isn't set) to stay correct if HOME changes at runtime.
function resolveHomeDir(): string {
  return process.env.HOME || homedir();
}

export function configPath(): string {
  return join(resolveHomeDir(), ".finch", "config");
}

const CONFIG_DIR_MODE = 0o700;

export function readConfig(): FinchConfig | null {
  const path = configPath();
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  chmodSync(path, CONFIG_MODE);
  try {
    return JSON.parse(raw) as FinchConfig;
  } catch {
    throw new FinchError("AUTH_ERROR", `${path} is not valid JSON`, null);
  }
}

export function writeConfig(config: FinchConfig): void {
  const path = configPath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, CONFIG_DIR_MODE);
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: CONFIG_MODE });
  chmodSync(path, CONFIG_MODE);
}

const ENV_AUTH_KEYS = {
  apiKey: "FINCH_API_KEY",
  apiKeySecret: "FINCH_API_KEY_SECRET",
  accessToken: "FINCH_ACCESS_TOKEN",
  accessTokenSecret: "FINCH_ACCESS_TOKEN_SECRET",
} as const;

function authConfigFromEnv(): FinchAuthConfig | null {
  const values = {
    apiKey: process.env[ENV_AUTH_KEYS.apiKey],
    apiKeySecret: process.env[ENV_AUTH_KEYS.apiKeySecret],
    accessToken: process.env[ENV_AUTH_KEYS.accessToken],
    accessTokenSecret: process.env[ENV_AUTH_KEYS.accessTokenSecret],
  };
  if (Object.values(values).some((v) => !v)) return null;
  return values as FinchAuthConfig;
}

export function resolveAuthConfig(): FinchAuthConfig | null {
  const envAuth = authConfigFromEnv();
  if (envAuth) return envAuth;
  const config = readConfig();
  return config?.auth ?? null;
}

const SECRET_VISIBLE_SUFFIX_LENGTH = 4;
const SECRET_MASK_CHAR = "*";

// Never prints an auth.* value in full, per PLAN.md's "never logged / never
// echoed" invariant — masks all but the last 4 characters, or the whole
// value for anything at or below that length (revealing "all but 4" of a
// 4-character-or-shorter secret would be the whole secret).
export function maskSecret(value: string): string {
  if (value.length <= SECRET_VISIBLE_SUFFIX_LENGTH) {
    return SECRET_MASK_CHAR.repeat(value.length);
  }
  const hiddenLength = value.length - SECRET_VISIBLE_SUFFIX_LENGTH;
  return SECRET_MASK_CHAR.repeat(hiddenLength) + value.slice(-SECRET_VISIBLE_SUFFIX_LENGTH);
}
