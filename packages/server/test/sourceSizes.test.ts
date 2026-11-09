import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repository = resolve(import.meta.dirname, "../../..");
const dataExceptions = [
  "packages/server/testdata/catalogue.ts",
  "packages/i18n/messages/",
  "packages/snapsync/extension/snapsync--0.1.0.sql",
];

const sourceLineLimit = 500;
const testLineLimit = 800;
const folderLimit = 15;
const rule = 'as "Code health" in AGENTS.md says';

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
  return testPattern.test(path) ? testLineLimit : sourceLineLimit;
};

const lineCount = (contents: string) =>
  contents.split("\n").length - (contents.endsWith("\n") ? 1 : 0);

const sizeProblem = (path: string, contents: string): string | undefined => {
  const limit = limitFor(path);
  const lines = lineCount(contents);
  return limit !== undefined && lines > limit
    ? `${path}: ${lines} lines, over the limit of ${limit}. Split it by responsibility, ${rule}.`
    : undefined;
};

const folderProblems = (paths: readonly string[]): string[] => {
  const counts = new Map<string, number>();
  for (const path of paths) {
    if (isException(path) || !sourcePattern.test(path)) continue;
    const folder = dirname(path);
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count > folderLimit)
    .map(
      ([folder, count]) =>
        `${folder}: ${count} files directly inside, over the limit of ${folderLimit}. Split it into subfolders by responsibility, ${rule}.`,
    );
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
    destination: "packages/app/e2e/specs/site/siteHubSpot.spec.ts",
    marker: "HubSpot",
  },
  {
    page: "docs/acceptance/STU-02-organiser-logo.md",
    destination: "packages/app/e2e/specs/site/siteOrganizers.spec.ts",
    marker: "organizer",
  },
  {
    page: "docs/acceptance/ACC-05-account-settings.md",
    destination: "packages/app/e2e/specs/site/siteAccount.spec.ts",
    marker: "account menu",
  },
  {
    page: "docs/acceptance/ACC-01-login.md",
    destination: "packages/app/e2e/specs/site/siteAccount.spec.ts",
    marker: "await header.logOut()",
  },
  {
    page: "docs/acceptance/SITE-01-header-and-footer.md",
    destination: "packages/app/e2e/specs/site/siteAccount.spec.ts",
    marker: "account menu shows the picture",
  },
  {
    page: "docs/acceptance/STU-07-text-formatting.md",
    destination: "packages/app/e2e/specs/site/siteStudioLinks.spec.ts",
    marker: "editor refuses a link",
  },
] as const;

const codeHealthSection = (agents: string) => {
  const start = agents.indexOf("## Code health");
  if (start === -1) return undefined;
  const next = agents.indexOf("\n## ", start + 1);
  return agents.slice(start, next === -1 ? undefined : next);
};

const ruleReference = '"Code health" in AGENTS.md';

describe("repository source and test sizes", () => {
  it("fails a file one line over its limit with advice naming the rule (AC-3)", () => {
    expect(sizeProblem("src/example.ts", "x\n".repeat(500))).toBeUndefined();
    const source = sizeProblem("src/example.ts", "x\n".repeat(501));
    for (const part of ["src/example.ts", "501", "500", ruleReference]) {
      expect(source).toContain(part);
    }
    expect(source).toMatch(/split it by responsibility/i);

    expect(
      sizeProblem("test/example.test.ts", "x\n".repeat(800)),
    ).toBeUndefined();
    const test = sizeProblem("test/example.test.ts", "x\n".repeat(801));
    for (const part of ["test/example.test.ts", "801", "800", ruleReference]) {
      expect(test).toContain(part);
    }
    expect(test).toMatch(/split it by responsibility/i);

    for (const exception of dataExceptions) {
      const path = exception.endsWith("/") ? `${exception}nb.json` : exception;
      expect(sizeProblem(path, "x\n".repeat(900))).toBeUndefined();
    }
  });

  it("fails a folder with 16 TypeScript files directly inside, with advice naming the rule (AC-2)", () => {
    const paths = Array.from(
      { length: 16 },
      (_, index) => `src/feature/${index}.ts`,
    );
    const problems = folderProblems(paths);
    expect(problems).toHaveLength(1);
    for (const part of ["src/feature", "16", "15", ruleReference]) {
      expect(problems[0]).toContain(part);
    }
    expect(problems[0]).toMatch(/by responsibility/i);
  });

  it("does not count a nested file against its parent folder (AC-2)", () => {
    const paths = [
      ...Array.from({ length: 15 }, (_, index) => `src/feature/${index}.ts`),
      "src/feature/nested/extra.ts",
    ];
    expect(folderProblems(paths)).toEqual([]);
  });

  it("counts only TypeScript files outside the data exceptions toward the folder limit (AC-2)", () => {
    const typescript = Array.from(
      { length: 15 },
      (_, index) => `src/feature/${index}.ts`,
    );
    for (const extra of [
      "src/feature/styles.css",
      "src/feature/data.json",
      "src/feature/notes.md",
    ]) {
      expect(folderProblems([...typescript, extra])).toEqual([]);
    }
    const messages = Array.from(
      { length: 16 },
      (_, index) => `packages/i18n/messages/${index}.ts`,
    );
    expect(folderProblems(messages)).toEqual([]);
  });

  it("counts .ts and .tsx files together toward the folder limit (AC-2)", () => {
    const paths = Array.from(
      { length: 16 },
      (_, index) => `src/feature/${index}.${index % 2 === 0 ? "ts" : "tsx"}`,
    );
    expect(folderProblems(paths)).toHaveLength(1);
  });

  it("keeps every folder at 15 or fewer TypeScript files directly inside (AC-4)", () => {
    expect(folderProblems(trackedFiles())).toEqual([]);
  });

  it("documents the limits, the data exceptions and this test under Code health in AGENTS.md (AC-1)", () => {
    const agents = readFileSync(resolve(repository, "AGENTS.md"), "utf8");
    const section = codeHealthSection(agents);
    expect(section).toBeDefined();
    for (const fact of [
      "packages/server/test/sourceSizes.test.ts",
      ...dataExceptions,
      String(sourceLineLimit),
      String(testLineLimit),
      String(folderLimit),
    ]) {
      expect(section).toContain(fact);
    }
  });

  it("has a CLAUDE.md that only imports AGENTS.md (AC-1)", () => {
    const claude = readFileSync(resolve(repository, "CLAUDE.md"), "utf8");
    expect(claude.trimEnd()).toBe("@AGENTS.md");
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
