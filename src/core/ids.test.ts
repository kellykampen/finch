import { describe, test, expect } from "bun:test";
import { extractTweetId, normalizeUsername } from "./ids";
import { FinchError } from "./errors";

describe("extractTweetId", () => {
  test("passes through a bare numeric id", () => {
    expect(extractTweetId("12345")).toBe("12345");
  });

  test("extracts the id from an x.com status URL", () => {
    expect(extractTweetId("https://x.com/user/status/12345")).toBe("12345");
  });

  test("extracts the id from a twitter.com status URL", () => {
    expect(extractTweetId("https://twitter.com/user/status/12345")).toBe("12345");
  });

  test("extracts the id from a URL with a trailing path segment", () => {
    expect(extractTweetId("https://x.com/user/status/12345/photo/1")).toBe("12345");
  });

  test("rejects a non-numeric, non-URL argument", () => {
    expect(() => extractTweetId("not-an-id")).toThrow(FinchError);
  });

  test("rejects a URL from an unrecognized host", () => {
    expect(() => extractTweetId("https://evil.example/user/status/12345")).toThrow(FinchError);
  });

  test("rejects a status URL with unexpected query params", () => {
    expect(() => extractTweetId("https://x.com/user/status/12345?s=20")).toThrow(FinchError);
  });

  test("rejects a URL missing a status path", () => {
    expect(() => extractTweetId("https://x.com/user")).toThrow(FinchError);
  });
});

describe("normalizeUsername", () => {
  test("strips a leading @", () => {
    expect(normalizeUsername("@kelly")).toBe("kelly");
  });

  test("leaves a username without @ untouched", () => {
    expect(normalizeUsername("kelly")).toBe("kelly");
  });
});
