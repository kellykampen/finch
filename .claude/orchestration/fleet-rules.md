# Standing fleet rules — Finch (every seat reads this fully before acting)

1. NO DEV SERVER: Finch is a CLI + bundled MCP server, not a web app — there is nothing to run
   on a port. Verify changes by (a) `bun run typecheck` + `bun test`, and (b)
   `bun build --compile` producing a single binary and exercising it directly
   (`./finch <command> --json`, and separately smoke-testing the MCP server surface). No
   `webserver` tab, no dev-URL.
2. Package manager: **bun ONLY**. Never npm, yarn, or pnpm — lockfile and `bun build --compile`
   both depend on it.
3. GIT + WORKTREES: you work ONLY in the worktree named in your brief — never another seat's
   worktree, never the main checkout. Branch per ticket, branch name carries the ticket ID once
   a tracker prefix exists (TBD — no Linear team created yet; see docs/PLAN.md open questions —
   until then, branch names carry a short task slug instead). Commit with explicit file paths
   (`git add <path>` — never `-A`, `.`, or `commit -a`). Never push unless your brief explicitly
   says so. NEVER touch `main` directly — the operator promotes manually.
4. LIMITS: TBD — repo is a pre-implementation skeleton with no established file-size/lint
   conventions yet. First builder seat to touch real source should propose conventions (linting,
   max file size, module layout) in a PR the orchestrator reviews, then this line gets filled in.
5. VERIFY before reporting: `bun run typecheck` (tsc --noEmit) and `bun test` clean, AND exercise
   your change live — run the compiled binary against the real X API (BYOK creds from
   `~/.finch/config` in your worktree's test environment) or, for MCP-surface changes, call the
   tool through an MCP client. Never commit a stubbed/mocked "pass."
6. REPORTING: you report commits to the QA seat (surface noted in your brief) with your commit
   sha + evidence — NOT to the orchestrator. Every inter-pane message goes via
   `.claude/orchestration/cmux-send-verified.sh <surface> "msg"` — never raw cmux send.
   Escalate blockers to the orchestrator.
7. CONTEXT: your seat lives for THIS task. When QA passes your commit, you're done — expect to
   be cleared or closed. Don't start adjacent work you weren't briefed for.
8. DESIGN ORACLE: n/a — Finch is a CLI/MCP tool with no visual comp. The spec-of-record is
   `docs/PLAN.md`'s command table (endpoint, flags, JSON shape, exit codes per command) —
   build nothing that isn't in it; escalate gaps instead of inventing flags/output shapes.
9. FEATURE CONTEXT: `docs/PLAN.md` is the living spec — read it before touching any command.
   Non-negotiable invariants: (a) `~/.finch/config` is written/read with `0600` perms and NEVER
   logged or echoed, even in `--json`/error output; (b) every command supports `--json` with a
   deterministic exit code and machine-parseable error object on failure; (c) v1 ships **no**
   hosted proxy — all X calls are local BYOK — but the transport must be written behind an
   abstraction so a phase-2 `--proxy` mode can slot in without a rewrite (see PLAN.md's
   phase-2 seam section before adding any direct API-call code).
