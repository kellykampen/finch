import { resolveOAuth2Transport, type XTransport } from "../core/transport";
import { FinchError } from "../core/errors";
import { extractTweetId } from "../core/ids";
import { parseArgs } from "../core/args";

export interface LikeResult {
  liked: true;
  tweet_id: string;
}

export interface LikeDryRunResult {
  dryRun: true;
  wouldSend: { tweet_id: string };
}

export interface LikeDeps {
  getTransport?: () => XTransport;
}

/** `finch like <id-or-url>`: likes a post. */
export async function runLike(
  argv: string[],
  deps: LikeDeps = {},
): Promise<{ data: LikeResult | LikeDryRunResult; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const { bools, positionals } = parseArgs(argv, { boolFlags: ["--dry-run"] });
  const idOrUrl = positionals[0];
  if (!idOrUrl) {
    throw new FinchError("USAGE_ERROR", "finch like requires <id-or-url>");
  }
  const tweetId = extractTweetId(idOrUrl);

  if (bools["--dry-run"]) {
    return {
      data: { dryRun: true, wouldSend: { tweet_id: tweetId } },
      human: `Would like ${tweetId}`,
    };
  }

  const transport = getTransport();
  const me = await transport.getMe();
  await transport.like(me.id, tweetId);
  return { data: { liked: true, tweet_id: tweetId }, human: `Liked ${tweetId}` };
}
