import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = new URL("../..", import.meta.url).pathname;
const e2eRoot = join(appRoot, "e2e");
const messagesRoot = join(appRoot, "../i18n/messages");
const projectRoot = resolve(appRoot, "../..");
const acceptanceRoot = join(projectRoot, "docs/acceptance");
const oauthE2eRoot = join(appRoot, "../oauth/e2e");

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : extname(path) === ".ts"
        ? [path]
        : [];
  });

const filesWithExtension = (directory: string, extension: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? filesWithExtension(path, extension)
      : extname(path) === extension
        ? [path]
        : [];
  });

const catalogueTexts = new Set<string>(
  ["en.json", "nb.json", "nn.json"].flatMap((file) =>
    Object.values(
      JSON.parse(readFileSync(join(messagesRoot, file), "utf8")) as Record<
        string,
        string
      >,
    ),
  ),
);

const interfaceMethods = new Set([
  "getByAltText",
  "getByLabel",
  "getByPlaceholder",
  "getByRole",
  "getByText",
  "toContainText",
  "toHaveAccessibleName",
  "toHaveText",
]);

const allowedFixtureText = new Set(["e2e/pom/Header.ts\0Skjera"]);

const copiedInterfaceTexts = (): string[] => {
  const copies: string[] = [];
  for (const file of sourceFiles(e2eRoot)) {
    const source = readFileSync(file, "utf8");
    for (const method of interfaceMethods) {
      const call = new RegExp(`\\.${method}\\([\\s\\S]*?\\)(?:\\.|;|,)`, "g");
      for (const match of source.matchAll(call)) {
        for (const text of catalogueTexts) {
          if (
            match[0].includes(JSON.stringify(text)) &&
            !allowedFixtureText.has(`${relative(appRoot, file)}\0${text}`)
          ) {
            const line = source.slice(0, match.index).split("\n").length;
            copies.push(
              `${relative(appRoot, file)}:${line} ${JSON.stringify(text)}`,
            );
          }
        }
      }
    }
  }
  return copies;
};

describe("browser-test source contracts", () => {
  it("keeps specs on the shared fixture (AC-1)", () => {
    const directImports = [e2eRoot, oauthE2eRoot].flatMap((root) =>
      sourceFiles(join(root, "specs")).flatMap((file) =>
        /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*["']@playwright\/test["']/.test(
          readFileSync(file, "utf8"),
        )
          ? [relative(projectRoot, file)]
          : [],
      ),
    );
    const biome = readFileSync(join(projectRoot, "biome.json"), "utf8");
    expect(directImports).toEqual([]);
    expect(biome).toContain("noRestrictedImports");
  });

  it("keeps every automated acceptance path present (AC-2, AC-3)", () => {
    const missing = filesWithExtension(acceptanceRoot, ".md").flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.startsWith("**Automated:**"))
        .flatMap((line) => [...line.matchAll(/`([^`]+)`/g)])
        .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
        .filter((path) => path.endsWith(".spec.ts"))
        .filter((path) => !existsSync(resolve(projectRoot, path))),
    );
    expect(missing).toEqual([]);
  });

  it("qualifies criterion citations with their feature id (AC-3)", () => {
    const bare = [e2eRoot, oauthE2eRoot].flatMap((root) =>
      sourceFiles(join(root, "specs")).flatMap((file) => {
        const source = readFileSync(file, "utf8");
        return source
          .split("\n")
          .flatMap((line) => {
            const citation = line.match(
              /\(([^()]*\bAC-\d+[^()]*)\)", async/,
            )?.[1];
            return citation === undefined ? [] : [citation];
          })
          .filter((citation) => /(?:^|,\s*)AC-\d+/.test(citation))
          .map(() => relative(projectRoot, file));
      }),
    );
    expect(bare).toEqual([]);
  });

  it("shares unique emails and guest links (AC-4)", () => {
    const all = sourceFiles(e2eRoot).map((file) => readFileSync(file, "utf8"));
    const occurrences = (pattern: RegExp) =>
      all.reduce(
        (count, source) => count + [...source.matchAll(pattern)].length,
        0,
      );
    expect(occurrences(/crypto\.randomUUID\(\).*@example\.org/g)).toBe(1);
    expect(
      all.filter((source) => source.includes("\\\\?guest=\\\\S+")).length,
    ).toBe(1);
    expect(
      all.filter((source) => source.includes("cancel\\\\?token=\\\\S+")).length,
    ).toBe(1);
  });

  it("shares the bot-trap implementation (AC-4)", () => {
    const all = sourceFiles(e2eRoot).map((file) => readFileSync(file, "utf8"));
    const occurrences = (pattern: RegExp) =>
      all.reduce(
        (count, source) => count + [...source.matchAll(pattern)].length,
        0,
      );
    expect(occurrences(/input\[name=["']subject["']\]/g)).toBe(1);
  });

  it("shares past-event creation and confirmation coordination (AC-4)", () => {
    const editor = readFileSync(
      join(e2eRoot, "pom/studio/EventEditor.ts"),
      "utf8",
    );
    expect(
      readFileSync(
        join(e2eRoot, "pom/studio/event-editor/EventLifecycle.ts"),
        "utf8",
      ),
    ).toContain("readonly past?: boolean");
    expect([...editor.matchAll(/page\.once\("dialog"/g)]).toHaveLength(1);
    expect(
      readFileSync(join(e2eRoot, "specs/site/embed.spec.ts"), "utf8"),
    ).not.toContain("pickPastStart()");
  });

  it("shares the image-loading implementation (AC-4)", () => {
    const images = readFileSync(join(e2eRoot, "pom/images.ts"), "utf8");
    expect([...images.matchAll(/\.naturalWidth/g)]).toHaveLength(1);
    for (const file of [
      "pom/Header.ts",
      "pom/site/EventPage.ts",
      "pom/site/Footer.ts",
    ]) {
      expect(readFileSync(join(e2eRoot, file), "utf8")).not.toContain(
        ".naturalWidth",
      );
    }
  });

  it("uses shared Dex users in browser specs (AC-5)", () => {
    const inline = [e2eRoot, oauthE2eRoot].flatMap((root) =>
      sourceFiles(join(root, "specs")).flatMap((file) =>
        /["'](?:alice|bob)@example\.com["']/.test(readFileSync(file, "utf8"))
          ? [relative(projectRoot, file)]
          : [],
      ),
    );
    expect(inline).toEqual([]);
  });

  it("uses shared Dex form ids in login page objects (AC-6)", () => {
    const copied = [
      join(e2eRoot, "pom/LoginPage.ts"),
      join(oauthE2eRoot, "pom/LoginPage.ts"),
    ].filter((file) => /#[a-z-]+/.test(readFileSync(file, "utf8")));
    expect(copied).toEqual([]);
  });

  it("reads interface text from generated messages (AC-1)", () => {
    expect(copiedInterfaceTexts()).toEqual([]);
  });

  it("imports production timing, widths and paths (AC-3, AC-4)", () => {
    const guarded = [
      ["e2e/fixtures/support.ts", /\/automerge\$/],
      ["e2e/pom/site/HomePage.ts", /2_000/],
      ["e2e/pom/site/WhoIsComing.ts", /2_000/],
      ["e2e/specs/studio/columns.spec.ts", /expectWidth\([^\n]+,\s*\d+/],
      ["e2e/specs/studio/images.spec.ts", /\/api\/images/],
      ["e2e/pom/studio/EventEditor.ts", /\/api\/documents/],
      ["e2e/pom/studio/TeamsColumn.ts", /\/api\/teams/],
    ] as const;
    const copies = guarded.flatMap(([file, pattern]) => {
      const source = readFileSync(join(appRoot, file), "utf8");
      return pattern.test(source) ? [file] : [];
    });
    expect(copies).toEqual([]);
  });

  it("passes imported values into browser callbacks and field locators (AC-1, AC-4)", () => {
    const images = readFileSync(join(e2eRoot, "pom/images.ts"), "utf8");
    const editor = readFileSync(
      join(e2eRoot, "pom/studio/EventEditor.ts"),
      "utf8",
    );
    expect(images).toContain("{ base64: pixelBase64, imagesPath }");
    expect(images).toContain("}, imagesPath)");
    expect(editor).not.toMatch(/\btextbox\(["']/);
  });

  it("uses exported image and API paths and a typed site override (AC-2, AC-4)", () => {
    const api = readFileSync(join(appRoot, "../documents/src/api.ts"), "utf8");
    const support = readFileSync(join(e2eRoot, "fixtures/support.ts"), "utf8");
    expect(api).toContain('export * from "./Model.ts"');
    expect(
      readFileSync(join(appRoot, "../documents/src/CoverModel.ts"), "utf8"),
    ).toContain("imagePathPattern");
    expect(
      readFileSync(join(appRoot, "../documents/src/api/PublicApi.ts"), "utf8"),
    ).toContain("publicPath");
    expect(
      readFileSync(
        join(appRoot, "../documents/src/api/DocumentsApi.ts"),
        "utf8",
      ),
    ).toContain("documentPath");
    expect(
      readFileSync(join(appRoot, "../documents/src/api/TeamsApi.ts"), "utf8"),
    ).toContain("teamPath");
    expect(support).toContain("overrideSite");
    expect(support).toContain("Partial<Site>");
  });
});
