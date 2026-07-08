export interface CommandSchemaEntry {
  name: string;
  description: string;
  flags: string[];
  positionals: string[];
  endpoint: string;
  dataShape: string;
}

// Hand-authored, not reflected off argv parsers or the SDK's types — one
// entry per command in PLAN.md's command spec, kept in sync by hand as new
// commands ship. This is deliberately static/simple (per the agent-hardening
// brief: "simplicity over cleverness") rather than derived from the CLI's
// internal dispatch, so `finch schema`/`--describe` always reflects exactly
// what's documented, never an internal implementation detail.
export const COMMAND_SCHEMAS: CommandSchemaEntry[] = [
  {
    name: "auth",
    description:
      "Interactive wizard: runs the OAuth 2.0 PKCE browser flow, validates the token with a live call, and writes ~/.finch/config at 0600.",
    flags: ["--json", "--client-id <id>"],
    positionals: [],
    endpoint: "SDK client.users.getMe() (validation only)",
    dataShape: "{ configured: true, username: string }",
  },
  {
    name: "auth status",
    description: "Reports whether config exists/is valid, without a wizard.",
    flags: ["--json"],
    positionals: [],
    endpoint: "SDK client.users.getMe()",
    dataShape: "{ configured: boolean, valid: boolean, username: string | null }",
  },
  {
    name: "whoami",
    description: "Alias for the identity half of auth status — quick 'who am I'.",
    flags: ["--json"],
    positionals: [],
    endpoint: "SDK client.users.getMe()",
    dataShape: "{ id: string, username: string, name: string }",
  },
  {
    name: "post",
    description:
      "Create a top-level post. Text via arg or --file <path>/stdin if arg omitted; attach images with --media <path> (repeatable or comma-separated, up to 4). Set per-image alt text with --alt <text> (repeatable, aligned to each image).",
    flags: ["--json", "--dry-run", "--file <path>", "--media <path>", "--alt <text>"],
    positionals: ["<text>"],
    endpoint:
      "POST /2/tweets { text, media: { media_ids } } + POST /2/media/upload per image + POST /2/media/metadata per alt text",
    dataShape: "{ id: string, text: string }",
  },
  {
    name: "reply",
    description: "Reply to an existing post.",
    flags: ["--json", "--dry-run"],
    positionals: ["<id-or-url>", "<text>"],
    endpoint: "POST /2/tweets { text, reply: { in_reply_to_tweet_id } }",
    dataShape: "{ id: string, text: string, in_reply_to: string }",
  },
  {
    name: "thread",
    description: "Post a chain: first call is post, each subsequent is a reply to the previous response's id.",
    flags: ["--json", "--dry-run", "--file <path>"],
    positionals: ["<text1>", "<text2>", "..."],
    endpoint: "POST /2/tweets x N, chained",
    dataShape: "{ ids: string[], count: number }",
  },
  {
    name: "timeline",
    description: "The authenticated user's home reverse-chronological timeline.",
    flags: ["--json", "-n <count>"],
    positionals: [],
    endpoint: "GET /2/users/:id/timelines/reverse_chronological",
    dataShape: "{ posts: [{ id, text, author_id: string | null, created_at: string | null }] }",
  },
  {
    name: "search",
    description: "Recent search (free/basic tiers only cover ~7 days).",
    flags: ["--json", "-n <count>"],
    positionals: ["<query>"],
    endpoint: "GET /2/tweets/search/recent",
    dataShape: "{ posts: [{ id, text, author_id: string | null, created_at: string | null }] }",
  },
  {
    name: "user-posts",
    description: "A given user's recent posts.",
    flags: ["--json", "-n <count>"],
    positionals: ["<username>"],
    endpoint: "GET /2/users/by/username/:username then GET /2/users/:id/tweets",
    dataShape: "{ posts: [{ id, text, author_id: string | null, created_at: string | null }] }",
  },
  {
    name: "user",
    description: "Profile lookup.",
    flags: ["--json"],
    positionals: ["<username>"],
    endpoint: "GET /2/users/by/username/:username",
    dataShape: "{ id, username, name, description, public_metrics }",
  },
  {
    name: "show",
    description: "Fetch one post by id.",
    flags: ["--json"],
    positionals: ["<id-or-url>"],
    endpoint: "GET /2/tweets/:id",
    dataShape: "{ id, text, author_id: string | null, created_at: string | null }",
  },
  {
    name: "like",
    description: "Like a post.",
    flags: ["--json", "--dry-run"],
    positionals: ["<id-or-url>"],
    endpoint: "POST /2/users/:id/likes",
    dataShape: "{ liked: true, tweet_id: string }",
  },
  {
    name: "unlike",
    description: "Undo a like.",
    flags: ["--json", "--dry-run"],
    positionals: ["<id-or-url>"],
    endpoint: "DELETE /2/users/:id/likes/:tweet_id",
    dataShape: "{ liked: false, tweet_id: string }",
  },
  {
    name: "repost",
    description: "Repost a post.",
    flags: ["--json", "--dry-run"],
    positionals: ["<id-or-url>"],
    endpoint: "POST /2/users/:id/retweets",
    dataShape: "{ reposted: true, tweet_id: string }",
  },
  {
    name: "unrepost",
    description: "Undo a repost.",
    flags: ["--json", "--dry-run"],
    positionals: ["<id-or-url>"],
    endpoint: "DELETE /2/users/:id/retweets/:source_tweet_id",
    dataShape: "{ reposted: false, tweet_id: string }",
  },
  {
    name: "follow",
    description: "Follow a user.",
    flags: ["--json", "--dry-run"],
    positionals: ["<username>"],
    endpoint: "POST /2/users/:id/following",
    dataShape: "{ following: true, username: string }",
  },
  {
    name: "unfollow",
    description: "Unfollow a user.",
    flags: ["--json", "--dry-run"],
    positionals: ["<username>"],
    endpoint: "DELETE /2/users/:source_id/following/:target_id",
    dataShape: "{ following: false, username: string }",
  },
  {
    name: "delete",
    description: "Delete a post.",
    flags: ["--json", "--dry-run"],
    positionals: ["<id-or-url>"],
    endpoint: "DELETE /2/tweets/:id",
    dataShape: "{ deleted: true, tweet_id: string }",
  },
  {
    name: "bookmark list",
    description: "Fetch the authenticated user's bookmarked posts.",
    flags: ["--json", "-n <count>", "--count <count>"],
    positionals: [],
    endpoint: "GET /2/users/:id/bookmarks",
    dataShape: "{ posts: [{ id, text, author_id, created_at }] }",
  },
  {
    name: "bookmark folders",
    description: "List the authenticated user's bookmark folders. Bookmark folders require X Premium.",
    flags: ["--json"],
    positionals: [],
    endpoint: "GET /2/users/:id/bookmarks/folders",
    dataShape: "{ folders: [{ id: string, name: string }] }",
  },
  {
    name: "bookmark add",
    description: "Bookmark a post.",
    flags: ["--json", "--dry-run"],
    positionals: ["<id-or-url>"],
    endpoint: "POST /2/users/:id/bookmarks",
    dataShape: "{ bookmarked: true, tweet_id: string }",
  },
  {
    name: "bookmark rm",
    description: "Remove a bookmark.",
    flags: ["--json", "--dry-run"],
    positionals: ["<id-or-url>"],
    endpoint: "DELETE /2/users/:id/bookmarks/:tweet_id",
    dataShape: "{ bookmarked: false, tweet_id: string }",
  },
  {
    name: "bookmark folder new",
    description: "Create a bookmark folder. Bookmark folders require X Premium.",
    flags: ["--json"],
    positionals: ["<name>"],
    endpoint: "POST /2/users/:id/bookmarks/folders",
    dataShape: "{ folder: { id: string, name: string } }",
  },
  {
    name: "config get",
    description:
      "Print one config value. Masks auth.* fields to all-but-last-4 characters, whether or not --json is set.",
    flags: ["--json"],
    positionals: ["<key>"],
    endpoint: "-",
    dataShape: "{ key: string, value: string }",
  },
  {
    name: "config set",
    description: "Set one non-secret config value (defaults.json, defaults.count). Rejects auth.* keys.",
    flags: ["--json"],
    positionals: ["<key>", "<value>"],
    endpoint: "-",
    dataShape: "{ key: string, value: string }",
  },
  {
    name: "config path",
    description: "Print ~/.finch/config's resolved path. Does not require the file to exist.",
    flags: ["--json"],
    positionals: [],
    endpoint: "-",
    dataShape: "{ path: string }",
  },
  {
    name: "schema",
    description:
      "Describe every command's name, flags, X API endpoint, and JSON data shape as a single machine-readable document. Also available as the --describe global flag.",
    flags: ["--json", "--describe"],
    positionals: [],
    endpoint: "-",
    dataShape: "{ commands: CommandSchemaEntry[] }",
  },
];

/** `finch schema` / `--describe`: a single JSON document describing every command's surface. */
export async function runSchema(): Promise<{ data: { commands: CommandSchemaEntry[] }; human: string }> {
  const data = { commands: COMMAND_SCHEMAS };
  return { data, human: JSON.stringify(data, null, 2) };
}
