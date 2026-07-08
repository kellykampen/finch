import { resolveOAuth2Transport, type XTransport } from "../core/transport";
import { FinchError } from "../core/errors";
import { extractTweetId } from "../core/ids";
import { parseArgs } from "../core/args";

export interface DeleteResult {
  deleted: true;
  tweet_id: string;
}

export interface DeleteDryRunResult {
  dryRun: true;
  wouldSend: { tweet_id: string };
}

export interface DeleteDeps {
  getTransport?: () => XTransport;
}

/** `finch delete <id-or-url>`: delete a post. */
export async function runDelete(
  argv: string[],
  deps: DeleteDeps = {},
): Promise<{ data: DeleteResult | DeleteDryRunResult; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const { bools, positionals } = parseArgs(argv, { boolFlags: ["--dry-run"] });
  const idOrUrl = positionals[0];
  if (!idOrUrl) {
    throw new FinchError("USAGE_ERROR", "finch delete requires <id-or-url>");
  }
  const tweetId = extractTweetId(idOrUrl);

  if (bools["--dry-run"]) {
    return {
      data: { dryRun: true, wouldSend: { tweet_id: tweetId } },
      human: `Would delete ${tweetId}`,
    };
  }

  const transport = getTransport();
  await transport.deleteTweet(tweetId);
  return { data: { deleted: true, tweet_id: tweetId }, human: `Deleted ${tweetId}` };
}
