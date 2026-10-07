import { imagesPath, imageTypes, maxImageBytes } from "@skjera/documents/api";
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

/** The images among pasted or dropped files. */
export const imageFiles = (data: DataTransfer | null): Array<File> =>
  Array.from(data?.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
