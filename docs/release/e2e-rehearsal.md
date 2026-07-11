# No-live FIN-46 rehearsal gate

## Why

The live-E2E gate for the FIN-46 milestone (image posts with alt text, GIF/video upload,
Articles draft/publish, file-driven threads, and delete/cleanup) exercises the real X API with
real credentials — it is slow, rate-limited, and irreversible (a real post is a real post). You
do not want to discover a broken flag, a bad JSON shape, or a mis-wired subcommand *during* that
live run.

The **rehearsal gate** is the dry-run twin of that live gate. It drives the exact same FIN-46
command surfaces, asserts they parse, validate, and produce the right JSON envelope / exit code,
and proves they **fail safely before any network call** when credentials are absent — all
without real credentials and without a single live request. Run it before the live gate (and in
CI) so the only thing the live run is testing is the network round-trip itself.

This complements — it does not replace — the binary-provenance preflight in
[`e2e-preflight.md`](./e2e-preflight.md) and the known-answer
[`regression-checklist.md`](../../.claude/orchestration/regression-checklist.md).

## What it covers (FIN-46 surfaces)

| FIN-46 surface | Rehearsed as | Expected outcome |
|---|---|---|
| Image post with alt text | `post --media … --alt … --dry-run` | exit 0, `dryRun:true`, media+alt echoed in `wouldSend` |
| GIF/video upload path | `post --media clip.mp4 / loop.gif --dry-run` | exit 0, `dryRun:true` (extension-classified, no file read) |
| Article draft / publish / post | `article draft/publish/post … --dry-run` | exit 0, `dryRun:true`, output varies by subcommand |
| File-thread path | `thread --file … --number --dry-run` | exit 0, `dryRun:true`, 2 numbered posts |
| Delete / cleanup planning | `delete <url> --dry-run` | exit 0, `dryRun:true`, resolved `tweet_id` |

Plus guard cases that prove the gate is safe:

- **Live-write guard** — `post` / `delete` / `thread` *without* `--dry-run` and with no config
  must fail with `AUTH_ERROR` (exit 3) **before** any live post/delete/upload.
- **Media/alt validation** — too many images, image+video mix, and more alts than images are
  rejected as `USAGE_ERROR` (exit 2) at parse time.

The gate prints its cases in five sequentially numbered groups, in this order, so operator
output is easy to scan: **1. Dry-run** (image/video/gif/delete surfaces), **2. Article-path**
(article draft/publish/post dry-run plus arg-validation guards), **3. Live-write-guard**
(mutating commands with no `--dry-run` and no creds fail with `AUTH_ERROR`), **4. Validation**
(parse-level `USAGE_ERROR` rejections), and **5. File-thread** (`--file` dry-run). Each `PASS:`
line falls under the numbered group header it belongs to.

## How it stays offline (by construction)

- Every invocation runs under a throwaway sandbox `HOME` (`mktemp -d`), so the real
  `~/.finch/config` — which on this machine holds live X credentials — is **never read**
  (fleet-rules.md rule 12).
- Mutating commands resolve their transport lazily: `--dry-run` returns
  `{dryRun:true, wouldSend:{…}}` **before** `getTransport()` is ever called — no config, no
  network.

Because the only reachable outcomes are dry-run (exit 0), `AUTH_ERROR` (exit 3), or
`USAGE_ERROR` (exit 2), no live post/delete/upload can occur — even if the gate is run on a
machine that *does* have real credentials configured.

## Running it

```bash
bun run rehearse
# or, against a specific binary:
FINCH_BIN=./finch ./scripts/e2e-rehearsal.sh
```

The gate prints provenance (`git rev-parse HEAD`, working-tree status, and `finch version`)
before the cases, then a `PASS:`/`FAIL:` line per case, and exits non-zero if any case fails.

### Binary vs. source mode

- **Binary mode (recommended for a release / live-E2E gate).** Build first and capture
  provenance with the FIN-65 preflight, then rehearse that exact binary:
  ```bash
  bun run preflight   # git HEAD + bun run build + ./finch --version
  bun run rehearse    # uses the ./finch just built
  ```
  Paste the preflight provenance and the rehearsal PASS summary into the PR/Linear per
  [`e2e-preflight.md`](./e2e-preflight.md).
- **Source mode (quick check / CI).** With no compiled `./finch` and `FINCH_BIN` unset, the
  gate runs the TypeScript source with `bun` (requires `bun install`) and prints a warning that
  provenance is source-mode, not binary-mode. Fine for catching parse/validation regressions;
  not sufficient as the binary-provenance evidence a release gate needs.

## Where to record the evidence

Same destinations as the preflight: paste the rehearsal's provenance header and its
`ALL REHEARSAL CASES PASSED (N/N)` summary into the **PR** (as a comment) when the gate is part
of reviewing a PR, or into the **Linear issue** when closing out an issue/milestone.
