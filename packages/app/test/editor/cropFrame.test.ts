import { describe, expect, it } from "vitest";
import {
  drawFrame,
  focusInPart,
  focusInShown,
  frameInPixels,
  keyFocus,
  keyFrame,
  minShare,
  moveFrame,
  pointInPicture,
} from "../../src/editor/cover/cropFrame.ts";

describe("pointInPicture", () => {
  it("gives a pointer position as shares of the picture shown, held inside it (AC-1)", () => {
    const shown = { width: 400, height: 200 };
    expect(pointInPicture({ x: 100, y: 50 }, shown)).toEqual({
      x: 0.25,
      y: 0.25,
    });
    expect(pointInPicture({ x: -30, y: 260 }, shown)).toEqual({ x: 0, y: 1 });
  });

  it("rounds to four decimals (AC-1)", () => {
    expect(pointInPicture({ x: 1, y: 1 }, { width: 3, height: 3 })).toEqual({
      x: 0.3333,
      y: 0.3333,
    });
  });
});

describe("drawFrame", () => {
  it("is the rectangle between the two points, whichever way it is dragged (AC-1)", () => {
    const frame = { x: 0.2, y: 0.1, width: 0.3, height: 0.6 };
    expect(drawFrame({ x: 0.2, y: 0.1 }, { x: 0.5, y: 0.7 })).toEqual(frame);
    expect(drawFrame({ x: 0.5, y: 0.7 }, { x: 0.2, y: 0.1 })).toEqual(frame);
  });

  it("is at least 5 % of each side, and stays inside the picture (AC-1)", () => {
    expect(drawFrame({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 })).toEqual({
      x: 0.5,
      y: 0.5,
      width: minShare,
      height: minShare,
    });
    const corner = drawFrame({ x: 1, y: 1 }, { x: 1, y: 1 });
    expect(corner.x + corner.width).toBeLessThanOrEqual(1);
    expect(corner.y + corner.height).toBeLessThanOrEqual(1);
    expect(corner.width).toBe(minShare);
  });
});

describe("moveFrame", () => {
  const frame = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };

  it("moves the frame and keeps its size (AC-1)", () => {
    expect(moveFrame(frame, 0.1, -0.1)).toEqual({
      x: 0.3,
      y: 0.1,
      width: 0.4,
      height: 0.4,
    });
  });

  it("stops at the edge, with its size kept (AC-1)", () => {
    expect(moveFrame(frame, 0.9, 0.9)).toEqual({
      x: 0.6,
      y: 0.6,
      width: 0.4,
      height: 0.4,
    });
    expect(moveFrame(frame, -0.9, -0.9)).toEqual({
      x: 0,
      y: 0,
      width: 0.4,
      height: 0.4,
    });
  });
});

describe("keyFrame", () => {
  const frame = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };

  it("moves the frame with the arrow keys (AC-1)", () => {
    expect(keyFrame(frame, "ArrowRight", false)).toEqual({
      ...frame,
      x: 0.21,
    });
    expect(keyFrame(frame, "ArrowUp", false)).toEqual({ ...frame, y: 0.19 });
  });

  it("changes the size with Shift and the arrow keys (AC-1)", () => {
    expect(keyFrame(frame, "ArrowRight", true)).toEqual({
      ...frame,
      width: 0.41,
    });
    expect(keyFrame(frame, "ArrowUp", true)).toEqual({
      ...frame,
      height: 0.39,
    });
  });

  it("keeps the frame inside the picture and at least 5 % of each side (AC-1)", () => {
    const small = { x: 0.2, y: 0.2, width: minShare, height: minShare };
    expect(keyFrame(small, "ArrowLeft", true)).toEqual(small);
    const edge = { x: 0.6, y: 0.2, width: 0.4, height: 0.4 };
    expect(keyFrame(edge, "ArrowRight", true)).toEqual(edge);
    expect(keyFrame(edge, "ArrowRight", false)).toEqual(edge);
  });

  it("leaves the frame as it is for any other key (AC-1)", () => {
    expect(keyFrame(frame, "a", false)).toBe(frame);
  });
});

describe("frameInPixels", () => {
  it("is the frame's shares of the picture's own size (AC-1)", () => {
    expect(
      frameInPixels(
        { x: 0.25, y: 0.5, width: 0.5, height: 0.5 },
        { width: 200, height: 100 },
      ),
    ).toEqual({ x: 50, y: 50, width: 100, height: 50 });
  });

  it("rounds to whole pixels and stays inside the picture (AC-1)", () => {
    const pixels = frameInPixels(
      { x: 0.3333, y: 0, width: 0.6667, height: 1 },
      { width: 100, height: 100 },
    );
    expect(Number.isInteger(pixels.x)).toBe(true);
    expect(Number.isInteger(pixels.width)).toBe(true);
    expect(pixels.x + pixels.width).toBeLessThanOrEqual(100);
    expect(pixels.width).toBeGreaterThan(0);
  });
});

describe("focusInShown", () => {
  it("is the clicked point in shares of the whole picture when no part is cut (AC-1)", () => {
    expect(focusInShown({ x: 0.8, y: 0.3 }, null)).toEqual({ x: 0.8, y: 0.3 });
  });

  it("is the clicked point of the part in shares of the whole picture (AC-1)", () => {
    const crop = { x: 0.5, y: 0.25, width: 0.5, height: 0.5 };
    expect(focusInShown({ x: 0.5, y: 0.5 }, crop)).toEqual({
      x: 0.75,
      y: 0.5,
    });
  });
});

describe("focusInPart", () => {
  it("is a point of the picture in shares of the part shown, held at its nearest edge (AC-1)", () => {
    const crop = { x: 0.5, y: 0.25, width: 0.5, height: 0.5 };
    expect(focusInPart({ x: 0.75, y: 0.5 }, crop)).toEqual({ x: 0.5, y: 0.5 });
    expect(focusInPart({ x: 0.1, y: 0.9 }, crop)).toEqual({ x: 0, y: 1 });
    expect(focusInPart({ x: 0.8, y: 0.3 }, null)).toEqual({ x: 0.8, y: 0.3 });
  });
});

describe("keyFocus", () => {
  it("moves the point with the arrow keys, held inside the part shown (AC-1)", () => {
    expect(keyFocus({ x: 0.5, y: 0.5 }, "ArrowLeft")).toEqual({
      x: 0.49,
      y: 0.5,
    });
    expect(keyFocus({ x: 0, y: 1 }, "ArrowLeft")).toEqual({ x: 0, y: 1 });
    expect(keyFocus({ x: 0, y: 1 }, "ArrowDown")).toEqual({ x: 0, y: 1 });
  });
});
