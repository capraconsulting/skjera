# OPS-06: Local development stack

One command starts everything Skjera needs on a developer's machine: the database, the login provider, image storage, email and Skjera itself. The [Readme](../../Readme.md#getting-started) says how.

**Set-up:** mise and Docker installed, and a checkout set up with `mise trust`, `mise install` and `mise run setup`.

## AC-1: One command starts it all

WHEN a developer runs `pnpm dev`, Skjera SHALL start Postgres, Dex, RustFS, Mailpit, the server, the app and the message compiler.

**Test**

- **Given** the checkout set up
- **When** you run `pnpm dev`
- **Then** mprocs lists `postgres`, `dex`, `rustfs`, `mailpit`, `i18n`, `server` and `app`, all running
- **And** http://localhost:5173 shows the site, alice can log in, and Mailpit is at http://localhost:8025

**Automated:** none

## AC-2: Services pinned by digest

The local services SHALL run from images pinned by digest.

**Test**

- **Given** `compose.yml`
- **When** you read each service's `image:`
- **Then** each ends in `@sha256:` and a digest

**Automated:** none

## AC-3: Images stored and served safely

WHEN an image is uploaded in the studio, Skjera SHALL store it in the S3-compatible storage, and serve it back with its own image type and `X-Content-Type-Options: nosniff`.

**Test**

- **Given** an event in the studio with a PNG image in its **Body**, published
- **When** you open the event on the site, and run `curl -sI` on the image's address, `http://localhost:5173/api/images/…`
- **Then** it has `content-type: image/png` and `x-content-type-options: nosniff`

**Automated:** `packages/app/e2e/specs/images.spec.ts`, `packages/documents/test/events/Images.test.ts`

## AC-4: Table syncing comes with the migrations

The server's migrations SHALL install the table syncing the site and studio use, so that the database needs nothing more than Postgres with pg_automerge.

**Automated only:** it is seen only in how the tables sync. `packages/snapsync/test/snapsync.test.ts`, `packages/snapsync/test/client.test.ts`, and every run of `pnpm test:e2e`, on a new database each time.

## AC-5: Local data starts over

WHEN a developer runs `docker compose down -v`, Skjera SHALL start over with no local data the next time `pnpm dev` runs.

**Test**

- **Given** `pnpm dev` stopped, with teams in the studio
- **When** you run `docker compose down -v`, then `pnpm dev`, and log in as alice
- **Then** the studio has no teams

**Automated:** none
