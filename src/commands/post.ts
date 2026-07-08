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
  writeStatus?: (message: string) => void;
}

const POST_USAGE = `Usage: finch post [flags] [<text>]

Flags:
  --dry-run          Validate and show what would be posted without calling the X API
  --file <path>      Read post text from a file
  --media <path>     Attach images (up to 4) or one GIF/video; repeatable/comma-separated
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
  const writeStatus = deps.writeStatus ?? ((message: string) => console.error(message));

  const { help, dryRun, file, media, positionals } = parsePostArgs(argv);

  if (help) {
    return { data: { help: true, text: POST_USAGE }, human: POST_USAGE };
  }

  const mediaPlan = planMediaUploads(media);
  const text = await resolveText(positionals, file, media.length > 0, readStdin);

  if (text.length === 0 && media.length === 0) {
    throw new FinchError("USAGE_ERROR", "Post text must not be empty");
  }
  if (text.length > 0) {
    validatePostText(text);
  }

  if (dryRun) {
    return {
      data: { dryRun: true, wouldSend: { text, media } },
      human: `Would post: ${text}${media.length > 0 ? ` with media: ${media.join(", ")}` : ""}`,
    };
  }

  const transport = getTransport();
  const mediaIds = await uploadMedia(transport, mediaPlan, writeStatus);
  const created = await transport.createTweet(text, undefined, mediaIds);
  return { data: created, human: `Posted: ${created.id}` };
}

type MediaKind = "image" | "video";

interface PlannedMediaUpload {
  kind: MediaKind;
  paths: string[];
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "bmp", "png", "webp", "tiff", "tif"]);
const VIDEO_EXTENSIONS = new Set(["gif", "mp4", "mov", "webm", "ts", "m2ts"]);

function planMediaUploads(paths: string[]): PlannedMediaUpload {
  const kinds = paths.map((path) => ({ path, kind: classifyMediaPath(path) }));
  const unsupported = kinds.find((item) => item.kind === undefined);
  if (unsupported) {
    throw new FinchError(
      "USAGE_ERROR",
      `Unsupported media type for ${unsupported.path}. Supported extensions: .jpg, .jpeg, .png, .webp, .bmp, .tiff, .tif, .gif, .mp4, .mov, .webm, .ts, .m2ts`,
    );
  }

  const videoPaths = kinds.filter((item) => item.kind === "video").map((item) => item.path);
  const imagePaths = kinds.filter((item) => item.kind === "image").map((item) => item.path);

  if (videoPaths.length > 1) {
    throw new FinchError("USAGE_ERROR", "Only one GIF or video can be attached to a post");
  }
  if (videoPaths.length === 1 && imagePaths.length > 0) {
    throw new FinchError("USAGE_ERROR", "Cannot mix images with GIF/video media in the same post");
  }
  if (imagePaths.length > 4) {
    throw new FinchError("USAGE_ERROR", `Too many images: ${imagePaths.length} (maximum 4)`);
  }

  return videoPaths.length === 1 ? { kind: "video", paths: videoPaths } : { kind: "image", paths: imagePaths };
}

function classifyMediaPath(path: string): MediaKind | undefined {
  const dotIndex = path.lastIndexOf(".");
  const ext = dotIndex === -1 ? "" : path.slice(dotIndex + 1).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return undefined;
}

async function uploadMedia(
  transport: XTransport,
  plan: PlannedMediaUpload,
  writeStatus: (message: string) => void,
): Promise<string[] | undefined> {
  if (plan.paths.length === 0) return undefined;
  if (plan.kind === "video") {
    const result = await transport.uploadVideo(plan.paths[0] as string, writeStatus);
    return [result.media_id];
  }
  return uploadImages(transport, plan.paths);
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
