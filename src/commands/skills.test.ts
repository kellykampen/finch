import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSkills, type SkillsListResult, type SkillDetailResult } from "./skills";
import { parseSkillSummary } from "../core/skills";
import { FinchError } from "../core/errors";

const SKILL_MD = `---
name: finch
description: >-
  Use whenever you are an agent that needs to act on X/Twitter — post, reply,
  build a thread, or read a timeline — through the finch CLI or MCP server.
compatibility: Requires the finch binary.
---

# finch

Body content here.
`;

describe("finch skills command (FIN-75)", () => {
  let dir: string;
  let skillPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "finch-skills-test-"));
    skillPath = join(dir, "SKILL.md");
    writeFileSync(skillPath, SKILL_MD);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("lists the discoverable skill with its parsed name + description", async () => {
    const { data, human } = await runSkills([], { skillPath });
    const list = data as SkillsListResult;
    expect(list.skills).toHaveLength(1);
    const skill = list.skills[0];
    expect(skill?.name).toBe("finch");
    expect(skill?.description).toContain("act on X/Twitter");
    // Folded YAML description is joined into a single line.
    expect(skill?.description).not.toContain("\n");
    expect(human).toContain("finch");
  });

  test("prints the full SKILL.md for a named skill", async () => {
    const { data, human } = await runSkills(["finch"], { skillPath });
    const detail = data as SkillDetailResult;
    expect(detail.name).toBe("finch");
    expect(detail.content).toContain("# finch");
    expect(detail.content).toContain("Body content here.");
    expect(human).toBe(detail.content);
  });

  test("rejects an unknown skill name with a USAGE_ERROR", async () => {
    await expect(runSkills(["nope"], { skillPath })).rejects.toMatchObject({
      code: "USAGE_ERROR",
    });
  });

  test("rejects an unknown flag", async () => {
    await expect(runSkills(["--bogus"], { skillPath })).rejects.toMatchObject({
      code: "USAGE_ERROR",
    });
  });

  test("treats a name after the -- terminator as a skill name, not a flag (review)", async () => {
    const { data } = await runSkills(["--", "finch"], { skillPath });
    expect((data as SkillDetailResult).name).toBe("finch");
  });

  test("rejects more than one skill name (review)", async () => {
    await expect(runSkills(["finch", "extra"], { skillPath })).rejects.toMatchObject({
      code: "USAGE_ERROR",
    });
  });

  test("parses CRLF frontmatter (review)", () => {
    const crlf = SKILL_MD.replace(/\n/g, "\r\n");
    const summary = parseSkillSummary(crlf);
    expect(summary.name).toBe("finch");
    expect(summary.description).toContain("act on X/Twitter");
  });

  test("surfaces a CLIENT_ERROR (with the path) when the SKILL.md is missing", async () => {
    const missing = join(dir, "nope", "SKILL.md");
    const err = await runSkills([], { skillPath: missing }).catch((e) => e);
    expect(err).toBeInstanceOf(FinchError);
    expect((err as FinchError).code).toBe("CLIENT_ERROR");
    expect((err as FinchError).message).toContain(missing);
  });

  test("parseSkillSummary falls back to name 'finch' with no frontmatter", () => {
    const summary = parseSkillSummary("# just a heading\n\nno frontmatter here");
    expect(summary.name).toBe("finch");
    expect(summary.description).toBe("");
  });
});
