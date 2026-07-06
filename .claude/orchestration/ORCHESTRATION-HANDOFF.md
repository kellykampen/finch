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

**Next slice (in progress):** post/reply/thread + timeline/search on the SDK, per
docs/PLAN.md's Write/Read command tables. New worktree/branch to be created; same gate
process (independent review + AC-verify) before it merges.

No Linear team — this file + docs/PLAN.md are the tracking source of record.
