import pkg from "../../package.json" with { type: "json" };

export interface VersionResult {
  version: string;
}

/**
 * `finch version` / `--version`: reports the semver baked into this exact
 * binary at build time (`import ... with { type: "json" }` is resolved by
 * Bun at compile time, so a `bun build --compile` binary always reports the
 * version of the source it was built from, not whatever `package.json`
 * happens to say on disk right now). Exists so a "command not recognized"
 * report can be triaged as stale-binary-vs-real-regression before digging
 * further — see FIN-59.
 */
export async function runVersion(): Promise<{ data: VersionResult; human: string }> {
  const data: VersionResult = { version: pkg.version };
  return { data, human: `finch ${pkg.version}` };
}
