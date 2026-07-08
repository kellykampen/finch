import { describe, test, expect } from "bun:test";
import { runWhoami } from "./whoami";
import { FinchError } from "../core/errors";
import { fakeTransport } from "../core/transport.fixtures";

describe("runWhoami", () => {
  test("returns the authenticated user's id/username/name", async () => {
    const transport = fakeTransport({
      getMe: async () => ({ id: "1", username: "kelly", name: "Kelly" }),
    });

    const result = await runWhoami({ getTransport: () => transport });

    expect(result.data).toEqual({ id: "1", username: "kelly", name: "Kelly" });
  });

  test("throws AUTH_ERROR when Finch is not configured", async () => {
    try {
      await runWhoami({
        getTransport: () => {
          throw new FinchError("AUTH_ERROR", "Finch is not configured. Run `finch auth` first.");
        },
      });
      throw new Error("expected runWhoami to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
    }
  });

  test("propagates transport errors (e.g. rejected credentials) as-is", async () => {
    const transport = fakeTransport({
      getMe: async () => {
        throw new FinchError("AUTH_ERROR", "X rejected the provided credentials");
      },
    });

    try {
      await runWhoami({ getTransport: () => transport });
      throw new Error("expected runWhoami to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
    }
  });
});
