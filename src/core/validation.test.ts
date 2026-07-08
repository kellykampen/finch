import { describe, test, expect } from "bun:test";
import { validatePostText } from "./validation";
import { FinchError } from "./errors";

describe("validatePostText", () => {
  test("accepts ordinary text", () => {
    expect(() => validatePostText("hello world")).not.toThrow();
  });

  test("accepts multi-line text (newline/tab/CR are not disallowed)", () => {
    expect(() => validatePostText("line one\nline two\tindented\r")).not.toThrow();
  });

  test("rejects empty text", () => {
    expect(() => validatePostText("")).toThrow(FinchError);
  });

  test("rejects text containing an ESC control character", () => {
    expect(() => validatePostText("hello\x1Bworld")).toThrow(FinchError);
  });

  test("rejects text containing a NUL byte", () => {
    expect(() => validatePostText("hello\x00world")).toThrow(FinchError);
  });

  test("rejects text exceeding the post length limit", () => {
    expect(() => validatePostText("x".repeat(281))).toThrow(FinchError);
  });

  test("accepts text exactly at the post length limit", () => {
    expect(() => validatePostText("x".repeat(280))).not.toThrow();
  });
});
