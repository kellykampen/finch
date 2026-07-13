import { COMMAND_SCHEMAS } from "./schema";

export interface HelpCommand {
  name: string;
  description: string;
}

export interface HelpResult {
  usage: string;
  commands: HelpCommand[];
}

const USAGE = "finch <command> [args] [--json]";

// A command's schema description is a full paragraph (see schema.ts) — too
// long for a one-line listing. Trim to the first sentence for the human
// table; the JSON `data.commands` still carries the full description so an
// agent loses nothing.
function firstSentence(description: string): string {
  const end = description.indexOf(". ");
  return end === -1 ? description : description.slice(0, end + 1);
}

function renderHuman(commands: HelpCommand[]): string {
  const width = Math.max(...commands.map((c) => c.name.length));
  const rows = commands.map((c) => `  ${c.name.padEnd(width)}  ${firstSentence(c.description)}`);
  return [
    "finch — a small, agent-friendly CLI for X (Twitter).",
    "",
    "Usage:",
    `  ${USAGE}`,
    "  finch --help | -h     Show this help (also shown when run with no arguments)",
    "  finch --version       Print this binary's version (alias: finch version)",
    "  finch --describe      Machine-readable command schema as JSON (alias: finch schema)",
    "  finch mcp             Start the bundled MCP server over stdio for local agent harnesses",
    "",
    "Commands:",
    ...rows,
    "",
    "Every command supports --json (also forced when stdout is not a TTY) and returns a",
    "deterministic exit code: 0 ok, 2 usage, 3 auth, 4 client, 5 rate-limited, 6 network.",
    "Run `finch schema` for the full reference: flags, X API endpoints, and JSON data shapes.",
  ].join("\n");
}

/**
 * `finch help` / `--help` / `-h` / no-args: human-readable top-level usage and
 * the supported command listing. The listing is derived from COMMAND_SCHEMAS
 * (the same source `finch schema` / `--describe` serves), so it can never
 * drift from the documented command surface. JSON mode emits the deterministic
 * `{ usage, commands }` document instead of the human table.
 */
export async function runHelp(): Promise<{ data: HelpResult; human: string }> {
  const commands: HelpCommand[] = COMMAND_SCHEMAS.map((c) => ({
    name: c.name,
    description: c.description,
  }));
  const data: HelpResult = { usage: USAGE, commands };
  return { data, human: renderHuman(commands) };
}
