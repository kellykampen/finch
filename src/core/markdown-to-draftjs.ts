/**
 * Pure markdown -> X Articles API `content_state` converter.
 *
 * X accepts a DraftJS-derived wire format rather than DraftJS's native JSON:
 * block range fields are snake_case, inline styles and entity values are
 * lowercase, entities are an array, and list nesting depth is not part of the
 * API schema. Mentions and hashtags are represented as block data spans.
 *
 * Unsupported markdown never throws. Fenced code becomes a plain unstyled
 * block; inline code and image alt text become plain text; everything else is
 * emitted as literal text. Heading levels 4-6 degrade to header-three because
 * the Articles API currently supports only header-one through header-three.
 */

export type DraftBlockType =
  | "unstyled"
  | "header-one"
  | "header-two"
  | "header-three"
  | "unordered-list-item"
  | "ordered-list-item"
  | "blockquote";

export type InlineStyle = "BOLD" | "ITALIC" | "STRIKETHROUGH";
export type ArticleInlineStyle = "bold" | "italic" | "strikethrough";

export interface InlineStyleRange {
  offset: number;
  length: number;
  style: ArticleInlineStyle;
}

interface ParsedInlineStyleRange {
  offset: number;
  length: number;
  style: InlineStyle;
}

export interface EntityRange {
  offset: number;
  length: number;
  key: string;
}

interface ParsedEntityRange {
  offset: number;
  length: number;
  key: string;
}

export interface ArticleDataSpan {
  from_index: number;
  to_index: number;
  text: string;
}

export interface DraftBlock {
  key: string;
  text: string;
  type: DraftBlockType;
  data: {
    mentions?: ArticleDataSpan[];
    hashtags?: ArticleDataSpan[];
  };
  entity_ranges: EntityRange[];
  inline_style_ranges: InlineStyleRange[];
}

interface ParsedDraftBlock {
  key: string;
  text: string;
  type: DraftBlockType;
  depth: number;
  inlineStyleRanges: ParsedInlineStyleRange[];
  entityRanges: ParsedEntityRange[];
}

type ParsedEntityType = "LINK" | "MENTION" | "HASHTAG";

interface ParsedEntity {
  type: ParsedEntityType;
  mutability: "MUTABLE";
  data: Record<string, unknown>;
}

export interface ArticleEntity {
  key: string;
  value: {
    type: "link";
    mutability: "mutable";
    data: { url: string };
  };
}

export interface ContentState {
  blocks: DraftBlock[];
  entities: ArticleEntity[];
}

export interface MarkdownToContentStateOptions {
  /** Optional key generator. Defaults to deterministic per-call block_N keys. */
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
  4: "header-three",
  5: "header-three",
  6: "header-three",
};

const ARTICLE_STYLE_BY_PARSED_STYLE: Record<InlineStyle, ArticleInlineStyle> = {
  BOLD: "bold",
  ITALIC: "italic",
  STRIKETHROUGH: "strikethrough",
};

function createDefaultGenerateKey(): () => string {
  let keyIndex = 0;
  return () => {
    const key = `block_${keyIndex}`;
    keyIndex += 1;
    return key;
  };
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

function isAlphanumeric(char: string): boolean {
  return /^[A-Za-z0-9]$/.test(char);
}

function canToggleUnderscoreEmphasis(markup: string, index: number): boolean {
  const prev = markup.charAt(index - 1);
  const next = markup.charAt(index + 1);
  return !(isAlphanumeric(prev) && isAlphanumeric(next));
}

function parseInline(
  markup: string,
  getKey: () => string,
  inheritedStyles: Iterable<InlineStyle> = [],
  inheritedEntityKey?: string,
): { chars: CharStyle[]; entities: Record<string, ParsedEntity> } {
  const chars: CharStyle[] = [];
  const entities: Record<string, ParsedEntity> = {};
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

    if (markup[i] === "*" || (markup[i] === "_" && canToggleUnderscoreEmphasis(markup, i))) {
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

function buildStyleRanges(chars: CharStyle[]): ParsedInlineStyleRange[] {
  const ranges: ParsedInlineStyleRange[] = [];
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

function buildEntityRanges(chars: CharStyle[]): ParsedEntityRange[] {
  const ranges: ParsedEntityRange[] = [];
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
  inlineStyleRanges: ParsedInlineStyleRange[];
  entityRanges: ParsedEntityRange[];
  entities: Record<string, ParsedEntity>;
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
  block: ParsedDraftBlock;
  entities: Record<string, ParsedEntity>;
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
): { blocks: ParsedDraftBlock[]; entities: Record<string, ParsedEntity> } {
  const blocks: ParsedDraftBlock[] = [];
  const entities: Record<string, ParsedEntity> = {};
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

function spanFromRange(block: ParsedDraftBlock, range: ParsedEntityRange): ArticleDataSpan {
  return {
    from_index: range.offset,
    to_index: range.offset + range.length,
    text: block.text.slice(range.offset, range.offset + range.length),
  };
}

function toArticleContentState(
  parsedBlocks: ParsedDraftBlock[],
  parsedEntities: Record<string, ParsedEntity>,
): ContentState {
  const linkEntries = Object.entries(parsedEntities).filter(([, entity]) => entity.type === "LINK");
  const linkIndexByParsedKey = new Map(linkEntries.map(([parsedKey], index) => [parsedKey, String(index)]));

  const entities: ArticleEntity[] = linkEntries.map(([, entity], index) => ({
    key: String(index),
    value: {
      type: "link",
      mutability: "mutable",
      data: { url: String(entity.data.url ?? "") },
    },
  }));

  const blocks = parsedBlocks.map((block): DraftBlock => {
    const data: DraftBlock["data"] = {};
    const entityRanges: EntityRange[] = [];

    for (const range of block.entityRanges) {
      const entity = parsedEntities[range.key];
      if (entity?.type === "LINK") {
        const key = linkIndexByParsedKey.get(range.key);
        if (key !== undefined) entityRanges.push({ offset: range.offset, length: range.length, key });
      } else if (entity?.type === "MENTION") {
        data.mentions ??= [];
        data.mentions.push(spanFromRange(block, range));
      } else if (entity?.type === "HASHTAG") {
        data.hashtags ??= [];
        data.hashtags.push(spanFromRange(block, range));
      }
    }

    return {
      key: block.key,
      text: block.text,
      type: block.type,
      data,
      entity_ranges: entityRanges,
      inline_style_ranges: block.inlineStyleRanges.map((range) => ({
        offset: range.offset,
        length: range.length,
        style: ARTICLE_STYLE_BY_PARSED_STYLE[range.style],
      })),
    };
  });

  return { blocks, entities };
}

/** Convert markdown into the schema accepted by `POST /2/articles/draft`. */
export function markdownToContentState(markdown: string, options: MarkdownToContentStateOptions = {}): ContentState {
  const getKey = options.generateKey ?? createDefaultGenerateKey();
  const normalized = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const segments = splitByCodeFences(normalized);
  const { blocks, entities } = buildBlocks(segments, getKey);
  return toArticleContentState(blocks, entities);
}
