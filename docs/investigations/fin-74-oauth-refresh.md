# FIN-74 OAuth2 refresh-token investigation

Date: 2026-07-12

This report records path and behavior metadata only. No config contents, token values, client secrets, or unmasked client IDs were read or printed.

## Root cause

Finch previously derived both its credential file and refresh lock from the calling process's `HOME`:

- config: `$HOME/.finch/config`
- lock: `$HOME/.finch/config.refresh.lock`

Two callers with different `HOME` values therefore used independent credential snapshots and independent locks. X refresh responses can carry a replacement `refresh_token`, and Finch persists that returned token. A stale snapshot can consequently spend an older rotating token after another store has refreshed it.

There was a second concrete race in `withFileLock`: after waiting 10 seconds it ran the refresh callback **without owning the lock**. A slow X response could therefore let two processes spend the same refresh token. This explains recurrence near the access-token refresh boundary; FIN-62 only made the non-secret Client ID reusable after a session was already lost.

## Refresh-token evidence

- X's current OAuth2 user-access-token guide says `offline.access` is required to receive a refresh token and documents `POST https://api.x.com/2/oauth2/token` with `grant_type=refresh_token`: <https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token>.
- `@xdevplatform/xdk` 0.5.0's `OAuth2.refreshToken()` returns the token endpoint's new `refresh_token` field.
- Finch's refresh path replaces the stored refresh token whenever that response field is present. Its existing concurrency tests model this replacement and adoption behavior.

Together these are the safe operational assumption required by OAuth refresh-token rotation: a refresh is a single-writer operation, and callers must persist and subsequently use the latest returned credential. No live token diagnostics were needed.

## Execution-context evidence

| Context | `HOME` / config behavior | Can write the CEO credential? |
| --- | --- | --- |
| CEO interactive shell | Observed `HOME=/Users/kellykampen`; installed Finch reported `/Users/kellykampen/.finch/config`. Node `os.homedir()` and `os.userInfo().homedir` both reported `/Users/kellykampen`. | Yes. |
| Local pi-fleet lead/worker sessions | The FIN-74 local worker observed the same `HOME` and config path. Worktree location does not affect `configPath()`. | Yes, when a role invokes Finch. |
| `pi-personal-assistant` interactive use | Local profile invokes the installed Finch CLI and inherits the local user environment. | Yes. |
| Hourly personal launchd schedule | Installed social and Gmail plist files contained no explicit `HOME` or `FINCH_CONFIG_PATH` entry. The social schedule invokes Finch locally; launchd's user context supplies the user's home. | Social schedule: yes. Gmail schedule: no Finch invocation. |
| pi-fleet E2B workers | Isolated remote filesystem/home. pi-fleet does not inject Finch credentials, and its documented E2B worker flow does not invoke Finch. | No. It must remain isolated. |
| GitHub Actions CI | Ubuntu runner home; `./finch auth status --json` runs unconfigured. No live Finch credential is provided. | No. |
| Finch unit/regression/callback/rehearsal smokes | Tests and scripts use temporary `HOME` directories deliberately, with synthetic or absent credentials. | No; isolation is intentional. |
| Documentation | Examples only; no process invokes auth or transport. | No. |

## Fix

1. `FINCH_CONFIG_PATH` now selects one explicit absolute credential path before `HOME` is considered. Every process given the same value shares both the config and its adjacent refresh lock, even when their `HOME` values differ. **This is opt-in**: Finch's default behavior is unchanged, and any process that does not have `FINCH_CONFIG_PATH` set still derives its config and lock from that process's own `HOME`. Two callers with genuinely different `HOME` values, neither given the override, still diverge exactly as before.
2. Relative overrides are rejected to prevent working-directory-dependent stores.
3. Refresh-lock timeout now fails closed and never calls the refresh callback unlocked. Stale crashed locks are still recoverable through the existing stale-lock path (see the limitation noted in `withFileLock`'s JSDoc: the mtime-age heuristic cannot distinguish a crashed holder from one still legitimately mid-refresh).
4. `finch config path --json` remains the safe path diagnostic. `finch auth status --json` remains the safe auth diagnostic. Neither includes credential fields or values; lock timeout reports only path metadata.

**Scope note:** this Finch-only PR does not, by itself, close the original differing-`HOME` incident for every possible caller — it only removes the divergence for callers that are actually configured with a shared `FINCH_CONFIG_PATH`. Per the evidence table below, the CEO shell and the observed local fleet/personal-assistant contexts currently happen to share the same `HOME`, so the fail-closed lock fix protects that shared store immediately even without the override. But nothing in this PR forces convergence: if pi-fleet's personal-assistant process or its generated launchd plists were ever run under a different `HOME` (or on a different host), they would still diverge from the CEO store unless the pi-fleet follow-up (setting `FINCH_CONFIG_PATH` explicitly for those processes) has landed. That follow-up is tracked separately in pi-fleet and remains open as of this writing.

## Deployment / companion action

See the scope note above: the CEO shell and observed local fleet contexts already converge on `/Users/kellykampen/.finch/config` today, so the fail-closed lock fix protects that shared store immediately. Closing the general differing-`HOME` risk for pi-fleet's processes still requires the separate follow-up: pi-fleet should set an absolute `FINCH_CONFIG_PATH` in the personal-assistant process and generated social launchd plist, derived at schedule-install time from the operator's canonical path. E2B, CI, and no-live smokes must not inherit that value; their isolated stores are intentional.
