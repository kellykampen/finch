# Fleet Bootstrap — rebuild the Finch fleet from cold start

## AS-BUILT snapshot (2026-07-06, workspace "Finch") — rebuild to THIS
- Orchestrator pane: tabs `orch·sonnet5` (the lead's single contact) + `esc·fable5` (escalation, summoned on demand)
- QA station pane: tabs `qa·sonnet` + `regr·haiku` + `qa-browser` — Finch is a CLI + bundled MCP
  server with **no dev-server web app**, so `qa-browser` is used only if/when a companion
  web surface is ever added; until then QA verifies via terminal (run the compiled binary,
  inspect JSON output, exercise the MCP server with a client) instead of a browser surface.
- Builder seats: cast per task — panes exist as empty chairs or get created on demand
  (`build-a·codex`, `build-b·kimi`, `build-c·glm`, …; tab renamed at each casting)
- Infra pane: `git` (no `webserver` tab — nothing to serve; add one only if a future phase
  needs a proxy/gateway process running locally)

For: cmux crash, computer restart, or first-time setup. The ORCHESTRATOR executes this — the
lead orchestrator only relaunches *you* and points here. cmux restores pane geometry itself after most
restarts; agents inside are dead — usually you only relaunch agents into existing panes
(Phase B) and fix tab titles. Only build panes (Phase A) that are missing.

## Tab naming convention (MANDATORY)

Every agent tab is named `role·agent-model` so a glance identifies seat + brain. Set the title
from INSIDE the pane before launching the agent:

```bash
printf '\033]0;qa·sonnet\007'
```

If the agent's TUI later overwrites it, re-run the printf or rename via the tab UI.

## Layout

```
┌─────────────────────┬──────────────────┐
│ 1 ORCHESTRATOR       │ 2 builder seats  │
│   (+tab: esc·fable5) │   (cast per task)│
├─────────────────────┼──────────────────┤
│ 3 QA STATION         │ 4 (more seats)   │
│   qa·sonnet          │                  │
│   +regr·haiku        │                  │
│   +qa-browser (n/a for now)             │
├─────────────────────┴──────────────────┤
│ 5 INFRA: git   (full width)             │
└─────────────────────────────────────────┘
```

Phase A — create missing panes (from your own surface):
```bash
cmux new-split right --surface <orch-surface>     # adjust to your layout
cmux new-split down  --surface <orch-surface>
```

Phase B — per seat: set title → launch agent → wait ~12s → verify with capture-pane:

| Seat | Title | Launch |
|---|---|---|
| Orchestrator | `orch·sonnet5` | `claude --model sonnet --dangerously-skip-permissions`, first message: "You are the Finch orchestrator — read .claude/orchestration/ORCHESTRATOR-PLAYBOOK.md" |
| Escalation (tab) | `esc·fable5` | summoned on demand, not at boot |
| QA | `qa·sonnet` | `claude --model sonnet --dangerously-skip-permissions`, first message: adopt QA role per playbook §2 — builders report commits to you; regression checklist on every commit + pre-merge; GO/NO-GO to orchestrator; read fleet-rules.md |
| QA browser (tab) | `qa-browser` | not staffed for v1 (no web UI); revisit if phase-2 adds a hosted dashboard |
| Regression (tab) | `regr·haiku` | `claude --model haiku --dangerously-skip-permissions` — only once regression-checklist.md has lines to run |
| Builder seats | `build-*·<harness>` | cast per task: `codex` / `claudekimi --dangerously-skip-permissions` / `claudeglm --dangerously-skip-permissions` / `claude --model <m> --dangerously-skip-permissions` |
| Infra | `git` | plain shell |

Phase C — wire the fleet:
1. Read ORCHESTRATOR-PLAYBOOK.md + ORCHESTRATION-HANDOFF.md (your wake ritual covers the rest).
2. Send QA its role brief + pointer to fleet-rules.md via `.claude/orchestration/cmux-send-verified.sh`.
3. Verify every send landed (the script does this) and capture each pane once.
4. Confirm the binary builds: `bun build --compile ./src/index.ts --outfile finch && ./finch --help` exits 0.

## Boot checklist (cold start)
1. `cmux identify --json` + `cmux list-panes` — map what survived; verify you can spawn panes
   (test-split + close; if rejected, you're detached — tell the lead, it runs the
   relaunch-in-cmux fix).
2. Compare against the layout above; create only what's missing; fix tab titles.
3. Relaunch dead agents (a restored pane holds a fresh shell, not the agent).
4. TaskList + `git log --oneline -10` + `git status` + handoff — restore work state.
5. Report fleet status to the lead in one message.
