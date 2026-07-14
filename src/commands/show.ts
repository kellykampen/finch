import { resolveOAuth2Transport, type XTransport, type FinchTweet } from "../core/transport";
import { FinchError } from "../core/errors";
import { extractTweetId } from "../core/ids";
import { parseArgs } from "../core/args";

export interface ShowDeps {
  getTransport?: () => XTransport;
}

/** `finch show <id-or-url>`: fetch one post by id. */
export async function runShow(argv: string[], deps: ShowDeps = {}): Promise<{ data: FinchTweet; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const { positionals } = parseArgs(argv, { rejectUnknownFlags: true });
  const idOrUrl = positionals[0];
  if (!idOrUrl) {
    throw new FinchError("USAGE_ERROR", "finch show requires <id-or-url>");
  }
  const id = extractTweetId(idOrUrl);

  const transport = getTransport();
  const tweet = await transport.getTweet(id);

  return { data: tweet, human: `${tweet.id}  ${tweet.text}` };
}
