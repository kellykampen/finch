import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

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

export function readConfig(): FinchConfig | null {
  const path = configPath();
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  chmodSync(path, CONFIG_MODE);
  return JSON.parse(raw) as FinchConfig;
}

export function writeConfig(config: FinchConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
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
