import {
  type ImagePage,
  imageTypes,
  maxImageBytes,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { runRequest } from "../site/client.ts";

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
  const bytes = new Uint8Array(await file.arrayBuffer());
  const uploaded = await runRequest((client) =>
    client.images.upload({
      payload: bytes,
    }),
  );
  return uploaded.url;
};

/**
 * A page of the images already uploaded, newest first: the first, or the one
 * after the cursor `after` (a page's `next`). Fails with a message to show if
 * it can't be had.
 */
export const listImages = async (after?: string): Promise<ImagePage> => {
  return runRequest((client) =>
    client.images.list({
      query: after === undefined ? {} : { after },
    }),
  );
};

/** The images among pasted or dropped files. */
export const imageFiles = (data: DataTransfer | null): Array<File> =>
  Array.from(data?.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
