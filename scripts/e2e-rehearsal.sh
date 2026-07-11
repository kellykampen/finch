#!/usr/bin/env bash
#
# No-live FIN-46 rehearsal gate (FIN-67).
#
# Rehearses every FIN-46 write/media/article/thread/delete surface at the
# command + JSON-envelope level WITHOUT touching the live X API and WITHOUT
# real credentials. It is the dry-run twin of the live-E2E gate: run this to
# prove the command surface parses, validates, and fails safely, before you
# ever point a freshly-built binary at real keys.
#
# HOW IT STAYS OFFLINE (by construction, not by mocking):
#   * Every invocation runs under a throwaway sandbox HOME (`mktemp -d`), so
#     the real `~/.finch/config` (the CEO's live X credentials) is never read.
#   * Mutating commands (`post`, `thread`, `delete`, `article`) resolve their
#     transport lazily: `--dry-run` returns `{dryRun:true, wouldSend:{...}}`
#     BEFORE `getTransport()` is ever called — no config, no network.
# Because the only two reachable outcomes are dry-run (exit 0) or
# AUTH_ERROR/USAGE_ERROR, no live post/delete/upload can occur even if this is
# run on a machine that has real credentials configured.
#
# BINARY PROVENANCE:
#   For a release / live-E2E gate, build first and record provenance via the
#   FIN-65 preflight (`bun run preflight`) — this rehearsal then exercises that
#   exact binary. Point it at a specific binary with FINCH_BIN=/path/to/finch.
#   If no compiled ./finch exists and FINCH_BIN is unset, it falls back to
#   running the TypeScript source with `bun` (requires `bun install`) and warns
#   that provenance is source-mode, not binary-mode. See
#   docs/release/e2e-rehearsal.md.
#
# Usage:
#   ./scripts/e2e-rehearsal.sh          # or: bun run rehearse
#   FINCH_BIN=./finch ./scripts/e2e-rehearsal.sh
#
# Exit codes:
#   0  all rehearsal cases passed
#   1  one or more cases failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Resolve how we invoke finch: explicit FINCH_BIN > compiled ./finch > source.
# ---------------------------------------------------------------------------
SOURCE_MODE=0
if [ -n "${FINCH_BIN:-}" ]; then
  FINCH=("$FINCH_BIN")
elif [ -x "$REPO_ROOT/finch" ]; then
  FINCH=("$REPO_ROOT/finch")
  FINCH_BIN="$REPO_ROOT/finch"
else
  FINCH=(bun "$REPO_ROOT/src/index.ts")
  FINCH_BIN="(source via bun)"
  SOURCE_MODE=1
fi

# ---------------------------------------------------------------------------
# Provenance evidence for the checkout under rehearsal (AC: git HEAD + version).
# ---------------------------------------------------------------------------
echo "=== FIN-46 no-live rehearsal gate (FIN-67) ==="
echo "Commit under rehearsal:"
git rev-parse HEAD
echo "Working tree (should be clean for a release gate):"
git status --short || true
echo "finch invocation: ${FINCH[*]}"
if [ "$SOURCE_MODE" -eq 1 ]; then
  echo "WARNING: source mode — this is NOT binary-provenance. For a release/live-E2E"
  echo "         gate, run 'bun run preflight' first (builds + prints ./finch --version"
  echo "         per docs/release/e2e-preflight.md) and re-run with that binary."
fi
echo "finch version:"
# Version never touches auth/network; still run it under a sandbox HOME for hygiene.
HOME="$(mktemp -d)" "${FINCH[@]}" version --json || echo "(version lookup failed)"
echo ""

TOTAL=0
FAILURES=0

# Run finch under a fresh sandbox HOME with credential env scrubbed. Echoes the
# command's stdout; the caller reads $? for the exit code.
run_finch() {
  local sandbox rc
  sandbox="$(mktemp -d)"
  set +e
  HOME="$sandbox" \
    FINCH_OAUTH2_CLIENT_ID="" \
    "${FINCH[@]}" "$@"
  rc=$?
  set -e
  rm -rf "$sandbox"
  return "$rc"
}

# check <label> <expected_rc> <node-assertion|""> -- <finch args...>
# The node assertion receives the command's stdout as process.argv[1] and must
# throw to signal failure. Pass "" to assert on exit code only.
check() {
  local label="$1" expected_rc="$2" assertion="$3"
  shift 3
  [ "$1" = "--" ] && shift
  TOTAL=$((TOTAL + 1))

  local out rc
  set +e
  out="$(run_finch "$@")"
  rc=$?
  set -e

  if [ "$rc" -ne "$expected_rc" ]; then
    echo "FAIL: $label — expected exit $expected_rc, got $rc" >&2
    echo "      output: $out" >&2
    FAILURES=$((FAILURES + 1))
    return
  fi

  if [ -n "$assertion" ]; then
    if ! node -e "$assertion" "$out" 2>/tmp/e2e-rehearsal-assert.$$; then
      echo "FAIL: $label — JSON assertion failed: $(cat /tmp/e2e-rehearsal-assert.$$)" >&2
      echo "      output: $out" >&2
      rm -f /tmp/e2e-rehearsal-assert.$$
      FAILURES=$((FAILURES + 1))
      return
    fi
    rm -f /tmp/e2e-rehearsal-assert.$$
  fi

  echo "PASS: $label (exit $rc)"
}

DRYRUN_OK='const r=JSON.parse(process.argv[1]); if(!r.ok) throw new Error("ok=false: "+JSON.stringify(r)); if(r.data.dryRun!==true) throw new Error("dryRun not true");'
AUTH_ERR='const r=JSON.parse(process.argv[1]); if(r.ok) throw new Error("expected ok=false"); if(r.error.code!=="AUTH_ERROR") throw new Error("expected AUTH_ERROR, got "+r.error.code);'
USAGE_ERR='const r=JSON.parse(process.argv[1]); if(r.ok) throw new Error("expected ok=false"); if(r.error.code!=="USAGE_ERROR") throw new Error("expected USAGE_ERROR, got "+r.error.code);'

echo "--- 1. Dry-run cases (parse + validate FIN-46 surfaces, no network) ---"

# Case 1: image post with alt text.
check "image post + alt (dry-run)" 0 \
  'const r=JSON.parse(process.argv[1]); if(r.data.dryRun!==true) throw new Error("not dryRun"); const w=r.data.wouldSend; if(!w.media.includes("photo.png")) throw new Error("media missing: "+JSON.stringify(w)); if(!w.alt.includes("screenshot of the finch CLI")) throw new Error("alt missing: "+JSON.stringify(w));' \
  -- post "Ship it" --media photo.png --alt "screenshot of the finch CLI" --dry-run --json

# Case 2: GIF/video upload path (classification by extension; no file read).
check "video (.mp4) post (dry-run)" 0 \
  'const r=JSON.parse(process.argv[1]); if(!r.data.wouldSend.media.includes("demo.mp4")) throw new Error("mp4 missing");' \
  -- post "demo clip" --media demo.mp4 --dry-run --json
check "gif (.gif) post (dry-run)" 0 "$DRYRUN_OK" \
  -- post "loop" --media loop.gif --dry-run --json

# Case 3: delete / cleanup command planning (dry-run, from a URL).
check "delete from URL (dry-run)" 0 \
  'const r=JSON.parse(process.argv[1]); if(r.data.wouldSend.tweet_id!=="1755555555555555555") throw new Error("tweet_id: "+JSON.stringify(r.data));' \
  -- delete "https://x.com/example/status/1755555555555555555" --dry-run --json

echo ""
echo "--- 2. Article-path cases (dry-run, no network) ---"

# Case 4: article draft / publish / post (dry-run) — output varies by subcommand.
check "article draft (dry-run)" 0 \
  'const r=JSON.parse(process.argv[1]); if(r.data.dryRun!==true) throw new Error("not dryRun"); if(r.data.wouldSend.title!=="Launch Notes") throw new Error("title missing");' \
  -- article draft "Launch Notes" ./notes.md --dry-run --json
check "article publish (dry-run)" 0 \
  'const r=JSON.parse(process.argv[1]); if(r.data.dryRun!==true) throw new Error("not dryRun"); if(r.data.wouldSend.draftId!=="1755555555555555555") throw new Error("draftId missing");' \
  -- article publish 1755555555555555555 --dry-run --json
check "article post (dry-run)" 0 \
  'const r=JSON.parse(process.argv[1]); if(r.data.dryRun!==true) throw new Error("not dryRun"); if(r.data.wouldSend.title!=="Launch Notes") throw new Error("title missing");' \
  -- article post ./notes.md --title "Launch Notes" --dry-run --json

# Case 5: article arg parsing still rejects a missing arg as a usage error.
check "article draft missing args (usage)" 2 "$USAGE_ERR" \
  -- article draft --json

# Case 6 (FIN-70 regression): `--title` must not silently swallow `--dry-run`
# as its value — strict flag-collision rejection catches this at parse time,
# before it can fall through to a live AUTH_ERROR.
check "article post --title swallowing --dry-run rejected (usage)" 2 \
  'const r=JSON.parse(process.argv[1]); if(r.ok) throw new Error("expected ok=false"); if(r.error.code!=="USAGE_ERROR") throw new Error("expected USAGE_ERROR, got "+r.error.code); if(!String(r.error.message).includes("Missing value")) throw new Error("expected message to include Missing value: "+r.error.message);' \
  -- article post ./notes.md --title --dry-run --json

echo ""
echo "--- 3. Live-write-guard cases (mutating commands, no --dry-run, no creds) ---"

# Case 7: these prove the gate fails safely before any live post/delete/upload.
check "post (no dry-run, no creds) blocked" 3 "$AUTH_ERR" \
  -- post "would be a live post" --json
check "delete (no dry-run, no creds) blocked" 3 "$AUTH_ERR" \
  -- delete 1755555555555555555 --json
check "thread (no dry-run, no creds) blocked" 3 "$AUTH_ERR" \
  -- thread "one" "two" --json
check "article draft (no dry-run, no creds) blocked" 3 "$AUTH_ERR" \
  -- article draft "Launch Notes" ./notes.md --json
check "article publish (no dry-run, no creds) blocked" 3 "$AUTH_ERR" \
  -- article publish 1755555555555555555 --json
check "article post (no dry-run, no creds) blocked" 3 "$AUTH_ERR" \
  -- article post ./notes.md --title "Launch Notes" --json

echo ""
echo "--- 4. Validation cases (parse-level USAGE_ERROR rejections, still no network) ---"

# Case 8: media/alt validation — too many images, image+video mix, more alts than images.
check "too many images rejected" 2 "$USAGE_ERR" \
  -- post "x" --media a.png --media b.png --media c.png --media d.png --media e.png --dry-run --json
check "image + video mix rejected" 2 "$USAGE_ERR" \
  -- post "x" --media a.mp4 --media b.png --dry-run --json
check "more alts than images rejected" 2 "$USAGE_ERR" \
  -- post "x" --media a.png --alt "one" --alt "two" --dry-run --json

echo ""
echo "--- 5. File-thread cases (dry-run over a --file, no network) ---"

# Case 9: file-driven thread — needs a real file inside the sandbox HOME.
check_file_thread() {
  TOTAL=$((TOTAL + 1))
  local sandbox rc out
  sandbox="$(mktemp -d)"
  printf 'First post in the thread.\n\nSecond post in the thread.\n' > "$sandbox/thread.txt"
  set +e
  out="$(HOME="$sandbox" FINCH_OAUTH2_CLIENT_ID="" "${FINCH[@]}" \
    thread --file "$sandbox/thread.txt" --number --dry-run --json)"
  rc=$?
  set -e
  rm -rf "$sandbox"

  if [ "$rc" -ne 0 ]; then
    echo "FAIL: file-thread (dry-run) — expected exit 0, got $rc" >&2
    echo "      output: $out" >&2
    FAILURES=$((FAILURES + 1))
    return
  fi
  if ! node -e '
    const r = JSON.parse(process.argv[1]);
    if (r.data.dryRun !== true) throw new Error("not dryRun");
    if (r.data.wouldSend.length !== 2) throw new Error("expected 2 posts, got " + r.data.wouldSend.length);
    if (!r.data.wouldSend[0].text.startsWith("1/2 ")) throw new Error("numbering missing: " + r.data.wouldSend[0].text);
  ' "$out" 2>/tmp/e2e-rehearsal-thread.$$; then
    echo "FAIL: file-thread (dry-run) — $(cat /tmp/e2e-rehearsal-thread.$$)" >&2
    rm -f /tmp/e2e-rehearsal-thread.$$
    FAILURES=$((FAILURES + 1))
    return
  fi
  rm -f /tmp/e2e-rehearsal-thread.$$
  echo "PASS: file-thread numbered (dry-run) (exit 0)"
}
check_file_thread

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "ALL REHEARSAL CASES PASSED ($TOTAL/$TOTAL) — no live network, no real credentials."
  exit 0
else
  echo "REHEARSAL FAILURES: $FAILURES / $TOTAL" >&2
  exit 1
fi
