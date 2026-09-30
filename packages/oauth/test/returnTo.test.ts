import { describe, expect, it } from "@effect/vitest";
import { sanitizeReturnTo } from "../src/internal/returnTo.ts";

describe("sanitizeReturnTo", () => {
  it.each([
    ["/", "/"],
    ["/projects/1?tab=files#top", "/projects/1?tab=files#top"],
    ["/a/../b", "/b"],
  ])("keeps the same-origin path %s", (input, expected) => {
    expect(sanitizeReturnTo(input)).toBe(expected);
  });

  it.each([
    [undefined],
    [null],
    [""],
    ["projects"],
    ["https://evil.example/"],
    ["//evil.example/"],
    ["/\\evil.example/"],
    ["/\t/evil.example/"],
    ["/.//evil.example/"],
    ["javascript:alert(1)"],
  ])("falls back for %j", (input) => {
    expect(sanitizeReturnTo(input)).toBe("/");
  });
});
