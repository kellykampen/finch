import { describe, test, expect } from "bun:test";
import { runVersion } from "./version";
import pkg from "../../package.json" with { type: "json" };

describe("runVersion", () => {
  test("reports the version baked into package.json at build time", async () => {
    const result = await runVersion();
    expect(result.data).toEqual({ version: pkg.version });
    expect(result.human).toBe(`finch ${pkg.version}`);
  });

  test("version is a non-empty semver-shaped string", async () => {
    const result = await runVersion();
    expect(result.data.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
