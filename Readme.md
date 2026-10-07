# Skjera

To work on Skjera you need [mise](https://mise.jdx.dev) and Docker installed. mise installs the right versions of Node and pnpm, and Docker runs the local services.

Until pg_automerge publishes its Docker image, the local Postgres is built from a checkout of [pg-automerge](../pg-automerge) next to this repository.

Table syncing uses [snapsync](packages/snapsync), pure SQL in this repository, which the server's migrations install: Postgres needs nothing of ours beyond pg_automerge.

```bash
mise trust
mise install
mise run setup
```

Then `pnpm dev` starts Postgres, Dex, the server and the app at http://localhost:5173. Log in as `alice@example.com` or `bob@example.com`, password `password`.

## Deploying

The [Dockerfile](Dockerfile) builds one image: the server, serving the built app too, on port 3000.

```bash
docker build -t skjera .
```

It's configured by environment variables, as in [mise.toml](mise.toml). Needed: `DATABASE_URL` (Postgres 18 with pg_automerge; migrations run at start), `OAUTH_*` (an OIDC provider), `S3_*` (image storage), `SITE_URL`, `SITE_NAME`, `SITE_LOCALE` (the language for those who haven't picked one: `en`, `nb` or `nn`), `EMAIL_FROM`, `SIGNING_SECRET` (any long random string, the same across restarts) and `EMAIL_TRANSPORT=ses` (with `AWS_REGION` and AWS credentials) or `smtp` (with `EMAIL_SMTP_URL`). The server starts without the email settings and the secret, warning that emails aren't sent.

In Kubernetes:

- Liveness: `GET /health`. Readiness: `GET /health/ready`, which checks the database.
- One replica for now: background work (emails, reminders) runs on an Effect cluster in single-runner mode. More need its runners set up to find each other.
- It stops promptly on SIGTERM.
- WebSockets (`/automerge`, where drafts sync) have to pass through the ingress.

## Languages

The interface and emails are in English, Norwegian Bokmål and Nynorsk: [packages/i18n](packages/i18n), with [Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs). Each language's words are in `messages/{en,nb,nn}.json`; a test checks every message is in each. Event content stays in the language it was written in.
