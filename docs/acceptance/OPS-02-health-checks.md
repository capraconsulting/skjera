# OPS-02: Health checks

The server answers two health checks, for Kubernetes: one says the process is running, the other that it can serve, with the database answering.

**Set-up:** `pnpm dev` running. The server is on port 3000; the app on 5173 does not pass these addresses on to it.

## AC-1: Alive while the process runs

WHILE the server is running, `GET /health` SHALL answer `ok`.

**Test**

- **Given** `pnpm dev` running
- **When** you run `curl -i http://localhost:3000/health`
- **Then** it answers `200` with `ok`

**Automated:** `packages/server/test/health.test.ts`

## AC-2: Ready while the database answers

WHILE the database answers, `GET /health/ready` SHALL answer `ok`.

**Test**

- **Given** `pnpm dev` running
- **When** you run `curl -i http://localhost:3000/health/ready`
- **Then** it answers `200` with `ok`

**Automated:** `packages/server/test/health.test.ts`

## AC-3: Not ready without the database

IF the database does not answer within two seconds, THEN `GET /health/ready` SHALL answer `503` with `unavailable`, and `GET /health` SHALL still answer `ok`.

**Test**

- **Given** `pnpm dev` running
- **When** you run `docker compose stop postgres`, then `curl -i http://localhost:3000/health/ready` and `curl -i http://localhost:3000/health`
- **Then** the first answers `503` with `unavailable` after at most about two seconds, and the second `200` with `ok`
- **And** run `docker compose start postgres` afterwards

**Automated:** `packages/server/test/health.test.ts`

## AC-4: The Readme names them

The Readme SHALL say which address is the liveness check and which the readiness check.

**Test**

- **Given** the Readme
- **When** you read «In Kubernetes»
- **Then** it says liveness on `GET /health`, readiness on `GET /health/ready`

**Automated:** none
