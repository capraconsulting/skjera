/**
 * Whether the header takes the logo's small versions: Safari, and every
 * browser on an iPhone or iPad (they're Safari underneath), play large
 * animated WebP images unevenly.
 */
export const wantsSmallLogo = (userAgent: string) =>
  /iPad|iPhone/.test(userAgent) ||
  (userAgent.includes("Safari") &&
    !userAgent.includes("Chrome") &&
    !userAgent.includes("Chromium"));
