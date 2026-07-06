#!/usr/bin/env bun
import { FinchError, exitCodeForError } from "./core/errors";
import { runAuth, runAuthStatus } from "./commands/auth";
import { runWhoami } from "./commands/whoami";
import { runPost } from "./commands/post";
import { runReply } from "./commands/reply";
import { runThread } from "./commands/thread";
import { runTimeline } from "./commands/timeline";
import { runSearch } from "./commands/search";
import { runUserPosts } from "./commands/user-posts";
import { runUser } from "./commands/user";
import { runShow } from "./commands/show";
import { runLike } from "./commands/like";
import { runUnlike } from "./commands/unlike";
import { runRepost } from "./commands/repost";
import { runUnrepost } from "./commands/unrepost";
import { runFollow } from "./commands/follow";
import { runUnfollow } from "./commands/unfollow";
import { runConfigGet, runConfigSet, runConfigPath } from "./commands/config";
import { runSchema } from "./commands/schema";
import { runMcp } from "./mcp/server";

async function dispatch(args: string[]): Promise<{ data: unknown; human: string }> {
  const [cmd, sub] = args;

  if (cmd === "auth" && sub === "status") {
    return runAuthStatus();
  }
  if (cmd === "auth") {
    return runAuth();
  }
  if (cmd === "whoami") {
    return runWhoami();
  }
  if (cmd === "post") {
    return runPost(args.slice(1));
  }
  if (cmd === "reply") {
    return runReply(args.slice(1));
  }
  if (cmd === "thread") {
    return runThread(args.slice(1));
  }
  if (cmd === "timeline") {
    return runTimeline(args.slice(1));
  }
  if (cmd === "search") {
    return runSearch(args.slice(1));
  }
  if (cmd === "user-posts") {
    return runUserPosts(args.slice(1));
  }
  if (cmd === "user") {
    return runUser(args.slice(1));
  }
  if (cmd === "show") {
    return runShow(args.slice(1));
  }
  if (cmd === "like") {
    return runLike(args.slice(1));
  }
  if (cmd === "unlike") {
    return runUnlike(args.slice(1));
  }
  if (cmd === "repost") {
    return runRepost(args.slice(1));
  }
  if (cmd === "unrepost") {
    return runUnrepost(args.slice(1));
  }
  if (cmd === "follow") {
    return runFollow(args.slice(1));
  }
  if (cmd === "unfollow") {
    return runUnfollow(args.slice(1));
  }
  if (cmd === "config" && sub === "get") {
    return runConfigGet(args.slice(2));
  }
  if (cmd === "config" && sub === "set") {
    return runConfigSet(args.slice(2));
  }
  if (cmd === "config" && sub === "path") {
    return runConfigPath(args.slice(2));
  }
  if (cmd === "schema") {
    return runSchema();
  }

  throw new FinchError("USAGE_ERROR", `Unknown command: ${args.join(" ") || "(none)"}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // `finch mcp` starts a long-lived stdio server instead of the normal
  // dispatch-one-command-and-exit flow — it never reaches the JSON/exit-code
  // envelope below, since MCP has its own JSON-RPC framing over the same
  // stdio streams.
  if (argv[0] === "mcp") {
    await runMcp();
    return;
  }

  const jsonMode = argv.includes("--json") || !process.stdout.isTTY;
  // `--describe` is a global-flag alias for `finch schema` (PLAN.md's
  // agent-hardening section mentions both forms) — checked ahead of normal
  // dispatch so it works regardless of what other command/args precede it.
  // Only looks for it *before* a `--` terminator: everything after `--` is
  // caller-supplied free text (an MCP tool's post/reply text, a search
  // query, ...) that must be taken literally, per the same terminator
  // convention parseArgs enforces for every command — otherwise a literal
  // positional value that happens to equal "--describe" would be hijacked
  // into printing the schema instead of being passed through.
  const terminatorIndex = argv.indexOf("--");
  const globalFlags = terminatorIndex === -1 ? argv : argv.slice(0, terminatorIndex);
  const args = globalFlags.includes("--describe")
    ? ["schema"]
    : argv.filter((a) => a !== "--json");

  try {
    const { data, human } = await dispatch(args);
    if (jsonMode) {
      console.log(JSON.stringify({ ok: true, data }));
    } else {
      console.log(human);
    }
    process.exit(0);
  } catch (err) {
    const finchError =
      err instanceof FinchError
        ? err
        : new FinchError("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));

    if (jsonMode) {
      console.log(
        JSON.stringify({
          ok: false,
          error: { code: finchError.code, message: finchError.message, detail: finchError.detail },
        }),
      );
    } else {
      console.error(`Error: ${finchError.message}`);
    }
    process.exit(exitCodeForError(finchError.code));
  }
}

main();
