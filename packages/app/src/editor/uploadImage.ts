import { imagesPath, imageTypes, maxImageBytes } from "@skjera/documents/api";

/** What the file picker offers. */
export const acceptedImages = imageTypes.join(",");

/**
 * Uploads an image, returning where it is served. Fails with a message to
 * show if it can't be.
 */
export const uploadImage = async (file: File): Promise<string> => {
  if (!(imageTypes as ReadonlyArray<string>).includes(file.type)) {
    throw new Error("Pick a PNG, JPEG, GIF, WebP or AVIF image");
  }
  if (file.size > maxImageBytes) {
    throw new Error(`Images can be at most ${maxImageBytes / 1024 / 1024} MB`);
  }
  const response = await fetch(imagesPath, {
    method: "POST",
    body: file,
    headers: { "Content-Type": file.type },
  }).catch(() => {
    throw new Error("Couldn't upload the image. Are you online?");
  });
  const body = (await response.json().catch(() => ({}))) as {
    readonly url?: string;
    readonly message?: string;
  };
  if (!response.ok || body.url === undefined) {
    throw new Error(body.message ?? "Couldn't upload the image");
  }
  return body.url;
};

/** The images among pasted or dropped files. */
export const imageFiles = (data: DataTransfer | null): Array<File> =>
  Array.from(data?.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
