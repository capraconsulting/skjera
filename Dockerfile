# syntax=docker/dockerfile:1

# The Skjera server, serving the built app too: one image, one process, on
# port 3000 (PORT). Configured by environment variables, as in mise.toml.
# Postgres (with pg_automerge), S3 and an OIDC provider are elsewhere.
#
# Small: the server is bundled into one file (packages/server/build.ts), so
# there are no node_modules, and it runs on a distroless base with just the
# node binary, no shell or package manager.

ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-bookworm-slim AS node

FROM node AS build
RUN npm install --global pnpm@12.8.1
WORKDIR /repo

# Dependencies first, from the lockfile alone: cached until it changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch

COPY . .
# Only what the app and the server need, not the dev tooling at the root.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --offline --frozen-lockfile \
      --filter "@skjera/app..." --filter "@skjera/server..."
RUN pnpm --filter @skjera/app build && pnpm --filter @skjera/server build

# glibc and libstdc++, which node needs, and a nonroot user (65532).
FROM gcr.io/distroless/cc-debian12:nonroot@sha256:9dac0a79194e45a7da0158a9c6da57b217585af0786db3845d1f0ec1a0dd182f
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build /repo/packages/server/dist dist
COPY --from=build /repo/packages/server/extension extension
COPY --from=build /repo/packages/app/dist public
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/public
EXPOSE 3000
# Kubernetes: liveness on /health, readiness on /health/ready.
ENTRYPOINT ["/usr/local/bin/node", "--enable-source-maps", "dist/main.js"]
