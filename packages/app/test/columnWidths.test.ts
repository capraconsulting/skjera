import { describe, expect, it } from "vitest";
import {
  clampWidth,
  defaultWidths,
  maxWidth,
  minWidth,
  readWidths,
} from "../src/routes/studio/columnWidths.ts";

describe("clampWidth", () => {
  it("keeps a width between the narrowest and the widest", () => {
    expect(clampWidth(20)).toBe(20);
    expect(clampWidth(minWidth - 5)).toBe(minWidth);
    expect(clampWidth(maxWidth + 5)).toBe(maxWidth);
  });

  it("rounds to a quarter of a rem", () => {
    expect(clampWidth(20.1)).toBe(20);
    expect(clampWidth(20.2)).toBe(20.25);
  });
});

describe("readWidths", () => {
  it("gives the default widths when nothing is stored", () => {
    expect(readWidths(null)).toEqual(defaultWidths);
  });

  it("reads the widths stored", () => {
    expect(readWidths(JSON.stringify({ teams: 24, events: 18 }))).toEqual({
      teams: 24,
      events: 18,
    });
  });

  it("keeps stored widths within the limits", () => {
    expect(readWidths(JSON.stringify({ teams: 2, events: 99 }))).toEqual({
      teams: minWidth,
      events: maxWidth,
    });
  });

  it("falls back to the default for what isn't a width", () => {
    expect(readWidths("not json")).toEqual(defaultWidths);
    expect(readWidths(JSON.stringify({ teams: "wide", events: 18 }))).toEqual({
      teams: defaultWidths.teams,
      events: 18,
    });
    expect(readWidths(JSON.stringify([24, 18]))).toEqual(defaultWidths);
  });
});
