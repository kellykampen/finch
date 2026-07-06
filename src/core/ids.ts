import { FinchError } from "./errors";

const NUMERIC_ID_RE = /^\d+$/;
const STATUS_PATH_RE = /\/status(?:es)?\/(\d+)(?:\/.*)?$/;

/**
 * Accepts either a bare post ID or a full x.com/twitter.com status URL, per
 * PLAN.md's shared convention for id-or-URL arguments. Rejects a URL with
 * unexpected query params rather than silently ignoring them, so an
 * adversarial/malformed argument fails loudly (exit 2) instead of resolving
 * to a possibly-unintended post.
 */
export function extractTweetId(idOrUrl: string): string {
  const trimmed = idOrUrl.trim();
  if (NUMERIC_ID_RE.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new FinchError("USAGE_ERROR", `Not a valid post ID or URL: ${idOrUrl}`);
  }

  const host = url.hostname.replace(/^www\./, "");
  if (host !== "x.com" && host !== "twitter.com") {
    throw new FinchError("USAGE_ERROR", `Not a valid post ID or URL: ${idOrUrl}`);
  }
  if ([...url.searchParams.keys()].length > 0) {
    throw new FinchError("USAGE_ERROR", `Unexpected query parameters in post URL: ${idOrUrl}`);
  }

  const match = url.pathname.match(STATUS_PATH_RE);
  const id = match?.[1];
  if (id === undefined) {
    throw new FinchError("USAGE_ERROR", `Could not extract a post ID from URL: ${idOrUrl}`);
  }
  return id;
}

// X usernames can't contain '@' themselves, so stripping a leading one (as
// displayed all over x.com) is unambiguous and saves a class of usage errors.
export function normalizeUsername(raw: string): string {
  return raw.startsWith("@") ? raw.slice(1) : raw;
}
