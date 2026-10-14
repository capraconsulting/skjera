// Images: where they are uploaded and served, and what can be uploaded.

/**
 * Where images are uploaded to (POST, the image as the body) and served
 * from (GET `${imagesPath}/:id`). Uploading returns `{ id, url }`.
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
