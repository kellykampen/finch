# FIN-78 auth token persistence & long-lived token investigation

Date: 2026-07-13

This report records path, version, and behavior metadata only. No config contents, token
values, client secrets, or unmasked client IDs were read or printed. No live `finch auth`
or live X API call was made; all verification ran against sandboxed `FINCH_CONFIG_PATH`
stores and mocked OAuth transports.

## Symptoms (CEO report)

1. **Client ID not persisting** — every `finch auth` requires re-entering the Client ID.
2. **Token not long-lived** — sessions die repeatedly; `finch auth` needed multiple times
   per day.

## Root cause: the production binary predates every auth-persistence fix

The newest published release is **v0.3.0** (tag `v0.3.0` → `8e70d21`, released
2026-07-08). It is the latest tag in the repo, so it is the newest binary
`brew install`/`brew upgrade kellykampen/tap/finch` can deliver. Every fix for exactly
these two symptoms landed on `develop` **after** that tag and has never shipped:

| Fix | Commit | In v0.3.0? |
| --- | --- | --- |
| FIN-61 — `auth status` transparently refreshes an expired session | `4cecb9a` | no |
| FIN-62 (#47) — persist + reuse the Client ID on re-auth | `9c0f43a` | no |
| FIN-62 (#49) — durable sessions: concurrency-safe refresh, reactive 401 retry | `18ea60d` | no |
| FIN-74 — fail-closed cross-process refresh lock; divergent-snapshot analysis | `5752192` | no |
| FIN-77 — default config path resolves to canonical real-user home | `6c2a4df` | no |

### Symptom 1 mechanism (v0.3.0)

`git show v0.3.0:src/commands/auth.ts` shows `resolveClientId` resolves
flag → env → **interactive prompt**. There is no persisted-Client-ID fallback at all —
FIN-62 (#47) introduced it, after the release. Re-entering the Client ID on every
`finch auth` is v0.3.0's designed (broken) behavior, not a config wipe.

### Symptom 2 mechanism (v0.3.0)

v0.3.0 already requested `offline.access` and stored the refresh token, so the token
*grant* was never the problem — keeping the session alive was:

- Pre-FIN-61, `auth status` reported an expired access token as invalid instead of
  refreshing it, steering the operator straight to re-auth.
- Pre-FIN-74, `withFileLock` **ran the refresh callback without owning the lock** after a
  10-second timeout. X refresh tokens are single-use and rotate on every refresh; with the
  CLI, the bundled MCP server, and the hourly launchd social schedule all sharing the
  credential (see `docs/investigations/fin-74-oauth-refresh.md`'s execution-context
  table), two callers near the 2-hour expiry boundary could spend the same refresh token.
  X then invalidates the token family and the session is unrecoverable without an
  interactive re-login.
- Pre-FIN-77, any caller launched with a divergent `HOME` silently used its own config
  snapshot, so one context's rotation invalidated another context's stored token.

Net effect: sessions repeatedly die at or near access-token expiry instead of refreshing
transparently — experienced as "the token is not long-lived."

### No evidence of a config-wiping process

Nothing in `src/` deletes or truncates the config file; the only `rmSync` targets the
adjacent `*.refresh.lock`. `finch config set` refuses all `auth.*` keys. The
"something is deleting the credential" hypothesis is not supported at HEAD — the
re-prompt was v0.3.0 never *reading* the stored value, not the value being destroyed.

### Version-reporting footgun

`package.json` at HEAD still carries `0.3.0`, so a binary built from current `develop`
reports the same `finch version` as the broken release. Until the version is bumped as
part of the next release, "which binary am I actually running?" cannot be answered by
`finch version` alone (see FIN-59's stale-binary UX notes).

## Residual defects found at HEAD (fixed in this PR)

1. **Transient refresh failures masqueraded as expired sessions**
   (`src/core/transport.ts`). `performRefresh` mapped *every* refresh failure — including
   network errors and X 5xx, where the single-use refresh token was never spent — to
   `AUTH_ERROR: "Your session has expired — run finch auth"`. That is the "aggressive
   re-prompt instead of transparent refresh" failure mode: an offline moment at the expiry
   boundary told the operator to re-login (which also rotates the whole token family)
   when a plain retry would have recovered. Refresh failures are now classified: a 4xx
   token-endpoint rejection (except 429) still means session-expired; anything else maps
   to `NETWORK_ERROR` with retry guidance, and a `FinchError` from an injected `refreshFn`
   passes through unchanged.
2. **Re-auth silently reset operator defaults** (`src/commands/auth.ts`). `runAuth`
   rewrote `defaults` to factory values (`{json: false, count: 10}`) on every re-auth,
   clobbering operator-set values — the one real "config silently overwritten between
   runs" instance found. Re-auth now carries existing `defaults` forward (factory values
   still apply on first-ever auth or an unreadable prior config).
3. **Coverage gap on the requested OAuth scope.** The only scope assertions ran against a
   mocked OAuth2 client, so dropping `offline.access` from `OAUTH2_SCOPES` (the exact
   change that would make every future token short-lived) failed **zero** tests. A new
   regression test drives the real `@xdevplatform/xdk` client to the authorization URL
   (no network — URL building is pure) and asserts `offline.access` + PKCE parameters.
4. **Coverage gap on the real file store.** All prior client-ID-reuse tests injected
   `readOAuth2Config`/`writeOAuth2Config`. New FIN-78 regression tests run the production
   file store under a sandboxed `FINCH_CONFIG_PATH`: auth → re-auth without prompting,
   auth → transparent refresh (default lock-serialized persist path) → re-auth without
   prompting, and defaults preservation across re-auth. A temporary v0.3.0-style mutation
   (persisted-Client-ID read removed) makes these tests fail — they detect the exact CEO
   symptom.

## Verification at HEAD

- `bun run typecheck`, `bun test` (484 pass / 0 fail), `bun run lint` — clean.
- `bun run build` (bun build --compile) → sandboxed smoke (`HOME` + `FINCH_CONFIG_PATH`
  in a `mktemp -d` sandbox): `version --json`, `config path --json` (override respected,
  stable across invocations with divergent sandbox HOMEs), `auth status --json`
  (unconfigured, exit 0). No real config touched; no network.
- FIN-77's divergent-HOME canonical-path tests (including the two-real-process test) run
  as part of the suite and pass.

## Remediation

1. This PR: the two HEAD fixes plus the FIN-78 regression suite.
2. **Release (CEO decision required):** cut and publish a new release from `develop`
   (with a version bump) so production picks up FIN-61/62/74/77/78. Until that ships,
   every code fix listed above remains invisible to the Homebrew-installed binary — this
   is the actual production remediation for both reported symptoms.
