import { FinchError } from "./errors";

export interface ParsedArgs {
  values: Record<string, string>;
  bools: Record<string, boolean>;
  positionals: string[];
}

export function parseArgs(
  argv: string[],
  flags: { valueFlags?: string[]; boolFlags?: string[] } = {},
): ParsedArgs {
  const valueFlags = new Set(flags.valueFlags ?? []);
  const boolFlags = new Set(flags.boolFlags ?? []);
  const values: Record<string, string> = {};
  const bools: Record<string, boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (valueFlags.has(arg)) {
      const value = argv[++i];
      if (value === undefined) {
        throw new FinchError("USAGE_ERROR", `Missing value for ${arg}`);
      }
      values[arg] = value;
      continue;
    }
    if (boolFlags.has(arg)) {
      bools[arg] = true;
      continue;
    }
    positionals.push(arg);
  }

  return { values, bools, positionals };
}

const DEFAULT_COUNT = 10;
const MAX_COUNT = 100;

// Default 10, capped at the X API v2 list-endpoint hard cap of 100/page —
// PLAN.md calls this an "API-tier-aware max", not a hard usage error, so an
// over-large -n is silently clamped rather than rejected.
export function resolveCount(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_COUNT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new FinchError("USAGE_ERROR", `-n must be a positive integer, got: ${raw}`);
  }
  return Math.min(n, MAX_COUNT);
}
