import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const importPattern = /(?:from\s+|import\s+)["']([^"']+\.module\.css)["']/g;
const rawSelectPattern = /<select(?:\s|>)/g;
const windowConfirmPattern = /\b(?:window|globalThis)\.confirm\s*\(/g;

const lineAt = (source, index) => source.slice(0, index).split("\n").length;

export function findComponentBoundaryViolations(filePath, source) {
  const violations = [];
  const owner = filePath.replace(/\.[^.]+$/, "");

  for (const match of source.matchAll(importPattern)) {
    const imported = match[1];
    if (imported === undefined || !imported.startsWith(".")) continue;
    const importedOwner = resolve(dirname(filePath), imported).replace(
      /\.module\.css$/,
      "",
    );
    if (resolve(owner) === importedOwner) continue;
    const moduleName = imported.split("/").at(-1) ?? imported;
    const componentName = moduleName.replace(/\.module\.css$/, ".tsx");
    violations.push(
      `${filePath}:${lineAt(source, match.index)}: import shared styles through ${componentName}, not ${moduleName}`,
    );
  }

  if (!filePath.endsWith("/components/controls/Input.tsx")) {
    for (const match of source.matchAll(rawSelectPattern)) {
      violations.push(
        `${filePath}:${lineAt(source, match.index)}: use Select instead of a raw <select>`,
      );
    }
  }

  for (const match of source.matchAll(windowConfirmPattern)) {
    violations.push(
      `${filePath}:${lineAt(source, match.index)}: use useConfirm instead of window.confirm`,
    );
  }
  return violations;
}

const sourceFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return extname(entry.name) === ".tsx" ? [path] : [];
  });

export function checkComponentBoundaries(root) {
  const sourceRoot = join(root, "packages/app/src");
  return sourceFiles(sourceRoot).flatMap((path) => {
    const filePath = relative(root, path).split(sep).join("/");
    return findComponentBoundaryViolations(
      filePath,
      readFileSync(path, "utf8"),
    );
  });
}

const invoked =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const violations = checkComponentBoundaries(process.cwd());
  if (violations.length > 0) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  }
}
