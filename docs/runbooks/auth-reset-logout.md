# Auth reset / logout (no secrets)

## Why

Two different operator needs get conflated under "reset my auth": **reset** (I want to
re-authenticate, e.g. after a refresh token dies) and **logout** (I want this machine to
stop being authenticated, e.g. it's shared, borrowed, or being decommissioned). This
runbook covers both. Finch v1's shipped command surface (`docs/PLAN.md`) already covers
reset in full; logout has no dedicated command, and this doc explains why the existing
recovery path is sufficient rather than adding one.

## Reset: already covered by `finch auth`

`finch auth` **is** the reset flow. Re-running it always replaces the entire `auth` block
in `~/.finch/config` in one atomic write — Client ID, access token, refresh token, and
scopes are all overwritten together; there is no partial-update path (see README's "Auth
setup" and `docs/runbooks/credential-rotation.md`, which is the same flow driven by a
compromise rather than an expiry). Nothing further is needed for a safe reset:

```bash
finch auth               # full re-authentication, overwrites the stored credentials
finch auth status --json # confirm {configured: true, valid: true, username: "..."}
```

No new command is needed here. `finch auth` was already designed to be safely re-runnable
(FIN-62's persisted-Client-ID fix made this a one-command action), and it never leaves a
partially-written config: it only writes to disk after one live validation call succeeds.

## Logout: why the existing commands suffice

There is no `finch auth logout` or `finch auth reset` command in the shipped v1 surface
(`docs/PLAN.md`'s command table), and this runbook documents that as intentional rather
than a gap:

- **Finch's entire local auth state is one file.** `~/.finch/config` (see PLAN.md's config
  file shape) holds the complete `auth` block; there is no session cache, keychain entry,
  or secondary state file elsewhere on disk. "Logout" is exactly "this file is gone,"
  nothing more.
- **A missing config is already a first-class, non-error state.** `readOAuth2Config()`
  (`src/core/oauth2-config.ts`) returns `null` when the file doesn't exist, and every
  caller treats that as "not configured" rather than throwing: `finch auth status` reports
  `{configured: false, valid: false, username: null}` with exit code 0, and `finch whoami`
  reports the same clean "not configured, run `finch auth`" state. There's no broken
  half-authenticated state for a dedicated logout command to protect against.
- **Adding a new command would mean amending the frozen v1 spec, not just adding code.**
  `docs/PLAN.md` is marked `Status: SHIPPED (v1)` and states its command table is "the
  final shipped v1 command surface" — a new `auth logout` subcommand is a scope decision
  for that spec-of-record, not something this runbook should introduce unilaterally.
  Manual removal already gives an operator a safe, complete logout with the guidance
  below; if a scripted/agent-facing logout command becomes a real recurring need, that's a
  PLAN.md command-table change to propose separately, not a silent addition here.

### The safe logout procedure

```bash
finch config path   # confirm which file you're about to remove — path only, no secrets
rm ~/.finch/config  # or the path printed above, if it resolves elsewhere (see below)
finch auth status   # confirms {configured: false} — the clean "logged out" state
```

Use `finch config path` first rather than assuming `~/.finch/config`. An absolute
`FINCH_CONFIG_PATH` takes precedence; otherwise the path is resolved from `$HOME` at
runtime. Give every credential-using local process the same override when their `HOME`
values may differ—X refresh tokens can rotate, and independent writable copies do not
share Finch's adjacent refresh lock. Confirming the path avoids removing the wrong file.
Never `cat` the file first "to check"—that would print live tokens for no reason; the
path alone is enough to confirm you're targeting the right location.

### Destructive-behavior warning

- **This is a local-only, irreversible action.** There is no undo, no trash, and no
  `finch auth restore` — once removed, the only way back is running `finch auth` again
  (a fresh browser authorization).
- **Removing the local file does not revoke the credential at X.** The access/refresh
  token pair remains live at X's side until it naturally expires or is explicitly revoked
  from the X Developer Portal. If the goal is "this credential must stop working
  everywhere," not just "this machine is no longer configured," follow
  `docs/runbooks/credential-rotation.md` instead (or in addition) — logout alone is the
  wrong tool for a suspected-compromise scenario.
- **Config directory permissions are unaffected.** `~/.finch` itself stays at `0700`
  (`CONFIG_DIR_MODE`, `src/core/config.ts`) after the file inside it is removed; a
  subsequent `finch auth` recreates `~/.finch/config` at `0600` (`CONFIG_MODE`) same as
  any first-time setup — no permission drift results from a logout/re-auth cycle.

### What this procedure never does

Consistent with the no-secret conventions elsewhere in this repo
(`docs/runbooks/credential-rotation.md`, README's "Sharing diagnostics safely"): the
commands above never print an access token, refresh token, or Client ID. `finch config
path` prints only a filesystem path; `rm` prints nothing on success; `finch auth status`
after logout reports only booleans and a null username.
