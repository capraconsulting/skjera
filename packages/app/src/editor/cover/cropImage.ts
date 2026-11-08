import { imageTypeCatalogue, maxImageBytes } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { runRequest } from "../../site/client.ts";
import { type Frame, frameInPixels } from "./cropFrame.ts";

/** The longest side a cut part is given, in pixels. */
const longestSide = 2400;

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob === null
          ? reject(new Error(m.editor_upload_failed()))
          : resolve(blob),
      type,
      quality,
    );
  });

export const cropOutputType = (type: string): "image/png" | "image/jpeg" =>
  imageTypeCatalogue.find((image) => image.type === type)?.transparency === true
    ? "image/png"
    : "image/jpeg";

/**
 * Cuts the frame out of the picture served at `src` and gives it as an image
 * file, ready to upload. The picture is read from the app's own address, so
 * the canvas can be read back. A PNG, GIF, WebP or AVIF picture, which may have
 * see-through parts, gives a PNG; any other picture, and a PNG too large to upload, a JPEG
 * on white. The picture itself is never changed.
 */
export const cropImage = async (src: string, frame: Frame): Promise<File> => {
  const id = src.split("/").at(-1) ?? "";
  const response = await runRequest((client) =>
    client.publicImages.serve({ params: { id } }),
  );
  const picture = new Blob([response.body.slice().buffer as ArrayBuffer], {
    type: response.headers["content-type"],
  });
  // Drawn upright, as the page shows it.
  const bitmap = await createImageBitmap(picture).catch(() => {
    throw new Error(m.editor_upload_failed());
  });
  const part = frameInPixels(frame, bitmap);
  const scale = Math.min(1, longestSide / Math.max(part.width, part.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(part.width * scale));
  canvas.height = Math.max(1, Math.round(part.height * scale));
  const context = canvas.getContext("2d");
  if (context === null) throw new Error(m.editor_upload_failed());

  const draw = (background: string | null) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (background !== null) {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(
      bitmap,
      part.x,
      part.y,
      part.width,
      part.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  };

  if (cropOutputType(picture.type) === "image/png") {
    draw(null);
    const png = await encode(canvas, "image/png");
    if (png.size <= maxImageBytes) {
      return new File([png], "cover.png", { type: "image/png" });
    }
  }
  draw("white");
  const jpeg = await encode(canvas, "image/jpeg", 0.9);
  return new File([jpeg], "cover.jpg", { type: "image/jpeg" });
};
