import { Effect, Option, Stream } from "effect";
import type { ImageType } from "../api/ImagesApi.ts";

// Uploaded images, in an S3-compatible bucket. The bucket stays private:
// the server serves the images, under ids too long to guess.

/** The image's format, from its first bytes rather than what it claims. */
export const sniffImageType = (bytes: Uint8Array): ImageType | null => {
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to));
  const startsWith = (...signature: ReadonlyArray<number>) =>
    signature.every((byte, index) => bytes[index] === byte);
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "image/png";
  }
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) {
    return "image/avif";
  }
  return null;
};

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}
const asciiAt = (view: DataView, from: number, to: number) => {
  let text = "";
  for (let at = from; at < to; at++)
    text += String.fromCharCode(view.getUint8(at));
  return text;
};

/** The EXIF orientation (1-8) in the APP1 segment's data at `from`, or 1. */
const exifOrientation = (view: DataView, from: number, to: number): number => {
  try {
    if (asciiAt(view, from, from + 6) !== "Exif\0\0") return 1;
    const tiff = from + 6;
    const little = asciiAt(view, tiff, tiff + 2) === "II";
    if (view.getUint16(tiff + 2, little) !== 42) return 1;
    const directory = tiff + view.getUint32(tiff + 4, little);
    const count = Math.min(view.getUint16(directory, little), (to - from) / 12);
    for (let index = 0; index < count; index++) {
      const entry = directory + 2 + 12 * index;
      if (view.getUint16(entry, little) === 0x0112) {
        return view.getUint16(entry + 8, little);
      }
    }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  return 1;
};

const jpegSize = (view: DataView): ImageSize | undefined => {
  let at = 2;
  let orientation = 1;
  while (true) {
    if (view.getUint8(at) !== 0xff) return undefined;
    // Fill bytes: any number of 0xFF may come before a marker.
    while (view.getUint8(at + 1) === 0xff) at++;
    const marker = view.getUint8(at + 1);
    // Markers that have no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    // The first frame header: any SOF but DHT (C4), JPG (C8) and DAC (CC).
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      const height = view.getUint16(at + 5);
      const width = view.getUint16(at + 7);
      return orientation >= 5 && orientation <= 8
        ? { width: height, height: width }
        : { width, height };
    }
    // The end of the image, or the scan: no frame header came before it.
    if (marker === 0xd9 || marker === 0xda) return undefined;
    const length = view.getUint16(at + 2);
    if (marker === 0xe1) {
      orientation = exifOrientation(view, at + 4, at + 2 + length);
    }
    at += 2 + length;
  }
};

/** The boxes of an ISO base media file between `from` and `to`. */
function* boxesIn(view: DataView, from: number, to: number) {
  let at = from;
  while (at + 8 <= to) {
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1) {
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header) return;
    yield {
      type: asciiAt(view, at + 4, at + 8),
      start: at + header,
      end: Math.min(at + size, to),
    };
    at += size;
  }
}

const avifSize = (view: DataView): ImageSize | undefined => {
  let largest: ImageSize | undefined;
  let turned = false;
  for (const top of boxesIn(view, 0, view.byteLength)) {
    if (top.type !== "meta") continue;
    // `meta` is a full box: its children start after four bytes of version and flags.
    for (const iprp of boxesIn(view, top.start + 4, top.end)) {
      if (iprp.type !== "iprp") continue;
      for (const ipco of boxesIn(view, iprp.start, iprp.end)) {
        if (ipco.type !== "ipco") continue;
        for (const property of boxesIn(view, ipco.start, ipco.end)) {
          if (property.type === "ispe") {
            const width = view.getUint32(property.start + 4);
            const height = view.getUint32(property.start + 8);
            if (
              largest === undefined ||
              width * height > largest.width * largest.height
            ) {
              largest = { width, height };
            }
          } else if (property.type === "irot") {
            // A quarter turn, either way, swaps the sides.
            turned = turned || (view.getUint8(property.start) & 1) === 1;
          }
        }
      }
    }
  }
  return largest === undefined || !turned
    ? largest
    : { width: largest.height, height: largest.width };
};

const webpSize = (view: DataView): ImageSize | undefined => {
  switch (asciiAt(view, 12, 16)) {
    case "VP8 ":
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    case "VP8L": {
      if (view.getUint8(20) !== 0x2f) return undefined;
      const bits = view.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
    case "VP8X":
      return {
        width: 1 + (view.getUint16(24, true) | (view.getUint8(26) << 16)),
        height: 1 + (view.getUint16(27, true) | (view.getUint8(29) << 16)),
      };
    default:
      return undefined;
  }
};

/**
 * The image's width and height as it is shown, from its first bytes: each
 * format's header, a JPEG's orientation and an AVIF's rotation included.
 * Undefined when they are not in these bytes, or the bytes are no image.
 */
export const imageSize = (bytes: Uint8Array): ImageSize | undefined => {
  const type = sniffImageType(bytes);
  if (type === null) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    const size = (() => {
      switch (type) {
        case "image/png":
          return asciiAt(view, 12, 16) === "IHDR"
            ? { width: view.getUint32(16), height: view.getUint32(20) }
            : undefined;
        case "image/gif":
          return {
            width: view.getUint16(6, true),
            height: view.getUint16(8, true),
          };
        case "image/webp":
          return webpSize(view);
        case "image/jpeg":
          return jpegSize(view);
        case "image/avif":
          return avifSize(view);
      }
    })();
    return size !== undefined && size.width > 0 && size.height > 0
      ? size
      : undefined;
  } catch (error) {
    // Reading past the bytes there are: the size is not in them.
    if (error instanceof RangeError) return undefined;
    throw error;
  }
};

/**
 * The size of the image `body` holds. Reads until `imageSize` finds it, or
 * `limit` bytes, and no further: the stream's finalizer cancels the body, also
 * when the read is interrupted. Undefined: not found, or the body failed.
 */
export const readImageSize = (
  body: ReadableStream<Uint8Array>,
  limit = 512 * 1024,
): Effect.Effect<ImageSize | undefined> =>
  Stream.fromReadableStream({
    evaluate: () => body,
    onError: (cause) => cause,
  }).pipe(
    Stream.scan(
      () => new Uint8Array(),
      (read, chunk) => {
        const joined = new Uint8Array(read.length + chunk.length);
        joined.set(read);
        joined.set(chunk, read.length);
        return joined;
      },
    ),
    Stream.takeUntil(
      (read) => read.length >= limit || imageSize(read) !== undefined,
    ),
    Stream.runLast,
    Effect.map((read) =>
      Option.isSome(read) ? imageSize(read.value) : undefined,
    ),
    Effect.catchCause((cause) =>
      Effect.logWarning("Reading image size failed", cause).pipe(
        Effect.as(undefined),
      ),
    ),
  );
