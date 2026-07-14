---
name: orchestration
description: >-
  Local redirect to this project's fleet orchestration rules. Use this skill whenever you are
  an agent working in the Finch repo as part of the cmux fleet — before starting any
  dispatched task, when you need the standing fleet rules (build/test commands, git/worktree
  rules, reporting flow), when sending a message to another pane, or when the user mentions the
  orchestrator, QA, seats, panes, surfaces, or fleet rules.
---

# Finch fleet orchestration — redirect

The canonical rules live in `~/.pi-fleet/finch/` (on local disk, outside the repo):

- **`fleet-rules.md`** — the standing rules every seat follows (READ FIRST, fully)
- **`ORCHESTRATOR-PLAYBOOK.md`** — the full playbook (only if you are the orchestrator)
- **`regression-checklist.md`** — QA's known-answer checks
- **`fleet-bootstrap.md`** — fleet layout + relaunch procedure (crash recovery)

Quick contract for a dispatched worker seat:
1. Read `fleet-rules.md` before touching anything.
2. Work only in the worktree named in your brief.
3. Report commits (sha + evidence) to the QA seat, not the orchestrator; send every
   inter-pane message via `~/.pi-fleet/finch/cmux-send-verified.sh <surface> "msg"`.
4. Your seat ends when QA passes your commit.

## Project-specific gotchas

- Finch is a **CLI + bundled MCP server**, distributed as a single `bun build --compile`
  binary via Homebrew — there is no dev server and no web UI to screenshot.
- BYOK secrets live in `~/.finch/config` at `0600` — never print, log, or echo this file's
  contents, including in error output.
- v1 has no Linear team/tracker yet — branch names use a task slug until one exists (see
  `docs/PLAN.md` open questions).
- The X-call transport must stay behind an abstraction (local-BYOK vs remote-proxy) per
  `docs/PLAN.md`'s phase-2 seam — don't hardcode direct API calls into command handlers.
