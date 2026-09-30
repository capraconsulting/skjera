# Skjera

To work on Skjera you need [mise](https://mise.jdx.dev) and Docker installed. mise installs the right versions of Node and pnpm, and Docker runs the local services.

Until pg_automerge publishes its Docker image, the local Postgres is built from a checkout of [pg-automerge](../pg-automerge) next to this repository.

```bash
mise trust
mise install
mise run setup
```

Then `pnpm dev` starts Postgres, Dex, the server and the app at http://localhost:5173. Log in as `alice@example.com` or `bob@example.com`, password `password`.
