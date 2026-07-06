import { describe, test, expect } from "bun:test";
import { PassThrough } from "node:stream";
import { createPromptSession } from "./prompt";

describe("createPromptSession (non-TTY fallback used by piped/test input)", () => {
  test("resolves with one line of input", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const session = createPromptSession({ input, output });

    const resultPromise = session.promptSecret("API Key: ");
    input.write("abc123\n");

    expect(await resultPromise).toBe("abc123");
    session.close();
  });

  test("never echoes the entered value back to output", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let written = "";
    output.on("data", (chunk) => {
      written += chunk.toString();
    });
    const session = createPromptSession({ input, output });

    const resultPromise = session.promptSecret("API Key: ");
    input.write("super-secret-value\n");
    await resultPromise;
    session.close();

    expect(written).not.toContain("super-secret-value");
  });

  test("supports multiple sequential prompts over the same piped input", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const session = createPromptSession({ input, output });

    input.write("first-value\nsecond-value\nthird-value\nfourth-value\n");

    const first = await session.promptSecret("Field 1: ");
    const second = await session.promptSecret("Field 2: ");
    const third = await session.promptSecret("Field 3: ");
    const fourth = await session.promptSecret("Field 4: ");
    session.close();

    expect([first, second, third, fourth]).toEqual([
      "first-value",
      "second-value",
      "third-value",
      "fourth-value",
    ]);
  });
});
