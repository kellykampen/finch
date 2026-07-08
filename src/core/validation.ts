import { FinchError } from "./errors";

// X's post text limit.
export const MAX_POST_LENGTH = 280;

// C0 control characters below 0x20, excluding tab/newline/CR — those are
// legitimate in multi-line post text. PLAN.md's "reject control characters
// (below ASCII 0x20)" targets adversarial bytes (e.g. ESC, BEL), not ordinary
// line breaks an agent or human would type in a real post.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional match of disallowed C0 control bytes
const DISALLOWED_CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

export function validatePostText(text: string): void {
  if (text.length === 0) {
    throw new FinchError("USAGE_ERROR", "Post text must not be empty");
  }
  if (text.length > MAX_POST_LENGTH) {
    throw new FinchError("USAGE_ERROR", `Post text exceeds ${MAX_POST_LENGTH} characters (${text.length})`);
  }
  if (DISALLOWED_CONTROL_CHAR_RE.test(text)) {
    throw new FinchError("USAGE_ERROR", "Post text contains disallowed control characters");
  }
}
