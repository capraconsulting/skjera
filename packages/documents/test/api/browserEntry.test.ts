import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// `@skjera/documents/api` is what the browser loads. Anything it reaches,
// directly or through other files, is bundled into the app, so it must not
// reach the server's email and notice code: nodemailer cannot run in a
// browser, and the app fails to start when it is there.
const entry = resolve(import.meta.dirname, "../../src/api.ts");
const serverOnly = [
  /^@skjera\/email/,
  /^nodemailer/,
  /^react-email/,
  /\/src\/notices\//,
];

const staticImports = (source: string): string[] =>
  [...source.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+"([^"]+)"/gm)]
    .filter((match) => !/^\s*(?:import|export)\s+type\s/.test(match[0]))
    .map((match) => match[1] as string);

const reached = (start: string): Map<string, string> => {
  const seen = new Map<string, string>();
  const visit = (file: string, importer: string) => {
    if (seen.has(file)) return;
    seen.set(file, importer);
    for (const specifier of staticImports(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) {
        seen.set(specifier, file);
        continue;
      }
      const target = resolve(dirname(file), specifier);
      if (existsSync(target)) visit(target, file);
    }
  };
  visit(start, start);
  return seen;
};

describe("the documents package's browser entry", () => {
  it("reaches no server-only email or notice code", () => {
    const offending = [...reached(entry)]
      .filter(([target]) => serverOnly.some((pattern) => pattern.test(target)))
      .map(([target, importer]) => `${target} (imported by ${importer})`);

    expect(offending).toEqual([]);
  });
});
