# syntax=docker/dockerfile:1

# The Skjera server, serving the built app too: one image, one process, on
# port 3000 (PORT). Configured by environment variables, as in mise.toml.
# Postgres (with pg_automerge), S3 and an OIDC provider are elsewhere.

ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-bookworm-slim AS build
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
RUN pnpm --filter @skjera/app build
# The server with its production dependencies, workspace packages included.
RUN pnpm --filter @skjera/server deploy --prod /out \
 && cp -r packages/app/dist /out/public

FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/public
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
EXPOSE 3000
# Kubernetes: liveness on /health, readiness on /health/ready.
CMD ["node", "--import", "tsx", "src/main.ts"]
