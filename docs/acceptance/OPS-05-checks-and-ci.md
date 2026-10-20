# OPS-05: Checks and CI

Skjera's code is checked by commands any developer runs, by a git hook before each commit, and by GitHub Actions on each push. The [Readme](../../Readme.md#checks-and-tests) lists the commands.

**Set-up:** a checkout set up as the Readme says, with `mise run setup`, and the development services running.

## AC-1: One command for each check

Skjera SHALL have a command for each check: `pnpm lint` (Biome), `pnpm typecheck`, `pnpm test` (unit and integration tests) and `pnpm test:e2e` (the browser tests).

**Test**

- **Given** a checkout of `main`
- **When** you run `pnpm lint`, `pnpm typecheck` and `pnpm test`
- **Then** each runs, and passes

**Automated:** the «Lint, types and tests» job in `.github/workflows/ci.yml`

## AC-2: The browser tests on a server of their own

WHEN the browser tests run, they SHALL start a test server of their own, with a new database, and leave the development database alone.

**Test**

- **Given** `pnpm dev` running, with some teams in the studio
- **When** you run `pnpm test:e2e`
- **Then** it serves on port 8806 while it runs, and the teams in http://localhost:5173/studio are as before

**Automated:** `packages/server/test/testServer.test.ts`, which checks that a test server gets a new database, never the development one

## AC-3: A hook checks each commit

WHEN a developer commits, the pre-commit hook SHALL run Biome on the staged files, the type check and the tests, and stop the commit if one fails.

**Test**

- **Given** the hooks set by `mise run setup`: `git config core.hooksPath` says `.hooks`
- **When** you stage a change that breaks a type, and commit
- **Then** the commit is refused with the type error
- **And** undo the change afterwards

**Automated:** none

## AC-4: GitHub checks every push

WHEN code is pushed to `main` or to a pull request, GitHub Actions SHALL run the lint, the type check, the tests, the browser tests, and a build of the image.

**Test**

- **Given** the repository on GitHub
- **When** you open **Actions** and the latest run of **CI** on `main`
- **Then** it has the jobs «Lint, types and tests», «End-to-end tests» and «Image builds»

**Automated:** none
