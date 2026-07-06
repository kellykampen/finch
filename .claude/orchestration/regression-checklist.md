# Finch runtime regression checklist (known answers)

Run on the commit under test. All answers are known; any deviation = NO-GO. Finch has no
dev server — checks run the compiled binary directly, no sequencing constraints apply.

1. `bun run typecheck` → 0 errors.
2. `bun test` → all pass, 0 failures.
3. `bun build --compile ./src/index.ts --outfile finch` → exits 0, produces an executable file.
4. `./finch schema --json` (or `./finch --describe`) → exits 0, lists the full command set
   (post/reply/thread, timeline/search/user-posts/user/show, like/repost/follow/unfollow,
   auth/config/schema). (`--help`/`--version` are not implemented as of M4 — backlog item, not
   a known answer yet; don't check them until they exist.)
5. `./finch auth status --json` with no config present → **exits 0** with
   `{"ok":true,"data":{"configured":false,"valid":false,"username":null}}` — this is a
   successful check reporting an unconfigured state, NOT an error exit code (earlier version of
   this line incorrectly implied a "not configured" exit code; corrected after CI caught a
   related smoke-test assumption failure).
6. After `finch auth`/`finch config` sets up keys: `stat -f '%OLp' ~/.finch/config` → `600`,
   and the `~/.finch` directory itself → `700`.
7. Any write/read/engage command run with `--json` → output is valid JSON matching the shape
   documented in `docs/PLAN.md` for that command (parse it, don't eyeball it).
8. Bundled MCP server: starts and lists its tools (post_tweet, search, timeline, like, etc.)
   matching the tool list in `docs/PLAN.md`.
9. `finch config get <auth.key>` → value is masked (all but last 4 chars), never the full
   secret, regardless of `--json`. `finch config set <auth.key> ...` → USAGE_ERROR (exit 2).

Maintained by QA. Every new invariant that ships adds a line; keep every line a known answer.
When a line's expected value legitimately changes, the PR that changes it must update this
file in the same commit — a checklist that drifts from reality trains everyone to ignore
NO-GOs.
