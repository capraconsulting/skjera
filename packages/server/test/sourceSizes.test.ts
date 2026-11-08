import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repository = resolve(import.meta.dirname, "../../..");
const dataExceptions = [
  "packages/server/testdata/catalogue.ts",
  "packages/i18n/messages/",
  "packages/snapsync/extension/snapsync--0.1.0.sql",
];

const sourcePattern = /\.(?:ts|tsx)$/;
const testPattern = /(?:^|\/)test(?:\/|$)|\.(?:test|spec)\.(?:ts|tsx)$/;

const trackedFiles = () =>
  execFileSync("git", ["ls-files"], { cwd: repository, encoding: "utf8" })
    .trim()
    .split("\n");

const isException = (path: string) =>
  dataExceptions.some((exception) =>
    exception.endsWith("/") ? path.startsWith(exception) : path === exception,
  );

const limitFor = (path: string): number | undefined => {
  if (isException(path) || !sourcePattern.test(path)) return undefined;
  return testPattern.test(path) ? 800 : 500;
};

const lineCount = (contents: string) => contents.split("\n").length;

const sizeProblem = (path: string, contents: string): string | undefined => {
  const limit = limitFor(path);
  const lines = lineCount(contents);
  return limit !== undefined && lines > limit
    ? `${path}: ${lines} lines (limit ${limit})`
    : undefined;
};

const movedTests = [
  {
    page: "docs/acceptance/EXT-07-hubspot-sales-events.md",
    destination: "packages/documents/test/notices/HubSpotFailures.test.ts",
    marker: "A sales event when HubSpot fails",
  },
  {
    page: "docs/acceptance/SIGN-16-guest-cancels-by-email.md",
    destination: "packages/documents/test/attendance/guestCancellation.test.ts",
    marker: "cancel",
  },
  {
    page: "docs/acceptance/EXT-06-hubspot.md",
    destination: "packages/app/e2e/specs/siteHubSpot.spec.ts",
    marker: "HubSpot",
  },
  {
    page: "docs/acceptance/STU-02-organiser-logo.md",
    destination: "packages/app/e2e/specs/siteOrganizers.spec.ts",
    marker: "organizer",
  },
  {
    page: "docs/acceptance/ACC-05-account-settings.md",
    destination: "packages/app/e2e/specs/siteAccount.spec.ts",
    marker: "account menu",
  },
  {
    page: "docs/acceptance/ACC-01-login.md",
    destination: "packages/app/e2e/specs/siteAccount.spec.ts",
    marker: "await header.logOut()",
  },
  {
    page: "docs/acceptance/SITE-01-header-and-footer.md",
    destination: "packages/app/e2e/specs/siteAccount.spec.ts",
    marker: "account menu shows the picture",
  },
  {
    page: "docs/acceptance/STU-07-text-formatting.md",
    destination: "packages/app/e2e/specs/siteStudioLinks.spec.ts",
    marker: "editor refuses a link",
  },
] as const;

describe("repository source and test sizes", () => {
  it("classifies source and test boundaries and data exceptions (AC-1, AC-2)", () => {
    expect(sizeProblem("src/example.ts", "x\n".repeat(499))).toBeUndefined();
    expect(sizeProblem("src/example.ts", "x\n".repeat(500))).toBe(
      "src/example.ts: 501 lines (limit 500)",
    );
    expect(
      sizeProblem("test/example.test.ts", "x\n".repeat(799)),
    ).toBeUndefined();
    expect(sizeProblem("test/example.test.ts", "x\n".repeat(800))).toBe(
      "test/example.test.ts: 801 lines (limit 800)",
    );
    for (const exception of dataExceptions) {
      const path = exception.endsWith("/") ? `${exception}nb.json` : exception;
      expect(sizeProblem(path, "x\n".repeat(900))).toBeUndefined();
    }
  });

  it("keeps every non-data source and test file within its limit (AC-1, AC-2)", () => {
    const problems = trackedFiles()
      .map((path) =>
        sizeProblem(path, readFileSync(resolve(repository, path), "utf8")),
      )
      .filter((problem): problem is string => problem !== undefined);
    expect(problems).toEqual([]);
  });

  it("keeps acceptance references with the tests they describe (AC-3)", () => {
    const problems = movedTests.flatMap(({ page, destination, marker }) => {
      const pageText = readFileSync(resolve(repository, page), "utf8");
      let testText = "";
      try {
        testText = readFileSync(resolve(repository, destination), "utf8");
      } catch {
        return [`${destination}: missing`];
      }
      return [
        ...(pageText.includes(destination)
          ? []
          : [`${page}: does not name ${destination}`]),
        ...(testText.includes(marker)
          ? []
          : [`${destination}: does not contain ${marker}`]),
      ];
    });
    expect(problems).toEqual([]);
  });
});
