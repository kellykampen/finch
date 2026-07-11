import { describe, test, expect } from "bun:test";
import { runAuthStatus } from "./auth";
import { runWhoami } from "./whoami";
import { runConfigPath } from "./config";
import type { FinchOAuth2Config } from "../core/oauth2-config";
import { fakeTransport } from "../core/transport.fixtures";

// FIN-72: the "no-secret diagnostics" set — the commands the README tells users
// to paste into a support handoff (`finch auth status`, `finch whoami`,
// `finch config path`). These cases pin that neither the machine (`data`) nor
// the human output ever carries credential material, so a future field addition
// can't silently turn a safe diagnostic command into a token leak.

// Distinctive sentinel secrets: if any of these substrings ever appears in a
// diagnostic command's output, the masking/omission guarantee has regressed.
const SECRETS = {
  clientId: "SENTINEL-client-id-11112222",
  accessToken: "SENTINEL-access-token-33334444",
  refreshToken: "SENTINEL-refresh-token-55556666",
};

const fakeMe = { id: "1", username: "kelly", name: "Kelly" };

const configWithSecrets: FinchOAuth2Config = {
  auth: {
    clientId: SECRETS.clientId,
    accessToken: SECRETS.accessToken,
    refreshToken: SECRETS.refreshToken,
    expiresAt: 9_999_999_999_000,
    scopes: ["tweet.read", "users.read", "offline.access"],
  },
  transport: "oauth2",
  defaults: { json: false, count: 10 },
};

function assertNoSecrets(result: { data: unknown; human: string }): void {
  // Serialize the whole envelope (machine `data` + human string) and confirm no
  // sentinel secret survives into anything a user would copy into a bug report.
  const serialized = `${JSON.stringify(result.data)}\n${result.human}`;
  for (const secret of Object.values(SECRETS)) {
    expect(serialized).not.toContain(secret);
  }
}

describe("no-secret diagnostics set (FIN-72)", () => {
  test("`auth status` reports state without emitting any credential", async () => {
    const result = await runAuthStatus({
      readOAuth2Config: () => configWithSecrets,
      createRefreshingTransport: () => fakeTransport({ getMe: async () => fakeMe }),
    });

    expect(result.data).toEqual({ configured: true, valid: true, username: "kelly" });
    assertNoSecrets(result);
  });

  test("`whoami` returns only id/username/name — no credential fields", async () => {
    const result = await runWhoami({
      getTransport: () => fakeTransport({ getMe: async () => fakeMe }),
    });

    expect(Object.keys(result.data).sort()).toEqual(["id", "name", "username"]);
    assertNoSecrets(result);
  });

  test("`config path` prints the path, never the config contents", async () => {
    const result = await runConfigPath([], {
      configPath: () => "/home/kelly/.finch/config",
    });

    expect(result.data).toEqual({ path: "/home/kelly/.finch/config" });
    assertNoSecrets(result);
  });
});
