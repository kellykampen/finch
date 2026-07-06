import { describe, test, expect } from "bun:test";
import { runWhoami } from "./whoami";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

const fakeAuth = { apiKey: "k", apiKeySecret: "ks", accessToken: "t", accessTokenSecret: "ts" };

describe("runWhoami", () => {
  test("returns the authenticated user's id/username/name", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });

    const result = await runWhoami({
      resolveAuth: () => fakeAuth,
      transportFactory: () => transport,
    });

    expect(result.data).toEqual({ id: "1", username: "kelly", name: "Kelly" });
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    let called = false;
    try {
      await runWhoami({
        resolveAuth: () => null,
        transportFactory: () => {
          called = true;
          throw new Error("should not be called");
        },
      });
      throw new Error("expected runWhoami to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
    }
    expect(called).toBe(false);
  });

  test("propagates transport errors (e.g. rejected credentials) as-is", async () => {
    const transport = fakeTransport({
      getMe: async () => {
        throw new FinchError("AUTH_ERROR", "X rejected the provided credentials");
      },
    });

    try {
      await runWhoami({ resolveAuth: () => fakeAuth, transportFactory: () => transport });
      throw new Error("expected runWhoami to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
    }
  });
});
