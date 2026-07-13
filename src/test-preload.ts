// Bun test preload — configured via bunfig.toml's `[test] preload`. Runs once
// per test process, before any test file loads. Its sole job is to guarantee
// that no test can ever write to the operator's REAL ~/.finch/config.
//
// Background (the FIN-77 incident): configPath() resolves to the canonical
// real-user home regardless of $HOME, so a sandboxed `HOME=$(mktemp -d)` does
// NOT isolate a test's config writes — only an explicit FINCH_CONFIG_PATH
// does. Three FIN-59 auth tests drove a successful `runAuth` without injecting
// a writer, so they fell through to the real file store and, under a real
// $HOME with no FINCH_CONFIG_PATH, overwrote the operator's live credentials
// with test fixtures the first time `bun test` ran after FIN-77 merged.
//
// Two layers of protection, both established here:
//   1. FINCH_TEST_RUNTIME marks the process as a test run. Every config
//      mutation entry point (writeOAuth2Config, withConfigStoreLock) calls
//      assertConfigIsolatedInTests(), which throws if the real config is
//      touched during a test run without an explicit FINCH_CONFIG_PATH.
//      This is the fail-closed catch if isolation is ever bypassed.
//   2. A default isolated FINCH_CONFIG_PATH so a test that simply forgot to
//      set one still writes to a throwaway temp file, never the real path.
//      Tests that need their own sandbox override this in beforeEach as usual.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FINCH_TEST_RUNTIME = "1";

if (!process.env.FINCH_CONFIG_PATH?.trim()) {
  const dir = mkdtempSync(join(tmpdir(), "finch-test-config-"));
  process.env.FINCH_CONFIG_PATH = join(dir, ".finch", "config");
}
