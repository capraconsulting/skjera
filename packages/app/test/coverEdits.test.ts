import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as A from "@automerge/automerge/slim";
import { beforeAll, describe, expect, it } from "vitest";
import {
  resetCropAndFocus,
  setCrop,
  setFocus,
  setPicture,
} from "../src/editor/coverEdits.ts";

const picture = "/api/images/AAAAAAAAAAAAAAAAAAAAAA";
const another = "/api/images/CCCCCCCCCCCCCCCCCCCCCC";
const part = "/api/images/BBBBBBBBBBBBBBBBBBBBBB";

const crop = {
  x: 0.25,
  y: 0,
  width: 0.5,
  height: 1,
  from: picture,
  src: part,
};

beforeAll(async () => {
  const wasm = createRequire(import.meta.url).resolve(
    "@automerge/automerge/automerge.wasm",
  );
  await A.initializeWasm(await readFile(wasm));
});

type Draft = { cover?: Record<string, unknown> };

type ReadCover = {
  readonly src: string;
  readonly alt?: string;
  readonly crop?: { readonly from: string; readonly src: string };
  readonly focus?: unknown;
};

/** The cover as the draft holds it, addresses as strings. */
const coverOf = (doc: Draft): ReadCover | undefined => {
  const cover = doc.cover;
  if (cover === undefined) return undefined;
  const crop = cover.crop as Record<string, unknown> | undefined;
  const focus = cover.focus as Record<string, unknown> | undefined;
  return {
    ...cover,
    src: String(cover.src),
    ...(focus === undefined
      ? {}
      : { focus: { ...focus, from: String(focus.from) } }),
    ...(crop === undefined
      ? {}
      : {
          crop: { ...crop, from: String(crop.from), src: String(crop.src) },
        }),
  };
};

/** A draft edited the way the field edits it: one change per call. */
const draftOf = (cover?: Record<string, unknown>) => {
  let doc = A.from<Draft>({});
  const edit = (fn: (draft: Draft) => unknown) => {
    doc = A.change(doc, (d) => {
      fn(d as Draft);
    });
  };
  if (cover !== undefined) edit((d) => setPicture(d as never, picture));
  if (cover?.alt !== undefined) {
    edit((d) => {
      (d.cover as { alt: string }).alt = String(cover.alt);
    });
  }
  return { edit, read: () => coverOf(doc as Draft) };
};

describe("setPicture", () => {
  it("makes a cover of the picture with an empty description when there is none (AC-5)", () => {
    const draft = draftOf();
    draft.edit((d) => setPicture(d as never, picture));
    expect(draft.read()).toEqual({ src: picture, alt: "" });
  });

  it("drops the crop and the focal point, and keeps the description (AC-5)", () => {
    const draft = draftOf({ alt: "A full room" });
    draft.edit((d) => setCrop(d as never, crop));
    draft.edit((d) => setFocus(d as never, { x: 0.8, y: 0.3 }));
    draft.edit((d) => setPicture(d as never, another));
    expect(draft.read()).toEqual({ src: another, alt: "A full room" });
  });
});

describe("setCrop", () => {
  it("writes the crop and leaves the picture's own address as it was (AC-1, AC-9)", () => {
    const draft = draftOf({ alt: "" });
    draft.edit((d) => setCrop(d as never, crop));
    expect(draft.read()?.crop).toEqual(crop);
    expect(draft.read()?.src).toBe(picture);
    expect(draft.read()?.crop?.src).not.toBe(picture);
  });

  it("writes no crop that reaches outside the picture, has no width, or is not an uploaded image (AC-1)", () => {
    for (const bad of [
      { ...crop, x: 0.6 },
      { ...crop, height: 1.5 },
      { ...crop, width: 0 },
      { ...crop, src: "https://example.com/x.png" },
    ]) {
      const draft = draftOf({ alt: "" });
      let written: unknown = "not called";
      draft.edit((d) => {
        written = setCrop(d as never, bad);
      });
      expect(written, JSON.stringify(bad)).toBe(false);
      expect(draft.read()?.crop, JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("writes no crop once the picture it was cut from has been replaced (AC-5)", () => {
    const draft = draftOf({ alt: "" });
    draft.edit((d) => setPicture(d as never, another));
    draft.edit((d) => setCrop(d as never, crop));
    expect(draft.read()).toEqual({ src: another, alt: "" });
  });

  it("writes nothing when there is no cover (AC-5)", () => {
    const draft = draftOf();
    draft.edit((d) => setCrop(d as never, crop));
    expect(draft.read()).toBeUndefined();
  });
});

describe("setFocus", () => {
  it("writes the focal point (AC-1)", () => {
    const draft = draftOf({ alt: "" });
    draft.edit((d) => setFocus(d as never, { x: 0.8, y: 0.3 }));
    expect(draft.read()?.focus).toEqual({ x: 0.8, y: 0.3, from: picture });
  });

  it("records the picture it was set on, so a new picture's merge can drop it (AC-5)", () => {
    const draft = draftOf({ alt: "" });
    draft.edit((d) => setFocus(d as never, { x: 0.8, y: 0.3 }));
    draft.edit((d) => {
      // Another organiser's new picture, written without touching the point.
      (d.cover as { src: unknown }).src = new A.ImmutableString(another);
    });
    expect(draft.read()?.focus).toMatchObject({ from: picture });
    expect(draft.read()?.src).toBe(another);
  });

  it("writes no point outside the picture (AC-1)", () => {
    for (const bad of [
      { x: 1.2, y: 0.5 },
      { x: 0.5, y: -0.1 },
    ]) {
      const draft = draftOf({ alt: "" });
      draft.edit((d) => setFocus(d as never, bad));
      expect(draft.read()?.focus, JSON.stringify(bad)).toBeUndefined();
    }
  });
});

describe("resetCropAndFocus", () => {
  it("removes both and keeps the picture and its description (AC-8)", () => {
    const draft = draftOf({ alt: "A full room" });
    draft.edit((d) => setCrop(d as never, crop));
    draft.edit((d) => setFocus(d as never, { x: 0.8, y: 0.3 }));
    draft.edit((d) => resetCropAndFocus(d as never));
    expect(draft.read()).toEqual({ src: picture, alt: "A full room" });
  });
});
