import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));

const filesContaining = (pattern: RegExp, files: ReadonlyArray<string>) =>
  files.filter((file) => pattern.test(readFileSync(`${root}/${file}`, "utf8")));

describe("test waits", () => {
  it("keeps fixed sleeps out of notice tests (AC-1)", () => {
    const noticeTests = globSync(
      "packages/documents/test/{notices,events/recurring}/**/*.test.{ts,tsx}",
      { cwd: root },
    );

    expect(filesContaining(/Effect\.sleep\(/, noticeTests)).toEqual([]);
  });

  it("keeps timeout and network-idle waits out of browser tests (AC-2)", () => {
    const browserTests = globSync("packages/app/e2e/**/*.{ts,tsx}", {
      cwd: root,
    });

    expect(
      filesContaining(/waitForTimeout\(|["']networkidle["']/, browserTests),
    ).toEqual([]);
  });
});
