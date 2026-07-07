import { readConfig, writeConfig, configPath, maskSecret, type FinchConfig } from "../core/config";
import { FinchError } from "../core/errors";
import { parseArgs, resolveCount } from "../core/args";

export interface ConfigDeps {
  readConfig?: () => FinchConfig | null;
  writeConfig?: (config: FinchConfig) => void;
  configPath?: () => string;
}

export interface ConfigKeyValue {
  key: string;
  value: string;
}

type ConfigKeyKind = "secret" | "string" | "boolean" | "count";

interface ConfigKeyDef {
  path: readonly [string] | readonly [string, string];
  kind: ConfigKeyKind;
  settable: boolean;
}

// The full set of dotted keys `finch config get`/`finch config set`
// recognize — deliberately a flat, hand-authored map rather than reflecting
// over FinchConfig's shape, so every readable/settable key is an explicit,
// reviewable decision (PLAN.md: auth.* is never settable via `config set`,
// only defaults.json/defaults.count are).
// Object.create(null) rather than a plain object literal — a plain `{}`
// inherits Object.prototype, so a lookup like `CONFIG_KEYS["__proto__"]` or
// `CONFIG_KEYS["constructor"]` would resolve to a prototype value (truthy,
// but shaped nothing like ConfigKeyDef) instead of undefined, bypassing the
// "unknown key" check below and crashing when `.path` is destructured.
const CONFIG_KEYS: Record<string, ConfigKeyDef> = Object.assign(Object.create(null), {
  "auth.apiKey": { path: ["auth", "apiKey"], kind: "secret", settable: false },
  "auth.apiKeySecret": { path: ["auth", "apiKeySecret"], kind: "secret", settable: false },
  "auth.accessToken": { path: ["auth", "accessToken"], kind: "secret", settable: false },
  "auth.accessTokenSecret": { path: ["auth", "accessTokenSecret"], kind: "secret", settable: false },
  transport: { path: ["transport"], kind: "string", settable: false },
  "defaults.json": { path: ["defaults", "json"], kind: "boolean", settable: true },
  "defaults.count": { path: ["defaults", "count"], kind: "count", settable: true },
});

function lookupConfigKeyDef(key: string): ConfigKeyDef | undefined {
  return CONFIG_KEYS[key];
}

// Returns undefined (rather than throwing) when a top-level section is
// missing, so callers can report a clean FinchError instead of letting a
// raw TypeError escape from `section[nested]` on a manually-edited or
// partially-corrupt config file.
function readRaw(config: FinchConfig, def: ConfigKeyDef): unknown {
  const [top, nested] = def.path;
  const section = (config as unknown as Record<string, unknown>)[top];
  if (section === undefined || section === null) return undefined;
  if (nested === undefined) return section;
  return (section as Record<string, unknown>)[nested];
}

function formatValue(def: ConfigKeyDef, raw: unknown): string {
  if (def.kind === "secret") return maskSecret(String(raw));
  return String(raw);
}

function getConfigValue(config: FinchConfig, key: string): ConfigKeyValue {
  const def = lookupConfigKeyDef(key);
  if (!def) {
    throw new FinchError("USAGE_ERROR", `Unknown config key: ${key}`);
  }
  const raw = readRaw(config, def);
  if (raw === undefined) {
    throw new FinchError(
      "AUTH_ERROR",
      `Config file is missing an expected value for ${key} — it may be corrupt; try \`finch auth\` to reconfigure.`,
    );
  }
  return { key, value: formatValue(def, raw) };
}

function parseSettableValue(def: ConfigKeyDef, key: string, raw: string): unknown {
  if (def.kind === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new FinchError("USAGE_ERROR", `${key} must be "true" or "false", got: ${raw}`);
  }
  if (def.kind === "count") {
    return resolveCount(raw);
  }
  throw new FinchError("USAGE_ERROR", `${key} is not settable via finch config set`);
}

function setConfigValue(
  config: FinchConfig,
  key: string,
  raw: string,
): { config: FinchConfig; result: ConfigKeyValue } {
  if (key.startsWith("auth.")) {
    throw new FinchError("USAGE_ERROR", `${key} cannot be set via \`finch config set\` — run \`finch auth\` instead.`);
  }

  const def = lookupConfigKeyDef(key);
  if (!def?.settable) {
    throw new FinchError(
      "USAGE_ERROR",
      `finch config set does not support key: ${key} (only defaults.json, defaults.count are settable)`,
    );
  }

  const parsed = parseSettableValue(def, key, raw);
  const [top, nested] = def.path;
  if (nested === undefined) {
    throw new FinchError("USAGE_ERROR", `finch config set does not support key: ${key}`);
  }
  const updated: FinchConfig = {
    ...config,
    [top]: { ...((config as unknown as Record<string, unknown>)[top] as object), [nested]: parsed },
  };
  return { config: updated, result: { key, value: String(parsed) } };
}

/** `finch config get <key>`: prints one value, masking secret auth.* fields. */
export async function runConfigGet(
  argv: string[],
  deps: ConfigDeps = {},
): Promise<{ data: ConfigKeyValue; human: string }> {
  const readConfigFn = deps.readConfig ?? readConfig;

  const { positionals } = parseArgs(argv);
  const key = positionals[0];
  if (!key) {
    throw new FinchError("USAGE_ERROR", "finch config get requires <key>");
  }

  const config = readConfigFn();
  if (!config) {
    throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
  }

  const data = getConfigValue(config, key);
  return { data, human: `${data.key} = ${data.value}` };
}

/** `finch config set <key> <value>`: sets one non-secret config value. */
export async function runConfigSet(
  argv: string[],
  deps: ConfigDeps = {},
): Promise<{ data: ConfigKeyValue; human: string }> {
  const readConfigFn = deps.readConfig ?? readConfig;
  const writeConfigFn = deps.writeConfig ?? writeConfig;

  const { positionals } = parseArgs(argv);
  const [key, value] = positionals;
  if (!key || value === undefined) {
    throw new FinchError("USAGE_ERROR", "finch config set requires <key> <value>");
  }

  const config = readConfigFn();
  if (!config) {
    throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
  }

  const { config: updated, result } = setConfigValue(config, key, value);
  writeConfigFn(updated);
  return { data: result, human: `${result.key} = ${result.value}` };
}

/** `finch config path`: prints the resolved `~/.finch/config` path. */
export async function runConfigPath(
  _argv: string[],
  deps: ConfigDeps = {},
): Promise<{ data: { path: string }; human: string }> {
  const configPathFn = deps.configPath ?? configPath;
  const path = configPathFn();
  return { data: { path }, human: path };
}
