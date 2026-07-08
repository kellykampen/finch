import { describe, expect, test } from "bun:test";
import { markdownToContentState, type ContentState } from "./markdown-to-draftjs";

function keyGenerator(): () => string {
  const keys = "abcdefghijklmnopqrstuvwxyz".split("");
  let index = 0;
  return () => {
    const key = keys[index];
    index += 1;
    if (key === undefined) throw new Error("test key generator exhausted");
    return key;
  };
}

function convert(markdown: string): ContentState {
  return markdownToContentState(markdown, { generateKey: keyGenerator() });
}

describe("markdownToContentState", () => {
  test("uses deterministic default block keys across separate calls", () => {
    expect(markdownToContentState("some text")).toEqual(markdownToContentState("some text"));
  });

  test("converts headings and paragraph blocks", () => {
    expect(convert("# Title\n\n### Section\n\nPlain text.")).toEqual({
      blocks: [
        {
          key: "a",
          text: "Title",
          type: "header-one",
          depth: 0,
          inlineStyleRanges: [],
          entityRanges: [],
        },
        {
          key: "b",
          text: "Section",
          type: "header-three",
          depth: 0,
          inlineStyleRanges: [],
          entityRanges: [],
        },
        {
          key: "c",
          text: "Plain text.",
          type: "unstyled",
          depth: 0,
          inlineStyleRanges: [],
          entityRanges: [],
        },
      ],
      entities: {},
    });
  });

  test("converts inline bold italic and strikethrough ranges", () => {
    expect(convert("This is **bold**, _italic_, and ~~gone~~.")).toEqual({
      blocks: [
        {
          key: "a",
          text: "This is bold, italic, and gone.",
          type: "unstyled",
          depth: 0,
          inlineStyleRanges: [
            { offset: 8, length: 4, style: "BOLD" },
            { offset: 14, length: 6, style: "ITALIC" },
            { offset: 26, length: 4, style: "STRIKETHROUGH" },
          ],
          entityRanges: [],
        },
      ],
      entities: {},
    });
  });

  test("preserves intra-word underscores as literal text", () => {
    expect(convert("Check my_variable_name here")).toEqual({
      blocks: [
        {
          key: "a",
          text: "Check my_variable_name here",
          type: "unstyled",
          depth: 0,
          inlineStyleRanges: [],
          entityRanges: [],
        },
      ],
      entities: {},
    });
  });

  test("keeps underscore italics at word boundaries", () => {
    expect(convert("This is _really_ important")).toEqual({
      blocks: [
        {
          key: "a",
          text: "This is really important",
          type: "unstyled",
          depth: 0,
          inlineStyleRanges: [{ offset: 8, length: 6, style: "ITALIC" }],
          entityRanges: [],
        },
      ],
      entities: {},
    });
  });

  test("preserves overlapping inline styles", () => {
    expect(convert("This is **bold and _italic_**.")).toEqual({
      blocks: [
        {
          key: "a",
          text: "This is bold and italic.",
          type: "unstyled",
          depth: 0,
          inlineStyleRanges: [
            { offset: 8, length: 15, style: "BOLD" },
            { offset: 17, length: 6, style: "ITALIC" },
          ],
          entityRanges: [],
        },
      ],
      entities: {},
    });
  });

  test("converts unordered and ordered lists with nesting depth", () => {
    expect(convert("- top\n  - nested\n1. first\n  2. second")).toEqual({
      blocks: [
        {
          key: "a",
          text: "top",
          type: "unordered-list-item",
          depth: 0,
          inlineStyleRanges: [],
          entityRanges: [],
        },
        {
          key: "b",
          text: "nested",
          type: "unordered-list-item",
          depth: 1,
          inlineStyleRanges: [],
          entityRanges: [],
        },
        {
          key: "c",
          text: "first",
          type: "ordered-list-item",
          depth: 0,
          inlineStyleRanges: [],
          entityRanges: [],
        },
        {
          key: "d",
          text: "second",
          type: "ordered-list-item",
          depth: 1,
          inlineStyleRanges: [],
          entityRanges: [],
        },
      ],
      entities: {},
    });
  });

  test("converts blockquotes", () => {
    expect(convert("> quoted **text**")).toEqual({
      blocks: [
        {
          key: "a",
          text: "quoted text",
          type: "blockquote",
          depth: 0,
          inlineStyleRanges: [{ offset: 7, length: 4, style: "BOLD" }],
          entityRanges: [],
        },
      ],
      entities: {},
    });
  });

  test("converts links mentions and hashtags into consistent entities", () => {
    expect(convert("Hi [Finch](https://example.com) from @finch_cli #articles")).toEqual({
      blocks: [
        {
          key: "d",
          text: "Hi Finch from @finch_cli #articles",
          type: "unstyled",
          depth: 0,
          inlineStyleRanges: [],
          entityRanges: [
            { offset: 3, length: 5, key: "a" },
            { offset: 14, length: 10, key: "b" },
            { offset: 25, length: 9, key: "c" },
          ],
        },
      ],
      entities: {
        a: { type: "LINK", mutability: "MUTABLE", data: { url: "https://example.com" } },
        b: { type: "MENTION", mutability: "MUTABLE", data: { username: "finch_cli" } },
        c: { type: "HASHTAG", mutability: "MUTABLE", data: { hashtag: "articles" } },
      },
    });
  });

  test("supports inline styles inside link text", () => {
    expect(convert("Read [**Finch** docs](https://example.com/docs).")).toEqual({
      blocks: [
        {
          key: "b",
          text: "Read Finch docs.",
          type: "unstyled",
          depth: 0,
          inlineStyleRanges: [{ offset: 5, length: 5, style: "BOLD" }],
          entityRanges: [{ offset: 5, length: 10, key: "a" }],
        },
      ],
      entities: {
        a: { type: "LINK", mutability: "MUTABLE", data: { url: "https://example.com/docs" } },
      },
    });
  });

  test("degrades unsupported markdown without throwing", () => {
    expect(convert("![alt text](image.png)\n\n```ts\nconst value = 1;\n```")).toEqual({
      blocks: [
        {
          key: "a",
          text: "alt text",
          type: "unstyled",
          depth: 0,
          inlineStyleRanges: [],
          entityRanges: [],
        },
        {
          key: "b",
          text: "const value = 1;",
          type: "unstyled",
          depth: 0,
          inlineStyleRanges: [],
          entityRanges: [],
        },
      ],
      entities: {},
    });
  });
});
