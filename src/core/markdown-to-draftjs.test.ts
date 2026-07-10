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

  test("emits the X Articles API content_state schema", () => {
    const contentState = convert("**Bold** [link](https://example.com) @finch #articles");

    expect(Array.isArray(contentState.entities)).toBe(true);
    expect(contentState).toEqual({
      blocks: [
        {
          key: "d",
          text: "Bold link @finch #articles",
          type: "unstyled",
          data: {
            mentions: [{ from_index: 10, to_index: 16, text: "@finch" }],
            hashtags: [{ from_index: 17, to_index: 26, text: "#articles" }],
          },
          entity_ranges: [{ offset: 5, length: 4, key: "0" }],
          inline_style_ranges: [{ offset: 0, length: 4, style: "bold" }],
        },
      ],
      entities: [
        {
          key: "0",
          value: {
            type: "link",
            mutability: "mutable",
            data: { url: "https://example.com" },
          },
        },
      ],
    });
  });

  test("converts headings and paragraph blocks", () => {
    expect(convert("# Title\n\n### Section\n\nPlain text.")).toEqual({
      blocks: [
        {
          key: "a",
          text: "Title",
          type: "header-one",
          data: {},
          entity_ranges: [],
          inline_style_ranges: [],
        },
        {
          key: "b",
          text: "Section",
          type: "header-three",
          data: {},
          entity_ranges: [],
          inline_style_ranges: [],
        },
        {
          key: "c",
          text: "Plain text.",
          type: "unstyled",
          data: {},
          entity_ranges: [],
          inline_style_ranges: [],
        },
      ],
      entities: [],
    });
  });

  test("degrades heading levels four through six to header-three", () => {
    const contentState = convert("#### Four\n##### Five\n###### Six");

    expect(contentState.blocks.map(({ text, type }) => ({ text, type }))).toEqual([
      { text: "Four", type: "header-three" },
      { text: "Five", type: "header-three" },
      { text: "Six", type: "header-three" },
    ]);
  });

  test("converts inline bold italic and strikethrough ranges", () => {
    expect(convert("This is **bold**, _italic_, and ~~gone~~.")).toEqual({
      blocks: [
        {
          key: "a",
          text: "This is bold, italic, and gone.",
          type: "unstyled",
          data: {},
          entity_ranges: [],
          inline_style_ranges: [
            { offset: 8, length: 4, style: "bold" },
            { offset: 14, length: 6, style: "italic" },
            { offset: 26, length: 4, style: "strikethrough" },
          ],
        },
      ],
      entities: [],
    });
  });

  test("preserves intra-word underscores as literal text", () => {
    expect(convert("Check my_variable_name here")).toEqual({
      blocks: [
        {
          key: "a",
          text: "Check my_variable_name here",
          type: "unstyled",
          data: {},
          entity_ranges: [],
          inline_style_ranges: [],
        },
      ],
      entities: [],
    });
  });

  test("keeps underscore italics at word boundaries", () => {
    expect(convert("This is _really_ important")).toEqual({
      blocks: [
        {
          key: "a",
          text: "This is really important",
          type: "unstyled",
          data: {},
          entity_ranges: [],
          inline_style_ranges: [{ offset: 8, length: 6, style: "italic" }],
        },
      ],
      entities: [],
    });
  });

  test("preserves overlapping inline styles", () => {
    expect(convert("This is **bold and _italic_**.")).toEqual({
      blocks: [
        {
          key: "a",
          text: "This is bold and italic.",
          type: "unstyled",
          data: {},
          entity_ranges: [],
          inline_style_ranges: [
            { offset: 8, length: 15, style: "bold" },
            { offset: 17, length: 6, style: "italic" },
          ],
        },
      ],
      entities: [],
    });
  });

  test("converts unordered and ordered list items without unsupported depth", () => {
    expect(convert("- top\n  - nested\n1. first\n  2. second")).toEqual({
      blocks: [
        {
          key: "a",
          text: "top",
          type: "unordered-list-item",
          data: {},
          entity_ranges: [],
          inline_style_ranges: [],
        },
        {
          key: "b",
          text: "nested",
          type: "unordered-list-item",
          data: {},
          entity_ranges: [],
          inline_style_ranges: [],
        },
        {
          key: "c",
          text: "first",
          type: "ordered-list-item",
          data: {},
          entity_ranges: [],
          inline_style_ranges: [],
        },
        {
          key: "d",
          text: "second",
          type: "ordered-list-item",
          data: {},
          entity_ranges: [],
          inline_style_ranges: [],
        },
      ],
      entities: [],
    });
  });

  test("converts blockquotes", () => {
    expect(convert("> quoted **text**")).toEqual({
      blocks: [
        {
          key: "a",
          text: "quoted text",
          type: "blockquote",
          data: {},
          entity_ranges: [],
          inline_style_ranges: [{ offset: 7, length: 4, style: "bold" }],
        },
      ],
      entities: [],
    });
  });

  test("converts links to entities and mentions and hashtags to block metadata", () => {
    expect(convert("Hi [Finch](https://example.com) from @finch_cli #articles")).toEqual({
      blocks: [
        {
          key: "d",
          text: "Hi Finch from @finch_cli #articles",
          type: "unstyled",
          data: {
            mentions: [{ from_index: 14, to_index: 24, text: "@finch_cli" }],
            hashtags: [{ from_index: 25, to_index: 34, text: "#articles" }],
          },
          entity_ranges: [{ offset: 3, length: 5, key: "0" }],
          inline_style_ranges: [],
        },
      ],
      entities: [
        {
          key: "0",
          value: {
            type: "link",
            mutability: "mutable",
            data: { url: "https://example.com" },
          },
        },
      ],
    });
  });

  test("renumbers multiple links consistently with matching string entity keys", () => {
    const contentState = convert(
      "[First](https://first.example) and [Second](https://second.example) then [Third](https://third.example)",
    );

    expect(contentState.entities.map(({ key }) => key)).toEqual(["0", "1", "2"]);
    expect(contentState.blocks[0]?.entity_ranges.map(({ key }) => key)).toEqual(["0", "1", "2"]);
    for (const range of contentState.blocks[0]?.entity_ranges ?? []) {
      expect(typeof range.key).toBe("string");
      expect(contentState.entities.some((entity) => entity.key === range.key)).toBe(true);
    }
  });

  test("emits mentions and hashtags as metadata without link entities", () => {
    const contentState = convert("Hello @finch and #articles");

    expect(contentState.entities).toEqual([]);
    expect(contentState.blocks[0]?.entity_ranges).toEqual([]);
    expect(contentState.blocks[0]?.data).toEqual({
      mentions: [{ from_index: 6, to_index: 12, text: "@finch" }],
      hashtags: [{ from_index: 17, to_index: 26, text: "#articles" }],
    });
  });

  test("supports inline styles inside link text", () => {
    expect(convert("Read [**Finch** docs](https://example.com/docs).")).toEqual({
      blocks: [
        {
          key: "b",
          text: "Read Finch docs.",
          type: "unstyled",
          data: {},
          entity_ranges: [{ offset: 5, length: 10, key: "0" }],
          inline_style_ranges: [{ offset: 5, length: 5, style: "bold" }],
        },
      ],
      entities: [
        {
          key: "0",
          value: {
            type: "link",
            mutability: "mutable",
            data: { url: "https://example.com/docs" },
          },
        },
      ],
    });
  });

  test("degrades unsupported markdown without throwing", () => {
    expect(convert("![alt text](image.png)\n\n```ts\nconst value = 1;\n```")).toEqual({
      blocks: [
        {
          key: "a",
          text: "alt text",
          type: "unstyled",
          data: {},
          entity_ranges: [],
          inline_style_ranges: [],
        },
        {
          key: "b",
          text: "const value = 1;",
          type: "unstyled",
          data: {},
          entity_ranges: [],
          inline_style_ranges: [],
        },
      ],
      entities: [],
    });
  });
});
