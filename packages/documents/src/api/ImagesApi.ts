import { Authentication } from "@skjera/oauth/api";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import {
  ImageListUnavailable,
  ImageNotFound,
  InvalidImage,
  InvalidImageCursor,
} from "./errors.ts";

/**
 * Where images are uploaded to (POST, the image as the body) and served
 * from (GET `${imagesPath}/:id`). Uploading returns `{ id, url }`. GET
 * `${imagesPath}` lists them.
 */
export const imagesPath = "/api/images";

/** The largest image that can be uploaded. */
export const maxImageBytes = 10 * 1024 * 1024;

/** The image formats that can be uploaded and whether they can be transparent. */
export const imageTypeCatalogue = [
  { type: "image/png", transparency: true },
  { type: "image/jpeg", transparency: false },
  { type: "image/gif", transparency: true },
  { type: "image/webp", transparency: true },
  { type: "image/avif", transparency: true },
] as const;

export const imageTypes = imageTypeCatalogue.map(({ type }) => type);

export type ImageType = (typeof imageTypes)[number];

/** How many images one page of the list holds. */
export const imagePageSize = 30;

/**
 * A page of uploaded images, newest first (GET `${imagesPath}`, with `?after=`
 * the previous page's `next`). `next` is null after the last page.
 */
export const ImagePage = Schema.Struct({
  images: Schema.Array(
    Schema.Struct({ url: Schema.String, uploadedAt: Schema.String }),
  ),
  next: Schema.NullOr(Schema.String),
});
export type ImagePage = typeof ImagePage.Type;

export const UploadedImage = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
}).annotate({ httpApiStatus: 201 });

const ImageBytes = Schema.Uint8Array.pipe(
  HttpApiSchema.asUint8Array({ contentType: "application/octet-stream" }),
);

export const ServedImage = HttpApiSchema.WithHeaders(ImageBytes, {
  "content-type": Schema.String,
  "content-length": Schema.optionalKey(Schema.String),
  "cache-control": Schema.String,
  "x-content-type-options": Schema.String,
  "content-security-policy": Schema.String,
});

export class ImagesApi extends HttpApiGroup.make("images")
  .add(
    HttpApiEndpoint.get("list", imagesPath, {
      query: { after: Schema.optionalKey(Schema.String) },
      success: ImagePage,
      error: [InvalidImageCursor, ImageListUnavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post("upload", imagesPath, {
      payload: ImageBytes,
      success: UploadedImage,
      error: InvalidImage,
    }),
  )
  .middleware(Authentication) {}

export class PublicImagesApi extends HttpApiGroup.make("publicImages").add(
  HttpApiEndpoint.get("serve", `${imagesPath}/:id`, {
    params: { id: Schema.String },
    success: ServedImage,
    error: ImageNotFound,
  }),
) {}
