import { readFileSync } from "node:fs";
import { resolveOAuth2Transport, type XTransport } from "../core/transport";
import { markdownToContentState } from "../core/markdown-to-draftjs";
import { parseArgs } from "../core/args";
import { FinchError } from "../core/errors";

export interface ArticleDraftResult {
  id: string;
}

export interface ArticlePublishResult {
  post_id: string;
  url: string;
}

export interface ArticleDraftDeps {
  getTransport?: () => XTransport;
}

function postUrl(postId: string): string {
  return `https://x.com/i/web/status/${postId}`;
}

async function createDraftFromMarkdown(
  transport: XTransport,
  title: string,
  markdownPath: string,
  coverPath: string | undefined,
): Promise<{ id: string }> {
  let markdown: string;
  try {
    markdown = readFileSync(markdownPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new FinchError("USAGE_ERROR", `Cannot read markdown file ${markdownPath}: ${message}`, null);
  }

  const contentState = markdownToContentState(markdown);

  let coverMediaId: string | undefined;
  if (coverPath !== undefined) {
    const uploaded = await transport.uploadImage(coverPath);
    coverMediaId = uploaded.media_id;
  }

  return transport.createArticleDraft(title, contentState, coverMediaId);
}

/**
 * `finch article draft <title> <markdown-file-path>`: convert a markdown file
 * to an X Articles API content_state and create an article draft on X. An optional
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

  const transport = getTransport();
  const created = await createDraftFromMarkdown(transport, title, markdownPath, values["--cover"]);
  return { data: { id: created.id }, human: `Created article draft ${created.id}` };
}

/**
 * `finch article publish <draft_id>`: publish an existing article draft and
 * return the resulting post URL.
 */
export async function runArticlePublish(
  argv: string[],
  deps: ArticleDraftDeps = {},
): Promise<{ data: ArticlePublishResult; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const terminatorIndex = argv.indexOf("--");
  const flagRegion = terminatorIndex === -1 ? argv : argv.slice(0, terminatorIndex);
  const literalRegion = terminatorIndex === -1 ? [] : argv.slice(terminatorIndex + 1);

  const { positionals } = parseArgs(flagRegion, {
    valueFlags: [],
  });

  const unknownFlag = positionals.find((p) => p.startsWith("-"));
  if (unknownFlag !== undefined) {
    throw new FinchError("USAGE_ERROR", `Unknown flag: ${unknownFlag}`);
  }

  const allPositionals = [...positionals, ...literalRegion];
  const draftId = allPositionals[0];

  if (!draftId) {
    throw new FinchError("USAGE_ERROR", "finch article publish requires <draft_id>");
  }

  const transport = getTransport();
  const published = await transport.publishArticleDraft(draftId);
  const url = postUrl(published.post_id);
  return { data: { post_id: published.post_id, url }, human: `Published article as ${url}` };
}

/**
 * `finch article post <markdown-file-path> --title <title> [--cover <path>]`: a
 * convenience that creates an article draft from a markdown file and then
 * publishes it, returning the final post URL.
 */
export async function runArticlePost(
  argv: string[],
  deps: ArticleDraftDeps = {},
): Promise<{ data: ArticlePublishResult; human: string }> {
  const getTransport = deps.getTransport ?? resolveOAuth2Transport;

  const terminatorIndex = argv.indexOf("--");
  const flagRegion = terminatorIndex === -1 ? argv : argv.slice(0, terminatorIndex);
  const literalRegion = terminatorIndex === -1 ? [] : argv.slice(terminatorIndex + 1);

  const { values, positionals } = parseArgs(flagRegion, {
    valueFlags: ["--title", "--cover"],
  });

  const unknownFlag = positionals.find((p) => p.startsWith("-"));
  if (unknownFlag !== undefined) {
    throw new FinchError("USAGE_ERROR", `Unknown flag: ${unknownFlag}`);
  }

  const allPositionals = [...positionals, ...literalRegion];
  const markdownPath = allPositionals[0];
  const title = values["--title"];
  const coverPath = values["--cover"];

  if (!markdownPath || !title) {
    throw new FinchError("USAGE_ERROR", "finch article post requires <markdown-file> and --title <title>");
  }

  const transport = getTransport();
  const draft = await createDraftFromMarkdown(transport, title, markdownPath, coverPath);
  const published = await transport.publishArticleDraft(draft.id);
  const url = postUrl(published.post_id);
  return { data: { post_id: published.post_id, url }, human: `Published article as ${url}` };
}
