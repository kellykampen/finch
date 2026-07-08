import { describe, test, expect } from "bun:test";
import { createTools } from "./tools";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

const EXPECTED_TOOL_NAMES = [
  "post_tweet",
  "reply_tweet",
  "post_thread",
  "get_timeline",
  "list_bookmarks",
  "search_tweets",
  "get_user_posts",
  "get_user_profile",
  "get_tweet",
  "like_tweet",
  "unlike_tweet",
  "repost_tweet",
  "unrepost_tweet",
  "delete_tweet",
  "follow_user",
  "unfollow_user",
  "whoami",
];

function toolByName(tools: ReturnType<typeof createTools>, name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool registered named ${name}`);
  return tool;
}

describe("createTools", () => {
  test("registers exactly the MCP surface from PLAN.md's table", () => {
    const tools = createTools({});
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  test("post_tweet wraps runPost and returns the same data shape as the CLI --json output", async () => {
    const transport = fakeTransport({ createTweet: async (text) => ({ id: "1", text }) });
    const tools = createTools({ getTransport: () => transport });

    const result = await toolByName(tools, "post_tweet").handler({ text: "hello" });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ id: "1", text: "hello" });
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ id: "1", text: "hello" }) }]);
  });

  test("post_tweet's dryRun input flows through to the underlying command's --dry-run path", async () => {
    const tools = createTools({
      getTransport: () => {
        throw new Error("should not be called");
      },
    });

    const result = await toolByName(tools, "post_tweet").handler({ text: "hello", dryRun: true });

    expect(result.structuredContent).toEqual({ dryRun: true, wouldSend: { text: "hello" } });
  });

  test("a FinchError from the wrapped command surfaces as an MCP tool error with {code, message, detail}", async () => {
    const tools = createTools({
      getTransport: () => {
        throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
      },
    });

    const result = await toolByName(tools, "post_tweet").handler({ text: "hello" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "AUTH_ERROR" });
  });

  test("like_tweet resolves the authenticated user id and reports {liked, tweet_id}", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
      like: async () => ({ liked: true }),
    });
    const tools = createTools({ getTransport: () => transport });

    const result = await toolByName(tools, "like_tweet").handler({ idOrUrl: "999" });

    expect(result.structuredContent).toEqual({ liked: true, tweet_id: "999" });
  });

  test("follow_user resolves username to id via getUserByUsername and reports {following, username}", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
      getUserByUsername: async (username) => ({
        id: "42",
        username,
        name: "Target",
        description: "",
        public_metrics: {},
      }),
      follow: async () => ({ following: true }),
    });
    const tools = createTools({ getTransport: () => transport });

    const result = await toolByName(tools, "follow_user").handler({ username: "someuser" });

    expect(result.structuredContent).toEqual({ following: true, username: "someuser" });
  });

  test("get_timeline passes a structured count through as the -n flag", async () => {
    let capturedCount: number | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
      homeTimeline: async (_userId, maxResults) => {
        capturedCount = maxResults;
        return [];
      },
    });
    const tools = createTools({ getTransport: () => transport });

    await toolByName(tools, "get_timeline").handler({ count: 5 });

    expect(capturedCount).toBe(5);
  });

  test("post_tweet sends a text value that literally equals '--dry-run' as real text, not the flag", async () => {
    const transport = fakeTransport({ createTweet: async (text) => ({ id: "1", text }) });
    const tools = createTools({ getTransport: () => transport });

    const result = await toolByName(tools, "post_tweet").handler({ text: "--dry-run" });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ id: "1", text: "--dry-run" });
  });

  test("post_thread sends a text value that literally equals '--file' as a real thread post, not the flag", async () => {
    const ids: string[] = [];
    const transport = fakeTransport({
      createTweet: async (text) => {
        const id = String(ids.length + 1);
        ids.push(id);
        return { id, text };
      },
    });
    const tools = createTools({ getTransport: () => transport });

    const result = await toolByName(tools, "post_thread").handler({ texts: ["--file", "second post"] });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ ids: ["1", "2"], count: 2 });
  });

  test("like_tweet sends an idOrUrl value that literally equals '--dry-run' as a real id, not the flag", async () => {
    let capturedTweetId: string | undefined;
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
      like: async (_userId, tweetId) => {
        capturedTweetId = tweetId;
        return { liked: true };
      },
    });
    const tools = createTools({ getTransport: () => transport });

    // "--dry-run" isn't a valid tweet id/URL, so a correctly-positional
    // "--dry-run" must fail extractTweetId's own validation (a distinct
    // message) rather than being silently swallowed as the --dry-run flag —
    // which would instead short-circuit to a `{dryRun: true, ...}` success
    // result without ever reaching extractTweetId or the transport.
    const result = await toolByName(tools, "like_tweet").handler({ idOrUrl: "--dry-run" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "USAGE_ERROR",
      message: "Not a valid post ID or URL: --dry-run",
    });
    expect(capturedTweetId).toBeUndefined();
  });

  test("whoami takes no input and wraps runWhoami", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });
    const tools = createTools({ getTransport: () => transport });

    const result = await toolByName(tools, "whoami").handler({});

    expect(result.structuredContent).toEqual({ id: "1", username: "kelly", name: "Kelly" });
  });
});
