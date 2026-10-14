import { Authenticator } from "@skjera/oauth";
import { AwsClient } from "aws4fetch";
import {
  Config,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Stream,
} from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { type ImageType, imagesPath, maxImageBytes } from "../api/ImagesApi.ts";
import { InvalidImage } from "../server/errors.ts";
import { refused } from "../server/Problems.ts";

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

/** 128 random bits, URL safe. */
const newId = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");

const validId = /^[A-Za-z0-9_-]{22}$/;

export interface StoredImage {
  readonly contentType: string;
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number | null;
}

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

      return { upload, get };
    }),
  );
}

const failure = (status: number, message: string) =>
  HttpServerResponse.jsonUnsafe({ message }, { status });

/**
 * Uploading images, for signed-in users, and serving them, to anyone with
 * the link.
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

    return Layer.mergeAll(
      HttpRouter.add("POST", imagesPath, upload),
      HttpRouter.add("GET", `${imagesPath}/:id`, serve),
    );
  }),
);
