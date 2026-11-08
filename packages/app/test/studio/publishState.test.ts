import { describe, expect, it } from "vitest";
import {
  isDraft,
  publishedState,
  publishState,
  rowState,
  versionOf,
} from "../../src/routes/studio/publishing/publishState.ts";

it("uses one order-independent published-state rule in the list and editor (AC-2)", () => {
  expect(versionOf(["b", "a"])).toBe("a,b");
  expect(publishedState(["b", "a"], "a,b")).toBe("published");
  expect(rowState({ publishedHeads: ["b", "a"], draftHeads: ["a", "b"] })).toBe(
    "published",
  );
  expect(
    publishState({ publishedHeads: ["b", "a"], version: "a,b", saving: false }),
  ).toEqual({
    upToDate: true,
    changed: false,
  });
  expect(publishedState(["a"], "a,b")).toBe("changed");
  expect(publishedState(undefined, "a,b")).toBe("draft");
});

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

describe("isDraft", () => {
  it("is the draft when the heads are the draft's, in any order (AC-3)", () => {
    expect(isDraft(["b", "a"], "a,b")).toBe(true);
    expect(isDraft(["a", "b"], "a,b")).toBe(true);
  });

  it("is not the draft when the heads differ from the draft's (AC-3)", () => {
    expect(isDraft(["a"], "a,b")).toBe(false);
    expect(isDraft(["a", "c"], "a,b")).toBe(false);
  });
});
