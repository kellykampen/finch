import { homedir, userInfo } from "node:os";
import { isAbsolute, join } from "node:path";
import { FinchError } from "./errors";

export const CONFIG_MODE = 0o600;

// FIN-77: neither `os.homedir()` nor (under Bun specifically — verified with a
// divergent-$HOME repro, see config.test.ts) `os.userInfo().homedir` are safe
// defaults: both read the caller-set $HOME environment variable rather than
// asking the OS who the real user is. Two callers that launch Finch with
// different $HOME values would each get routed to their own
// `~/.finch/config` snapshot instead of sharing one, which is the exact
// FIN-74 divergent-snapshot bug (a stale refresh token in one snapshot looks
// "revoked" to a caller reading the other).
//
// `os.userInfo().username` IS reliable under Bun — it resolves via the real
// OS user database keyed on the process's actual uid, not from any env var
// (confirmed empirically: it stays correct even when $HOME is overridden).
// Shell tilde-expansion of an *explicit* username (`~alice`, as opposed to a
// bare `~`) is specified by POSIX to perform that same uid/username-keyed
// passwd-database lookup and never consults $HOME, so chaining the two gives
// a canonical home directory that a caller-set $HOME cannot redirect.
//
// The username comes from the OS (not attacker/network input), but it's
// still validated against a strict allowlist before being interpolated into
// a shell command string, out of defense-in-depth discipline.
const SAFE_USERNAME = /^[A-Za-z0-9._-]+$/;

let cachedCanonicalHome: string | undefined;

function resolveCanonicalHomeDir(): string {
  if (cachedCanonicalHome !== undefined) return cachedCanonicalHome;

  const { username } = userInfo();
  if (SAFE_USERNAME.test(username)) {
    const result = Bun.spawnSync(["/bin/sh", "-c", `echo ~${username}`]);
    const resolved = result.exitCode === 0 ? result.stdout.toString("utf8").trim() : "";
    if (resolved && isAbsolute(resolved) && !resolved.startsWith("~")) {
      cachedCanonicalHome = resolved;
      return cachedCanonicalHome;
    }
  }

  // Last-resort fallback (e.g. no /bin/sh, or an unresolvable username) — may
  // still be $HOME-influenced, but only reached if the passwd-database
  // lookup above didn't produce a usable path.
  cachedCanonicalHome = homedir();
  return cachedCanonicalHome;
}

/** Test-only: forces the next resolveCanonicalHomeDir() call to re-resolve. */
export function __resetCanonicalHomeCacheForTests(): void {
  cachedCanonicalHome = undefined;
}

export function configPath(): string {
  const explicitPath = process.env.FINCH_CONFIG_PATH?.trim();
  if (explicitPath) {
    if (!isAbsolute(explicitPath)) {
      throw new FinchError("USAGE_ERROR", "FINCH_CONFIG_PATH must be an absolute path");
    }
    return explicitPath;
  }
  return join(resolveCanonicalHomeDir(), ".finch", "config");
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
