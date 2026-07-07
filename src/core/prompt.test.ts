import { describe, test, expect } from "bun:test";
import { PassThrough } from "node:stream";
import { createPromptSession, defaultIO } from "./prompt";

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

    expect([first, second, third, fourth]).toEqual(["first-value", "second-value", "third-value", "fourth-value"]);
  });
});

function makeFakeTTY(): PassThrough & { isTTY: true; setRawMode: (mode: boolean) => void } {
  const stream = new PassThrough() as PassThrough & { isTTY: true; setRawMode: (mode: boolean) => void };
  stream.isTTY = true;
  stream.setRawMode = () => {};
  return stream;
}

describe("createPromptSession (raw TTY path)", () => {
  test("drops unhandled control bytes (e.g. a lone ESC from an arrow-key sequence) instead of appending them", async () => {
    const input = makeFakeTTY();
    const output = new PassThrough();
    const session = createPromptSession({ input, output });

    const resultPromise = session.promptSecret("Field: ");
    // "ab" + ESC (0x1b, below the printable threshold and not a handled
    // control) + "cd" + Enter
    input.write(Buffer.from([0x61, 0x62, 0x1b, 0x63, 0x64, 0x0a]));

    expect(await resultPromise).toBe("abcd");
    session.close();
  });

  test("still supports backspace and resolves on Enter", async () => {
    const input = makeFakeTTY();
    const output = new PassThrough();
    const session = createPromptSession({ input, output });

    const resultPromise = session.promptSecret("Field: ");
    input.write(Buffer.from([0x61, 0x62, 0x63, 0x7f, 0x0a])); // "abc" + backspace + Enter

    expect(await resultPromise).toBe("ab");
    session.close();
  });
});

describe("defaultIO", () => {
  test("writes prompt output to stderr, not stdout, so interactive labels never pollute the --json/piped stdout contract", () => {
    const io = defaultIO();
    expect(io.output).toBe(process.stderr);
    expect(io.input).toBe(process.stdin);
  });
});
