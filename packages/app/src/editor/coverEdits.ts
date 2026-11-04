import * as A from "@automerge/automerge/slim";
import { CoverCrop, CoverFocus } from "@skjera/documents/api";
import { Schema } from "effect";

// How the studio edits an event's cover in the draft. The addresses are
// ImmutableStrings, replaced whole; the crop and the focal point are written
// as new objects, so two organisers changing one at once end with one of them
// whole, never a mix.

type Cover = {
  src: unknown;
  alt: string;
  crop?: unknown;
  focus?: unknown;
};

/** The part of the draft the cover lives in. */
export type Draft = { cover?: Cover };

const isCrop = Schema.is(CoverCrop);
const isFocus = Schema.is(CoverFocus);

/**
 * Makes the picture the cover. A cover that was there keeps its description
 * but loses the crop and the focal point of the picture it replaces.
 */
export const setPicture = (draft: Draft, url: string): void => {
  const src = new A.ImmutableString(url);
  if (draft.cover === undefined) {
    draft.cover = { src, alt: "" };
    return;
  }
  draft.cover.src = src;
  delete draft.cover.crop;
  delete draft.cover.focus;
};

/**
 * Writes the crop, when it is a part inside the picture, of an uploaded image,
 * cut from the picture the cover has now. A crop that finishes uploading after
 * the picture was replaced is not written. Says whether it was written.
 */
export const setCrop = (draft: Draft, crop: CoverCrop): boolean => {
  const cover = draft.cover;
  if (cover === undefined || !isCrop(crop)) return false;
  if (String(cover.src) !== crop.from) return false;
  cover.crop = {
    x: crop.x,
    y: crop.y,
    width: crop.width,
    height: crop.height,
    from: new A.ImmutableString(crop.from),
    src: new A.ImmutableString(crop.src),
  };
  return true;
};

/** Writes the focal point, when it is inside the picture. Says whether it was. */
export const setFocus = (
  draft: Draft,
  point: { readonly x: number; readonly y: number },
): boolean => {
  const cover = draft.cover;
  if (cover === undefined || !isFocus({ x: point.x, y: point.y })) return false;
  cover.focus = {
    x: point.x,
    y: point.y,
    // The picture it is set on, so a merge with a new picture drops it.
    from: new A.ImmutableString(String(cover.src)),
  };
  return true;
};

/** Removes the crop and the focal point; the picture and its description stay. */
export const resetCropAndFocus = (draft: Draft): void => {
  if (draft.cover === undefined) return;
  delete draft.cover.crop;
  delete draft.cover.focus;
};
