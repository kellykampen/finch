import { resolveOAuth2Transport, type XTransport } from "../core/transport";
import { FinchError } from "../core/errors";
import { extractTweetId } from "../core/ids";
import { parseArgs } from "../core/args";

export interface RepostResult {
  reposted: true;
  tweet_id: string;
}

export interface RepostDryRunResult {
  dryRun: true;
  wouldSend: { tweet_id: string };
}

export interface RepostDeps {
  getTransport?: () => XTransport;
}

/** `finch repost <id-or-url>`: reposts a post. */
export async function runRepost(
  argv: string[],
  deps: RepostDeps = {},
): Promise<{ data: RepostResult | RepostDryRunResult; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const { bools, positionals } = parseArgs(argv, { boolFlags: ["--dry-run"] });
  const idOrUrl = positionals[0];
  if (!idOrUrl) {
    throw new FinchError("USAGE_ERROR", "finch repost requires <id-or-url>");
  }
  const tweetId = extractTweetId(idOrUrl);

  if (bools["--dry-run"]) {
    return {
      data: { dryRun: true, wouldSend: { tweet_id: tweetId } },
      human: `Would repost ${tweetId}`,
    };
  }

  const transport = getTransport();
  const me = await transport.getMe();
  await transport.retweet(me.id, tweetId);
  return { data: { reposted: true, tweet_id: tweetId }, human: `Reposted ${tweetId}` };
}
