// Images: where they are uploaded and served, and what can be uploaded.

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
export interface ImagePage {
  readonly images: ReadonlyArray<{
    readonly url: string;
    readonly uploadedAt: string;
  }>;
  readonly next: string | null;
}
