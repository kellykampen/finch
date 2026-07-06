import { resolveAuthConfig, type FinchAuthConfig } from "../core/config";
import { createByokTransport, type XTransport } from "../core/transport";
import { FinchError } from "../core/errors";
import { validatePostText } from "../core/validation";
import { extractTweetId } from "../core/ids";
import { parseArgs } from "../core/args";

export interface ReplyResult {
  id: string;
  text: string;
  in_reply_to: string;
}

export interface ReplyDryRunResult {
  dryRun: true;
  wouldSend: { text: string; reply: { in_reply_to_tweet_id: string } };
}

export interface ReplyDeps {
  resolveAuth?: () => FinchAuthConfig | null;
  transportFactory?: (auth: FinchAuthConfig) => XTransport;
}

/** `finch reply <id-or-url> "<text>"`: replies to an existing post. */
export async function runReply(
  argv: string[],
  deps: ReplyDeps = {},
): Promise<{ data: ReplyResult | ReplyDryRunResult; human: string }> {
  const resolveAuth = deps.resolveAuth ?? resolveAuthConfig;
  const transportFactory = deps.transportFactory ?? createByokTransport;

  const { bools, positionals } = parseArgs(argv, { boolFlags: ["--dry-run"] });
  const [idOrUrl, text] = positionals;
  if (!idOrUrl) {
    throw new FinchError("USAGE_ERROR", "finch reply requires <id-or-url> and <text>");
  }
  if (text === undefined) {
    throw new FinchError("USAGE_ERROR", "finch reply requires <text>");
  }
  validatePostText(text);
  const replyToId = extractTweetId(idOrUrl);

  if (bools["--dry-run"]) {
    return {
      data: { dryRun: true, wouldSend: { text, reply: { in_reply_to_tweet_id: replyToId } } },
      human: `Would reply to ${replyToId}: ${text}`,
    };
  }

  const auth = resolveAuth();
  if (!auth) {
    throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
  }

  const transport = transportFactory(auth);
  const created = await transport.createTweet(text, replyToId);
  return {
    data: { id: created.id, text: created.text, in_reply_to: replyToId },
    human: `Replied: ${created.id}`,
  };
}
