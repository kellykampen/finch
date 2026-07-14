import { readFileSync } from "node:fs";
import { resolveOAuth2Transport, type XTransport } from "../core/transport";
import { FinchError } from "../core/errors";
import { validatePostText } from "../core/validation";
import { extractTweetId } from "../core/ids";
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

export interface ThreadHelpResult {
  help: true;
  text: string;
}

export interface ThreadDeps {
  getTransport?: () => XTransport;
  writeStatus?: (message: string) => void;
}

const THREAD_USAGE = `Usage: finch thread [flags] [<text1> <text2> ...]

Flags:
  --dry-run            Validate and show what would be posted without calling the X API
  --file <path>        Read posts from a file, split on blank lines (or --delimiter)
  --delimiter <str>     Split --file content on this literal string instead of blank lines
  --continue <id|url>  Reply to an existing post/thread instead of starting a new one
  --number             Prefix each post with "i/n "
  --media <n>:<path>   Attach media to the tweet at index n (0-based); repeatable
  --alt <n>:<text>     Alt text for the preceding --media at index n
  --help, -h           Show this help message

Text may be supplied as repeated positional arguments or via --file.
Use -- before the text to pass literal values starting with "-", e.g.
  finch thread -- "-1 isn't a bad take" "-2 another one"`;

interface ParsedThreadArgs {
  values: Record<string, string>;
  help: boolean;
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
 *
 * `--help`/`-h` prints usage and exits without touching the transport/auth
 * layer. Unknown flags before a `--` terminator are rejected rather than
 * posted as thread text; put a `--` before any literal text that begins
 * with `-`.
 */
export async function runThread(
  argv: string[],
  deps: ThreadDeps = {},
): Promise<{ data: ThreadResult | ThreadDryRunResult | ThreadHelpResult; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;
  const writeStatus = deps.writeStatus ?? ((message: string) => console.error(message));

  const { values, help, dryRun, number, mediaByIndex, positionals } = parseThreadArgs(argv);

  if (help) {
    return { data: { help: true, text: THREAD_USAGE }, human: THREAD_USAGE };
  }

  const texts = resolveTexts(positionals, values);
  if (texts.length === 0) {
    throw new FinchError("USAGE_ERROR", "finch thread requires at least one post (positional args or --file)");
  }

  validateMediaIndices(mediaByIndex, texts.length);

  const numberedTexts = number ? texts.map((text, i) => `${i + 1}/${texts.length} ${text}`) : texts;

  numberedTexts.forEach(validatePostText);

  let previousId: string | undefined =
    values["--continue"] !== undefined ? extractTweetId(values["--continue"]) : undefined;

  if (dryRun) {
    return {
      data: {
        dryRun: true,
        wouldSend: numberedTexts.map((text, i) => {
          const entry = mediaByIndex.get(i);
          return { text, media: entry?.media ?? [], alt: entry?.alt ?? [] };
        }),
      },
      human:
        previousId !== undefined
          ? `Would post a thread of ${numberedTexts.length} posts continuing from ${previousId}`
          : `Would post a thread of ${numberedTexts.length} posts`,
    };
  }

  const transport = getTransport();

  const ids: string[] = [];
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

/**
 * Mirrors the dispatch-args pattern used for `finch post`: recognized flags
 * (`--dry-run`, `--number`, `--help`, `-h`, `--file`, `--delimiter`,
 * `--continue`, `--media`, `--alt`) are only parsed in the region before a
 * `--` terminator; everything after `--` is literal thread text and is never
 * reinterpreted as a flag. Unknown `-` prefixed tokens before `--` are
 * rejected instead of being silently posted as thread text.
 */
function parseThreadArgs(argv: string[]): ParsedThreadArgs {
  const terminatorIndex = argv.indexOf("--");
  const flagRegion = terminatorIndex === -1 ? argv : argv.slice(0, terminatorIndex);
  const literalRegion = terminatorIndex === -1 ? [] : argv.slice(terminatorIndex + 1);

  const { values, bools, positionals } = parseArgs(flagRegion, {
    rejectUnknownFlags: true,
    valueFlags: ["--file", "--delimiter", "--continue", "--media", "--alt"],
    boolFlags: ["--dry-run", "--number", "--help", "-h"],
  });

  return {
    values,
    help: Boolean(bools["--help"] || bools["-h"]),
    dryRun: Boolean(bools["--dry-run"]),
    number: Boolean(bools["--number"]),
    mediaByIndex: collectThreadMediaWithAlt(argv),
    positionals: [...positionals, ...literalRegion],
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
