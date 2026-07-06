import { readFileSync } from "node:fs";
import { resolveAuthConfig, type FinchAuthConfig } from "../core/config";
import { createByokTransport, type XTransport } from "../core/transport";
import { FinchError } from "../core/errors";
import { validatePostText } from "../core/validation";
import { parseArgs } from "../core/args";

export interface PostResult {
  id: string;
  text: string;
}

export interface PostDryRunResult {
  dryRun: true;
  wouldSend: { text: string };
}

export interface PostDeps {
  resolveAuth?: () => FinchAuthConfig | null;
  transportFactory?: (auth: FinchAuthConfig) => XTransport;
  readStdin?: () => Promise<string>;
}

/**
 * `finch post "<text>"`: text via positional arg, `--file <path>`, or stdin
 * (in that precedence order) when the arg is omitted. `--dry-run` validates
 * and reports what would be sent without calling the X API.
 */
export async function runPost(
  argv: string[],
  deps: PostDeps = {},
): Promise<{ data: PostResult | PostDryRunResult; human: string }> {
  const resolveAuth = deps.resolveAuth ?? resolveAuthConfig;
  const transportFactory = deps.transportFactory ?? createByokTransport;
  const readStdin = deps.readStdin ?? (() => Bun.stdin.text());

  const { values, bools, positionals } = parseArgs(argv, {
    valueFlags: ["--file"],
    boolFlags: ["--dry-run"],
  });

  const text = await resolveText(positionals, values, readStdin);
  validatePostText(text);

  if (bools["--dry-run"]) {
    return {
      data: { dryRun: true, wouldSend: { text } },
      human: `Would post: ${text}`,
    };
  }

  const auth = resolveAuth();
  if (!auth) {
    throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
  }

  const transport = transportFactory(auth);
  const created = await transport.createTweet(text);
  return { data: created, human: `Posted: ${created.id}` };
}

async function resolveText(
  positionals: string[],
  values: Record<string, string>,
  readStdin: () => Promise<string>,
): Promise<string> {
  if (positionals[0] !== undefined) return positionals[0].trim();
  if (values["--file"] !== undefined) return readFileSync(values["--file"], "utf8").trim();
  return (await readStdin()).trim();
}
