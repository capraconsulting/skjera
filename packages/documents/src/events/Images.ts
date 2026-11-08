import { AwsClient } from "aws4fetch";
import { Config, Context, Data, Effect, Layer, Option, Redacted } from "effect";
import { InvalidImage } from "../api/errors.ts";
import { imagesPath, maxImageBytes } from "../api/ImagesApi.ts";
import { refused } from "../api/Problems.ts";

import { sniffImageType } from "./ImageMetadata.ts";

export {
  type ImageSize,
  imageSize,
  readImageSize,
  sniffImageType,
} from "./ImageMetadata.ts";

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
    /** Deletes an image. An image already absent is harmless. */
    readonly delete: (id: string) => Effect.Effect<void>;
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
          body: new Uint8Array(bytes),
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

      const remove = Effect.fn("Images.delete")(function* (id: string) {
        if (!validId.test(id)) return;
        const response = yield* request(url(id), { method: "DELETE" });
        if (!response.ok && response.status !== 404) {
          return yield* Effect.die(
            new Error(`Deleting image failed: ${response.status}`),
          );
        }
        if (listing !== undefined) {
          listing = {
            ...listing,
            images: listing.images.filter((image) => image.id !== id),
          };
        }
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

      return { upload, get, delete: remove, list };
    }),
  );
}
