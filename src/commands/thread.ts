import { readFileSync } from "node:fs";
import { resolveOAuth2Transport, type XTransport } from "../core/transport";
import { FinchError } from "../core/errors";
import { validatePostText } from "../core/validation";
import { parseArgs } from "../core/args";

export interface ThreadResult {
  ids: string[];
  count: number;
}

export interface ThreadDryRunResult {
  dryRun: true;
  wouldSend: Array<{ text: string }>;
}

export interface ThreadDeps {
  getTransport?: () => XTransport;
}

/**
 * `finch thread "<text1>" "<text2>" ...` (repeatable arg, or `--file` with
 * one post per line): posts a chain, each reply targeting the previous
 * call's id. No auto-rollback on partial failure — X has no
 * thread-delete-cascade — so a failure partway through throws a FinchError
 * whose `detail` carries `{ids, count, failure}` for what already succeeded,
 * letting the caller decide whether to retry from the failure point.
 */
export async function runThread(
  argv: string[],
  deps: ThreadDeps = {},
): Promise<{ data: ThreadResult | ThreadDryRunResult; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const { values, bools, positionals } = parseArgs(argv, {
    valueFlags: ["--file"],
    boolFlags: ["--dry-run"],
  });

  const texts = resolveTexts(positionals, values);
  if (texts.length === 0) {
    throw new FinchError("USAGE_ERROR", "finch thread requires at least one post (positional args or --file)");
  }
  texts.forEach(validatePostText);

  if (bools["--dry-run"]) {
    return {
      data: { dryRun: true, wouldSend: texts.map((text) => ({ text })) },
      human: `Would post a thread of ${texts.length} posts`,
    };
  }

  const transport = getTransport();

  const ids: string[] = [];
  let previousId: string | undefined;
  for (const text of texts) {
    try {
      const created = await transport.createTweet(text, previousId);
      ids.push(created.id);
      previousId = created.id;
    } catch (err) {
      const finchErr =
        err instanceof FinchError
          ? err
          : new FinchError("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
      throw new FinchError(finchErr.code, finchErr.message, {
        ids,
        count: ids.length,
        failure: finchErr.detail,
      });
    }
  }

  return { data: { ids, count: ids.length }, human: `Posted a thread of ${ids.length} posts` };
}

function resolveTexts(positionals: string[], values: Record<string, string>): string[] {
  if (values["--file"] !== undefined) {
    if (positionals.length > 0) {
      throw new FinchError("USAGE_ERROR", "finch thread: positional args and --file are mutually exclusive");
    }
    return readFileSync(values["--file"], "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  return positionals;
}
