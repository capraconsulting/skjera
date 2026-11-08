import { imageTypeCatalogue } from "@skjera/documents/api";
import { describe, expect, it } from "vitest";
import { cropOutputType } from "../../src/editor/cover/cropImage.ts";

describe("cropOutputType", () => {
  it("keeps transparency for every upload type that can have it (AC-3)", () => {
    const expected = {
      "image/png": "image/png",
      "image/jpeg": "image/jpeg",
      "image/gif": "image/png",
      "image/webp": "image/png",
      "image/avif": "image/png",
    } as const;
    for (const image of imageTypeCatalogue) {
      expect(cropOutputType(image.type)).toBe(expected[image.type]);
    }
  });
});
