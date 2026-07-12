import { closeSync, openSync, rmSync, statSync, writeSync } from "node:fs";
import { FinchError } from "./errors";

export interface FileLockOptions {
  /**
   * Break a lock whose file is older than this many ms. This is an mtime-age
   * heuristic, not a liveness check: it cannot distinguish a crashed holder
   * from a holder still legitimately mid-refresh past `staleMs`. Set it
   * comfortably above the slowest expected refresh so a live holder is never
   * mistaken for a crashed one.
   */
  staleMs?: number;
  /** Poll interval while waiting for the lock. */
  retryMs?: number;
  /** Give up waiting after this long and fail closed (never refresh without the lock). */
  timeoutMs?: number;
  nowFn?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
  statFn?: (path: string) => { mtimeMs: number };
}

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_RETRY_MS = 25;
const DEFAULT_TIMEOUT_MS = 10_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` while holding an exclusive advisory lock represented by an
 * O_EXCL lock file at `lockPath`, serializing critical sections across every
 * process and in-process caller that shares the path. Used to make X's
 * single-use (rotating) OAuth2 refresh token safe under concurrent commands:
 * only one caller performs the network refresh; the rest wait, then re-read
 * the freshly rotated credential.
 *
 * The wait loop is fully async (never a busy spin) so the lock holder's own
 * awaited work keeps making progress on Bun's single-threaded event loop. A
 * lock whose file is older than `staleMs` is broken so a crashed holder can't
 * strand every other caller forever — but `staleMs` is an mtime-age heuristic,
 * not proof of death: a holder whose refresh is still legitimately in flight
 * past `staleMs` looks identical to a crashed one, and another caller can seize
 * the lock and double-spend the rotating refresh token in that window. Callers
 * must set `staleMs` well above the slowest expected refresh to keep that
 * window practically unreachable; this function cannot guarantee it can't
 * happen. A caller that waits past `timeoutMs` (without ever observing a stale
 * lock) fails closed: running the callback without the lock could spend the
 * same rotating refresh token twice and invalidate the session.
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.nowFn ?? Date.now;
  const sleep = options.sleepFn ?? defaultSleep;
  const stat = options.statFn ?? statSync;

  const start = now();
  let acquired = false;

  while (!acquired) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      try {
        writeSync(fd, String(now()));
      } finally {
        closeSync(fd);
      }
      acquired = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // Someone holds the lock. Break it if the holder appears to have crashed.
      let mtimeMs: number;
      try {
        mtimeMs = stat(lockPath).mtimeMs;
      } catch (statErr) {
        if ((statErr as NodeJS.ErrnoException).code === "ENOENT") {
          // Lock vanished between openSync and statSync — retry immediately.
          continue;
        }
        // An unexpected stat failure (e.g. EACCES/EIO) means we cannot tell
        // whether the lock is stale. Fail closed immediately rather than
        // spin retrying a stat that will keep failing the same way.
        throw new FinchError(
          "NETWORK_ERROR",
          `Could not inspect the credential refresh lock at ${lockPath}; retry the command.`,
        );
      }
      const age = now() - mtimeMs;
      if (age > staleMs) {
        rmSync(lockPath, { force: true });
        continue;
      }
      if (now() - start > timeoutMs) {
        throw new FinchError(
          "NETWORK_ERROR",
          `Timed out waiting for the credential refresh lock at ${lockPath}; retry the command.`,
        );
      }
      await sleep(retryMs);
    }
  }

  try {
    return await fn();
  } finally {
    if (acquired) {
      try {
        rmSync(lockPath, { force: true });
      } catch {
        // Best effort — a broken/removed lock file must not mask fn()'s result.
      }
    }
  }
}
