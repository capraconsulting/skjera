# Skjera

How this repository is kept workable. [Readme.md](Readme.md) says how to run it.

## Code health

`packages/server/test/sourceSizes.test.ts` checks the line and folder limits below on every tracked file
(`pnpm test`).

- A source file (`.ts`, `.tsx`) stays at or under 500 lines; a test file (under a `test` folder, or named
  `*.test.*` or `*.spec.*`) at or under 800.
- A folder holds at most 15 source or test files (`.ts`, `.tsx`) directly inside it. A folder that would go
  past 15 is split into subfolders named for what their files are about.
- A module split across several files is a folder named after the module, with an `index.ts` that says what it
  exports, never a file beside a folder of the same name.
- A part nearing a limit is split by responsibility: the part that has its own name moves out, never an
  arbitrary half.
- These data files are left out of both limits, since they grow with the data, not with the code:
  `packages/server/testdata/catalogue.ts`, `packages/i18n/messages/` and
  `packages/snapsync/extension/snapsync--0.1.0.sql`.
