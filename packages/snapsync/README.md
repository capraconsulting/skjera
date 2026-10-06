# snapsync

Keep copies of Postgres tables up to date by pulling what changed since a
snapshot. Clients (a browser's TanStack DB collection, another service, a
search index) pull a table once, then pull what changed since their last
pull, and never miss a change, however transactions interleave or in which
order they commit.

- **`extension/`**: the `snapsync` Postgres extension, in plain SQL.
- **`@skjera/snapsync/server`**: pulling from tracked tables, and keeping
  snapsync well, with [Effect](https://effect.website) SQL.
- **`@skjera/snapsync/client`**: a [TanStack DB](https://tanstack.com/db)
  collection holding a copy of a table, pulled from a server.
- **`@skjera/snapsync/schema`**: what goes over the wire between them.
- **`@skjera/snapsync/testing`**: concurrent out-of-order writers and
  consistency checks, to test pulls the way they fail.

## Why snapshots

Syncing by "changed after the last timestamp (or sequence number) I saw"
misses changes: a transaction that started earlier can commit after a later
one, with an earlier timestamp than what a client has already seen. Instead,
every tracked row records the transaction that last wrote it (an `xid8`),
and a client keeps the snapshot it pulled in: which transactions it had seen.
The next pull returns rows written by transactions that snapshot hadn't seen:
`xid >= xmin AND NOT pg_visible_in_snapshot(xid, snapshot)`, narrowed by an
index on the xid column. Deleted rows leave tombstones, pulled the same way.

This follows Cognite's
[txid-syncing](https://github.com/cognitedata/txid-syncing) and its talk
"[Flexible change data capture with Postgres](https://vimeo.com/747697698)",
with Postgres 13+'s `xid8` and `pg_snapshot` in place of `txid_*`.

## Install the extension

PostgreSQL 14 or later. Copy `extension/*` into the server's extension
directory (`$(pg_config --sharedir)/extension`), or on PostgreSQL 18, point
`extension_control_path` at a directory holding them in an `extension/`
subdirectory, e.g. in Docker Compose:

```yaml
postgres:
  image: postgres:18
  command: ["postgres", "-c", "extension_control_path=$$system:/opt/snapsync"]
  volumes:
    - ./node_modules/@skjera/snapsync/extension:/opt/snapsync/extension:ro
```

Then, as a superuser (the owner of the tables, typically):

```sql
CREATE EXTENSION snapsync;
SELECT snapsync.track('attendees');            -- key column "id", xid column "xid"
SELECT snapsync.track('tags', 'name', 'xid');  -- or name them
```

`track()` adds the xid column (unless it exists) with an index, and triggers
that stamp rows and bury deleted ones. Keys are compared as text.

## Pull

A pull runs in one `REPEATABLE READ` transaction: the token's snapshot, the
rows, the tombstones and the new token all see the same transactions.

```sql
-- null: start over and pull everything (see "Starting over").
SELECT snapsync.since($token, 'attendees')::text;              -- $since
SELECT * FROM attendees WHERE snapsync.unseen(xid, $since::pg_snapshot);
SELECT key FROM snapsync.deleted('attendees', $since::pg_snapshot) AS key;
SELECT snapsync.token('attendees');                              -- the next token
```

Pass `$since` as a value, not as `snapsync.since(...)` inline: that way
`unseen()` is inlined and the index used.

With Effect:

```ts
import * as Snapsync from "@skjera/snapsync/server";

const pull = (since: Token | undefined) =>
  Snapsync.pull({
    table: "attendees",
    since,
    select: (unseen) =>
      sql<Row>`SELECT ... FROM attendees a JOIN events e ON ...
               WHERE ${unseen("a.xid")} OR ${unseen("e.xid")}`.pipe(
        Effect.map((rows) => ({
          rows: rows.filter(mayRead),
          // Changed rows the reader may not see (anymore) leave their copy.
          hidden: rows.filter((row) => !mayRead(row)).map((row) => row.id),
        })),
      ),
  });
```

Who may see which rows is up to the query: `hidden` keys are pulled as
deleted. `snapsync.deleted()` only shows a role the tombstones of tables it
may `SELECT` from (row-level security).

## Copies in TanStack DB

```ts
import { syncedTable } from "@skjera/snapsync/client";

export const attendees = syncedTable({
  id: "attendees",
  getKey: (row: AttendeeRow) => row.id,
  pull: (since) => api.attendees({ since }),
  write: { insert: (row, metadata) => api.attend(row, metadata) },
});
// attendees.collection: a TanStack DB collection; attendees.refresh()
```

It pulls every row once, then what changed: every 5 seconds while the page
is visible, when it's visible or online again, and after each write. Writes
show at once and are undone if the server refuses them.

## Starting over

`snapsync.status(token, table)` says whether a token can be pulled from.
When it can't, `since()` returns null and the pull returns every row with
`complete: true`, and the client replaces its copy:

| Status | When |
|---|---|
| `missing` | No token: a first pull. |
| `malformed` | Not a token. |
| `elsewhere` | From another cluster or database. |
| `ahead` | From transactions this database hasn't had. |
| `restarted` | The table was truncated, or the database restored, since. |
| `pruned` | It needed tombstones that were forgotten. |

## Keeping it well

```ts
// After migrations; with the defaults shown.
Snapsync.maintain({ retention: "30 days", every: "1 hour" })
```

- **Pruning**: `snapsync.prune(interval)` forgets tombstones older than the
  retention. A table's clients whose snapshot predates the newest forgotten
  one start over. A snapshot's xmin is the oldest transaction running
  anywhere in the cluster, so keep tombstones longer than transactions run.
- **Restores**: transaction ids start over in another cluster, and a
  `pg_dump` brings the old ones along. `snapsync.ensure_current()` notices
  (by the cluster's system identifier and the database's oid, kept in
  `snapsync.state`, which is dumped too), stamps every tracked row anew and
  starts every client over. Call it when connecting, before serving pulls;
  `maintain()` does. Physical backups, replicas and failovers keep ids, and
  need nothing.

## Testing

`@skjera/snapsync/testing` tests pulls the way they fail, after Cognite's
load generator and consistency check:

```ts
const copy = replica({ getKey, pull });            // a client's copy
yield* concurrentWriters({ writers: 8, transactions: 25, write });
// ...pulling meanwhile, then once more:
yield* copy.pull;
differences({ table: yield* all, copy: copy.rows, getKey });
// { missing: [], extra: [], changed: [] }
```

`concurrentWriters` runs transactions at once, each pausing a random while
before committing, so they commit out of order; some roll back. Point `write`
at a few hot rows often. The package's tests run against the Postgres in
the repository's `compose.yml` (`pnpm test`).

## Not (yet)

- **Batches**: a pull returns everything changed since, and a first pull the
  whole table. For large tables, page by `(xid, key)` as txid-syncing does.
- **One token per table**: a pull joining tables checks each table's xid
  with the same snapshot, but only the pulled table's truncates and pruning
  restart its clients.
- **Composite keys**: one key column per table.
