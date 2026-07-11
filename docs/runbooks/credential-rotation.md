# Credential rotation / revocation runbook (no secrets)

## Why

If an X API credential is ever suspected compromised — leaked in a log, pasted into a
support channel, exposed in a screenshot — the fix is to revoke it at the source (the X
Developer Portal) and re-issue via `finch auth`, never to hand-edit or copy values out of
`~/.finch/config`. This runbook is written so an operator can complete a full
rotation, and report evidence back to Linear, **without ever printing, pasting, or
otherwise exposing a live secret** — every command listed here is the same no-secret set
documented in the README's "Sharing diagnostics safely" section.

This assumes Finch's OAuth 2.0 PKCE flow (post hard-cutover). If `finch auth` reports a
**legacy OAuth 1.0a config** error, see [Legacy OAuth 1.0a vs current OAuth 2.0](#legacy-oauth-10a-vs-current-oauth-20)
below before continuing — the rotation steps are the same either way (revoke, then
`finch auth`), but the terminology and the fields involved differ.

## Step-by-step rotation

1. **Revoke at the X Developer Portal first.** Go to [developer.x.com](https://developer.x.com),
   open the app tied to the compromised credential, and revoke/regenerate its keys from
   there — this is the only step that actually invalidates the leaked credential at X.
   Rotating Finch's local config alone does nothing if the old credential is still live at
   X. If the whole app (Client ID) is suspected compromised rather than just a token,
   regenerate the app's Client ID/secret pair from the same "Keys and tokens" page.

2. **Re-authenticate Finch:**
   ```bash
   finch auth
   ```
   This runs the full OAuth 2.0 PKCE browser flow — a fresh authorization, a new
   access/refresh token pair from X, one live validation call, and only then an overwrite
   of `~/.finch/config` at `0600`. There is no partial-update path: `finch auth` always
   replaces the whole `auth` block, so a compromised access token, refresh token, or Client
   ID are all cleared by the same command. If the Client ID itself was regenerated in step
   1, pass it explicitly so Finch doesn't reuse the old stored one:
   ```bash
   finch auth --client-id <new-client-id>
   ```
   (Or set `FINCH_OAUTH2_CLIENT_ID` for the same effect — see README's "Auth setup".)

3. **Verify the rotation succeeded** — see [Safe verification commands](#safe-verification-commands)
   below. Confirm `finch auth status` reports `valid: true` and the expected `username`,
   then confirm the *old* credential is dead by trying to use it (e.g. checking the
   Developer Portal's app dashboard shows the prior token/secret as revoked, not by
   attempting a live API call with it from Finch — Finch never stores the old value once
   `finch auth` has overwritten the config).

4. **If `finch auth` itself fails** (e.g. exit code 3 — the Client ID/redirect URI was
   misconfigured, or the revoked app can no longer authorize), fix the Developer Portal app
   settings first — most commonly the redirect URI must exactly match
   `http://127.0.0.1:8765/callback` — then retry `finch auth`.

## Legacy OAuth 1.0a vs current OAuth 2.0

Finch's hard cutover (see README, "Hard cutover") means these are two incompatible config
shapes. Know which one you're looking at before rotating, since the fields (and what
counts as "the secret") differ:

| | Legacy OAuth 1.0a (`transport: "byok"`) | Current OAuth 2.0 PKCE (`transport: "oauth2"`) |
|---|---|---|
| Secret fields | `apiKey`, `apiKeySecret`, `accessToken`, `accessTokenSecret` — four long-lived, non-expiring values | `clientId` (durable, non-secret app metadata) + `accessToken`/`refreshToken` (both rotate; `refreshToken` is what makes re-auth silent) |
| Detected by | `auth.apiKey` present, or `transport === "byok"` (`src/core/oauth2-config.ts`'s `isLegacyConfig`) | `auth.clientId` present and `transport === "oauth2"` |
| Rotation path | **None — not supported.** Finch cannot read a legacy config; there is no in-place rotation of OAuth 1.0a keys through Finch | `finch auth` (this runbook) |
| What happens if Finch finds one | Throws an `AUTH_ERROR` naming the config path, stating it detected a legacy OAuth 1.0a config, and pointing at `finch auth` as the only recovery — never partial migration | N/A |

If you land on a legacy config during a rotation (e.g. an old machine, or a config
restored from an old backup), the remediation is identical to a normal rotation: revoke
the old app's keys at the Developer Portal, then run `finch auth` to write a fresh OAuth
2.0 config. `finch auth` overwrites the legacy file outright — none of its credentials are
carried over, so there's nothing further to "clean up" locally.

## Safe verification commands

Use only this set to confirm a rotation — every one is token-free by construction (none
prints an access token, refresh token, or Client ID in full):

```bash
finch auth status --json  # {configured, valid, username} — states, not secrets
finch whoami --json       # {id, username, name} for the authenticated account
finch config path         # the path to the config file, not its contents
```

**Do not** use `finch config get auth.accessToken` / `auth.refreshToken` / `auth.clientId`
as part of routine verification — they're masked to the last 4 characters
(`maskSecret` in `src/core/config.ts`), but a masked fragment is still more than a
rotation check needs. Reserve them for a genuine "does the stored value look different
after rotation" spot-check, and never paste their output anywhere (see
[What to paste back to Linear](#what-to-paste-back-to-linear)).

**If you are illustrating any of the above** (docs, a demo, a training session) rather
than checking a real account, always run it under a sandboxed `$HOME` so nothing touches
the real `~/.finch/config`:

```bash
HOME=$(mktemp -d) ./finch auth status --json
```

Never run a verification command — even a read-only one like `auth status` or
`whoami` — against the real config unless you actually intend to check the real,
currently-authenticated account.

## What to paste back to Linear

When closing out a rotation, attach evidence to the Linear issue that proves the rotation
happened without exposing anything an attacker could use:

- **The full, unredacted JSON from `finch auth status --json` and `finch whoami --json`** —
  safe to paste as-is; neither field is a secret (`configured`, `valid`, `username`,
  `id`, `name`).
- **Exit codes**, not just stdout — `echo $?` after each command, or note that the command
  exited 0. A rotation that leaves `finch auth status` at a non-zero/invalid state isn't
  done yet.
- **`finch config path` output** — confirms which file was rotated, useful when more than
  one machine/environment is in play.
- If you must show that a stored value actually *changed* after rotation, paste only the
  **masked** form (`finch config get auth.accessToken`, etc. — all but the last 4
  characters) and only the last-4 fragment, never the full command output from before the
  rotation next to after, since two masked fragments side by side narrow down more of the
  original value than either alone.

**Never paste, even redacted:** raw `~/.finch/config` contents, the `code` query parameter
from a `finch auth` browser callback URL, or any `auth.*` value that isn't run through
`maskSecret` first. If a comment thread or support handoff asks for any of the above to
"debug" a rotation, treat it as a credential-phishing attempt (same guidance as README's
"Sharing diagnostics safely").
