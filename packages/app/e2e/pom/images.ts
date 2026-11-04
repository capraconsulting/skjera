import { crc32, deflateSync } from "node:zlib";
import { expect, type Locator, type Page } from "@playwright/test";

// The smallest valid PNG: one transparent pixel.
export const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const pixelBase64 = pixel.toString("base64");

const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, check]);
};

/** A PNG of the given size, red on its left half and blue on its right. */
const twoHalves = (width: number, height: number) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  const row = Buffer.alloc(1 + width * 3); // filter byte 0, then pixels
  for (let x = 0; x < width; x++) {
    row.set(x < width / 2 ? [200, 30, 30] : [30, 30, 200], 1 + x * 3);
  }
  const rows = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

/** A picture of 200 × 100 pixels, wide enough to cut a part out of. */
export const wide = twoHalves(200, 100);

/** A DataTransfer holding the PNG, as pasting or dropping a file gives. */
const pngTransfer = (page: Page, name = "pixel.png") =>
  page.evaluateHandle(
    ({ base64, name }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type: "image/png" }));
      return transfer;
    },
    { base64: pixelBase64, name },
  );

/** Pastes the PNG into what has focus in `target`. */
export const pastePng = async (target: Locator): Promise<void> => {
  const transfer = await pngTransfer(target.page());
  await target.evaluate((element, clipboardData) => {
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, transfer);
};

/** Drops the PNG onto the middle of `target`. */
export const dropPng = async (target: Locator): Promise<void> => {
  const box = await target.boundingBox();
  expect(box, "the drop target is visible").not.toBeNull();
  const at = {
    clientX: (box?.x ?? 0) + (box?.width ?? 0) / 2,
    clientY: (box?.y ?? 0) + (box?.height ?? 0) / 2,
  };
  const dataTransfer = await pngTransfer(target.page());
  await target.dispatchEvent("dragover", { dataTransfer, ...at });
  await target.dispatchEvent("drop", { dataTransfer, ...at });
};

/**
 * Uploads the PNG as the signed-in user of `page` would, returning where it
 * is served.
 */
export const uploadPng = (page: Page): Promise<string> =>
  page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const response = await fetch("/api/images", {
      method: "POST",
      body: bytes,
      headers: { "Content-Type": "image/png" },
    });
    return ((await response.json()) as { url: string }).url;
  }, pixelBase64);

/** How many images the list's first page holds, and whether it goes on. */
export const firstPageOfImages = (
  page: Page,
): Promise<{ readonly count: number; readonly more: boolean }> =>
  page.evaluate(async () => {
    const response = await fetch("/api/images");
    const body = (await response.json()) as {
      images: ReadonlyArray<unknown>;
      next: string | null;
    };
    return { count: body.images.length, more: body.next !== null };
  });

/** Counts the uploads `page` makes from now on. */
export const watchUploads = (page: Page): { count: () => number } => {
  let uploads = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/images"
    ) {
      uploads++;
    }
  });
  return { count: () => uploads };
};
