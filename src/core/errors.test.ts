import { describe, test, expect } from "bun:test";
import { FinchError, exitCodeForError } from "./errors";

describe("exitCodeForError", () => {
  test("maps AUTH_ERROR to exit code 3", () => {
    expect(exitCodeForError("AUTH_ERROR")).toBe(3);
  });

  test("maps USAGE_ERROR to exit code 2", () => {
    expect(exitCodeForError("USAGE_ERROR")).toBe(2);
  });

  test("maps CLIENT_ERROR to exit code 4", () => {
    expect(exitCodeForError("CLIENT_ERROR")).toBe(4);
  });

  test("maps RATE_LIMITED to exit code 5", () => {
    expect(exitCodeForError("RATE_LIMITED")).toBe(5);
  });

  test("maps NETWORK_ERROR to exit code 6", () => {
    expect(exitCodeForError("NETWORK_ERROR")).toBe(6);
  });

  test("maps INTERNAL_ERROR to exit code 1", () => {
    expect(exitCodeForError("INTERNAL_ERROR")).toBe(1);
  });
});

describe("FinchError", () => {
  test("carries code, message, and detail", () => {
    const err = new FinchError("AUTH_ERROR", "bad creds", { foo: "bar" });
    expect(err.code).toBe("AUTH_ERROR");
    expect(err.message).toBe("bad creds");
    expect(err.detail).toEqual({ foo: "bar" });
  });

  test("defaults detail to null", () => {
    const err = new FinchError("USAGE_ERROR", "oops");
    expect(err.detail).toBeNull();
  });
});
