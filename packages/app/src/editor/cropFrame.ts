// The geometry of cropping a cover: a frame and a focal point, both as shares
// (0 to 1) of the picture, from pointer positions and from keys.

/** A part of the picture: its top left corner and its size, as shares. */
export type Frame = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** A point of the picture, as shares of its width and height. */
export type Point = { readonly x: number; readonly y: number };

/** The least a frame may be, of the picture's width and of its height. */
export const minShare = 0.05;

/** How far an arrow key moves a frame or a point, as a share. */
const step = 0.01;

const round = (share: number) => Math.round(share * 10000) / 10000;
const hold = (share: number, least = 0, most = 1) =>
  Math.min(most, Math.max(least, share));

/** A pointer position in the picture shown, as shares of it, held inside it. */
export const pointInPicture = (
  pointer: Point,
  shown: { readonly width: number; readonly height: number },
): Point => ({
  x: round(hold(pointer.x / shown.width)),
  y: round(hold(pointer.y / shown.height)),
});

/** One side of a frame: where it starts and how long it is. */
const side = (a: number, b: number) => {
  const length = round(hold(Math.abs(a - b), minShare));
  return { start: round(Math.min(Math.min(a, b), 1 - length)), length };
};

/** The frame between two points, at least the least size, inside the picture. */
export const drawFrame = (a: Point, b: Point): Frame => {
  const horizontal = side(a.x, b.x);
  const vertical = side(a.y, b.y);
  return {
    x: horizontal.start,
    y: vertical.start,
    width: horizontal.length,
    height: vertical.length,
  };
};

/** The frame moved by shares, stopping at the picture's edge, size kept. */
export const moveFrame = (frame: Frame, dx: number, dy: number): Frame => ({
  ...frame,
  x: round(hold(frame.x + dx, 0, 1 - frame.width)),
  y: round(hold(frame.y + dy, 0, 1 - frame.height)),
});

const arrows: Record<string, Point> = {
  ArrowLeft: { x: -step, y: 0 },
  ArrowRight: { x: step, y: 0 },
  ArrowUp: { x: 0, y: -step },
  ArrowDown: { x: 0, y: step },
};

/**
 * The frame after an arrow key: moved, or with Shift changing its width
 * (left and right) or its height (up and down). Another key changes nothing.
 */
export const keyFrame = (frame: Frame, key: string, shift: boolean): Frame => {
  const arrow = arrows[key];
  if (arrow === undefined) return frame;
  if (!shift) return moveFrame(frame, arrow.x, arrow.y);
  return {
    ...frame,
    width: round(hold(frame.width + arrow.x, minShare, 1 - frame.x)),
    height: round(hold(frame.height + arrow.y, minShare, 1 - frame.y)),
  };
};

/** The frame in the picture's own pixels, whole pixels inside the picture. */
export const frameInPixels = (
  frame: Frame,
  size: { readonly width: number; readonly height: number },
): Frame => {
  const span = (start: number, length: number, total: number) => {
    const from = Math.min(Math.round(start * total), total - 1);
    const to = Math.min(Math.round((start + length) * total), total);
    return { start: from, length: Math.max(1, to - from) };
  };
  const horizontal = span(frame.x, frame.width, size.width);
  const vertical = span(frame.y, frame.height, size.height);
  return {
    x: horizontal.start,
    y: vertical.start,
    width: horizontal.length,
    height: vertical.length,
  };
};

/**
 * A point of the part shown (as shares of it) as shares of the whole picture.
 * No part cut out: the part shown is the picture.
 */
export const focusInShown = (point: Point, crop: Frame | null): Point =>
  crop === null
    ? point
    : {
        x: round(crop.x + point.x * crop.width),
        y: round(crop.y + point.y * crop.height),
      };

/**
 * A point of the picture (as shares of it) as shares of the part shown: held
 * at the part's nearest edge when it lies outside. The reverse of
 * `focusInShown`.
 */
export const focusInPart = (point: Point, crop: Frame | null): Point =>
  crop === null
    ? point
    : {
        x: round(hold((point.x - crop.x) / crop.width)),
        y: round(hold((point.y - crop.y) / crop.height)),
      };

/** The point after an arrow key, held inside the picture. */
export const keyFocus = (point: Point, key: string): Point => {
  const arrow = arrows[key];
  if (arrow === undefined) return point;
  return {
    x: round(hold(point.x + arrow.x)),
    y: round(hold(point.y + arrow.y)),
  };
};
