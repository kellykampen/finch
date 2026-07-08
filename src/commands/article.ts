import { readFileSync } from "node:fs";
import { resolveOAuth2Transport, type XTransport } from "../core/transport";
import { markdownToContentState } from "../core/markdown-to-draftjs";
import { parseArgs } from "../core/args";
import { FinchError } from "../core/errors";

export interface ArticleDraftResult {
  id: string;
}

export interface ArticleDraftDeps {
  getTransport?: () => XTransport;
}

/**
 * `finch article draft <title> <markdown-file-path>`: convert a markdown file
 * to a DraftJS content_state and create an article draft on X. An optional
 * `--cover <path>` image is uploaded first and attached to the draft.
 */
export async function runArticleDraft(
  argv: string[],
  deps: ArticleDraftDeps = {},
): Promise<{ data: ArticleDraftResult; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const terminatorIndex = argv.indexOf("--");
  const flagRegion = terminatorIndex === -1 ? argv : argv.slice(0, terminatorIndex);
  const literalRegion = terminatorIndex === -1 ? [] : argv.slice(terminatorIndex + 1);

  const { values, positionals } = parseArgs(flagRegion, {
    valueFlags: ["--cover"],
  });

  const unknownFlag = positionals.find((p) => p.startsWith("-"));
  if (unknownFlag !== undefined) {
    throw new FinchError("USAGE_ERROR", `Unknown flag: ${unknownFlag}`);
  }

  const allPositionals = [...positionals, ...literalRegion];

  const title = allPositionals[0];
  const markdownPath = allPositionals[1];

  if (!title || !markdownPath) {
    throw new FinchError("USAGE_ERROR", "finch article draft requires <title> and <markdown-file-path>");
  }

  let markdown: string;
  try {
    markdown = readFileSync(markdownPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new FinchError("USAGE_ERROR", `Cannot read markdown file ${markdownPath}: ${message}`, null);
  }

  const contentState = markdownToContentState(markdown);

  const coverPath = values["--cover"];

  const transport = getTransport();

  let coverMediaId: string | undefined;
  if (coverPath !== undefined) {
    const uploaded = await transport.uploadImage(coverPath);
    coverMediaId = uploaded.media_id;
  }

  const created = await transport.createArticleDraft(title, contentState, coverMediaId);
  return { data: { id: created.id }, human: `Created article draft ${created.id}` };
}
