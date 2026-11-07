import { maxImageBytes } from "@skjera/documents/api";
import { baseLocale, overwriteGetLocale } from "@skjera/i18n/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadImage } from "../src/editor/uploadImage.ts";

/** A PNG file of `size` bytes. */
const pngOf = (size: number) =>
  new File([new Uint8Array(size)], "big.png", { type: "image/png" });

describe("uploadImage", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    overwriteGetLocale(() => "en");
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    fetchSpy.mockReset();
    vi.unstubAllGlobals();
    overwriteGetLocale(() => baseLocale);
  });

  it("refuses an image over 10 MB and says so, without uploading it (STU-08 AC-3)", async () => {
    await expect(uploadImage(pngOf(maxImageBytes + 1))).rejects.toThrow(
      "Images can be at most 10 MB",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uploads an image of exactly 10 MB (STU-08 AC-3)", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: "abc", url: "/api/images/abc" }), {
        status: 201,
      }),
    );
    await expect(uploadImage(pngOf(maxImageBytes))).resolves.toBe(
      "/api/images/abc",
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
