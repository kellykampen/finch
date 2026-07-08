import { readFileSync } from "node:fs";
import { resolveOAuth2Transport, type XTransport } from "../core/transport";
import { FinchError } from "../core/errors";
import { validatePostText } from "../core/validation";
import { parseArgs } from "../core/args";
import { planMediaUploads, uploadMedia } from "./post";

export interface ThreadResult {
  ids: string[];
  count: number;
}

export interface ThreadDryRunResult {
  dryRun: true;
  wouldSend: Array<{ text: string; media: string[]; alt: (string | undefined)[] }>;
}

export interface ThreadDeps {
  getTransport?: () => XTransport;
  writeStatus?: (message: string) => void;
}

interface ParsedThreadArgs {
  values: Record<string, string>;
  dryRun: boolean;
  number: boolean;
  mediaByIndex: Map<number, { media: string[]; alt: (string | undefined)[] }>;
  positionals: string[];
}

/**
 * `finch thread "<text1>" "<text2>" ...` (repeatable arg, or `--file` with
 * posts split by blank lines / paragraphs): posts a chain, each reply
 * targeting the previous call's id. No auto-rollback on partial failure —
 * X has no thread-delete-cascade — so a failure partway through throws a
 * FinchError whose `detail` carries `{ids, count, failure}` for what already
 * succeeded, letting the caller decide whether to retry from the failure point.
 *
 * Per-tweet media can be attached with `--media <n>:<path>` (repeatable), where
 * `<n>` is the 0-based index into the resolved texts array. `--alt <n>:<text>`
 * attaches alt text to the most recent `--media` at the same index.
 */
export async function runThread(
  argv: string[],
  deps: ThreadDeps = {},
): Promise<{ data: ThreadResult | ThreadDryRunResult; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;
  const writeStatus = deps.writeStatus ?? ((message: string) => console.error(message));

  const { values, dryRun, number, mediaByIndex, positionals } = parseThreadArgs(argv);
  const texts = resolveTexts(positionals, values);
  if (texts.length === 0) {
    throw new FinchError("USAGE_ERROR", "finch thread requires at least one post (positional args or --file)");
  }

  validateMediaIndices(mediaByIndex, texts.length);

  const numberedTexts = number ? texts.map((text, i) => `${i + 1}/${texts.length} ${text}`) : texts;

  numberedTexts.forEach(validatePostText);

  if (dryRun) {
    return {
      data: {
        dryRun: true,
        wouldSend: numberedTexts.map((text, i) => {
          const entry = mediaByIndex.get(i);
          return { text, media: entry?.media ?? [], alt: entry?.alt ?? [] };
        }),
      },
      human: `Would post a thread of ${numberedTexts.length} posts`,
    };
  }

  const transport = getTransport();

  const ids: string[] = [];
  let previousId: string | undefined;
  let i = 0;
  for (const text of numberedTexts) {
    try {
      const mediaEntry = mediaByIndex.get(i);
      let mediaIds: string[] | undefined;
      if (mediaEntry !== undefined) {
        const plan = planMediaUploads(mediaEntry.media);
        mediaIds = await uploadMedia(transport, plan, mediaEntry.alt, writeStatus);
      }
      const created = await transport.createTweet(text, previousId, mediaIds);
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
    i++;
  }

  return { data: { ids, count: ids.length }, human: `Posted a thread of ${ids.length} posts` };
}

function parseThreadArgs(argv: string[]): ParsedThreadArgs {
  const { values, bools, positionals } = parseArgs(argv, {
    valueFlags: ["--file", "--delimiter", "--media", "--alt"],
    boolFlags: ["--dry-run", "--number"],
  });

  return {
    values,
    dryRun: Boolean(bools["--dry-run"]),
    number: Boolean(bools["--number"]),
    mediaByIndex: collectThreadMediaWithAlt(argv),
    positionals,
  };
}

function collectThreadMediaWithAlt(argv: string[]): Map<number, { media: string[]; alt: (string | undefined)[] }> {
  const terminatorIndex = argv.indexOf("--");
  const flagRegion = terminatorIndex === -1 ? argv : argv.slice(0, terminatorIndex);
  const byIndex = new Map<number, { media: string[]; alt: (string | undefined)[] }>();
  const lastMediaIndexByTweetIndex = new Map<number, number>();

  for (let i = 0; i < flagRegion.length; i++) {
    if (flagRegion[i] === "--media") {
      const raw = flagRegion[i + 1];
      if (raw === undefined) {
        throw new FinchError("USAGE_ERROR", "Missing value for --media");
      }
      const { index, rest: path } = parseIndexedFlag(raw, "--media");
      let group = byIndex.get(index);
      if (group === undefined) {
        group = { media: [], alt: [] };
        byIndex.set(index, group);
      }
      group.media.push(path);
      group.alt.push(undefined);
      lastMediaIndexByTweetIndex.set(index, group.media.length - 1);
      i++;
      continue;
    }

    if (flagRegion[i] === "--alt") {
      const raw = flagRegion[i + 1];
      if (raw === undefined) {
        throw new FinchError("USAGE_ERROR", "Missing value for --alt");
      }
      const { index, rest: text } = parseIndexedFlag(raw, "--alt");
      const lastIndex = lastMediaIndexByTweetIndex.get(index);
      if (lastIndex !== undefined) {
        const group = byIndex.get(index);
        if (group !== undefined) {
          group.alt[lastIndex] = text;
        }
      }
      i++;
    }
  }

  return byIndex;
}

function parseIndexedFlag(raw: string, flagName: string): { index: number; rest: string } {
  const colonIndex = raw.indexOf(":");
  if (colonIndex === -1) {
    throw new FinchError("USAGE_ERROR", `Invalid ${flagName} value: ${raw} (expected <n>:<value>)`);
  }
  const indexStr = raw.slice(0, colonIndex);
  const rest = raw.slice(colonIndex + 1);
  const index = Number(indexStr);
  if (!Number.isInteger(index) || index < 0) {
    throw new FinchError("USAGE_ERROR", `Invalid ${flagName} index: ${indexStr}`);
  }
  return { index, rest };
}

function validateMediaIndices(mediaByIndex: Map<number, unknown>, textCount: number): void {
  for (const index of mediaByIndex.keys()) {
    if (index >= textCount) {
      throw new FinchError(
        "USAGE_ERROR",
        `Media index ${index} is out of range (thread has ${textCount} tweet${textCount === 1 ? "" : "s"})`,
      );
    }
  }
}

function resolveTexts(positionals: string[], values: Record<string, string>): string[] {
  if (values["--file"] !== undefined) {
    if (positionals.length > 0) {
      throw new FinchError("USAGE_ERROR", "finch thread: positional args and --file are mutually exclusive");
    }
    const raw = readFileSync(values["--file"], "utf8").replace(/\r\n/g, "\n");
    const delimiter = values["--delimiter"];
    const pieces = delimiter !== undefined ? raw.split(delimiter) : raw.split(/\n\s*\n+/);
    return pieces.map((piece) => piece.trim()).filter((piece) => piece.length > 0);
  }
  if (values["--delimiter"] !== undefined) {
    throw new FinchError("USAGE_ERROR", "finch thread: --delimiter requires --file");
  }
  return positionals;
}
