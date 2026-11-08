export interface SnapsyncBuildFiles {
  readonly packageJson: string;
  readonly control: string;
  readonly server: string;
  readonly dockerfile: string;
}

const capture = (text: string, pattern: RegExp, field: string): string => {
  const value = pattern.exec(text)?.[1];
  if (value === undefined) throw new Error(`Could not read snapsync ${field}`);
  return value;
};

export const snapsyncBuildContract = (files: SnapsyncBuildFiles) => {
  const version = (JSON.parse(files.packageJson) as { version: string })
    .version;
  const controlVersion = capture(
    files.control,
    /^default_version\s*=\s*'([^']+)'/m,
    "control version",
  );
  const sourceVersion = capture(
    files.server,
    /export const version = "([^"]+)"/,
    "source version",
  );
  if (controlVersion !== version || sourceVersion !== version)
    throw new Error(
      `Snapsync versions differ: package ${version}, control ${controlVersion}, source ${sourceVersion}`,
    );

  const extensionDirectory = "../snapsync/extension";
  if (!/\.\.\/extension\/snapsync--\$\{version\}\.sql/.test(files.server))
    throw new Error("Snapsync source does not read its versioned SQL file");
  if (!files.dockerfile.includes("packages/server/extension"))
    throw new Error("Dockerfile does not copy the built snapsync extension");
  return { version, extensionDirectory };
};
