import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = new URL("..", import.meta.url).pathname;
const e2eRoot = join(appRoot, "e2e");
const messagesRoot = join(appRoot, "../i18n/messages");

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : extname(path) === ".ts"
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
  it("reads interface text from generated messages (AC-1)", () => {
    expect(copiedInterfaceTexts()).toEqual([]);
  });

  it("imports production timing, widths and paths (AC-3, AC-4)", () => {
    const guarded = [
      ["e2e/fixtures/support.ts", /\/automerge\$/],
      ["e2e/pom/site/HomePage.ts", /2_000/],
      ["e2e/pom/site/WhoIsComing.ts", /2_000/],
      ["e2e/specs/columns.spec.ts", /expectWidth\([^\n]+,\s*\d+/],
      ["e2e/specs/images.spec.ts", /\/api\/images/],
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
      readFileSync(join(appRoot, "../documents/src/Model.ts"), "utf8"),
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
