import { describe, test, expect } from "bun:test";
import { createTools } from "./tools";
import { fakeTransport } from "../core/transport.fixtures";

const fakeAuth = { apiKey: "k", apiKeySecret: "ks", accessToken: "t", accessTokenSecret: "ts" };

const EXPECTED_TOOL_NAMES = [
  "post_tweet",
  "reply_tweet",
  "post_thread",
  "get_timeline",
  "search_tweets",
  "get_user_posts",
  "get_user_profile",
  "get_tweet",
  "like_tweet",
  "unlike_tweet",
  "repost_tweet",
  "unrepost_tweet",
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
    const tools = createTools({ resolveAuth: () => fakeAuth, transportFactory: () => transport });

    const result = await toolByName(tools, "post_tweet").handler({ text: "hello" });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ id: "1", text: "hello" });
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ id: "1", text: "hello" }) }]);
  });

  test("post_tweet's dryRun input flows through to the underlying command's --dry-run path", async () => {
    const tools = createTools({
      resolveAuth: () => fakeAuth,
      transportFactory: () => {
        throw new Error("should not be called");
      },
    });

    const result = await toolByName(tools, "post_tweet").handler({ text: "hello", dryRun: true });

    expect(result.structuredContent).toEqual({ dryRun: true, wouldSend: { text: "hello" } });
  });

  test("a FinchError from the wrapped command surfaces as an MCP tool error with {code, message, detail}", async () => {
    const tools = createTools({ resolveAuth: () => null });

    const result = await toolByName(tools, "post_tweet").handler({ text: "hello" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "AUTH_ERROR" });
  });

  test("like_tweet resolves the authenticated user id and reports {liked, tweet_id}", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
      like: async () => ({ liked: true }),
    });
    const tools = createTools({ resolveAuth: () => fakeAuth, transportFactory: () => transport });

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
    const tools = createTools({ resolveAuth: () => fakeAuth, transportFactory: () => transport });

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
    const tools = createTools({ resolveAuth: () => fakeAuth, transportFactory: () => transport });

    await toolByName(tools, "get_timeline").handler({ count: 5 });

    expect(capturedCount).toBe(5);
  });

  test("whoami takes no input and wraps runWhoami", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });
    const tools = createTools({ resolveAuth: () => fakeAuth, transportFactory: () => transport });

    const result = await toolByName(tools, "whoami").handler({});

    expect(result.structuredContent).toEqual({ id: "1", username: "kelly", name: "Kelly" });
  });
});
