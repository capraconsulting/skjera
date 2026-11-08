import { Schema } from "effect";

/** Where uploaded images are served (see ImagesApi.ts). */
export const imagePathPattern = /^\/api\/images\/[A-Za-z0-9_-]{22}$/;

/** Where an uploaded image is served (see ImagesApi.ts). */
export const ImageSrc = Schema.String.check(Schema.isPattern(imagePathPattern));

export const imagePlacements = ["full", "left", "right", "center"] as const;
export const imageSizes = ["small", "medium", "large"] as const;
export interface ImageChoices {
  readonly placement: (typeof imagePlacements)[number];
  readonly size: (typeof imageSizes)[number];
  readonly caption: string;
}
export const defaultImageChoices: ImageChoices = {
  placement: "full",
  size: "medium",
  caption: "",
};

export const linkProtocols = ["http:", "https:", "mailto:"] as const;
export const imageProtocols = ["http:", "https:"] as const;
export const safeLink = (
  value: unknown,
  base: string,
  protocols: ReadonlyArray<string> = linkProtocols,
): string | null => {
  try {
    const url = new URL(String(value), base);
    return protocols.includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

/** A share of the picture's width or height, from 0 to 1. */
const Share = Schema.Number.check(
  Schema.makeFilter(
    (n: number) => (n >= 0 && n <= 1) || "Expected a number from 0 to 1",
  ),
);

/** The part of a cover's picture used, and that part as an image of its own. */
export const CoverCrop = Schema.Struct({
  x: Share,
  y: Share,
  width: Share,
  height: Share,
  /** The picture it was cut from: a crop of another picture is not used. */
  from: ImageSrc,
  /** The part, uploaded as an image of its own. */
  src: ImageSrc,
}).check(
  Schema.makeFilter(
    (crop) =>
      (crop.width > 0 &&
        crop.height > 0 &&
        crop.x + crop.width <= 1 &&
        crop.y + crop.height <= 1) ||
      "Expected a part inside the picture",
  ),
);
export type CoverCrop = typeof CoverCrop.Type;

/** The point of a cover's picture that must stay in view, as shares of it. */
export const CoverFocus = Schema.Struct({
  x: Share,
  y: Share,
  /** The picture it was set on: a point on another picture is not used. */
  from: Schema.optionalKey(ImageSrc),
});
export type CoverFocus = typeof CoverFocus.Type;

/**
 * An event's cover image, with a description for those who can't see it. A
 * crop and a focal point are kept apart from the picture, which is never
 * changed; a cover without them is the whole picture, cut around its centre.
 */
export const Cover = Schema.Struct({
  src: ImageSrc,
  alt: Schema.String,
  crop: Schema.optionalKey(CoverCrop),
  focus: Schema.optionalKey(CoverFocus),
});
export type Cover = typeof Cover.Type;

export const shownCoverData = (cover: Cover): Cover => {
  const { crop, focus, ...plain } = cover;
  return {
    ...plain,
    ...(crop?.from === cover.src ? { crop } : {}),
    ...(focus !== undefined &&
    (focus.from === undefined || focus.from === cover.src)
      ? { focus }
      : {}),
  };
};

/** A share as a CSS percentage, to two decimals and without trailing zeros. */
const percent = (share: number) => `${Math.round(share * 10000) / 100}%`;

const within = (n: number) => Math.min(1, Math.max(0, n));

/**
 * What the site shows of a cover: the file (the cropped part, else the
 * picture) and, for a box of another shape, the CSS `object-position` that
 * keeps the focal point in view: it sits as far into the box as it is into the
 * part shown. Without a focal point: the centre.
 */
export const shownCover = (
  cover: Cover,
): { readonly src: string; readonly position: string } => {
  const { crop, focus } = shownCoverData(cover);
  // No focal point: the centre of the part shown.
  const position = (share: number | undefined, start = 0, length = 1) =>
    percent(share === undefined ? 0.5 : within((share - start) / length));
  return {
    src: crop?.src ?? cover.src,
    position: `${position(focus?.x, crop?.x, crop?.width)} ${position(focus?.y, crop?.y, crop?.height)}`,
  };
};
