# Release / live-E2E preflight: prove the binary is current

## Why

Every live-E2E gate (a manual smoke test against the real X API, or a release sign-off)
exercises a compiled `./finch` binary, not the source tree directly. A binary left over from
an earlier build, or a Homebrew install shadowing the repo-local one on `PATH`, will silently
pass or fail against the **wrong code** — the gate result then proves nothing about the commit
actually under test. This has already bitten the project once (see README's Troubleshooting
section and FIN-59): a stale binary was mistaken for a source regression.

The fix is procedural, not code: **always rebuild from the exact checkout being gated, then
prove that binary's provenance, before running any live E2E check.**

## Preflight steps

Run these from the worktree/checkout you're about to gate — every time, not just when you
suspect staleness:

1. **Capture the commit under test.**
   ```bash
   git status --short   # should be clean; if not, note exactly what's uncommitted
   git rev-parse HEAD
   ```

2. **Rebuild from this exact checkout.** Never trust a `./finch` left over from a previous run
   or a previous commit — `git pull`/`git checkout` does not update an already-compiled binary.
   ```bash
   bun install
   bun run build
   ```

3. **Prove provenance** — confirm the binary you're about to exercise corresponds to the commit
   captured in step 1:
   ```bash
   ./finch --version
   which finch   # confirm you're running the repo-local ./finch, not a shadowing Homebrew install
   ```
   `./finch --version` reports the semver baked into the binary at build time (see
   `docs/PLAN.md`'s `finch version` entry). Cross-check it against `package.json`'s `version`
   field and, if you're gating a release rather than a PR, against the latest tag.

4. Only once steps 1-3 are captured, proceed with the live E2E / regression checklist
   (`.claude/orchestration/regression-checklist.md`) against this freshly built binary.

`bun run preflight` (see below) runs steps 1-3 in one shot.

## Where to record the evidence

Paste the raw output of `git rev-parse HEAD`, the build command (with its exit code), and
`./finch --version` — verbatim, not summarized — into:

- **The PR** — as the PR description or a PR comment (`gh pr comment`), when the live-E2E gate
  is part of reviewing that PR. This is the same evidence Gate B in
  `.claude/orchestration/fleet-rules.md` requires from whoever runs AC-verification.
- **The Linear issue** — as an issue comment, when the live-E2E gate is part of closing out an
  issue or milestone rather than a specific PR.

Without this, a live-E2E pass/fail is unverifiable after the fact — there's no way to confirm
later which commit the binary that was actually exercised came from.

## Script

```bash
bun run preflight
```

Runs `git rev-parse HEAD`, rebuilds (`bun run build`), and prints `./finch --version` — the
three pieces of evidence to paste into the PR/Linear comment per the section above.
