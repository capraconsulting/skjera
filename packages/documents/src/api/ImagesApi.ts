// Images: where they are uploaded and served, and what can be uploaded.

/**
 * Where images are uploaded to (POST, the image as the body) and served
 * from (GET `${imagesPath}/:id`). Uploading returns `{ id, url }`. GET
 * `${imagesPath}` lists them.
 */
export const imagesPath = "/api/images";

/** The largest image that can be uploaded. */
export const maxImageBytes = 10 * 1024 * 1024;

/** The image formats that can be uploaded. */
export const imageTypes = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;

export type ImageType = (typeof imageTypes)[number];

/** How many images one page of the list holds. */
export const imagePageSize = 30;

/**
 * A page of uploaded images, newest first (GET `${imagesPath}`, with `?after=`
 * the previous page's `next`). `next` is null after the last page.
 */
export interface ImagePage {
  readonly images: ReadonlyArray<{
    readonly url: string;
    readonly uploadedAt: string;
  }>;
  readonly next: string | null;
}
