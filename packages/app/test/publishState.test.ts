import { describe, expect, it } from "vitest";
import { publishState } from "../src/routes/studio/publishState.ts";

describe("publishState", () => {
  it("has changes to discard when the draft is not the published version (AC-1)", () => {
    expect(
      publishState({
        publishedHeads: ["b", "a"],
        version: "a,c",
        saving: false,
      }).changed,
    ).toBe(true);
  });

  it("has changes to discard while edits are still being saved (AC-1)", () => {
    expect(
      publishState({ publishedHeads: ["b", "a"], version: "a,b", saving: true })
        .changed,
    ).toBe(true);
  });

  it("has nothing to discard for an event never published (AC-2)", () => {
    for (const saving of [false, true]) {
      expect(
        publishState({ publishedHeads: undefined, version: "a", saving })
          .changed,
      ).toBe(false);
    }
  });

  it("has nothing to discard when the draft is the published version (AC-2)", () => {
    expect(
      publishState({
        publishedHeads: ["b", "a"],
        version: "a,b",
        saving: false,
      }).changed,
    ).toBe(false);
  });

  it("is up to date when the published heads, in any order, are the draft's (AC-7)", () => {
    expect(
      publishState({
        publishedHeads: ["b", "a"],
        version: "a,b",
        saving: false,
      }).upToDate,
    ).toBe(true);
  });
});
