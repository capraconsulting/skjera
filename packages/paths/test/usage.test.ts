import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const productionFiles = globSync(
  "packages/{app,documents,oauth}/src/**/*.{ts,tsx}",
  { cwd: root },
);
const forbidden = [
  /["'`]\/events\//,
  /["'`]\/studio(?:\/|["'`])/,
  /["'`]\/auth\/(?:login|logout)/,
  /["'`]\/login-failed/,
  /searchParams\.get\(["'`](?:guest|token|version)["'`]\)/,
];

describe("production path use", () => {
  it("keeps app routes and shared query names in the catalogue (AC-3, AC-6)", () => {
    const bypasses = productionFiles.flatMap((file) => {
      if (file.endsWith("packages/paths/src/index.ts")) return [];
      const source = readFileSync(`${root}/${file}`, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      return forbidden.some((pattern) => pattern.test(source)) ? [file] : [];
    });
    expect(bypasses).toEqual([]);
  });
});
