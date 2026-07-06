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

  throw new FinchError("USAGE_ERROR", `Unknown command: ${args.join(" ") || "(none)"}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const jsonMode = argv.includes("--json") || !process.stdout.isTTY;
  const args = argv.filter((a) => a !== "--json");

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
