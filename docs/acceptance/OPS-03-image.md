# OPS-03: The image and running it

Skjera is deployed as one Docker image: the server, serving the built app too, on port 3000. The [Readme](../../Readme.md#deploying) says how it is built and run.

**Set-up:** Docker running, in a checkout of `main`.

## AC-1: One image, built from the repository

Skjera SHALL build into one Docker image, from the `Dockerfile` at the top of the repository.

**Test**

- **Given** a checkout of `main`
- **When** you run `docker build -t skjera .`
- **Then** it builds an image `skjera`

**Automated:** the «Image builds» job in `.github/workflows/ci.yml`, on every push to main and every pull request.

## AC-2: The server and the app on port 3000

The image SHALL hold the server and the built app, set to serve them together on port 3000 unless `PORT` says otherwise.

**Test**

- **Given** the image built
- **When** you run `docker image inspect skjera --format '{{.Config.ExposedPorts}} {{.Config.Env}}'`
- **Then** it exposes `3000/tcp` and sets `PORT=3000`

**Automated:** none; every run of `pnpm test:e2e` serves the same built app and server together on one port, as `pnpm test-server` does, but not from the image.

## AC-3: Migrations at start

WHEN the server starts, it SHALL bring the database up to date before it serves anything.

**Test**

- **Given** the development services running
- **When** you start a test server, `PORT=8801 mise exec -- pnpm test-server`, which starts on a new, empty database
- **Then** http://localhost:8801 shows the site, and alice can log in and create a team

**Automated:** every run of `pnpm test:e2e`, on a new database each time.

## AC-4: Stops promptly on SIGTERM

WHEN the server is sent SIGTERM, it SHALL stop promptly.

**Test**

- **Given** a test server started with `PORT=8801 mise exec -- pnpm test-server`
- **When** you send it SIGTERM: `kill $(lsof -t -iTCP:8801 -sTCP:LISTEN)`
- **Then** it has stopped within a few seconds, and http://localhost:8801 no longer answers

**Automated:** `packages/server/test/shutdown.test.ts`

## AC-5: The Readme says how to run it

The Readme SHALL say that the image is to run as one replica, which addresses the health checks are on, and that WebSockets on `/automerge` must pass through the ingress.

**Test**

- **Given** the Readme
- **When** you read «Deploying» and «In Kubernetes»
- **Then** it has `docker build -t skjera .`, the configuration, one replica, `/health` and `/health/ready`, SIGTERM, and `/automerge`

**Automated:** none
