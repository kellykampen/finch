STATE-AT-RESET (2026-07-06): CEO build-greenlight received: LOW PRIORITY, RELAXED pace, cap
1-2 light seats, Codex OFF, GLM/Kimi sparing, reviews via agy/Gemini, full gates
(review+AC+CI-green) before merge, PING CEO the moment `finch auth`/config is testable.
Mid-build, CEO reviewed PLAN.md and mandated the official X TypeScript SDK
(`@xdevplatform/xdk`) over hand-rolled OAuth1.0a signing — locked in (commit 675d0f2).

**M1 slice 1 — MERGED to main (commit b6c7052, `main`).** Bun/TS scaffold, `~/.finch/config`
schema (0600 file + 0700 dir), `XTransport`/`ByokTransport` wrapping the SDK, `finch
auth`/`auth status`/`whoami`, universal `--json`+exit codes. CEO live-tested `finch auth`
against his real X keys end to end — works. Gates run: independent review (Gemini 3.1 Pro via
`agy`) found 3 high-severity + 2 lower-severity issues, all verified against the actual
code/SDK types (one review finding was refuted after checking the SDK's real type defs — not
blindly trusted), fixed with regression tests, re-verified (typecheck clean, 47 tests pass),
then AC-verified against docs/PLAN.md before merge. Worktree `../finch-wt/m1-scaffold-core`
(branch `m1-scaffold-core`) is done; builder seat (surface:199) is being cleared and re-cast
for the next slice, not closed.

**Flagged, not yet resolved by CEO:**
1. No GitHub remote yet — "CI-green" and "posted on the PR" gate halves can't be literally
   satisfied until one exists. Local branch + diff-model review + manual AC-verification
   substitutes for now; creating a remote is a decision to surface, not make unilaterally.
2. M1's planned biome/lint setup was deferred by the builder as scope creep beyond slice 1 —
   still an open follow-up, not yet scheduled to a slice.
3. **Security note**: during the review-fix round, the builder seat incidentally read the
   CEO's real `~/.finch/config` (live credentials from his end-to-end test) while
   sanity-checking file permissions on the actual host `$HOME` (not a sandboxed one) — it
   self-reported this, fixed only the directory's permissions, and did not otherwise use the
   credentials. Flagged to the CEO directly; recommend treating those 4 X API credentials as
   exposed and rotating them out of caution.

**M2 (write/read) — MERGED to main (commit 1075dd1).** post/reply/thread + timeline/search/
user-posts/user/show, extending XTransport/ByokTransport with createTweet/getTweet/
searchRecent/userTweets/homeTimeline/getUserByUsername — method names confirmed against
`@xdevplatform/xdk@0.5.0`'s actual type defs, no SDK gaps found. `--dry-run` added to the 3
mutating commands per the agent-hardening section. Gates: independent review (Gemini 3.1 Pro
via agy) came back clean (no high-severity findings) — 3 low-severity items fixed
(positional-text trimming, thread `--file`/positional mutual exclusivity, deduped
`formatPosts` helper), one optimization note deferred as backlog (cache the user id in config
to cut `finch timeline`'s 2 API calls to 1 — needs a config schema change, not done). 122
tests pass, typecheck clean, independently re-verified before merge. Worktrees
`../finch-wt/m1-scaffold-core` and `../finch-wt/m2-write-read` still exist on disk (branches
merged, not yet pruned) — builder seat for M2 cleared/closed per the "seat lives for one task"
rule.

**M3 (engage + MCP) — MERGED to main (commit ece4d7d).** `finch like/unlike/repost/unrepost/
follow/unfollow` on the confirmed SDK methods (`likePost`/`unlikePost`/`repostPost`/
`unrepostPost`/`followUser`/`unfollowUser`); bundled MCP server (`finch mcp`, stdio,
`@modelcontextprotocol/sdk`) with one tool per command, wrapping the same core `run*`
functions the CLI uses (no reimplementation). Gates: independent review (Gemini 3.1 Pro via
agy) found one real high-severity bug — MCP tools bridged untrusted free-text input into the
CLI's argv-based `parseArgs` with no boundary, so caller text literally equal to a flag string
(e.g. `{text: "--dry-run"}`) was silently misinterpreted as that flag. Verified against the
code, fixed with a standard `--` end-of-flags terminator + regression tests. 181 tests pass,
typecheck clean, independently re-verified before merge. M3 seat closed (task done+merged).
Standing rule from the CEO: don't park after a milestone merges — immediately pull the next
one, seat cast, poll to done.

**Next slice (in progress):** `finch config get/set/path` + `finch schema` introspection
(the M1-scoped agent-hardening addition, not yet built) — the remaining CLI-completeness
items before M4 (distribution/brew) and M5 (hardening). Worktree `../finch-wt/m4-config-schema`
(branch `m4-config-schema`).

**Housekeeping (not urgent):** worktrees `m1-scaffold-core`, `m2-write-read`, `m3-engage-mcp`
still exist on disk with their branches merged — not yet pruned via `git worktree remove`.

No Linear team — this file + docs/PLAN.md are the tracking source of record.
