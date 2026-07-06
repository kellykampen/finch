# Finch runtime regression checklist (known answers)

Run on the commit under test. All answers are known; any deviation = NO-GO. Finch has no
dev server — checks run the compiled binary directly, no sequencing constraints apply.

1. `bun run typecheck` → 0 errors.
2. `bun test` → all pass, 0 failures.
3. `bun build --compile ./src/index.ts --outfile finch` → exits 0, produces an executable file.
4. `./finch --help` → exits 0, lists the v1 command set (post/reply/thread, timeline/search/user
   posts, like/repost/follow/unfollow, auth/config).
5. `./finch --version` → prints a non-empty version string, exit 0.
6. `./finch auth status --json` with no config present → exits with the documented
   "not configured" exit code and a machine-parseable JSON error object (not a stack trace).
7. After `finch auth`/`finch config` sets up keys: `stat -f '%OLp' ~/.finch/config` → `600`.
8. Any write/read/engage command run with `--json` → output is valid JSON matching the shape
   documented in `docs/PLAN.md` for that command (parse it, don't eyeball it).
9. Bundled MCP server: starts and lists its tools (post_tweet, search, timeline, like, etc.)
   matching the tool list in `docs/PLAN.md`.

Maintained by QA. Every new invariant that ships adds a line; keep every line a known answer.
When a line's expected value legitimately changes, the PR that changes it must update this
file in the same commit — a checklist that drifts from reality trains everyone to ignore
NO-GOs.
