import { Authenticator } from "@skjera/oauth";
import { AwsClient } from "aws4fetch";
import {
  Config,
  Context,
  Data,
  Effect,
  Layer,
  Option,
  Redacted,
  Stream,
} from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { InvalidImage } from "../api/errors.ts";
import {
  type ImagePage,
  type ImageType,
  imagePageSize,
  imagesPath,
  maxImageBytes,
} from "../api/ImagesApi.ts";
import { refused } from "../api/Problems.ts";

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

/** 128 random bits, URL safe. */
const newId = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");

const validId = /^[A-Za-z0-9_-]{22}$/;

export interface StoredImage {
  readonly contentType: string;
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number | null;
}

/** An image in the bucket, and when it was uploaded. */
export interface ListedImage {
  readonly id: string;
  readonly uploadedAt: Date;
}

/** The bucket would not list its images. */
export class ImageListFailed extends Data.TaggedError("ImageListFailed") {}

const unescapeXml = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

const tagIn = (xml: string, tag: string) =>
  new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1];

/**
 * The images in one ListObjectsV2 response, and its continuation token (null
 * on the last response). Keys that are no image id are left out.
 */
export const listedObjects = (
  xml: string,
): {
  readonly images: ReadonlyArray<ListedImage>;
  readonly next: string | null;
} => {
  const images: Array<ListedImage> = [];
  for (const [, entry = ""] of xml.matchAll(
    /<Contents>([\s\S]*?)<\/Contents>/g,
  )) {
    const key = tagIn(entry, "Key");
    const modified = tagIn(entry, "LastModified");
    if (key === undefined || modified === undefined || !validId.test(key)) {
      continue;
    }
    const uploadedAt = new Date(modified);
    if (Number.isNaN(uploadedAt.getTime())) continue;
    images.push({ id: key, uploadedAt });
  }
  const token = tagIn(xml, "NextContinuationToken");
  return { images, next: token === undefined ? null : unescapeXml(token) };
};

const newestFirst = (a: ListedImage, b: ListedImage) =>
  b.uploadedAt.getTime() - a.uploadedAt.getTime() ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The page of `images` after the cursor `after` (none: the first page):
 * newest first, images uploaded at the same time in id order. A page's
 * `next` is the cursor of its last image, `<uploaded at in ms>.<id>`, or null
 * when no image follows. Undefined for a cursor that cannot be read.
 */
export const pageOf = (
  images: ReadonlyArray<ListedImage>,
  after: string | undefined,
  size: number,
):
  | {
      readonly images: ReadonlyArray<ListedImage>;
      readonly next: string | null;
    }
  | undefined => {
  const sorted = [...images].sort(newestFirst);
  let from = 0;
  if (after !== undefined) {
    const match = /^(\d+)\.([A-Za-z0-9_-]{22})$/.exec(after);
    const uploadedAt = new Date(Number(match?.[1]));
    if (match === null || Number.isNaN(uploadedAt.getTime())) return undefined;
    const marker = { id: match[2] ?? "", uploadedAt };
    const found = sorted.findIndex((image) => newestFirst(image, marker) > 0);
    from = found < 0 ? sorted.length : found;
  }
  const page = sorted.slice(from, from + size);
  const last = page.at(-1);
  return {
    images: page,
    next:
      last === undefined || from + size >= sorted.length
        ? null
        : `${last.uploadedAt.getTime()}.${last.id}`,
  };
};

export class Images extends Context.Service<
  Images,
  {
    /** Stores an image, returning its id and where it is served. */
    readonly upload: (
      bytes: Uint8Array,
    ) => Effect.Effect<
      { readonly id: string; readonly url: string },
      InvalidImage
    >;
    readonly get: (id: string) => Effect.Effect<Option.Option<StoredImage>>;
    /** Every image in the bucket, in no particular order. */
    readonly list: () => Effect.Effect<
      ReadonlyArray<ListedImage>,
      ImageListFailed
    >;
  }
>()("@skjera/documents/Images") {
  /** On the bucket `S3_BUCKET` at `S3_ENDPOINT`, created if missing. */
  static readonly layer = Layer.effect(
    Images,
    Effect.gen(function* () {
      const endpoint = yield* Config.URL("S3_ENDPOINT");
      const bucket = yield* Config.String("S3_BUCKET");
      const client = new AwsClient({
        accessKeyId: yield* Config.String("S3_ACCESS_KEY_ID"),
        secretAccessKey: Redacted.value(
          yield* Config.Redacted("S3_SECRET_ACCESS_KEY"),
        ),
        region: yield* Config.String("S3_REGION").pipe(
          Config.withDefault("us-east-1"),
        ),
        service: "s3",
      });
      // Path-style addressing, which S3-compatible stores all take.
      const url = (key = "") =>
        new URL(`${bucket}/${key}`, endpoint.href.replace(/\/?$/, "/")).href;
      const request = (target: string, init?: RequestInit) =>
        Effect.tryPromise(() => client.fetch(target, init)).pipe(Effect.orDie);

      const created = yield* request(url(), { method: "PUT" });
      // 409: it exists already.
      if (!created.ok && created.status !== 409) {
        return yield* Effect.die(
          new Error(
            `Creating bucket ${bucket} failed: ${created.status} ${yield* Effect.promise(() => created.text())}`,
          ),
        );
      }

      // The bucket's whole listing, kept briefly: every page of the list is
      // cut from it, so only the first look pays for reading the bucket.
      const listingTtlMs = 30_000;
      let listing:
        | { readonly at: number; readonly images: ReadonlyArray<ListedImage> }
        | undefined;

      const upload = Effect.fn("Images.upload")(function* (bytes: Uint8Array) {
        if (bytes.byteLength > maxImageBytes) {
          return yield* new InvalidImage(
            refused({
              _tag: "ImageTooBig",
              maxMb: maxImageBytes / 1024 / 1024,
            }),
          );
        }
        const contentType = sniffImageType(bytes);
        if (contentType === null) {
          return yield* new InvalidImage(refused({ _tag: "ImageFormat" }));
        }
        const id = newId();
        const response = yield* request(url(id), {
          method: "PUT",
          body: bytes,
          headers: { "Content-Type": contentType },
        });
        if (!response.ok) {
          return yield* Effect.die(
            new Error(`Storing image failed: ${response.status}`),
          );
        }
        // A new image is in the list at once, without reading the bucket again.
        if (listing !== undefined) {
          listing = {
            ...listing,
            images: [...listing.images, { id, uploadedAt: new Date() }],
          };
        }
        return { id, url: `${imagesPath}/${id}` };
      });

      const get = Effect.fn("Images.get")(function* (id: string) {
        if (!validId.test(id)) return Option.none<StoredImage>();
        const response = yield* request(url(id));
        if (response.status === 404 || response.body === null) {
          return Option.none<StoredImage>();
        }
        if (!response.ok) {
          return yield* Effect.die(
            new Error(`Reading image failed: ${response.status}`),
          );
        }
        const length = response.headers.get("Content-Length");
        return Option.some<StoredImage>({
          contentType:
            response.headers.get("Content-Type") ?? "application/octet-stream",
          body: response.body,
          size: length === null ? null : Number(length),
        });
      });

      // Every page of the bucket's listing. A request the store refuses, or
      // that fails, ends in an error of its own rather than a defect.
      const list = Effect.fn("Images.list")(function* () {
        if (listing !== undefined && Date.now() - listing.at < listingTtlMs) {
          return listing.images;
        }
        const found: Array<ListedImage> = [];
        let token: string | null = null;
        do {
          const query = new URLSearchParams({ "list-type": "2" });
          if (token !== null) query.set("continuation-token", token);
          const xml: string = yield* Effect.tryPromise({
            try: async () => {
              const response = await client.fetch(`${url()}?${query}`);
              if (!response.ok) throw new Error(String(response.status));
              return await response.text();
            },
            catch: () => new ImageListFailed(),
          });
          const listed = listedObjects(xml);
          found.push(...listed.images);
          token = listed.next;
        } while (token !== null);
        listing = { at: Date.now(), images: found };
        return found;
      });

      return { upload, get, list };
    }),
  );
}

const failure = (status: number, message: string) =>
  HttpServerResponse.jsonUnsafe({ message }, { status });

/**
 * Uploading images and listing them, for signed-in users, and serving them,
 * to anyone with the link.
 */
export const layerHttp = Layer.unwrap(
  Effect.gen(function* () {
    const images = yield* Images;
    const authenticator = yield* Authenticator;

    const upload = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (request.headers.origin !== authenticator.origin) {
        return HttpServerResponse.empty({ status: 403 });
      }
      const user = yield* authenticator.fromCookieHeader(
        request.headers.cookie,
      );
      if (Option.isNone(user)) {
        return failure(401, "Log in to upload images");
      }
      // Refused before reading any of it.
      const length = Number(request.headers["content-length"]);
      if (!Number.isFinite(length)) {
        return failure(411, "The upload needs a Content-Length");
      }
      if (length > maxImageBytes) {
        return failure(
          413,
          `Images can be at most ${maxImageBytes / 1024 / 1024} MB`,
        );
      }
      const bytes = yield* request.arrayBuffer.pipe(Effect.orDie);
      return yield* images.upload(new Uint8Array(bytes)).pipe(
        Effect.match({
          onFailure: (error) => failure(400, error.message),
          onSuccess: (image) =>
            HttpServerResponse.jsonUnsafe(image, { status: 201 }),
        }),
      );
    });

    const serve = Effect.gen(function* () {
      const { id } = yield* HttpRouter.params;
      const image = yield* images.get(id ?? "");
      if (Option.isNone(image))
        return HttpServerResponse.empty({ status: 404 });
      const { body, contentType, size } = image.value;
      return HttpServerResponse.stream(
        Stream.fromReadableStream({
          evaluate: () => body,
          onError: (cause) => cause,
        }),
        {
          contentType,
          ...(size === null ? {} : { contentLength: size }),
          headers: {
            // An id is only ever used for one image.
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'",
          },
        },
      );
    });

    // A page of the images, newest first. It changes nothing, so it needs the
    // session only: no `Origin`, which a same-origin GET often leaves out.
    const list = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const user = yield* authenticator.fromCookieHeader(
        request.headers.cookie,
      );
      if (Option.isNone(user)) {
        return failure(401, "Log in to see the images");
      }
      const after =
        new URL(request.url, "http://localhost").searchParams.get("after") ??
        undefined;
      return yield* images.list().pipe(
        Effect.match({
          onFailure: () => failure(500, "Couldn't list the images"),
          onSuccess: (all) => {
            const page = pageOf(all, after, imagePageSize);
            if (page === undefined) {
              return failure(400, "That is not a place in the list");
            }
            const body: ImagePage = {
              images: page.images.map((image) => ({
                url: `${imagesPath}/${image.id}`,
                uploadedAt: image.uploadedAt.toISOString(),
              })),
              next: page.next,
            };
            return HttpServerResponse.jsonUnsafe(body, {
              headers: { "Cache-Control": "no-store" },
            });
          },
        }),
      );
    });

    return Layer.mergeAll(
      HttpRouter.add("GET", imagesPath, list),
      HttpRouter.add("POST", imagesPath, upload),
      HttpRouter.add("GET", `${imagesPath}/:id`, serve),
    );
  }),
);
