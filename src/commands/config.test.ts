import { describe, test, expect } from "bun:test";
import { runConfigGet, runConfigSet, runConfigPath } from "./config";
import { FinchError } from "../core/errors";
import type { FinchConfig } from "../core/config";

const sampleAuth = {
  apiKey: "key123456",
  apiKeySecret: "secret123456",
  accessToken: "token123456",
  accessTokenSecret: "tokensecret123456",
};

const sampleConfig: FinchConfig = {
  auth: sampleAuth,
  transport: "byok",
  defaults: { json: false, count: 10 },
};

describe("runConfigGet", () => {
  test("prints a non-secret string value (transport)", async () => {
    const result = await runConfigGet(["transport"], { readConfig: () => sampleConfig });
    expect(result.data).toEqual({ key: "transport", value: "byok" });
  });

  test("prints a non-secret number value as a string (defaults.count)", async () => {
    const result = await runConfigGet(["defaults.count"], { readConfig: () => sampleConfig });
    expect(result.data).toEqual({ key: "defaults.count", value: "10" });
  });

  test("prints a non-secret boolean value as a string (defaults.json)", async () => {
    const result = await runConfigGet(["defaults.json"], { readConfig: () => sampleConfig });
    expect(result.data).toEqual({ key: "defaults.json", value: "false" });
  });

  test("masks auth.* fields to all-but-last-4 characters", async () => {
    const result = await runConfigGet(["auth.apiKey"], { readConfig: () => sampleConfig });
    expect(result.data).toEqual({ key: "auth.apiKey", value: "*****3456" });
    expect((result.data as { value: string }).value).not.toContain("key123456");
  });

  test("masks every auth.* field, never the full plaintext", async () => {
    for (const key of ["auth.apiKeySecret", "auth.accessToken", "auth.accessTokenSecret"]) {
      const result = await runConfigGet([key], { readConfig: () => sampleConfig });
      const value = (result.data as { value: string }).value;
      expect(value).toMatch(/^\*+\w{4}$/);
    }
  });

  test("masking happens regardless of --json", async () => {
    // runConfigGet is JSON-shape-agnostic (the CLI layer decides --json vs
    // human output) — masking must apply to the returned data either way,
    // since the human formatter reads the same `value` field.
    const jsonResult = await runConfigGet(["auth.apiKey"], { readConfig: () => sampleConfig });
    const humanResult = await runConfigGet(["auth.apiKey"], { readConfig: () => sampleConfig });
    expect(jsonResult.data).toEqual(humanResult.data);
    expect((jsonResult.data as { value: string }).value).toBe("*****3456");
  });

  test("throws USAGE_ERROR for an unknown key", async () => {
    await expect(
      runConfigGet(["bogus.key"], { readConfig: () => sampleConfig }),
    ).rejects.toThrow(FinchError);
  });

  test("throws AUTH_ERROR when no config exists", async () => {
    let thrown: unknown;
    try {
      await runConfigGet(["transport"], { readConfig: () => null });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FinchError);
    expect((thrown as FinchError).code).toBe("AUTH_ERROR");
  });

  test("throws USAGE_ERROR when no key is given", async () => {
    await expect(runConfigGet([], { readConfig: () => sampleConfig })).rejects.toThrow(FinchError);
  });
});

describe("runConfigSet", () => {
  test("sets defaults.count and writes the updated config", async () => {
    const written: { config: FinchConfig | null } = { config: null };
    const result = await runConfigSet(["defaults.count", "25"], {
      readConfig: () => sampleConfig,
      writeConfig: (config) => {
        written.config = config;
      },
    });

    expect(result.data).toEqual({ key: "defaults.count", value: "25" });
    expect(written.config).toEqual({ ...sampleConfig, defaults: { json: false, count: 25 } });
  });

  test("sets defaults.json and writes the updated config", async () => {
    const written: { config: FinchConfig | null } = { config: null };
    const result = await runConfigSet(["defaults.json", "true"], {
      readConfig: () => sampleConfig,
      writeConfig: (config) => {
        written.config = config;
      },
    });

    expect(result.data).toEqual({ key: "defaults.json", value: "true" });
    expect(written.config).toEqual({ ...sampleConfig, defaults: { json: true, count: 10 } });
  });

  test("rejects setting any auth.* field with a clear USAGE_ERROR pointing at finch auth", async () => {
    let thrown: unknown;
    try {
      await runConfigSet(["auth.apiKey", "newvalue"], {
        readConfig: () => sampleConfig,
        writeConfig: () => {
          throw new Error("should not write");
        },
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FinchError);
    expect((thrown as FinchError).code).toBe("USAGE_ERROR");
    expect((thrown as FinchError).message).toMatch(/finch auth/i);
  });

  test("rejects setting an unsupported non-secret key (e.g. transport)", async () => {
    await expect(
      runConfigSet(["transport", "proxy"], {
        readConfig: () => sampleConfig,
        writeConfig: () => {
          throw new Error("should not write");
        },
      }),
    ).rejects.toThrow(FinchError);
  });

  test("rejects an invalid value for defaults.count", async () => {
    await expect(
      runConfigSet(["defaults.count", "not-a-number"], {
        readConfig: () => sampleConfig,
        writeConfig: () => {
          throw new Error("should not write");
        },
      }),
    ).rejects.toThrow(FinchError);
  });

  test("throws AUTH_ERROR when no config exists", async () => {
    let thrown: unknown;
    try {
      await runConfigSet(["defaults.count", "5"], { readConfig: () => null });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(FinchError);
    expect((thrown as FinchError).code).toBe("AUTH_ERROR");
  });

  test("throws USAGE_ERROR when key or value is missing", async () => {
    await expect(
      runConfigSet(["defaults.count"], { readConfig: () => sampleConfig }),
    ).rejects.toThrow(FinchError);
  });
});

describe("runConfigPath", () => {
  test("prints the resolved config path without requiring the file to exist", async () => {
    const result = await runConfigPath([], { configPath: () => "/home/fake/.finch/config" });
    expect(result.data).toEqual({ path: "/home/fake/.finch/config" });
  });
});
