import { describe, test, expect } from "bun:test";
import { runUser } from "./user";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

const fakeAuth = { apiKey: "k", apiKeySecret: "ks", accessToken: "t", accessTokenSecret: "ts" };

describe("runUser", () => {
  test("looks up a profile by username", async () => {
    const profile = {
      id: "42",
      username: "kelly",
      name: "Kelly",
      description: "bio",
      public_metrics: { followersCount: 10 },
    };
    const transport = fakeTransport({ getUserByUsername: async () => profile });

    const result = await runUser(["kelly"], {
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
    });

    expect(result.data).toEqual(profile);
  });

  test("strips a leading @ from the username", async () => {
    let capturedUsername: string | undefined;
    const transport = fakeTransport({
      getUserByUsername: async (username) => {
        capturedUsername = username;
        return { id: "42", username, name: "Kelly", description: "", public_metrics: {} };
      },
    });

    await runUser(["@kelly"], { resolveAuth: () => fakeAuth, transportFactory: () => transport });

    expect(capturedUsername).toBe("kelly");
  });

  test("throws USAGE_ERROR when the username is missing", async () => {
    await expect(
      runUser([], { resolveAuth: () => fakeAuth, transportFactory: () => fakeTransport({}) }),
    ).rejects.toThrow(FinchError);
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    await expect(
      runUser(["kelly"], {
        resolveAuth: () => null,
        transportFactory: () => {
          throw new Error("should not be called");
        },
      }),
    ).rejects.toThrow(FinchError);
  });
});
