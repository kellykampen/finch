import { readFileSync } from "node:fs";
import { resolveOAuth2Transport, type XTransport } from "../core/transport";
import { validatePostText } from "../core/validation";
import { parseArgs } from "../core/args";
import { FinchError } from "../core/errors";

export interface PostResult {
  id: string;
  text: string;
}

export interface PostDryRunResult {
  dryRun: true;
  wouldSend: { text: string; media: string[] };
}

export interface PostHelpResult {
  help: true;
  text: string;
}

export interface PostDeps {
  getTransport?: () => XTransport;
  readStdin?: () => Promise<string>;
}

const POST_USAGE = `Usage: finch post [flags] [<text>]

Flags:
  --dry-run          Validate and show what would be posted without calling the X API
  --file <path>      Read post text from a file
  --media <path>     Attach an image (repeatable or comma-separated; up to 4)
  --help, -h         Show this help message

Text may be supplied as a positional argument, via --file, or from stdin.
Use -- before the text to pass literal values starting with "-", e.g.
  finch post -- "-1 isn't a bad take"`;

interface ParsedPostArgs {
  help: boolean;
  dryRun: boolean;
  file: string | undefined;
  media: string[];
  positionals: string[];
}

/**
 * Parse post argv, mirroring the dispatch-args pattern used for global flags:
 * recognized flags (`--dry-run`, `--help`, `-h`, `--file`) are only parsed in
 * the region before a `--` terminator; everything after `--` is literal content
 * and is never reinterpreted as a flag. Unknown `-` prefixed tokens before `--`
 * are rejected instead of being silently posted as tweet text.
 */
function parsePostArgs(argv: string[]): ParsedPostArgs {
  const terminatorIndex = argv.indexOf("--");
  const flagRegion = terminatorIndex === -1 ? argv : argv.slice(0, terminatorIndex);
  const literalRegion = terminatorIndex === -1 ? [] : argv.slice(terminatorIndex + 1);

  const { values, bools, positionals } = parseArgs(flagRegion, {
    valueFlags: ["--file", "--media"],
    boolFlags: ["--help", "-h", "--dry-run"],
  });

  const unknownFlag = positionals.find((p) => p.startsWith("-"));
  if (unknownFlag !== undefined) {
    throw new FinchError("USAGE_ERROR", `Unknown flag: ${unknownFlag}`);
  }

  return {
    help: Boolean(bools["--help"] || bools["-h"]),
    dryRun: Boolean(bools["--dry-run"]),
    file: values["--file"],
    media: collectMediaPaths(flagRegion),
    positionals: [...positionals, ...literalRegion],
  };
}

function collectMediaPaths(flagRegion: string[]): string[] {
  const paths: string[] = [];
  for (let i = 0; i < flagRegion.length; i++) {
    if (flagRegion[i] === "--media") {
      const value = flagRegion[i + 1];
      if (value === undefined) {
        throw new FinchError("USAGE_ERROR", "Missing value for --media");
      }
      paths.push(
        ...value
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
      );
      i++;
    }
  }
  return paths;
}

/**
 * `finch post "<text>"`: text via positional arg, `--file <path>`, or stdin
 * (in that precedence order) when the arg is omitted. `--dry-run` validates
 * and reports what would be sent without calling the X API. `--help` prints
 * usage and exits without touching the transport/auth layer.
 */
export async function runPost(
  argv: string[],
  deps: PostDeps = {},
): Promise<{ data: PostResult | PostDryRunResult | PostHelpResult; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;
  const readStdin = deps.readStdin ?? (() => Bun.stdin.text());

  const { help, dryRun, file, media, positionals } = parsePostArgs(argv);

  if (help) {
    return { data: { help: true, text: POST_USAGE }, human: POST_USAGE };
  }

  const text = await resolveText(positionals, file, media.length > 0, readStdin);

  if (text.length === 0 && media.length === 0) {
    throw new FinchError("USAGE_ERROR", "Post text must not be empty");
  }
  if (text.length > 0) {
    validatePostText(text);
  }

  if (media.length > 4) {
    throw new FinchError("USAGE_ERROR", `Too many images: ${media.length} (maximum 4)`);
  }

  if (dryRun) {
    return {
      data: { dryRun: true, wouldSend: { text, media } },
      human: `Would post: ${text}${media.length > 0 ? ` with media: ${media.join(", ")}` : ""}`,
    };
  }

  const transport = getTransport();
  const mediaIds = media.length > 0 ? await uploadImages(transport, media) : undefined;
  const created = await transport.createTweet(text, undefined, mediaIds);
  return { data: created, human: `Posted: ${created.id}` };
}

async function uploadImages(transport: XTransport, paths: string[]): Promise<string[]> {
  const results = await Promise.all(paths.map((path) => transport.uploadImage(path)));
  return results.map((r) => r.media_id);
}

async function resolveText(
  positionals: string[],
  file: string | undefined,
  hasMedia: boolean,
  readStdin: () => Promise<string>,
): Promise<string> {
  if (positionals[0] !== undefined) return positionals[0].trim();
  if (file !== undefined) return readFileSync(file, "utf8").trim();
  if (hasMedia) return "";
  return (await readStdin()).trim();
}
