export const serverRoutes = {
  auth: "/auth",
  api: "/api",
  embed: "/embed",
  siteAssets: "/site-assets",
  manifest: "/manifest.webmanifest",
  automerge: "/automerge",
} as const;

export const serverRoutePrefixes = Object.values(serverRoutes);

export const serverRoutePrefixesFor = (redirectUri?: string) => {
  if (redirectUri === undefined) return serverRoutePrefixes;
  const callback = new URL(redirectUri).pathname;
  return serverRoutePrefixes.some(
    (prefix) => callback === prefix || callback.startsWith(`${prefix}/`),
  )
    ? serverRoutePrefixes
    : [...serverRoutePrefixes, callback];
};
