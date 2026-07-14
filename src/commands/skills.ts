import { FinchError } from "../core/errors";
import { defaultSkillPath, listSkills, parseSkillSummary, readSkillMarkdown, type SkillSummary } from "../core/skills";

export interface SkillsListResult {
  skills: SkillSummary[];
}

export interface SkillDetailResult {
  name: string;
  content: string;
}

export interface SkillsDeps {
  skillPath?: string;
}

function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](?:\s|$)/);
  return (match ? match[0] : text).trim();
}

/**
 * `finch skills` — lists the discoverable finch skill(s). `finch skills <name>`
 * prints that skill's full SKILL.md. This is the CLI counterpart of the MCP
 * `skills` tool; both read the same source via core/skills (FIN-75).
 */
export async function runSkills(
  argv: string[],
  deps: SkillsDeps = {},
): Promise<{ data: SkillsListResult | SkillDetailResult; human: string }> {
  const requested = argv.find((arg) => !arg.startsWith("-"));
  const unknownFlag = argv.find((arg) => arg.startsWith("-") && arg !== "-");
  if (unknownFlag !== undefined) {
    throw new FinchError("USAGE_ERROR", `Unknown flag "${unknownFlag}" for 'finch skills'.`, { flag: unknownFlag });
  }

  const skillPath = deps.skillPath ?? defaultSkillPath();

  // No name → list the available skill(s).
  if (requested === undefined) {
    const skills = await listSkills(skillPath);
    const width = Math.max(...skills.map((s) => s.name.length));
    const rows = skills.map((s) => `  ${s.name.padEnd(width)}  ${firstSentence(s.description)}`.trimEnd());
    const human = ["Available finch skills (run `finch skills <name>` for the full detail):", "", ...rows].join("\n");
    return { data: { skills }, human };
  }

  // A name → print that skill's full SKILL.md.
  const content = await readSkillMarkdown(skillPath);
  const summary = parseSkillSummary(content);
  if (requested !== summary.name) {
    throw new FinchError("USAGE_ERROR", `Unknown skill "${requested}". Available: ${summary.name}.`, {
      skill: requested,
    });
  }
  return { data: { name: summary.name, content }, human: content };
}
