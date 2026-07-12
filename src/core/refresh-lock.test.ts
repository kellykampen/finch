import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileLock } from "./refresh-lock";

describe("withFileLock", () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "finch-lock-test-"));
    lockPath = join(dir, "refresh.lock");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("serializes overlapping critical sections (no interleaving)", async () => {
    const events: string[] = [];
    const section = (id: string) =>
      withFileLock(lockPath, async () => {
        events.push(`enter-${id}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        events.push(`exit-${id}`);
      });

    await Promise.all([section("a"), section("b")]);

    expect(events).toHaveLength(4);
    // Whoever enters first must exit before the other enters.
    const [firstEnter, firstExit] = events;
    const first = (firstEnter ?? "").slice("enter-".length);
    expect(firstEnter).toBe(`enter-${first}`);
    expect(firstExit).toBe(`exit-${first}`);
  });

  test("releases the lock file after the critical section resolves", async () => {
    await withFileLock(lockPath, async () => {});
    expect(existsSync(lockPath)).toBe(false);
  });

  test("releases the lock file even when the critical section throws", async () => {
    await expect(
      withFileLock(lockPath, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(existsSync(lockPath)).toBe(false);
  });

  test("returns the critical section's result", async () => {
    const result = await withFileLock(lockPath, async () => 42);
    expect(result).toBe(42);
  });

  test("breaks a stale lock held longer than staleMs", async () => {
    writeFileSync(lockPath, "0");
    let ran = false;
    await withFileLock(
      lockPath,
      async () => {
        ran = true;
      },
      // A clock far in the future makes the pre-existing lock look stale.
      { staleMs: 1000, retryMs: 5, nowFn: () => Date.now() + 10_000 },
    );
    expect(ran).toBe(true);
  });

  test("fails closed on timeout without running the refresh callback unlocked", async () => {
    writeFileSync(lockPath, "held");
    let callbackRan = false;
    let now = 0;

    await expect(
      withFileLock(
        lockPath,
        async () => {
          callbackRan = true;
        },
        {
          staleMs: Number.MAX_SAFE_INTEGER,
          retryMs: 1,
          timeoutMs: 5,
          nowFn: () => now++,
          sleepFn: async () => {},
        },
      ),
    ).rejects.toThrow("Timed out waiting for the credential refresh lock");
    expect(callbackRan).toBe(false);
  });
});
