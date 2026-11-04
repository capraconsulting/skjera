import {
  type ImagePage,
  imagesPath,
  imageTypes,
  maxImageBytes,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { sayWhy } from "../problems.ts";

/** What the file picker offers. */
export const acceptedImages = imageTypes.join(",");

/**
 * Uploads an image, returning where it is served. Fails with a message to
 * show if it can't be.
 */
export const uploadImage = async (file: File): Promise<string> => {
  if (!(imageTypes as ReadonlyArray<string>).includes(file.type)) {
    throw new Error(m.editor_image_type());
  }
  if (file.size > maxImageBytes) {
    throw new Error(m.editor_image_size({ mb: maxImageBytes / 1024 / 1024 }));
  }
  const response = await fetch(imagesPath, {
    method: "POST",
    body: file,
    headers: { "Content-Type": file.type },
  }).catch(() => {
    throw new Error(m.editor_upload_offline());
  });
  const body = (await response.json().catch(() => ({}))) as {
    readonly url?: string;
  };
  if (!response.ok || body.url === undefined) {
    throw new Error(sayWhy(body, m.editor_upload_failed()));
  }
  return body.url;
};

/**
 * A page of the images already uploaded, newest first: the first, or the one
 * after the cursor `after` (a page's `next`). Fails with a message to show if
 * it can't be had.
 */
export const listImages = async (after?: string): Promise<ImagePage> => {
  const response = await fetch(
    after === undefined
      ? imagesPath
      : `${imagesPath}?after=${encodeURIComponent(after)}`,
  ).catch(() => {
    throw new Error(m.editor_existing_failed());
  });
  const body = (await response.json().catch(() => ({}))) as Partial<ImagePage>;
  if (!response.ok || body.images === undefined || body.next === undefined) {
    throw new Error(sayWhy(body, m.editor_existing_failed()));
  }
  return { images: body.images, next: body.next };
};

/** The images among pasted or dropped files. */
export const imageFiles = (data: DataTransfer | null): Array<File> =>
  Array.from(data?.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
