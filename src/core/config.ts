import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_MODE = 0o600;

// Bun's os.homedir() snapshots $HOME at process start rather than reading it
// live, so this reads process.env.HOME directly (falling back to os.homedir()
// for the case where HOME isn't set) to stay correct if HOME changes at runtime.
function resolveHomeDir(): string {
  return process.env.HOME || homedir();
}

export function configPath(): string {
  return join(resolveHomeDir(), ".finch", "config");
}

export const CONFIG_DIR_MODE = 0o700;

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
