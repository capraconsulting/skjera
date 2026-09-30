const base = "http://return-to.invalid";

/**
 * Only allows same-origin relative paths as the post-login destination, so
 * the login endpoint can't be used as an open redirect.
 */
export const sanitizeReturnTo = (
  value: string | null | undefined,
  fallback = "/",
): string => {
  if (value === null || value === undefined || !value.startsWith("/")) {
    return fallback;
  }
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return fallback;
  }
  const path = `${url.pathname}${url.search}${url.hash}`;
  // Normalisation can still produce a protocol-relative "//host" path, e.g.
  // from "/.//evil.example".
  if (url.origin !== base || path.startsWith("//") || path.startsWith("/\\")) {
    return fallback;
  }
  return path;
};
