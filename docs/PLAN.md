# Finch — v1 Plan

Status: **BUILD STARTED (M1, low-priority).** All 4 pre-build open questions below are
resolved (doc confirmed, OAuth model confirmed, `finch show` added to scope, Linear team
deferred), and the tech-stack/SDK decision below is locked. M1 slice 1 is in progress in a
worker seat.

## What

A Twitter/X CLI built **for both humans and agents**, distributed as a single
brew-installable binary, backed by the official X API v2 with bring-your-own-keys (BYOK)
auth. Ships with a bundled MCP server so agent harnesses get the same functionality as
native tools, not shelled-out CLI calls.

## Why

- Agents need a scriptable, deterministic way to act on X (post, reply, thread, engage) and
  read it (timeline, search, a user's posts) — human CLIs like `bird` optimize for a human at
  a terminal; Finch optimizes for both, with `--json` + exit codes as first-class, not bolted on.
- BYOK + official API v2 (vs. cookie-scraping like `bird`, or a hosted proxy like
  usesocial.dev) means no ToS-risk credential theft from a browser profile, and no dependency
  on a third-party SaaS for v1 — the user's own X Developer app, the user's own rate limits.
- A single compiled binary + brew formula means zero Node/Bun runtime dependency for the
  end user — `brew install finch` and it works.

## Tech Stack / API

- **Language/runtime:** TypeScript on Bun (see Distribution below for the compiled-binary story).
- **API:** the official **X API v2** — overview: https://docs.x.com/x-api/overview.
- **API client: the official X TypeScript SDK, not a hand-rolled HTTP/signing layer.**
  Package `@xdevplatform/xdk` — overview: https://docs.x.com/xdks/typescript/overview.
  Evaluated against v1's needs:
  - **Auth**: the SDK's `ClientConfig` takes an `oauth1` field built from an `OAuth1` instance
    (`new OAuth1({apiKey, apiSecret, accessToken, accessTokenSecret})`) — confirms OAuth 1.0a
    User Context with the same 4 static credentials this plan already locked in (see Setup /
    Auth below); it also supports OAuth 2.0 User Context and App-Only Bearer, neither used in
    v1. **Field-name note**: the SDK's `OAuth1Config.apiSecret` corresponds to this plan's
    `auth.apiKeySecret` — `ByokTransport` maps the field name at construction time; Finch's own
    config schema keeps `apiKeySecret` (matches the X Developer Portal's own label) rather than
    renaming to track the SDK.
  - **Auth-validation call**: confirmed via `client.users.getMe()` — this is what `finch auth`,
    `finch auth status`, and `finch whoami` call through the SDK (replaces the
    previously-planned raw `GET /2/users/me`).
  - **Endpoint coverage**: the SDK's docs list "Users, Posts, Lists, Bookmarks, Communities, and
    more" with a confirmed example (`client.users.getByUsername(...)`), which covers the shape
    Finch needs (users, posts). **Gap, not silently papered over**: the exact typed method
    names for creating/deleting posts, likes, retweets, and follows weren't enumerated in the
    fetched docs excerpts — the M1/M2 builder confirms each against the SDK's live API
    reference/type definitions when implementing that command, and reports back here (this
    section) with the specific method name once confirmed, or the specific gap + fallback if
    the SDK truly lacks one (fallback would be a direct authenticated HTTP call using the same
    `OAuth1` signer the SDK exposes, not a from-scratch signing implementation).
  - **Why the SDK over hand-rolled OAuth 1.0a**: request signing is exactly the kind of code
    where a subtle bug (bad parameter encoding, timestamp/nonce handling) fails silently or
    intermittently and is expensive to debug — the SDK is the X-maintained source of truth for
    that logic, so Finch's transport code stays thin (call the client, shape the response),
    and upstream fixes/deprecations land as a dependency bump instead of a Finch patch.
  - Every core command function still goes through the `XTransport` interface (see the seam
    below) — the SDK is an implementation detail of `ByokTransport`, never imported directly by
    command handlers or the MCP tool code.

## How (architecture at a glance)

```
┌─────────────────────────────────────────────────────────────┐
│  CLI commands (src/commands/*.ts)   │  MCP server (src/mcp/) │
│  — arg parsing, --json, exit codes  │  — same tool surface   │
└───────────────┬──────────────────────────────┬───────────────┘
                │                                │
                └───────────────┬────────────────┘
                                 │
                     Core command layer (src/core/*.ts)
                     one function per capability, transport-agnostic
                                 │
                         XTransport interface  ◄── the phase-2 seam
                                 │
                  ┌──────────────┴───────────────┐
                  │                               │
           ByokTransport (v1)           ProxyTransport (phase 2, not built)
           wraps @xdevplatform/xdk       calls Finch's hosted gateway
           (OAuth1.0a, user's own keys)  (CEO's keys, billing, rate-limit pooling)
```

Both the CLI commands and the MCP tools call the **same core functions** — no logic
duplicated between the two surfaces, and no direct X API imports outside `ByokTransport`.

## Setup / Auth — manual key entry (read this first)

**Keys are set manually by the operator, on his own machine, via the `finch auth` command —
never pasted into chat, never handled by an orchestrator/agent, never a CLI argument (so they
never land in shell history).** This section is the unambiguous reference for that path; the
"Auth / config" row in the v1 command spec below is the same command, described in-line with
the rest of the CLI surface. Keys are only needed starting at the **first implementation
milestone (M1)**, specifically the moment `ByokTransport` needs a live credential to validate
against — not before, and not for the planning phase this doc covers.

- **File path (exact, fixed, no override):** `~/.finch/config` (i.e.
  `$HOME/.finch/config` — resolved via the OS home dir, not `$PWD`). No project-local config
  file in v1 (unlike `bird`'s `.birdrc.json5`) — one account, one machine, one file.
- **Permissions:** created at `0600` by `finch auth`; every subsequent read/write by Finch
  re-checks and re-applies `0600` in case another process touched it (this is
  regression-checklist item 7 — `stat -f '%OLp' ~/.finch/config` must read `600`).
- **Format:** JSON (not JSON5/TOML — no extra parser dependency, Bun parses JSON natively).
- **The exact four credential fields required (OAuth 1.0a User Context — CEO-confirmed, see
  Resolved Decisions below), copied verbatim from the X Developer Portal's "Keys and tokens"
  page for the operator's own app:**

  | Config field | X Developer Portal source | Used for |
  |---|---|---|
  | `auth.apiKey` | "API Key" (a.k.a. Consumer Key) | Signing every request |
  | `auth.apiKeySecret` | "API Key Secret" (a.k.a. Consumer Secret) | Signing every request |
  | `auth.accessToken` | "Access Token" (under "Access Token and Secret", user-context) | Identifies the acting account |
  | `auth.accessTokenSecret` | "Access Token Secret" | Signing every request |

  All four are required for v1 — read commands, write commands, and engagement commands all
  need OAuth 1.0a User Context (X API v2 does not offer an app-only/bearer-only path for
  posting, liking, reposting, or following). There is no separate "bearer token" field in v1;
  a bearer-only mode would only cover reads and would need a second code path for zero
  benefit, so it's deliberately not included.

- **How `finch auth` sets them, step by step:**
  1. Operator runs `finch auth` interactively on his own machine.
  2. It prompts for the four fields one at a time, masked (no echo), no default values pulled
     from anywhere.
  3. On entry, it makes one live validation call through the official X TypeScript SDK
     (`@xdevplatform/xdk`'s `client.users.getMe()`, constructed with an `OAuth1` instance from
     the four entered fields — see Tech Stack / API above) before writing anything to disk — a
     typo'd key fails loudly with exit code 3, not a silently-broken config file.
  4. Only on successful validation does it write `~/.finch/config` at `0600` and print
     `{configured: true, username: "..."}` (human mode: a one-line confirmation).
  5. Re-running `finch auth` overwrites all four fields (full re-entry, no partial update —
     partial credential updates are handled via `finch config set`, which explicitly refuses
     to touch the four `auth.*` fields; see below).
- **Env var override (for CI/ephemeral machines only, still set locally by whoever controls
  that machine — never through Finch/chat/an agent):** `FINCH_API_KEY`,
  `FINCH_API_KEY_SECRET`, `FINCH_ACCESS_TOKEN`, `FINCH_ACCESS_TOKEN_SECRET`. These take
  precedence over the config file when present, matching the CLI-flags > env > config
  precedence pattern borrowed from `bird`. There is no CLI-flag form for the secret values
  themselves in v1 (only env or the interactive prompt) — deliberately, to keep keys out of
  shell history and process listings.
- **Never logged / never echoed:** `finch config get auth.*` refuses to print these fields in
  full (masks all but the last 4 characters); no Finch code path writes them to stdout,
  stderr, log files, or error `detail` objects — an X API 401 surfaces the API's error body
  with credentials redacted, not the key that failed.

## Inspiration mapping

**bird** (https://github.com/jawond/bird) — cookie-based, human-first X CLI. Borrowed:
- Verb-first subcommands (`tweet`, `reply`, `read`, `search`) → Finch uses the same shape
  (`post`, `reply`, `search`, …).
- `--json` flag on every read command → Finch makes this **universal** (every command, not
  just reads) since agents need machine output from writes/engagement too.
- Config file with clear precedence (CLI flags > env > project > global) → Finch adopts the
  same precedence for `~/.finch/config`, minus the project-file layer (no per-repo config
  needed for a personal-account tool).
- `whoami` / `check` diagnostic commands → Finch keeps both as `finch whoami` and
  `finch auth status`.
- Explicitly NOT borrowed: cookie/browser-profile credential extraction (Chrome/Firefox
  cookie DB reads). Finch is BYOK-official-API only — no ToS gray area, no keychain prompts.

**usesocial.dev** (https://usesocial.dev/#x) — hosted, SaaS-key X integration. Its X command
surface, and how it maps to Finch v1 (brief locks the scope; DMs and the local-mirror/`sql`
features are explicitly out of v1):

| usesocial.dev command | Finch v1 equivalent | In scope? |
|---|---|---|
| `post` | `finch post` | yes |
| `repost` / `unrepost` | `finch repost` / `finch unrepost` | yes |
| `like` / `unlike` | `finch like` / `finch unlike` | yes |
| `tweet` (fetch single post) | `finch show` | yes |
| `tweets` (user's recent posts) | `finch user-posts` | yes |
| `profile` | `finch user` | yes |
| `followers` / `following` | — | **out of v1** (not in brief's locked scope; candidate backlog item) |
| `follow` / `unfollow` | `finch follow` / `finch unfollow` | yes |
| `bookmark` / `unbookmark` | — | **out of v1** (not in brief) |
| `message` (DM) | — | **explicitly out of v1** per brief |
| `sync` / `sql` (local mirror) | — | **out of v1** (SaaS-specific local-cache feature, no equivalent need for a BYOK CLI) |
| account/billing management | `finch auth` / `finch config` | yes, BYOK-shaped not billing-shaped |

**CEO-confirmed addition to v1 scope:** `finch show <id-or-url>` (fetch one post by id) was
flagged as an open question and is now locked into v1 — `reply` already needs to resolve a
tweet-id-or-URL argument, and `GET /2/tweets/:id` is a near-zero-cost addition on top of that.
See the Read table below and M1 in the milestones.

## v1 command spec

Conventions used throughout:
- Every command accepts `--json`. Default (no `--json`, TTY) is a human-readable table/text;
  `--json` (or non-TTY stdout) emits one JSON object to stdout and nothing else — no banners,
  no color codes, so it's pipeable.
- Success JSON envelope: `{"ok": true, "data": <endpoint-shaped-result>}`.
- Error JSON envelope: `{"ok": false, "error": {"code": <string>, "message": <string>,
  "detail": <api-error-body-or-null>}}` — printed to stdout (not stderr) when `--json` is set,
  so agents parsing stdout always get one well-formed object regardless of success/failure.
  Human mode prints errors to stderr.
- Tweet/user arguments accept either a bare ID or a full URL (`https://x.com/user/status/123`
  or `https://twitter.com/...`); Finch extracts the ID the same way `bird` does
  (`extractTweetId`-style helper).
- `-n <count>` bounds list-returning commands; default 10, capped by an API-tier-aware max
  (documented per command — X API v2 hard-caps most list endpoints at 100/page).
- Every "X API v2 call" cell below is called through the official SDK (`@xdevplatform/xdk`),
  never raw HTTP — the endpoint path shown is what the SDK call maps to over the wire, not a
  hand-rolled request. Per Tech Stack / API above, the exact typed SDK method name for each
  non-users endpoint (posts, likes, retweets, follows, search, timelines) is confirmed by
  whoever implements that command against the SDK's live reference, not guessed here.

### Exit codes (shared across every command)

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Unexpected/internal error |
| 2 | Usage error (bad flags/args, missing required argument) |
| 3 | Auth error (`~/.finch/config` missing, unreadable, or X rejected the credentials) |
| 4 | X API client error (4xx other than auth/rate-limit — not found, forbidden, duplicate, etc.) |
| 5 | Rate limited (429 from X, or Finch's own tier-limit pre-check) |
| 6 | Network/timeout error reaching X |

### Auth / config

| Command | Behavior | X API v2 call | JSON `data` shape | Notes |
|---|---|---|---|---|
| `finch auth` | Interactive wizard: prompts for the 4 OAuth1.0a credentials, validates them with a live call, writes `~/.finch/config` at `0600` | SDK `client.users.getMe()` (validation only) | `{configured: true, username: string}` | Never accepts keys as bare CLI args in v1 (avoids shell-history leakage) — reads from prompts or `FINCH_*` env vars only |
| `finch auth status` | Reports whether config exists/is valid, without a wizard | SDK `client.users.getMe()` | `{configured: bool, valid: bool, username: string \| null}` | Used by `regr·haiku` checklist item 6 |
| `finch config get <key>` | Print one config value (never prints secret fields in plaintext — masks all but last 4 chars) | — | `{key: string, value: string}` | |
| `finch config set <key> <value>` | Set one non-secret config value (e.g. `defaults.count`) | — | `{key: string, value: string}` | Secret fields only settable via `finch auth` |
| `finch config path` | Print `~/.finch/config`'s resolved path | — | `{path: string}` | |
| `finch whoami` | Alias for the identity half of `auth status` — quick "who am I" | SDK `client.users.getMe()` | `{id: string, username: string, name: string}` | Matches `bird whoami` UX |

### Write

| Command | Behavior | X API v2 call | JSON `data` shape |
|---|---|---|---|
| `finch post "<text>"` | Create a top-level post. Text via arg or `--file <path>`/stdin if arg omitted | `POST /2/tweets` `{text}` | `{id: string, text: string}` |
| `finch reply <id-or-url> "<text>"` | Reply to an existing post | `POST /2/tweets` `{text, reply: {in_reply_to_tweet_id}}` | `{id: string, text: string, in_reply_to: string}` |
| `finch thread "<text1>" "<text2>" ...` (repeatable arg, or `--file` with one tweet per line) | Post a chain: first call is `post`, each subsequent is a `reply` to the previous response's id | `POST /2/tweets` × N, chained | `{ids: string[], count: number}` — if any call after the first fails, returns what succeeded plus the failure so the caller can decide whether to retry-from-N (no auto-rollback; X has no thread-delete-cascade) |

### Read

| Command | Behavior | X API v2 call | JSON `data` shape |
|---|---|---|---|
| `finch timeline [-n]` | The authenticated user's home reverse-chronological timeline | `GET /2/users/:id/timelines/reverse_chronological` | `{posts: [{id, text, author_id, created_at}]}` |
| `finch search "<query>" [-n]` | Recent search (X API v2 free/basic tiers only cover ~7 days) | `GET /2/tweets/search/recent` | `{posts: [...]}` — same post shape as timeline |
| `finch user-posts <username> [-n]` | A given user's recent posts | `GET /2/users/by/username/:username` (resolve id) then `GET /2/users/:id/tweets` | `{posts: [...]}` |
| `finch user <username>` | Profile lookup | `GET /2/users/by/username/:username` | `{id, username, name, description, public_metrics}` |
| `finch show <id-or-url>` | Fetch one post by id | `GET /2/tweets/:id` | `{id, text, author_id, created_at}` |

**Tier-limit handling (brief calls this out as the expensive/limited part):** every read
command pre-flight-checks the X API's returned rate-limit headers
(`x-rate-limit-remaining`/`-reset`) and, on a 429, returns exit code 5 with
`{code: "RATE_LIMITED", detail: {resetAt: <iso8601>}}` rather than retrying silently — an
agent caller needs to know to back off, not have Finch mask it with a hidden sleep/retry.

### Engage

| Command | Behavior | X API v2 call | JSON `data` shape |
|---|---|---|---|
| `finch like <id-or-url>` | Like a post | `POST /2/users/:id/likes` | `{liked: true, tweet_id: string}` |
| `finch unlike <id-or-url>` | Undo a like | `DELETE /2/users/:id/likes/:tweet_id` | `{liked: false, tweet_id: string}` |
| `finch repost <id-or-url>` | Repost | `POST /2/users/:id/retweets` | `{reposted: true, tweet_id: string}` |
| `finch unrepost <id-or-url>` | Undo a repost | `DELETE /2/users/:id/retweets/:source_tweet_id` | `{reposted: false, tweet_id: string}` |
| `finch follow <username>` | Follow a user | `POST /2/users/:id/following` | `{following: true, username: string}` |
| `finch unfollow <username>` | Unfollow a user | `DELETE /2/users/:source_id/following/:target_id` | `{following: false, username: string}` |

DMs are explicitly out of v1 per the brief.

## MCP server surface

One bundled server (`finch mcp` starts it, stdio transport for local agent harnesses),
wrapping the exact same core functions as the CLI — no re-implementation, no shelling out to
the CLI binary from the MCP process. Tool list (name → maps to command):

| MCP tool | Maps to |
|---|---|
| `post_tweet` | `finch post` |
| `reply_tweet` | `finch reply` |
| `post_thread` | `finch thread` |
| `get_timeline` | `finch timeline` |
| `search_tweets` | `finch search` |
| `get_user_posts` | `finch user-posts` |
| `get_user_profile` | `finch user` |
| `get_tweet` | `finch show` |
| `like_tweet` / `unlike_tweet` | `finch like` / `finch unlike` |
| `repost_tweet` / `unrepost_tweet` | `finch repost` / `finch unrepost` |
| `follow_user` / `unfollow_user` | `finch follow` / `finch unfollow` |
| `whoami` | `finch whoami` |

Each tool's input schema mirrors the command's flags; each tool's output is the same `data`
shape from the table above (no `--json`-vs-table branching inside MCP — it's JSON-only by
construction). Errors surface as MCP tool errors carrying the same `{code, message, detail}`
shape rather than being swallowed into a generic failure string.

## Agent-interface hardening (from the "building for agents" reference — CEO-confirmed)

The brief's referenced "building for agents" doc is **confirmed** by the CEO to be
https://justin.poehnelt.com/posts/rewrite-your-cli-for-ai-agents/ (found open in a browser
tab while reporting this plan up). Its guidance below is now **locked v1 scope**, not a
recommendation. It also validates two choices already made above (env-var credential
injection over a browser-redirect OAuth flow; a bundled MCP surface alongside the CLI):

- **`--dry-run` on every mutating command** (`post`, `reply`, `thread`, `like`, `unlike`,
  `repost`, `unrepost`, `follow`, `unfollow`) — validates args and prints what would be sent
  (`{ok: true, data: {dryRun: true, wouldSend: {...}}}`) without calling the X API. Cheap to
  add now (one flag check before the transport call in each core function); expensive to
  retrofit once agents depend on the commands' side-effecting behavior.
- **`finch schema` / `--describe`** — a runtime-introspectable command listing every command's
  name, flags, X API endpoint, and JSON output shape as a single JSON document (effectively
  this plan's command-spec table, machine-readable). Lets an agent harness discover Finch's
  full surface without parsing `--help` text or hardcoding it.
- **Input validation on every id/URL/text argument** — reject control characters (below ASCII
  0x20) in post text and reject a tweet-id argument that's actually a URL with unexpected query
  params, before it reaches the API. Applies the article's "assume inputs can be adversarial
  even from agents" principle to the `extractTweetId`-style helper already planned above.
  Also a hedge against unsanitized text (Finch is CLI-only, no file-path args to sandbox in
  v1's write commands, so path-traversal hardening doesn't apply beyond the config file itself).
- **Prompt-injection awareness on read output** — `timeline`/`search`/`user-posts`/`show`
  return other users' raw tweet text verbatim; that text is untrusted input to whatever agent
  consumes Finch's JSON. Finch's job is to pass it through faithfully (not silently sanitize
  someone's tweet), but this is worth one line in Finch's own docs/skill file so agents built
  on Finch know to treat tweet `text` fields as untrusted data, not instructions.
- **A bundled skill/context file** (the article's "ship skill files with YAML-frontmatter
  Markdown") — ship a `SKILL.md`-shaped file describing Finch's JSON contract, exit codes, and
  the untrusted-tweet-text note above, installable alongside the binary, so an agent harness
  onboarding Finch gets the invariants that don't fit in `--help`.

These are additions to, not replacements for, the v1 command spec above — `finch schema` is
now part of M1 and `--dry-run` is now part of M2 (see milestones below); the rest are
documentation/validation hardening threaded through existing milestones.

## Distribution: Bun single binary + Homebrew

1. **Build**: `bun build --compile ./src/index.ts --outfile finch` per target
   (`--target=bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`, `bun-linux-arm64`) — no
   Node/Bun runtime needed on the end-user machine.
2. **CI (GitHub Actions)**: on a version tag push, build all four targets, sha256-checksum
   each, attach as GitHub Release assets.
3. **Homebrew tap**: a separate `kellykampen/homebrew-finch` tap repo with a formula that
   downloads the release asset matching `Hardware::CPU.arch`/`OS.mac?`/`OS.linux?` and
   installs the binary directly (no `bun install`/source build needed for end users — that
   path is reserved for contributors). Formula version bump is a small script run per release.
4. `brew install kellykampen/finch/finch` is the target UX; `brew tap` once, then normal
   upgrades via `brew upgrade`.

## `~/.finch/config` full schema

The complete file shape (the "Setup / Auth" section above is the canonical reference for the
`auth.*` fields specifically — path, permissions, exact field list, and the manual-entry
process; this is the schema in full, including the non-auth fields):

```json
{
  "auth": {
    "apiKey": "string",
    "apiKeySecret": "string",
    "accessToken": "string",
    "accessTokenSecret": "string"
  },
  "transport": "byok",
  "defaults": {
    "json": false,
    "count": 10
  }
}
```

- `transport` — `"byok"` in v1 (only valid value). Phase 2 adds `"proxy"` plus a `proxy: {url,
  token}` block; `ByokTransport`/`ProxyTransport` selection reads this field (or a `--proxy`
  flag override) — see seam below.
- `defaults.*` — non-secret UX defaults, editable via `finch config set`.

## Phase-2 seam: the `--proxy` transport abstraction

Design now, build nothing: every core command function takes an `XTransport` instance with
one method per capability (`createTweet`, `deleteTweet`, `like`, `unlike`, `retweet`,
`unretweet`, `follow`, `unfollow`, `searchRecent`, `userTweets`, `homeTimeline`, `getUser`,
`getMe`, `getTweet`). v1 ships exactly one implementation, `ByokTransport`, which constructs
an `@xdevplatform/xdk` `Client` from `config.auth` (via an `OAuth1` instance) and calls the SDK
directly with the user's own OAuth 1.0a keys — the SDK is wholly internal to this one class.

Phase 2 adds `ProxyTransport`, same `XTransport` interface, which instead calls a hosted Finch
gateway (the CEO's X keys, pooled/rate-limited server-side, billing gate) — selected via
`config.transport === "proxy"` or a `--proxy` flag, with no changes to command handlers, MCP
tool code, or the JSON output contracts above. Whether `ProxyTransport` itself wraps the SDK
(pointed at Finch's gateway as a custom base URL, if the SDK supports one) or calls the
gateway's own HTTP API directly is a phase-2 implementation detail to confirm against the
SDK's config options when phase 2 is designed — not decided now. This is the whole point of
the seam either way: adding phase 2 is "write `ProxyTransport`, wire the selector," not
"rewrite the CLI."

Backend/billing stack for the phase-2 gateway is explicitly **not decided here** per the
brief (Convex+Stripe vs. Vercel+Stripe — the fleet already knows Convex+Stripe, which is a
point in its favor, but this is a phase-2 decision to make when phase 2 is greenlit, not now).

## Phased milestones

- **M0 — done.** Repo skeleton (this commit's ancestor: `chore: bootstrap Finch repo
  skeleton`).
- **M1 — Core + read-only BYOK.** `bun init` proper project (tsconfig, biome/lint, `bun test`
  wiring), add the `@xdevplatform/xdk` dependency, `~/.finch/config` schema + `finch
  auth`/`auth status`/`config *`/`whoami` (built on the SDK's `OAuth1` + `client.users.getMe()`,
  not hand-rolled signing), `XTransport` interface + `ByokTransport`, read commands (`timeline`, `search`,
  `user-posts`, `user`, `show`), universal `--json` + exit-code plumbing, `finch schema`
  introspection command, input validation on id/URL/text arguments, regression checklist
  items 1-7 passable.
- **M2 — Write & engage.** `post`/`reply`/`thread`, `like`/`unlike`, `repost`/`unrepost`,
  `follow`/`unfollow`, `--dry-run` on every mutating command. Regression checklist item 8
  passable for every command.
- **M3 — MCP server.** Bundle the MCP surface wrapping M1+M2 core functions; regression
  checklist item 9 passable.
- **M4 — Distribution.** Multi-target `bun build --compile`, GH Actions release pipeline,
  Homebrew tap + formula, README install instructions.
- **M5 — Hardening.** Rate-limit/tier-limit graceful handling end-to-end, full regression
  checklist automated under `regr·haiku`, docs pass.
- **Phase 2 (design-only, not scheduled).** `ProxyTransport` + hosted gateway + billing —
  blocked on a backend/billing stack decision and the CEO's proxy-key infra.

## Resolved decisions (previously open questions — all 4 answered by the CEO)

1. **"Building for agents" reference doc** — **CONFIRMED**:
   https://justin.poehnelt.com/posts/rewrite-your-cli-for-ai-agents/. Its guidance is locked
   into the "Agent-interface hardening" section above and into M1/M2.
2. **`finch show <id>`** — **CONFIRMED added to v1 scope.** Now a normal row in the Read
   command table and part of M1, no longer flagged.
3. **Linear team/project** — **CONFIRMED: not yet.** No `FIN` team created. This doc
   (`docs/PLAN.md`) remains the tracking source of record for milestones until the CEO
   decides to stand up a Linear team.
4. **OAuth model** — **CONFIRMED: OAuth 1.0a** (4 static keys), as already specified in
   "Setup / Auth" above. No browser-redirect flow in v1. Implemented via the official X
   TypeScript SDK's `OAuth1` class (see Tech Stack / API), not hand-rolled request signing.

**Build-greenlight: received (low-priority, M1 in progress).** See Tech Stack / API above for
the SDK-adoption decision the CEO added on plan review before implementation began.
