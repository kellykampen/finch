import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { XTransport } from "../core/transport";
import { FinchError } from "../core/errors";
import { runPost } from "../commands/post";
import { runReply } from "../commands/reply";
import { runThread } from "../commands/thread";
import { runTimeline } from "../commands/timeline";
import { runSearch } from "../commands/search";
import { runUserPosts } from "../commands/user-posts";
import { runUser } from "../commands/user";
import { runShow } from "../commands/show";
import { runLike } from "../commands/like";
import { runUnlike } from "../commands/unlike";
import { runRepost } from "../commands/repost";
import { runUnrepost } from "../commands/unrepost";
import { runDelete } from "../commands/delete";
import { runFollow } from "../commands/follow";
import { runUnfollow } from "../commands/unfollow";
import { runWhoami } from "../commands/whoami";
import {
  runBookmarkList,
  runBookmarkAdd,
  runBookmarkRemove,
  runBookmarkFolders,
  runBookmarkFolderNew,
} from "../commands/bookmark";

export interface McpToolDeps {
  getTransport?: () => XTransport;
  /** Override for the `skills` tool's SKILL.md path — see server.ts's defaultSkillPath(). */
  skillPath?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

// Every command function already accepts a CLI-shaped `argv: string[]` (plus
// the same DI `deps` every command test uses) — bridging structured MCP tool
// input back into that argv shape reuses the exact same parseArgs/validation/
// dry-run/error path the CLI takes, rather than re-implementing any of it
// for the MCP surface.
//
// Flags are emitted first, followed by a `--` terminator, with the
// caller-supplied positionals (untrusted MCP tool input — post text, search
// query, username, id-or-URL, ...) always last. Without the terminator, a
// positional value that happens to literally equal a registered flag string
// (e.g. `post_tweet` called with `{text: "--dry-run"}`) would be
// misinterpreted by parseArgs as that flag instead of taken literally.
interface MediaEntry {
  path: string;
  alt?: string;
}

interface ThreadMediaEntry extends MediaEntry {
  tweetIndex: number;
}

function buildArgv(
  positionals: string[],
  opts: {
    count?: number;
    dryRun?: boolean;
    folderId?: string;
    media?: MediaEntry[];
    threadMedia?: ThreadMediaEntry[];
  } = {},
): string[] {
  const argv: string[] = [];
  if (opts.count !== undefined) argv.push("-n", String(opts.count));
  if (opts.dryRun) argv.push("--dry-run");
  if (opts.folderId !== undefined) argv.push("--folder", opts.folderId);
  if (opts.media) {
    for (const { path, alt } of opts.media) {
      argv.push("--media", path);
      if (alt !== undefined) argv.push("--alt", alt);
    }
  }
  if (opts.threadMedia) {
    for (const { tweetIndex, path, alt } of opts.threadMedia) {
      argv.push("--media", `${tweetIndex}:${path}`);
      if (alt !== undefined) argv.push("--alt", `${tweetIndex}:${alt}`);
    }
  }
  argv.push("--", ...positionals);
  return argv;
}

// Wraps a core command call so every tool's success/error shape is uniform:
// success mirrors the CLI's `--json` `data` field exactly (PLAN.md requires
// MCP tool output be that same shape); failure carries FinchError's
// {code, message, detail} rather than collapsing to a generic error string.
async function runTool(fn: () => Promise<{ data: unknown }>): Promise<CallToolResult> {
  try {
    const { data } = await fn();
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data as Record<string, unknown>,
    };
  } catch (err) {
    const finchError =
      err instanceof FinchError
        ? err
        : new FinchError("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
    const errorPayload = {
      code: finchError.code,
      message: finchError.message,
      detail: finchError.detail,
    };
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(errorPayload) }],
      structuredContent: errorPayload,
    };
  }
}

/** Builds the MCP tool surface — one tool per PLAN.md's MCP server table, each wrapping the same core command function the CLI dispatches to. */
export function createTools(deps: McpToolDeps = {}): ToolDefinition[] {
  return [
    {
      name: "post_tweet",
      description: "Create a top-level post (maps to `finch post`).",
      inputSchema: {
        text: z.string(),
        dryRun: z.boolean().optional(),
        media: z.array(z.object({ path: z.string(), alt: z.string().optional() })).optional(),
      },
      handler: (args) =>
        runTool(() =>
          runPost(
            buildArgv([args.text as string], {
              dryRun: args.dryRun as boolean,
              media: args.media as MediaEntry[] | undefined,
            }),
            deps,
          ),
        ),
    },
    {
      name: "reply_tweet",
      description: "Reply to an existing post (maps to `finch reply`).",
      inputSchema: { idOrUrl: z.string(), text: z.string(), dryRun: z.boolean().optional() },
      handler: (args) =>
        runTool(() =>
          runReply(buildArgv([args.idOrUrl as string, args.text as string], { dryRun: args.dryRun as boolean }), deps),
        ),
    },
    {
      name: "post_thread",
      description: "Post a chain of posts, each replying to the previous (maps to `finch thread`).",
      inputSchema: {
        texts: z.array(z.string()).min(1),
        dryRun: z.boolean().optional(),
        media: z
          .array(
            z.object({
              tweetIndex: z.number().int().nonnegative(),
              path: z.string(),
              alt: z.string().optional(),
            }),
          )
          .optional(),
      },
      handler: (args) =>
        runTool(() =>
          runThread(
            buildArgv(args.texts as string[], {
              dryRun: args.dryRun as boolean,
              threadMedia: args.media as ThreadMediaEntry[] | undefined,
            }),
            deps,
          ),
        ),
    },
    {
      name: "get_timeline",
      description: "The authenticated user's home reverse-chronological timeline (maps to `finch timeline`).",
      inputSchema: { count: z.number().int().positive().optional() },
      handler: (args) => runTool(() => runTimeline(buildArgv([], { count: args.count as number }), deps)),
    },
    {
      name: "list_bookmarks",
      description: "Fetch the authenticated user's bookmarked posts (maps to `finch bookmark list`).",
      inputSchema: {
        count: z.number().int().positive().optional(),
        folderId: z.string().optional(),
      },
      handler: (args) =>
        runTool(() =>
          runBookmarkList(
            buildArgv([], {
              count: args.count as number,
              folderId: args.folderId as string | undefined,
            }),
            deps,
          ),
        ),
    },
    {
      name: "list_bookmark_folders",
      description: "List the authenticated user's bookmark folders (maps to `finch bookmark folders`).",
      inputSchema: {},
      handler: () => runTool(() => runBookmarkFolders(buildArgv([]), deps)),
    },
    {
      name: "add_bookmark",
      description: "Bookmark a post (maps to `finch bookmark add`).",
      inputSchema: {
        idOrUrl: z.string(),
        folderId: z.string().optional(),
        dryRun: z.boolean().optional(),
      },
      handler: (args) =>
        runTool(() =>
          runBookmarkAdd(
            buildArgv([args.idOrUrl as string], {
              dryRun: args.dryRun as boolean,
              folderId: args.folderId as string | undefined,
            }),
            deps,
          ),
        ),
    },
    {
      name: "remove_bookmark",
      description: "Remove a bookmark (maps to `finch bookmark rm`).",
      inputSchema: { idOrUrl: z.string(), dryRun: z.boolean().optional() },
      handler: (args) =>
        runTool(() => runBookmarkRemove(buildArgv([args.idOrUrl as string], { dryRun: args.dryRun as boolean }), deps)),
    },
    {
      name: "create_bookmark_folder",
      description: "Create a bookmark folder (maps to `finch bookmark folder new`).",
      inputSchema: { name: z.string() },
      handler: (args) => runTool(() => runBookmarkFolderNew(buildArgv([args.name as string]), deps)),
    },
    {
      name: "search_tweets",
      description: "Recent search, ~7 days of coverage on free/basic tiers (maps to `finch search`).",
      inputSchema: { query: z.string(), count: z.number().int().positive().optional() },
      handler: (args) =>
        runTool(() => runSearch(buildArgv([args.query as string], { count: args.count as number }), deps)),
    },
    {
      name: "get_user_posts",
      description: "A given user's recent posts (maps to `finch user-posts`).",
      inputSchema: { username: z.string(), count: z.number().int().positive().optional() },
      handler: (args) =>
        runTool(() => runUserPosts(buildArgv([args.username as string], { count: args.count as number }), deps)),
    },
    {
      name: "get_user_profile",
      description: "Profile lookup by username (maps to `finch user`).",
      inputSchema: { username: z.string() },
      handler: (args) => runTool(() => runUser(buildArgv([args.username as string]), deps)),
    },
    {
      name: "get_tweet",
      description: "Fetch one post by id or URL (maps to `finch show`).",
      inputSchema: { idOrUrl: z.string() },
      handler: (args) => runTool(() => runShow(buildArgv([args.idOrUrl as string]), deps)),
    },
    {
      name: "like_tweet",
      description: "Like a post (maps to `finch like`).",
      inputSchema: { idOrUrl: z.string(), dryRun: z.boolean().optional() },
      handler: (args) =>
        runTool(() => runLike(buildArgv([args.idOrUrl as string], { dryRun: args.dryRun as boolean }), deps)),
    },
    {
      name: "unlike_tweet",
      description: "Undo a like (maps to `finch unlike`).",
      inputSchema: { idOrUrl: z.string(), dryRun: z.boolean().optional() },
      handler: (args) =>
        runTool(() => runUnlike(buildArgv([args.idOrUrl as string], { dryRun: args.dryRun as boolean }), deps)),
    },
    {
      name: "repost_tweet",
      description: "Repost a post (maps to `finch repost`).",
      inputSchema: { idOrUrl: z.string(), dryRun: z.boolean().optional() },
      handler: (args) =>
        runTool(() => runRepost(buildArgv([args.idOrUrl as string], { dryRun: args.dryRun as boolean }), deps)),
    },
    {
      name: "unrepost_tweet",
      description: "Undo a repost (maps to `finch unrepost`).",
      inputSchema: { idOrUrl: z.string(), dryRun: z.boolean().optional() },
      handler: (args) =>
        runTool(() => runUnrepost(buildArgv([args.idOrUrl as string], { dryRun: args.dryRun as boolean }), deps)),
    },
    {
      name: "delete_tweet",
      description: "Delete a post (maps to `finch delete`).",
      inputSchema: { idOrUrl: z.string(), dryRun: z.boolean().optional() },
      handler: (args) =>
        runTool(() => runDelete(buildArgv([args.idOrUrl as string], { dryRun: args.dryRun as boolean }), deps)),
    },
    {
      name: "follow_user",
      description: "Follow a user by username (maps to `finch follow`).",
      inputSchema: { username: z.string(), dryRun: z.boolean().optional() },
      handler: (args) =>
        runTool(() => runFollow(buildArgv([args.username as string], { dryRun: args.dryRun as boolean }), deps)),
    },
    {
      name: "unfollow_user",
      description: "Unfollow a user by username (maps to `finch unfollow`).",
      inputSchema: { username: z.string(), dryRun: z.boolean().optional() },
      handler: (args) =>
        runTool(() => runUnfollow(buildArgv([args.username as string], { dryRun: args.dryRun as boolean }), deps)),
    },
    {
      name: "whoami",
      description: "The authenticated user's own identity (maps to `finch whoami`).",
      inputSchema: {},
      handler: () => runTool(() => runWhoami(deps)),
    },
  ];
}
