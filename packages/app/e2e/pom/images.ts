import { expect, type Locator, type Page } from "@playwright/test";

// The smallest valid PNG: one transparent pixel.
export const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const pixelBase64 = pixel.toString("base64");

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
