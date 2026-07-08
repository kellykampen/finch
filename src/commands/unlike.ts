import { resolveOAuth2Transport, type XTransport } from "../core/transport";
import { FinchError } from "../core/errors";
import { extractTweetId } from "../core/ids";
import { parseArgs } from "../core/args";

export interface UnlikeResult {
  liked: false;
  tweet_id: string;
}

export interface UnlikeDryRunResult {
  dryRun: true;
  wouldSend: { tweet_id: string };
}

export interface UnlikeDeps {
  getTransport?: () => XTransport;
}

/** `finch unlike <id-or-url>`: undoes a like. */
export async function runUnlike(
  argv: string[],
  deps: UnlikeDeps = {},
): Promise<{ data: UnlikeResult | UnlikeDryRunResult; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const { bools, positionals } = parseArgs(argv, { boolFlags: ["--dry-run"] });
  const idOrUrl = positionals[0];
  if (!idOrUrl) {
    throw new FinchError("USAGE_ERROR", "finch unlike requires <id-or-url>");
  }
  const tweetId = extractTweetId(idOrUrl);

  if (bools["--dry-run"]) {
    return {
      data: { dryRun: true, wouldSend: { tweet_id: tweetId } },
      human: `Would unlike ${tweetId}`,
    };
  }

  const transport = getTransport();
  const me = await transport.getMe();
  await transport.unlike(me.id, tweetId);
  return { data: { liked: false, tweet_id: tweetId }, human: `Unliked ${tweetId}` };
}
