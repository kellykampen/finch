import { resolveOAuth2Transport, type XTransport } from "../core/transport";
import { FinchError } from "../core/errors";
import { extractTweetId } from "../core/ids";
import { parseArgs } from "../core/args";

export interface UnrepostResult {
  reposted: false;
  tweet_id: string;
}

export interface UnrepostDryRunResult {
  dryRun: true;
  wouldSend: { tweet_id: string };
}

export interface UnrepostDeps {
  getTransport?: () => XTransport;
}

/** `finch unrepost <id-or-url>`: undoes a repost. */
export async function runUnrepost(
  argv: string[],
  deps: UnrepostDeps = {},
): Promise<{ data: UnrepostResult | UnrepostDryRunResult; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const { bools, positionals } = parseArgs(argv, { boolFlags: ["--dry-run"] });
  const idOrUrl = positionals[0];
  if (!idOrUrl) {
    throw new FinchError("USAGE_ERROR", "finch unrepost requires <id-or-url>");
  }
  const tweetId = extractTweetId(idOrUrl);

  if (bools["--dry-run"]) {
    return {
      data: { dryRun: true, wouldSend: { tweet_id: tweetId } },
      human: `Would unrepost ${tweetId}`,
    };
  }

  const transport = getTransport();
  const me = await transport.getMe();
  await transport.unretweet(me.id, tweetId);
  return { data: { reposted: false, tweet_id: tweetId }, human: `Unreposted ${tweetId}` };
}
