# F08: Test servers

A branch of Skjera can be started as a test server on one port, with a database of its own, at an address set by configuration. The [Readme](../../Readme.md#test-servers) describes it.

**Set-up:** the development services running: `pnpm dev`, or `docker compose up --detach --wait postgres dex rustfs mailpit`.

## AC-1: One command builds and serves on a port

Skjera SHALL have a command that builds the app and the server from the working tree and serves both on the port in `PORT`, and keeps running until it is stopped.

**Test**

- **Given** the development services running
- **When** you run `PORT=8801 mise exec -- pnpm test-server` and open http://localhost:8801
- **Then** the site answers on 8801 until you stop it with Ctrl-C

**Automated:** `packages/server/test/testServer.test.ts`

## AC-2: A database of its own

WHEN that command starts, it SHALL give the test server a fresh database of its own in the development Postgres, so that test servers for different branches never share one, and never use the development database `skjera`.

**Test**

- **Given** the development services running
- **When** you start the test server twice, one after the other
- **Then** each start prints a new database, `skjera_testserver_8801_…`, different each time

**Automated:** `packages/server/test/testServer.test.ts`

## AC-3: The host name comes from configuration

The host name a test server is reached at SHALL be read from configuration, and SHALL be `localhost` when none is set.

**Test**

- **Given** `SKJERA_TEST_SERVER_URL` not set
- **When** you start the test server
- **Then** its links use http://localhost:8801

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/server/test/testServer.test.ts`

## AC-4: Log in from another machine

WHEN a test server is opened at the configured host name and its port, a person on another machine SHALL be able to log in with the development users, as on `localhost` today.

**Test**

- **Given** `SKJERA_TEST_SERVER_URL` set on the machine running the test server, as the Readme says, and a second machine that can reach it
- **When** you open the test server from the second machine, at that address and port, and log in as alice
- **Then** alice is logged in

**Automated:** `packages/server/test/testServer.test.ts`

## AC-5: Email links use that host name

The links in the emails a test server sends SHALL point at the configured host name and the test server's port.

**Test**

- **Given** a test server with `SKJERA_TEST_SERVER_URL` set
- **When** you sign up to an event on it, and open the email in Mailpit
- **Then** its links point at the configured address with the test server's port

**Automated:** `packages/app/e2e/specs/attendance/guests.spec.ts`, `packages/server/test/testServer.test.ts`, `packages/documents/test/notices/signups.test.tsx`

## AC-6: Mailpit from another machine

WHERE a host name is configured, the emails a test server sends SHALL be readable in Mailpit from another machine at that host name.

**Test**

- **Given** the same test server
- **When** you open the configured address on port 8025 from the second machine
- **Then** Mailpit shows the test server's emails

**Automated:** none.

## AC-7: Nothing changes without a host name

WHILE no host name is configured, `pnpm dev`, the tests and the end-to-end tests SHALL work as they do today.

**Test**

- **Given** `SKJERA_TEST_SERVER_URL` not set
- **When** you run `pnpm dev`, log in at http://localhost:5173, and open Mailpit at http://localhost:8025
- **Then** both work

**Automated:** every run of `pnpm check` and `pnpm test:e2e`.

## AC-8: The Readme says how

The Readme SHALL say how a branch is started as a test server and which configuration names its host.

**Test**

- **Given** the Readme
- **When** you read «Test servers»
- **Then** it has the command, what must be running, and `SKJERA_TEST_SERVER_URL`

**Automated:** none.
