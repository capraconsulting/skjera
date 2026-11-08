import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const qualifyingExtensions = new Set([".css", ".ts", ".tsx"]);

export const foldersOverDirectFileLimit = (
  roots: string[],
  limit = 15,
): string[] => {
  const oversized: string[] = [];

  const visit = (directory: string) => {
    const entries = readdirSync(directory, { withFileTypes: true });
    const directFiles = entries.filter(
      (entry) =>
        entry.isFile() && qualifyingExtensions.has(extname(entry.name)),
    );
    if (directFiles.length > limit) {
      oversized.push(directory);
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        visit(join(directory, entry.name));
      }
    }
  };

  for (const root of roots) {
    visit(root);
  }
  return oversized;
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true });
  }
});

describe("direct source and test file limit", () => {
  it("reports 16 qualifying direct files (AC-2)", () => {
    const root = mkdtempSync(join(tmpdir(), "skjera-folder-limit-"));
    temporaryDirectories.push(root);
    for (let index = 0; index < 16; index += 1) {
      writeFileSync(join(root, `${index}.ts`), "");
    }

    expect(foldersOverDirectFileLimit([root])).toEqual([root]);
  });

  it("does not count nested files against the parent (AC-2)", () => {
    const root = mkdtempSync(join(tmpdir(), "skjera-folder-limit-"));
    temporaryDirectories.push(root);
    const nested = join(root, "feature");
    mkdirSync(nested);
    for (let index = 0; index < 15; index += 1) {
      writeFileSync(join(root, `${index}.tsx`), "");
    }
    writeFileSync(join(nested, "nested.ts"), "");

    expect(foldersOverDirectFileLimit([root])).toEqual([]);
  });

  it("keeps every app source and test folder within the limit (AC-1)", () => {
    const appRoot = resolve(import.meta.dirname, "../..");
    const roots = ["src", "test", "e2e/specs", "e2e/pom"].map((path) =>
      join(appRoot, path),
    );

    expect(
      foldersOverDirectFileLimit(roots).map((directory) =>
        relative(appRoot, directory),
      ),
    ).toEqual([]);
  });
});
