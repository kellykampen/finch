#!/usr/bin/env bash
#
# Regression checklist runner for FIN-27.
#
# Automates every numbered known-answer check from
# .claude/orchestration/regression-checklist.md against the compiled Finch
# binary. Runs in a fully sandboxed HOME + FINCH_CONFIG_PATH for any check
# that touches ~/.finch/config or runs finch auth / finch config. FIN-77 made
# the default config path resolve to the real user's canonical
# ~/.finch/config regardless of a caller-set $HOME, so sandbox HOME alone no
# longer isolates the config file — FINCH_CONFIG_PATH must be set explicitly
# to keep every check below from touching real credentials.
#
# Usage:
#   ./scripts/regression-checklist.sh
#
# Exit codes:
#   0  all checks passed
#   1  one or more checks failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

FINCH_BIN="$REPO_ROOT/finch"

TOTAL=0
FAILURES=0

log_check() {
  echo ""
  echo "[CHECK $1] $2"
}

run_check() {
  local num="$1" name="$2"
  shift 2
  TOTAL=$((TOTAL + 1))
  log_check "$num" "$name"
  if "$@"; then
    echo "PASS: $num. $name"
  else
    echo "FAIL: $num. $name" >&2
    FAILURES=$((FAILURES + 1))
  fi
}

# ---------------------------------------------------------------------------
# Check 1: bun run typecheck → 0 errors
# ---------------------------------------------------------------------------
check_1_typecheck() {
  bun run typecheck
}

# ---------------------------------------------------------------------------
# Check 2: bun test → all pass, 0 failures
# ---------------------------------------------------------------------------
check_2_tests() {
  bun test
}

# ---------------------------------------------------------------------------
# Check 3: compile binary → exits 0 and produces executable
# ---------------------------------------------------------------------------
check_3_build() {
  rm -f "$FINCH_BIN"
  bun run build || return 1
  test -x "$FINCH_BIN"
}

# ---------------------------------------------------------------------------
# Check 4: schema lists the full command set
# ---------------------------------------------------------------------------
check_4_schema() {
  local output
  if ! output="$("$FINCH_BIN" schema --json)"; then
    echo "schema command failed" >&2
    return 1
  fi
  node -e '
    const response = JSON.parse(process.argv[1]);
    if (!response.ok) throw new Error("schema returned ok=false");
    const names = new Set(response.data.commands.map((c) => c.name));
    const required = [
      "post", "reply", "thread",
      "timeline", "search", "user-posts", "user", "show",
      "like", "repost", "follow", "unfollow",
      "auth", "auth status",
      "config get", "config set", "config path",
      "schema",
    ];
    const missing = required.filter((n) => !names.has(n));
    if (missing.length) throw new Error("missing commands: " + missing.join(", "));
  ' "$output"
}

# ---------------------------------------------------------------------------
# Check 5: auth status with no config → known unconfigured answer, exit 0
# ---------------------------------------------------------------------------
check_5_auth_status_unconfigured() {
  (
    SANDBOX_HOME="$(mktemp -d)"
    trap 'rm -rf "$SANDBOX_HOME"' EXIT

    local output rc
    set +e
    output="$(HOME="$SANDBOX_HOME" FINCH_CONFIG_PATH="$SANDBOX_HOME/.finch/config" "$FINCH_BIN" auth status --json)"
    rc=$?
    set -e
    [ "$rc" -eq 0 ] || { echo "expected exit 0, got $rc" >&2; exit 1; }

    node -e '
      const response = JSON.parse(process.argv[1]);
      if (!response.ok) throw new Error("auth status returned ok=false");
      const expected = { configured: false, valid: false, username: null };
      const actual = response.data;
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error("unexpected data: " + JSON.stringify(actual));
      }
    ' "$output"
  )
}

# ---------------------------------------------------------------------------
# Check 6: after config is set up, ~/.finch/config is 600 and ~/.finch is 700
# ---------------------------------------------------------------------------
check_6_config_permissions() {
  (
    SANDBOX_HOME="$(mktemp -d)"
    trap 'rm -rf "$SANDBOX_HOME"' EXIT
    export HOME="$SANDBOX_HOME"
    export FINCH_CONFIG_PATH="$SANDBOX_HOME/.finch/config"

    mkdir -p "$SANDBOX_HOME/.finch"
    cat > "$SANDBOX_HOME/.finch/config" <<'JSON'
{
  "auth": {
    "clientId": "regression-test-client-id-123456789",
    "accessToken": "regression-test-access-token-123456789",
    "refreshToken": "regression-test-refresh-token-123456789",
    "expiresAt": 1893456000000,
    "scopes": ["tweet.read", "tweet.write"]
  },
  "transport": "oauth2",
  "defaults": { "json": false, "count": 10 }
}
JSON

    # Trigger a config rewrite through the binary so writeOAuth2Config()
    # applies its advertised directory/file modes.
    "$FINCH_BIN" config set defaults.json true >/dev/null || exit 1

    local file_perms dir_perms
    if [[ "$OSTYPE" == "darwin"* ]]; then
      file_perms="$(stat -f '%OLp' "$SANDBOX_HOME/.finch/config")"
      dir_perms="$(stat -f '%OLp' "$SANDBOX_HOME/.finch")"
    else
      file_perms="$(stat -c '%a' "$SANDBOX_HOME/.finch/config")"
      dir_perms="$(stat -c '%a' "$SANDBOX_HOME/.finch")"
    fi

    [ "$file_perms" = "600" ] || { echo "config perms $file_perms, expected 600" >&2; exit 1; }
    [ "$dir_perms" = "700" ] || { echo "directory perms $dir_perms, expected 700" >&2; exit 1; }
  )
}

# ---------------------------------------------------------------------------
# Check 7: write/read/engage command with --json → valid JSON of expected shape
# ---------------------------------------------------------------------------
check_7_json_output_shape() {
  (
    SANDBOX_HOME="$(mktemp -d)"
    trap 'rm -rf "$SANDBOX_HOME"' EXIT
    export HOME="$SANDBOX_HOME"
    export FINCH_CONFIG_PATH="$SANDBOX_HOME/.finch/config"

    local output rc
    set +e
    output="$("$FINCH_BIN" post --dry-run --json -- 'Regression test post')"
    rc=$?
    set -e
    [ "$rc" -eq 0 ] || { echo "expected exit 0, got $rc" >&2; exit 1; }

    node -e '
      const response = JSON.parse(process.argv[1]);
      if (!response.ok) throw new Error("post --dry-run returned ok=false");
      const data = response.data;
      if (data.dryRun !== true) throw new Error("dryRun not true");
      if (typeof data.wouldSend?.text !== "string") throw new Error("wouldSend.text not a string");
    ' "$output"
  )
}

# ---------------------------------------------------------------------------
# Check 8: bundled MCP server starts and lists the expected tools
# ---------------------------------------------------------------------------
check_8_mcp_tools() {
  (
    SANDBOX_HOME="$(mktemp -d)"
    HELPER="$(mktemp)"
    trap 'rm -rf "$SANDBOX_HOME" "$HELPER"' EXIT
    export HOME="$SANDBOX_HOME"
    export FINCH_CONFIG_PATH="$SANDBOX_HOME/.finch/config"

    cat > "$HELPER" <<'NODE'
const { spawn } = require("child_process");

const binary = process.argv[2];
const expectedTools = process.argv.slice(3);

const child = spawn(binary, ["mcp"], { stdio: ["pipe", "pipe", "inherit"] });
let buffer = "";
let tools = null;

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  const lines = buffer.split("\n");
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id === 1 && msg.result) {
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
      );
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }) + "\n",
      );
    }
    if (msg.id === 2 && msg.result && Array.isArray(msg.result.tools)) {
      tools = msg.result.tools.map((t) => t.name);
      child.stdin.end();
    }
  }
});

// Give the stdio transport a moment to start listening before sending the
// initialize handshake; writing immediately on spawn can race the server.
setTimeout(() => {
  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "finch-regression", version: "0.1.0" },
      },
    }) + "\n",
  );
}, 250);

setTimeout(() => {
  if (!tools) {
    console.error("timeout waiting for tools/list response");
    child.kill();
    process.exit(1);
  }
}, 10000);

child.on("exit", () => {
  if (!tools) {
    console.error("no tools/list response received");
    process.exit(1);
  }
  const toolSet = new Set(tools);
  const missing = expectedTools.filter((t) => !toolSet.has(t));
  if (missing.length) {
    console.error("missing tools: " + missing.join(", "));
    console.error("got: " + tools.join(", "));
    process.exit(1);
  }
  console.log("MCP tools: " + tools.join(", "));
  process.exit(0);
});
NODE

    node "$HELPER" "$FINCH_BIN" \
      post_tweet reply_tweet post_thread \
      get_timeline search_tweets get_user_posts get_user_profile get_tweet \
      like_tweet unlike_tweet repost_tweet unrepost_tweet delete_tweet \
      follow_user unfollow_user whoami skills
  )
}

# ---------------------------------------------------------------------------
# Check 9: config get masks auth.* values; config set auth.* is USAGE_ERROR (2)
# ---------------------------------------------------------------------------
check_9_config_masking() {
  (
    SANDBOX_HOME="$(mktemp -d)"
    trap 'rm -rf "$SANDBOX_HOME"' EXIT
    export HOME="$SANDBOX_HOME"
    export FINCH_CONFIG_PATH="$SANDBOX_HOME/.finch/config"

    mkdir -p "$SANDBOX_HOME/.finch"
    local CLIENT_ID="regression-test-client-id-123456789"
    cat > "$SANDBOX_HOME/.finch/config" <<JSON
{
  "auth": {
    "clientId": "$CLIENT_ID",
    "accessToken": "regression-test-access-token-123456789",
    "refreshToken": "regression-test-refresh-token-123456789",
    "expiresAt": 1893456000000,
    "scopes": ["tweet.read", "tweet.write"]
  },
  "transport": "oauth2",
  "defaults": { "json": false, "count": 10 }
}
JSON

    local output rc

    # Without explicit --json (script is non-TTY, so JSON is emitted anyway).
    output="$("$FINCH_BIN" config get auth.clientId)"
    rc=$?
    [ "$rc" -eq 0 ] || { echo "config get exit code $rc" >&2; exit 1; }
    node -e '
      const full = process.argv[2];
      const response = JSON.parse(process.argv[1]);
      if (!response.ok) throw new Error("config get returned ok=false");
      const value = response.data.value;
      if (value === full) throw new Error("value leaks full secret: " + value);
      if (!value.includes("*")) throw new Error("value is not masked: " + value);
      if (!value.endsWith(full.slice(-4))) throw new Error("value does not preserve last 4 chars: " + value);
    ' "$output" "$CLIENT_ID" || exit 1

    # With explicit --json.
    output="$("$FINCH_BIN" config get auth.clientId --json)"
    rc=$?
    [ "$rc" -eq 0 ] || { echo "config get --json exit code $rc" >&2; exit 1; }
    node -e '
      const full = process.argv[2];
      const response = JSON.parse(process.argv[1]);
      if (!response.ok) throw new Error("config get --json returned ok=false");
      const value = response.data.value;
      if (value === full) throw new Error("value leaks full secret: " + value);
      if (!value.includes("*")) throw new Error("value is not masked: " + value);
      if (!value.endsWith(full.slice(-4))) throw new Error("value does not preserve last 4 chars: " + value);
    ' "$output" "$CLIENT_ID" || exit 1

    # config set on an auth.* key must exit 2 (USAGE_ERROR).
    set +e
    output="$("$FINCH_BIN" config set auth.clientId newvalue --json 2>&1)"
    rc=$?
    set -e
    [ "$rc" -eq 2 ] || { echo "config set auth.* exit code $rc, expected 2" >&2; exit 1; }
    node -e '
      const response = JSON.parse(process.argv[1]);
      if (response.ok) throw new Error("config set auth.* returned ok=true");
      if (response.error.code !== "USAGE_ERROR") throw new Error("expected USAGE_ERROR, got " + response.error.code);
    ' "$output" || exit 1
  )
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

run_check 1 "bun run typecheck" check_1_typecheck
run_check 2 "bun test" check_2_tests
run_check 3 "bun build --compile produces executable" check_3_build
run_check 4 "schema lists full command set" check_4_schema
run_check 5 "auth status with no config returns unconfigured answer" check_5_auth_status_unconfigured
run_check 6 "config file permissions are 600/700 after setup" check_6_config_permissions
run_check 7 "dry-run post --json emits valid JSON of expected shape" check_7_json_output_shape
run_check 8 "MCP server starts and lists expected tools" check_8_mcp_tools
run_check 9 "config get masks auth.* and config set auth.* is rejected" check_9_config_masking

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "ALL CHECKS PASSED ($TOTAL/$TOTAL)"
  exit 0
else
  echo "FAILURES: $FAILURES / $TOTAL" >&2
  exit 1
fi
