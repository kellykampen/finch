import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FinchError } from "./errors";

export interface SkillSummary {
  name: string;
  description: string;
}

// The finch skill's SKILL.md lives in the sibling agent-skills repo (same
// layout peek's MCP server uses). This is the single source that BOTH the
// `finch skills` CLI command and the MCP `skills` tool read, so CLI/MCP skill
// discovery can never diverge (FIN-75 AC: shared, not duplicated).
export function defaultSkillPath(): string {
  return path.join(os.homedir(), "code", "agent-skills", "skills", "agents", "finch", "SKILL.md");
}

// Reads the SKILL.md verbatim. A missing/unreadable file is a CLIENT_ERROR
// (exit 4) — an environment problem (the sibling skill repo isn't present),
// not a usage error. The message includes the path so the operator can fix it.
export async function readSkillMarkdown(skillPath: string = defaultSkillPath()): Promise<string> {
  try {
    return await readFile(skillPath, "utf8");
  } catch (err) {
    throw new FinchError(
      "CLIENT_ERROR",
      `Could not read the finch skill's SKILL.md at ${skillPath}: ${(err as Error).message}`,
      { skillPath },
    );
  }
}

// Minimal YAML-frontmatter extraction (name + folded description). The SKILL.md
// frontmatter is a small, known shape, so this avoids pulling in a YAML
// dependency. Falls back gracefully for a SKILL.md with no frontmatter.
export function parseSkillSummary(markdown: string): SkillSummary {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/);
  const block = frontmatter?.[1] ?? "";
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim() || "finch";
  return { name, description: extractYamlField(block, "description") };
}

// Reads a plain or folded (`>-` / `|`) YAML scalar: the value on the key line,
// plus any following more-indented continuation lines, until the next
// top-level `key:`. Continuation lines are joined and whitespace collapsed.
function extractYamlField(block: string, key: string): string {
  const lines = block.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  const keyLine = start === -1 ? undefined : lines[start];
  if (keyLine === undefined) return "";
  const parts: string[] = [];
  // Drop a lone block-scalar indicator (`>-`, `|`, `>`, …) on the key line.
  const inline = keyLine
    .slice(key.length + 1)
    .trim()
    .replace(/^[>|][-+]?$/, "");
  if (inline) parts.push(inline);
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || /^\S/.test(line)) break; // next top-level key ends the field
    const trimmed = line.trim();
    if (trimmed) parts.push(trimmed);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// Lists the discoverable finch skill(s). Finch ships a single self-describing
// skill (its SKILL.md), so this returns one summary; the shape is a list so the
// CLI/MCP surface can grow to multiple skills without a contract change.
export async function listSkills(skillPath: string = defaultSkillPath()): Promise<SkillSummary[]> {
  return [parseSkillSummary(await readSkillMarkdown(skillPath))];
}
