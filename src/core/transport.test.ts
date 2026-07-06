import { describe, test, expect } from "bun:test";
import { ApiError } from "@xdevplatform/xdk";
import { ByokTransport } from "./transport";
import { FinchError } from "./errors";

describe("ByokTransport.getMe", () => {
  test("returns id/username/name on a successful call", async () => {
    const transport = new ByokTransport({
      getMe: async () => ({
        data: { id: "123", username: "kelly", name: "Kelly" },
      }),
    });

    const me = await transport.getMe();

    expect(me).toEqual({ id: "123", username: "kelly", name: "Kelly" });
  });

  test("throws AUTH_ERROR when the response has no data", async () => {
    const transport = new ByokTransport({
      getMe: async () => ({ errors: [{ detail: "no user" }] }),
    });

    await expect(transport.getMe()).rejects.toThrow(FinchError);
    try {
      await transport.getMe();
      throw new Error("expected getMe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
    }
  });

  test("maps a 401 ApiError to AUTH_ERROR", async () => {
    const transport = new ByokTransport({
      getMe: async () => {
        throw new ApiError("Unauthorized", 401, "Unauthorized", new Headers(), { detail: "bad token" });
      },
    });

    try {
      await transport.getMe();
      throw new Error("expected getMe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("AUTH_ERROR");
    }
  });

  test("maps a 429 ApiError to RATE_LIMITED", async () => {
    const transport = new ByokTransport({
      getMe: async () => {
        throw new ApiError("Too Many Requests", 429, "Too Many Requests", new Headers(), null);
      },
    });

    try {
      await transport.getMe();
      throw new Error("expected getMe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("RATE_LIMITED");
    }
  });

  test("maps a 404 ApiError to CLIENT_ERROR", async () => {
    const transport = new ByokTransport({
      getMe: async () => {
        throw new ApiError("Not Found", 404, "Not Found", new Headers(), null);
      },
    });

    try {
      await transport.getMe();
      throw new Error("expected getMe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("CLIENT_ERROR");
    }
  });

  test("maps a non-ApiError (e.g. network failure) to NETWORK_ERROR", async () => {
    const transport = new ByokTransport({
      getMe: async () => {
        throw new TypeError("fetch failed");
      },
    });

    try {
      await transport.getMe();
      throw new Error("expected getMe to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FinchError);
      expect((err as FinchError).code).toBe("NETWORK_ERROR");
    }
  });
});
