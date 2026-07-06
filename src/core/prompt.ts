import * as readline from "node:readline";

export interface PromptIO {
  input: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (mode: boolean) => void };
  output: NodeJS.WritableStream;
}

export interface PromptSession {
  promptSecret(label: string): Promise<string>;
  close(): void;
}

function defaultIO(): PromptIO {
  return { input: process.stdin, output: process.stdout };
}

const CTRL_C = String.fromCharCode(3);
const BACKSPACE = String.fromCharCode(127);

/**
 * Creates a session for asking several masked (no-echo) prompts in sequence,
 * e.g. the four `finch auth` credential fields. A single readline interface
 * (or raw-mode listener) is kept open across all prompts in the session —
 * creating a fresh one per prompt drops any input already buffered ahead of
 * it, which loses characters typed/piped for later prompts.
 */
export function createPromptSession(io: PromptIO = defaultIO()): PromptSession {
  if (io.input.isTTY && typeof io.input.setRawMode === "function") {
    return createTTYSession(io);
  }
  return createLineSession(io);
}

function createLineSession(io: PromptIO): PromptSession {
  const rl = readline.createInterface({
    input: io.input as NodeJS.ReadableStream,
    output: io.output as NodeJS.WritableStream,
    terminal: false,
  });

  // readline emits every complete line it can see as soon as data arrives,
  // not just one line per `question()` call — piped/pasted input containing
  // several lines up front would otherwise fire 'line' for later prompts
  // before anything is listening for them, and those lines would be lost.
  // Queuing decouples "line arrived" from "a prompt is waiting for a line".
  const pendingLines: string[] = [];
  const waiters: Array<(line: string) => void> = [];

  rl.on("line", (line) => {
    const waiter = waiters.shift();
    if (waiter) {
      waiter(line);
    } else {
      pendingLines.push(line);
    }
  });

  return {
    promptSecret: (label: string) =>
      new Promise((resolve) => {
        io.output.write(label);
        const queued = pendingLines.shift();
        if (queued !== undefined) {
          resolve(queued);
          return;
        }
        waiters.push(resolve);
      }),
    close: () => rl.close(),
  };
}

function createTTYSession(io: PromptIO): PromptSession {
  const input = io.input as NodeJS.ReadStream;
  input.setRawMode?.(true);
  input.resume();

  const promptSecret = (label: string): Promise<string> =>
    new Promise((resolve) => {
      io.output.write(label);
      let value = "";

      const onData = (chunk: Buffer) => {
        for (const ch of chunk.toString("utf8")) {
          if (ch === "\n" || ch === "\r") {
            input.removeListener("data", onData);
            io.output.write("\n");
            resolve(value);
            return;
          }
          if (ch === CTRL_C) {
            input.setRawMode?.(false);
            io.output.write("\n");
            process.exit(130);
          }
          if (ch === BACKSPACE || ch === "\b") {
            value = value.slice(0, -1);
            continue;
          }
          value += ch;
        }
      };

      input.on("data", onData);
    });

  return {
    promptSecret,
    close: () => {
      input.setRawMode?.(false);
      input.pause();
    },
  };
}
