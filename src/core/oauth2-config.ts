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

  const auth = (parsed as Record<string, unknown> | undefined)?.auth;
  if (auth && typeof auth === "object" && "apiKey" in auth) {
    throw new FinchError("AUTH_ERROR", "Finch now uses OAuth 2.0 — run `finch auth`", null);
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
