#!/usr/bin/env bash
#
# Regression check for FIN-51: verify that the COMPILED finch binary's local
# OAuth callback server survives malformed / noise HTTP requests without exiting.
#
# This exercises the real Bun.serve instance over the real network stack — no
# mocks, no real X credentials, and no real OAuth exchange. A fake client-id is
# used; we only care that the local server stays alive across stray requests.
#
# Usage:
#   ./scripts/verify-auth-callback-server.sh
#
# The script expects a compiled binary at ./finch; if missing it builds one.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FINCH_BIN="$REPO_ROOT/finch"

PORT=8765
HOST=127.0.0.1
CALLBACK_URL="http://$HOST:$PORT/callback"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log_info() { echo "[verify-auth-callback-server] $*"; }
log_error() { echo "[verify-auth-callback-server] ERROR: $*" >&2; }

# Return 0 if something appears to be listening on the callback port.
is_port_listening() {
  # macOS + Linux: lsof is the canonical cross-platform choice requested in the
  # FIN-51 write-up. It is installed on GitHub Actions ubuntu-latest runners.
  if command -v lsof >/dev/null 2>&1; then
    # -P disables port-to-service name mapping; -n disables host name lookup.
    lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n >/dev/null 2>&1 && return 0
    # Some lsof variants don't support -sTCP:LISTEN; try the simpler form too.
    lsof -iTCP:"$PORT" -P -n >/dev/null 2>&1 && return 0
  fi

  # Linux fallback (ubuntu-latest always has ss).
  if command -v ss >/dev/null 2>&1; then
    ss -tln 2>/dev/null | grep -qE ":${PORT}\b" && return 0
  fi

  # Last-resort connectivity probe: any HTTP response means the port is up.
  if command -v curl >/dev/null 2>&1; then
    curl -s -o /dev/null --connect-timeout 1 "$CALLBACK_URL" 2>/dev/null && return 0
  fi

  return 1
}

# Wait up to N seconds for the callback server to start.
wait_for_port() {
  local deadline="$(($(date +%s) + ${1:-10}))"
  while [[ "$(date +%s)" -lt "$deadline" ]]; do
    if is_port_listening; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

# curl a URL and print only the HTTP status code, or 000 on failure.
http_status() {
  curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "$@"
}

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

if [[ ! -x "$FINCH_BIN" ]]; then
  log_info "compiled binary not found at $FINCH_BIN; building..."
  (cd "$REPO_ROOT" && bun build --compile ./src/index.ts --outfile finch)
fi

# Never touch a real config: run with a disposable HOME.
SANDBOX_HOME="$(mktemp -d)"
# Also prevent the auth flow from spawning a real browser by shadowing the
# platform opener commands with no-op scripts placed first in PATH.
BROWSER_BIN_DIR="$(mktemp -d)"

for opener in open xdg-open; do
  cat > "$BROWSER_BIN_DIR/$opener" <<'OPENER'
#!/usr/bin/env sh
# No-op browser opener for regression testing.
exit 0
OPENER
  chmod +x "$BROWSER_BIN_DIR/$opener"
done

export HOME="$SANDBOX_HOME"
export PATH="$BROWSER_BIN_DIR:$PATH"

FINCH_LOG="$(mktemp)"

# Ensure cleanup even if we bail early.
cleanup() {
  set +e
  if [[ -n "${FINCH_PID:-}" ]] && kill -0 "$FINCH_PID" 2>/dev/null; then
    kill "$FINCH_PID" 2>/dev/null
    wait "$FINCH_PID" 2>/dev/null
  fi
  rm -rf "$SANDBOX_HOME" "$BROWSER_BIN_DIR" "$FINCH_LOG"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Start the compiled binary's auth flow
# ---------------------------------------------------------------------------

log_info "starting: $FINCH_BIN auth --client-id fake-test-client-id-not-real"
"$FINCH_BIN" auth --client-id fake-test-client-id-not-real >"$FINCH_LOG" 2>&1 &
FINCH_PID=$!

log_info "waiting for callback server on $HOST:$PORT..."
if ! wait_for_port 10; then
  log_error "callback server is not listening on port $PORT after wait"
  if ! kill -0 "$FINCH_PID" 2>/dev/null; then
    log_error "finch process (PID $FINCH_PID) has already exited"
  fi
  echo "--- finch stdout/stderr ---"
  cat "$FINCH_LOG" || true
  echo "--- end finch output ---"
  exit 1
fi
log_info "callback server is listening"

# ---------------------------------------------------------------------------
# Test 1: missing authorization code -> 400, process must survive
# ---------------------------------------------------------------------------

log_info "sending malformed request (missing code)..."
status_1="$(http_status "$CALLBACK_URL")"
if [[ "$status_1" != "400" ]]; then
  log_error "expected HTTP 400 for missing code, got $status_1"
  exit 1
fi

if ! kill -0 "$FINCH_PID" 2>/dev/null; then
  log_error "finch process died after the missing-code request"
  exit 1
fi
if ! is_port_listening; then
  log_error "callback server stopped listening after the missing-code request"
  exit 1
fi
log_info "process and port survived missing-code request"

# ---------------------------------------------------------------------------
# Test 2: wrong state value -> 403, process must survive
# ---------------------------------------------------------------------------

log_info "sending wrong-state request..."
status_2="$(http_status "$CALLBACK_URL?code=fake&state=wrongstate")"
if [[ "$status_2" != "403" ]]; then
  log_error "expected HTTP 403 for wrong state, got $status_2"
  exit 1
fi

if ! kill -0 "$FINCH_PID" 2>/dev/null; then
  log_error "finch process died after the wrong-state request"
  exit 1
fi
if ! is_port_listening; then
  log_error "callback server stopped listening after the wrong-state request"
  exit 1
fi
log_info "process and port survived wrong-state request"

# ---------------------------------------------------------------------------
# Cleanup and final verification
# ---------------------------------------------------------------------------

log_info "stopping finch process (PID $FINCH_PID)..."
kill "$FINCH_PID"
wait "$FINCH_PID" 2>/dev/null || true

if kill -0 "$FINCH_PID" 2>/dev/null; then
  log_error "finch process did not terminate after kill"
  exit 1
fi

log_info "PASS: compiled binary callback server survived malformed requests"
exit 0
