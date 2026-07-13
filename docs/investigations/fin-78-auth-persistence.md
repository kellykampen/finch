# FIN-78 auth token persistence & long-lived-session investigation

Date: 2026-07-13 (revised after independent review — see "Review-driven fixes" below)

This report records path, version, and behavior metadata only. No config contents, token
values, client secrets, or unmasked client IDs were read or printed. No live `finch auth`
or live X API call was made; all verification ran against sandboxed `FINCH_CONFIG_PATH`
stores and mocked OAuth transports.

Terminology: X OAuth2 **access tokens are always short-lived** (~2 hours). "Long-lived"
correctly refers to the **session** — continuity backed by a refresh token, which
`offline.access` makes X eligible to issue. The CEO-reported "token not long-lived"
symptom is therefore analyzed as "the refreshable session keeps dying."

## Symptoms (CEO report)

1. **Client ID not persisting** — every `finch auth` requires re-entering the Client ID.
2. **Session not long-lived** — sessions die repeatedly; `finch auth` needed multiple
   times per day.

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

### Symptom 1 mechanism (v0.3.0) — proven

`git show v0.3.0:src/commands/auth.ts` shows `resolveClientId` resolves
flag → env → **interactive prompt**. There is no persisted-Client-ID fallback at all —
FIN-62 (#47) introduced it, after the release. Re-entering the Client ID on every
`finch auth` is v0.3.0's designed (broken) behavior. This cause is proven directly from
the released source.

### Symptom 2 mechanisms (v0.3.0) — demonstrated mechanisms; incident trigger inferred

v0.3.0 already requested `offline.access` and stored the refresh token, so refresh-token
*issuance* was never the problem — keeping the session alive was. The released code
contains several defects, each sufficient to kill a session near the ~2-hour access-token
expiry:

- Pre-FIN-61, `auth status` reported an expired-but-refreshable session as invalid
  instead of refreshing it, steering the operator straight to re-auth.
- Pre-FIN-74, `withFileLock` **ran the refresh callback without owning the lock** after a
  10-second timeout. Per X's OAuth2 documentation (see
  `docs/investigations/fin-74-oauth-refresh.md`), refresh responses **can carry a
  replacement refresh token**, and Finch persists that replacement — so callers must
  treat refresh as a single-writer operation and always use the latest persisted
  credential. With the CLI, the bundled MCP server, and the hourly launchd social
  schedule all sharing the credential (FIN-74's execution-context table), two callers
  near the expiry boundary could submit the same already-rotated refresh token; X can
  then reject the stale token and the session is unrecoverable without an interactive
  re-login.
- Pre-FIN-77, any caller launched with a divergent `HOME` silently used its own config
  snapshot, so one context's rotation could strand another context's stored token.

**Certainty note:** the vulnerable mechanisms above and the release gap are proven from
the released source. The *exact* trigger of each production re-auth incident was not
directly observed (that would require live-credential telemetry, which the FIN-78 safety
constraints prohibit); what is proven is that the released binary contains multiple
defects whose failure mode matches the report, and that the fixes for them are unreleased.

### Config overwrite paths (corrected by review)

Every Finch config write is a whole-document replacement — `writeOAuth2Config()`
rewrites the entire file (originally via a truncating `writeFileSync`; now via an atomic
temp-file-and-rename). The independent review demonstrated a real lost-update race at
the prior HEAD: `finch config set` (and re-auth) performed **unlocked** whole-config
read-modify-writes, so a snapshot read before a concurrent refresh could be written back
afterwards, silently restoring an already-rotated refresh token. Refusing
`config set auth.*` keys does **not** protect credentials, because the command rewrites
the whole document regardless. Both writers are now serialized and merge-scoped — see
"Review-driven fixes."

### Version-reporting footgun

`package.json` at HEAD still carries `0.3.0`, so a binary built from current `develop`
reports the same `finch version` as the broken release. Until the version is bumped as
part of the next release, "which binary am I actually running?" cannot be answered by
`finch version` alone (see FIN-59's stale-binary UX notes).

## Defects found and fixed at HEAD in this PR

1. **Cross-writer lost-update race (review blocker 1).** Only token refresh took the
   store lock; `finch config set` and `finch auth`'s final write were unlocked
   whole-config read-modify-writes that could resurrect a stale credential rotated by a
   concurrent refresh. Fix: one shared store-wide writer lock
   (`withConfigStoreLock`, kept at the historical `.refresh.lock` path so old and new
   binaries still serialize against each other); every writer re-reads the freshest
   snapshot while holding it and merges only the fields it owns (refresh/re-auth own
   `auth`; `config set` owns `defaults`). `writeOAuth2Config` now writes atomically via
   same-directory temp file + rename, so no reader ever observes a truncated document
   (atomicity alone does not fix lost updates — the lock does). Deterministic
   interleaving regressions cover config-set-vs-refresh and re-auth-vs-refresh.
2. **Auth accepted a grant with no refresh token (review blocker 2).** `runAuth`
   persisted `refresh_token ?? ""`, so it could report success — and overwrite a
   previously refreshable config — with a session that cannot outlive its access token.
   Requesting `offline.access` does not prove X issued a refresh token (the scope can be
   denied on the consent screen or by app settings). Fix: `runAuth` fails with actionable
   guidance before any validation call or config write; the prior config is untouched.
   First-auth and re-auth regressions included.
3. **Refresh-failure classification (review finding 3).** Previously every refresh
   failure was reported as "session expired — run `finch auth`", and the first revision
   of this PR still treated all 4xx (except 429) as terminal and claimed the stored
   credential was "still valid" after network failures. Neither is knowable: a network
   failure or 5xx does not prove X never processed the request. Fix: terminal
   classification keys on RFC 6749 error codes (`invalid_grant`, `invalid_client`,
   `unauthorized_client`, `unsupported_grant_type`) or a non-transient 4xx; 408/425/429,
   5xx, and network failures map to a retryable `NETWORK_ERROR` whose message describes
   the outcome as unconfirmed and advises retry-then-re-auth. Regression tests drive the
   **real** `@xdevplatform/xdk` `refreshToken()` against a mocked `fetch` (invalid_grant,
   invalid_client, 408, 425, 429, 503, network failure, and the success/persist path), so
   an XDK contract change fails loudly.
4. **Re-auth silently reset operator defaults.** `runAuth` rewrote `defaults` to factory
   values on every re-auth. Fix: existing `defaults` carry forward (factory values still
   apply on first-ever auth or an unreadable prior config), now merged under the store
   lock from the freshest snapshot.
5. **Coverage gaps.** Added: a real-XDK authorization-URL pin proving `offline.access` +
   PKCE are actually requested (previously, dropping `offline.access` from
   `OAUTH2_SCOPES` failed zero tests); end-to-end persistence tests through the real file
   store under a sandboxed `FINCH_CONFIG_PATH` (client-ID reuse across auths, transparent
   refresh keeping `clientId`/`defaults` intact). A temporary v0.3.0-style mutation
   (persisted-Client-ID read removed) makes these fail — they detect the exact CEO
   symptom. Known limit: `runAuth` sequences run within one test process; cross-process
   serialization is provided by the O_EXCL lock-file primitive, whose behavior is covered
   by the FIN-74 lock tests, and FIN-77's two-process test proves path/lock-path equality
   across divergent-`HOME` processes.

## Verification at HEAD

- `bun run typecheck`, `bun test` (496 pass / 0 fail), `bun run lint` — clean.
- `bun run build` (bun build --compile) → sandboxed smoke (`HOME` + `FINCH_CONFIG_PATH`
  in a `mktemp -d` sandbox): `version --json`, `config path --json` (override respected,
  stable across invocations with divergent sandbox HOMEs), `auth status --json`
  (unconfigured, exit 0). No real config touched; no network.
- FIN-77's divergent-HOME canonical-path tests (including the two-real-process test) run
  as part of the suite and pass.

## Remediation

1. This PR: the fixes and regression suites above.
2. **Release (CEO decision required):** cut and publish a new release from `develop`
   (with a version bump) so production picks up FIN-61/62/74/77/78. Until that ships,
   every code fix listed above remains invisible to the Homebrew-installed binary — this
   is the actual production remediation for both reported symptoms. Merging this PR alone
   does not change the installed binary.
