export interface ResolvedDispatchArgs {
  jsonMode: boolean;
  args: string[];
}

// Splits argv into a "global flags" region (everything before a `--`
// terminator) and a "passthrough" region (the terminator itself and
// everything after it). The passthrough region is always caller-supplied
// positional/free-text data — an MCP tool's post/reply text, a search
// query, a tweet id-or-URL — and per the same `--` convention parseArgs
// enforces for every command, it must be taken literally. Global flags
// (`--json`, `--describe`, `--version`/`-v`) are only ever recognized or stripped from the
// global-flags region: a literal positional value that happens to equal
// one of those strings (e.g. post text of "--json") must never be
// misinterpreted as the flag, and must never be silently deleted.
export function resolveDispatchArgs(argv: string[], isTTY: boolean): ResolvedDispatchArgs {
  const terminatorIndex = argv.indexOf("--");
  const globalFlags = terminatorIndex === -1 ? argv : argv.slice(0, terminatorIndex);
  const passthrough = terminatorIndex === -1 ? [] : argv.slice(terminatorIndex);

  const jsonMode = globalFlags.includes("--json") || !isTTY;

  if (globalFlags.includes("--describe")) {
    return { jsonMode, args: ["schema"] };
  }

  if (globalFlags.includes("--version") || globalFlags.includes("-v")) {
    return { jsonMode, args: ["version"] };
  }

  return { jsonMode, args: [...globalFlags.filter((a) => a !== "--json"), ...passthrough] };
}
