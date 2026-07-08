/**
 * Pure markdown -> DraftJS `content_state` converter.
 *
 * Design notes:
 * - Hand-rolled, line-oriented parser for the bounded markdown subset required by
 *   FIN-38. No external markdown dependency was added because the supported
 *   surface (headings, paragraphs, bold/italic/strike, lists, blockquotes, links,
 *   mentions, hashtags) is small enough that a focused parser keeps the diff and
 *   dependency tree minimal.
 * - Entity type names: DraftJS has a canonical "LINK" entity. It does *not*
 *   define canonical names for mentions/hashtags, so this module uses "MENTION"
 *   and "HASHTAG" (uppercase, matching the LINK convention). Data payloads are
 *   `{ username }` and `{ hashtag }` respectively, with the leading `@`/`#`
 *   included in the displayed text covered by the entity range.
 * - Graceful degradation: unsupported markdown (tables, fenced code blocks,
 *   images, footnotes, raw HTML, inline code) never throws. Fenced code becomes
 *   a plain unstyled block; inline code and image alt text become plain text;
 *   everything else is emitted as literal text.
 */

export type DraftBlockType =
  | "unstyled"
  | "header-one"
  | "header-two"
  | "header-three"
  | "header-four"
  | "header-five"
  | "header-six"
  | "unordered-list-item"
  | "ordered-list-item"
  | "blockquote";

export type InlineStyle = "BOLD" | "ITALIC" | "STRIKETHROUGH";

export interface InlineStyleRange {
  offset: number;
  length: number;
  style: InlineStyle;
}

export interface EntityRange {
  offset: number;
  length: number;
  key: string;
}

export interface DraftBlock {
  key: string;
  text: string;
  type: DraftBlockType;
  depth: number;
  inlineStyleRanges: InlineStyleRange[];
  entityRanges: EntityRange[];
}

export type EntityType = "LINK" | "MENTION" | "HASHTAG";

export interface Entity {
  type: EntityType;
  mutability: "MUTABLE";
  data: Record<string, unknown>;
}

export interface ContentState {
  blocks: DraftBlock[];
  entities: Record<string, Entity>;
}

export interface MarkdownToContentStateOptions {
  /** Optional key generator. Defaults to random 5-char alphanumeric strings. */
  generateKey?: () => string;
}

interface CharStyle {
  char: string;
  styles: InlineStyle[];
  entityKey?: string;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UNORDERED_LIST_RE = /^(\s*)[-*]\s+(.*)$/;
const ORDERED_LIST_RE = /^(\s*)(\d+)\.\s+(.*)$/;
const BLOCKQUOTE_RE = /^(\s*)>+\s?(.*)$/;
const FENCE_RE = /^```(\S*)\s*$/;
const LINK_RE = /^\[([^\]]+)\]\(([^)]+)\)/;
const IMAGE_RE = /^!\[([^\]]*)\]\([^)]+\)/;
const MENTION_RE = /^@([A-Za-z0-9_]+)/;
const HASHTAG_RE = /^#([A-Za-z0-9_]+)/;
const CODE_RE = /^`([^`]*)`/;
const BOLD_RE = /^(\*\*|__)/;
const STRIKE_RE = /^~~/;

const HEADER_TYPES: Record<number, DraftBlockType> = {
  1: "header-one",
  2: "header-two",
  3: "header-three",
  4: "header-four",
  5: "header-five",
  6: "header-six",
};

function defaultGenerateKey(): string {
  return Math.random().toString(36).slice(2, 7);
}

function capture(match: RegExpMatchArray, index: number): string {
  return match[index] ?? "";
}

function isWhitespaceLine(line: string): boolean {
  return /^\s*$/.test(line);
}

function canStartEntity(markup: string, index: number): boolean {
  if (index === 0) return true;
  const prev = markup.charAt(index - 1);
  return /[\s([{<>"'.,;:!?]/.test(prev);
}

function parseInline(
  markup: string,
  getKey: () => string,
  inheritedStyles: Iterable<InlineStyle> = [],
  inheritedEntityKey?: string,
): { chars: CharStyle[]; entities: Record<string, Entity> } {
  const chars: CharStyle[] = [];
  const entities: Record<string, Entity> = {};
  const activeStyles = new Set<InlineStyle>(inheritedStyles);
  let i = 0;

  const pushText = (value: string, entityKey?: string): void => {
    const effectiveEntity = entityKey ?? inheritedEntityKey;
    const styles = [...activeStyles];
    for (const char of value) {
      chars.push({ char, styles, entityKey: effectiveEntity });
    }
  };

  while (i < markup.length) {
    const remainder = markup.slice(i);

    const linkMatch = remainder.match(LINK_RE);
    if (linkMatch) {
      const linkText = capture(linkMatch, 1);
      const url = capture(linkMatch, 2);
      const entityKey = getKey();
      entities[entityKey] = { type: "LINK", mutability: "MUTABLE", data: { url } };
      const nested = parseInline(linkText, getKey, new Set(activeStyles), entityKey);
      chars.push(...nested.chars);
      Object.assign(entities, nested.entities);
      i += linkMatch[0].length;
      continue;
    }

    const imageMatch = remainder.match(IMAGE_RE);
    if (imageMatch) {
      pushText(capture(imageMatch, 1));
      i += imageMatch[0].length;
      continue;
    }

    if (canStartEntity(markup, i)) {
      const mentionMatch = remainder.match(MENTION_RE);
      if (mentionMatch) {
        const entityKey = getKey();
        entities[entityKey] = {
          type: "MENTION",
          mutability: "MUTABLE",
          data: { username: capture(mentionMatch, 1) },
        };
        pushText(mentionMatch[0], entityKey);
        i += mentionMatch[0].length;
        continue;
      }

      const hashtagMatch = remainder.match(HASHTAG_RE);
      if (hashtagMatch) {
        const entityKey = getKey();
        entities[entityKey] = {
          type: "HASHTAG",
          mutability: "MUTABLE",
          data: { hashtag: capture(hashtagMatch, 1) },
        };
        pushText(hashtagMatch[0], entityKey);
        i += hashtagMatch[0].length;
        continue;
      }
    }

    const boldMatch = remainder.match(BOLD_RE);
    if (boldMatch) {
      if (activeStyles.has("BOLD")) activeStyles.delete("BOLD");
      else activeStyles.add("BOLD");
      i += boldMatch[0].length;
      continue;
    }

    const strikeMatch = remainder.match(STRIKE_RE);
    if (strikeMatch) {
      if (activeStyles.has("STRIKETHROUGH")) activeStyles.delete("STRIKETHROUGH");
      else activeStyles.add("STRIKETHROUGH");
      i += strikeMatch[0].length;
      continue;
    }

    if (markup[i] === "*" || markup[i] === "_") {
      if (activeStyles.has("ITALIC")) activeStyles.delete("ITALIC");
      else activeStyles.add("ITALIC");
      i += 1;
      continue;
    }

    const codeMatch = remainder.match(CODE_RE);
    if (codeMatch) {
      pushText(capture(codeMatch, 1));
      i += codeMatch[0].length;
      continue;
    }

    pushText(markup.charAt(i));
    i += 1;
  }

  return { chars, entities };
}

function buildStyleRanges(chars: CharStyle[]): InlineStyleRange[] {
  const ranges: InlineStyleRange[] = [];
  for (const style of ["BOLD", "ITALIC", "STRIKETHROUGH"] as InlineStyle[]) {
    let start: number | undefined;
    for (let index = 0; index <= chars.length; index++) {
      const hasStyle = chars[index]?.styles.includes(style) ?? false;
      if (hasStyle && start === undefined) {
        start = index;
      } else if (!hasStyle && start !== undefined) {
        ranges.push({ offset: start, length: index - start, style });
        start = undefined;
      }
    }
  }
  return ranges.sort((a, b) => a.offset - b.offset || a.length - b.length);
}

function buildEntityRanges(chars: CharStyle[]): EntityRange[] {
  const ranges: EntityRange[] = [];
  let currentKey: string | undefined;
  let start = 0;
  for (let index = 0; index <= chars.length; index++) {
    const key = chars[index]?.entityKey;
    if (key !== currentKey) {
      if (currentKey !== undefined) {
        ranges.push({ offset: start, length: index - start, key: currentKey });
      }
      currentKey = key;
      start = index;
    }
  }
  return ranges.sort((a, b) => a.offset - b.offset);
}

type LineSegment = { kind: "text"; line: string } | { kind: "code"; code: string; lang?: string };

function splitByCodeFences(input: string): LineSegment[] {
  const segments: LineSegment[] = [];
  const lines = input.split("\n");
  let inCode = false;
  let codeLines: string[] = [];
  let codeLang: string | undefined;

  for (const line of lines) {
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      if (inCode) {
        segments.push({ kind: "code", code: codeLines.join("\n"), lang: codeLang });
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
        codeLang = fenceMatch[1] || undefined;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
    } else {
      segments.push({ kind: "text", line });
    }
  }

  if (inCode) {
    // Unclosed fence: degrade gracefully by treating the fence and its contents
    // as literal text lines rather than crashing.
    segments.push({ kind: "text", line: `\`\`\`${codeLang ?? ""}` });
    for (const codeLine of codeLines) {
      segments.push({ kind: "text", line: codeLine });
    }
  }

  return segments;
}

interface ClassifiedLine {
  kind: "heading" | "list" | "blockquote" | "paragraph";
  type: DraftBlockType;
  depth: number;
  content: string;
}

function classifyLine(line: string): ClassifiedLine | null {
  if (isWhitespaceLine(line)) return null;

  const headingMatch = line.match(HEADING_RE);
  if (headingMatch) {
    const level = capture(headingMatch, 1).length;
    return {
      kind: "heading",
      type: HEADER_TYPES[level] ?? "unstyled",
      depth: 0,
      content: capture(headingMatch, 2).trimEnd(),
    };
  }

  const unorderedMatch = line.match(UNORDERED_LIST_RE);
  if (unorderedMatch) {
    return {
      kind: "list",
      type: "unordered-list-item",
      depth: Math.floor(capture(unorderedMatch, 1).length / 2),
      content: capture(unorderedMatch, 2).trimEnd(),
    };
  }

  const orderedMatch = line.match(ORDERED_LIST_RE);
  if (orderedMatch) {
    return {
      kind: "list",
      type: "ordered-list-item",
      depth: Math.floor(capture(orderedMatch, 1).length / 2),
      content: capture(orderedMatch, 3).trimEnd(),
    };
  }

  const blockquoteMatch = line.match(BLOCKQUOTE_RE);
  if (blockquoteMatch) {
    return {
      kind: "blockquote",
      type: "blockquote",
      depth: 0,
      content: capture(blockquoteMatch, 2).trimEnd(),
    };
  }

  return {
    kind: "paragraph",
    type: "unstyled",
    depth: 0,
    content: line.trimEnd(),
  };
}

interface InlineParseResult {
  text: string;
  inlineStyleRanges: InlineStyleRange[];
  entityRanges: EntityRange[];
  entities: Record<string, Entity>;
}

function parseInlineBlock(content: string, getKey: () => string): InlineParseResult {
  const { chars, entities } = parseInline(content, getKey);
  const text = chars.map((char) => char.char).join("");
  return {
    text,
    inlineStyleRanges: buildStyleRanges(chars),
    entityRanges: buildEntityRanges(chars),
    entities,
  };
}

interface BuiltBlock {
  block: DraftBlock;
  entities: Record<string, Entity>;
}

function buildBlock(type: DraftBlockType, depth: number, content: string, getKey: () => string): BuiltBlock {
  const { text, inlineStyleRanges, entityRanges, entities } = parseInlineBlock(content, getKey);
  return {
    block: {
      key: getKey(),
      text,
      type,
      depth,
      inlineStyleRanges,
      entityRanges,
    },
    entities,
  };
}

function buildBlocks(
  segments: LineSegment[],
  getKey: () => string,
): { blocks: DraftBlock[]; entities: Record<string, Entity> } {
  const blocks: DraftBlock[] = [];
  const entities: Record<string, Entity> = {};
  let paragraphBuffer: string[] = [];

  const flushParagraph = (): void => {
    if (paragraphBuffer.length === 0) return;
    const content = paragraphBuffer.join(" ");
    const built = buildBlock("unstyled", 0, content, getKey);
    blocks.push(built.block);
    Object.assign(entities, built.entities);
    paragraphBuffer = [];
  };

  for (const segment of segments) {
    if (segment.kind === "code") {
      flushParagraph();
      const built = buildBlock("unstyled", 0, segment.code, getKey);
      blocks.push(built.block);
      Object.assign(entities, built.entities);
      continue;
    }

    const classified = classifyLine(segment.line);
    if (classified === null) {
      flushParagraph();
      continue;
    }

    if (classified.kind === "paragraph") {
      paragraphBuffer.push(classified.content);
      continue;
    }

    flushParagraph();
    const built = buildBlock(classified.type, classified.depth, classified.content, getKey);
    blocks.push(built.block);
    Object.assign(entities, built.entities);
  }

  flushParagraph();
  return { blocks, entities };
}

/**
 * Convert a markdown string into a DraftJS-compatible content_state object.
 */
export function markdownToContentState(markdown: string, options: MarkdownToContentStateOptions = {}): ContentState {
  const getKey = options.generateKey ?? defaultGenerateKey;
  const normalized = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const segments = splitByCodeFences(normalized);
  const { blocks, entities } = buildBlocks(segments, getKey);
  return { blocks, entities };
}
