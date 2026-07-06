STATE-AT-RESET (2026-07-06): all v1 CLI/MCP slices merged to `main` — auth/config (`finch
auth`/`auth status`/`whoami`/`config get,set,path`), read (`timeline`/`search`/
`user-posts`/`user`/`show`), write (`post`/`reply`/`thread`), engage
(`like`/`unlike`/`repost`/`unrepost`/`follow`/`unfollow`), `finch schema`/`--describe`, and the
bundled MCP server. Tagged `v0.1.0` (pushed to remote — `push.followTags=true` in git config
did this automatically on an unrelated push, flagged to the CEO). Remaining v1 scope:
Homebrew/distribution (M4) and hardening (M5) — see Linear (below).

**Infra:** GitHub remote is live — `github.com/kellykampen/finch` (private). CI
(`.github/workflows/ci.yml`: typecheck + test + build smoke via `finch auth status --json`)
runs on every PR and push to `main`. Every merge from here forward goes through a real GitHub
PR with two evidence comments (independent review + AC-verification) and green CI before
`gh pr merge` — see `fleet-rules.md` rule 10 for the full gate spec, rule 11 for quota rules.

**Linear:** team `FIN` (Fibonacci estimates on — set via raw GraphQL `teamUpdate`, the
`linear-cli` wrapper has no flag for it), project "Finch v1", milestones M0–M5, issues FIN-1
through FIN-31 (auth/config/read/write/engage/MCP marked Done; distribution + hardening
Todo). This file + Linear are now both tracking sources; Linear is authoritative for
issue-level status, this file for fleet/session state.

**CEO pacing directive (current, standing until told otherwise): THROTTLED.** Max 1 worker
seat at a time, finish one task fully before starting the next. Prefer non-Claude harnesses
for builds where suitable (GLM/Kimi sparingly — also over-pace; Codex is OFF fleet-wide);
`agy` for reviews, rotating Gemini 3.1 Pro and GPT-OSS 120B (GPT-OSS proved unreliable on
complex review prompts this session — failed silently twice, see git log around PR #1's
review comments; fell back to Gemini both times, worth re-testing before trusting it again).
Reserve Fable/Claude seats for what genuinely needs them. Longer intervals between dispatches,
relaxed poll cadence, keep the QC gates. **Currently: coasting at a clean stopping point — no
seat is cast, no worktree is open.** Do not start the next slice (distribution or hardening)
without an explicit go-ahead.

**Known open items (not blocking, not forgotten):**
1. Rotate the CEO's 4 X API credentials (FIN-30) — a builder seat incidentally viewed the real
   `~/.finch/config` during the M1 review-fix round.
2. biome/lint conventions still not set up (FIN-29, M5).
3. `finch timeline`'s 2-API-call cost (getMe + homeTimeline) could drop to 1 by caching the
   user id in config — noted, not scheduled.
