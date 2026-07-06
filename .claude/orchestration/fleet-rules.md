# Standing fleet rules — Finch (every seat reads this fully before acting)

1. NO DEV SERVER: Finch is a CLI + bundled MCP server, not a web app — there is nothing to run
   on a port. Verify changes by (a) `bun run typecheck` + `bun test`, and (b)
   `bun build --compile` producing a single binary and exercising it directly
   (`./finch <command> --json`, and separately smoke-testing the MCP server surface). No
   `webserver` tab, no dev-URL.
2. Package manager: **bun ONLY**. Never npm, yarn, or pnpm — lockfile and `bun build --compile`
   both depend on it.
3. GIT + WORKTREES: you work ONLY in the worktree named in your brief — never another seat's
   worktree, never the main checkout. Branch per ticket, branch name carries the ticket ID
   (Linear team `FIN`, e.g. `fin-12-finch-schema`) or a short task slug if no ticket exists yet.
   Commit with explicit file paths (`git add <path>` — never `-A`, `.`, or `commit -a`). The
   **orchestrator** pushes your branch and opens the PR once your work is committed — you don't
   push yourself unless your brief explicitly says so. NEVER touch `main` directly — the
   orchestrator merges via PR once gate 10 below is fully green.
4. LIMITS: TBD — repo is a pre-implementation skeleton with no established file-size/lint
   conventions yet. First builder seat to touch real source should propose conventions (linting,
   max file size, module layout) in a PR the orchestrator reviews, then this line gets filled in.
5. VERIFY before reporting: `bun run typecheck` (tsc --noEmit) and `bun test` clean, AND exercise
   your change live — run the compiled binary against the real X API (BYOK creds from
   `~/.finch/config` in your worktree's test environment) or, for MCP-surface changes, call the
   tool through an MCP client. Never commit a stubbed/mocked "pass."
6. REPORTING: there is no separate QA seat in this fleet — report your commit sha + evidence
   directly in your own pane; the orchestrator is watching and will pick it up. Every
   inter-pane message (if you ever need to send one, which should be rare) goes via
   `.claude/orchestration/cmux-send-verified.sh <surface> "msg"` — never raw cmux send, and
   never message a pane you weren't explicitly told about. Escalate blockers to the orchestrator
   by just stating them in your own pane, not by hunting for another surface to message.
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
10. **STANDING QC GATES (CEO directive, non-skippable, EVIDENCE ON THE PR) — applies to every
    PR from here forward:**
    - **Gate A — independent review by a DIFFERENT model/harness than the builder.** Picked via
      the `model-classifier` skill for the specific task; posted as a **comment on the GitHub
      PR** (`gh pr comment`), not just relayed in a pane or this doc. The implementer never
      reviews their own PR.
    - **Gate B — AC-verification against `docs/PLAN.md`'s command tables**, run by someone who
      is NOT the implementer (the orchestrator, or a separate seat) — actually executing the
      real root commands (`bun run typecheck`, `bun test`, `bun build --compile` smoke), not
      trusting the builder's self-report. Evidence (command output) posted as a **comment on
      the PR**.
    - **Gate C — CI green on the PR.** "Passes locally" is not CI-green — the PR's actual GitHub
      Actions checks must pass before merge. Never merge on red or pending CI.
    - **Gate D — the implementer never self-verifies.** Review and AC-verification are always
      done by a separate seat/session/model than whoever wrote the diff.
    - **N/A, skip only this one**: visual-QA-vs-comp — Finch is a CLI/MCP tool with no design
      comp, so there is nothing to screenshot-compare. Every other gate above still applies.
    - Mechanically: builder commits in their worktree → orchestrator pushes the branch and opens
      the PR (`gh pr create`) → Gate A + Gate B evidence posted as PR comments → Gate C (CI)
      goes green → orchestrator merges via `gh pr merge`, never a bare local `git merge` once a
      remote/PR exists.
