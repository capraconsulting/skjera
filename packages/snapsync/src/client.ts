import { BasicIndex, createCollection } from "@tanstack/db";
import type { Pulled, Token } from "./schema.ts";

// A TanStack DB collection holding a copy of a table the server pulls from
// with snapsync. For browsers.

/**
 * Sends one change to the server, rejecting if it's refused. `metadata` is
 * what the change was made with, for what isn't in the row.
 */
export type Write<Row> = (row: Row, metadata: unknown) => Promise<void>;

/** How often a visible page pulls, by default. */
export const defaultPollEveryMs = 5_000;

/**
 * A collection holding a copy of a table. It pulls every row once, then
 * what changed since the previous pull: every `pollEveryMs` while the page
 * is visible, as soon as it's visible or online again, and on `refresh`.
 * Pulls run one at a time, each from where the last ended; a pull that
 * starts over replaces the copy.
 *
 * Changes made to the collection show at once. `write` sends them to the
 * server, then a pull brings them back, so the rows pulled already have the
 * change when it stops being shown on its own. A refused change is undone.
 */
export const syncedTable = <Row extends object>(options: {
  readonly id: string;
  readonly getKey: (row: Row) => string;
  readonly pull: (since: Token | undefined) => Promise<Pulled<Row>>;
  readonly write?: {
    readonly insert?: Write<Row>;
    readonly update?: Write<Row>;
    readonly delete?: Write<Row>;
  };
  readonly pollEveryMs?: number;
}) => {
  let refresh = () => Promise.resolve();

  /** Writes each change in a transaction, in order, then pulls. */
  const persist =
    (send: Write<Row>) =>
    async ({
      transaction,
    }: {
      readonly transaction: {
        readonly mutations: ReadonlyArray<{
          readonly modified: Row;
          readonly metadata: unknown;
        }>;
      };
    }) => {
      for (const mutation of transaction.mutations) {
        await send(mutation.modified, mutation.metadata);
      }
      await refresh();
    };
  const { insert, update, delete: remove } = options.write ?? {};

  const collection = createCollection<Row, string>({
    id: options.id,
    getKey: options.getKey,
    ...(insert === undefined ? {} : { onInsert: persist(insert) }),
    ...(update === undefined ? {} : { onUpdate: persist(update) }),
    ...(remove === undefined ? {} : { onDelete: persist(remove) }),
    // Joins and filters look rows up by their fields.
    autoIndex: "eager",
    defaultIndexType: BasicIndex,
    sync: {
      sync: ({ begin, write, commit, markReady, markError, truncate }) => {
        let since: Token | undefined;
        let stopped = false;
        const known = new Set<string>();

        const pull = async () => {
          const pulled = await options.pull(since);
          if (stopped) return;
          begin();
          if (pulled.complete) {
            truncate();
            known.clear();
          }
          for (const row of pulled.rows) {
            const key = options.getKey(row);
            write({ type: known.has(key) ? "update" : "insert", value: row });
            known.add(key);
          }
          for (const key of pulled.deleted) {
            if (known.delete(key)) write({ type: "delete", key });
          }
          commit();
          since = pulled.token;
        };

        let inFlight = 1;
        let pulls = pull().finally(() => inFlight--);
        pulls.then(markReady, markError);
        refresh = () => {
          inFlight++;
          pulls = pulls
            .catch(() => undefined)
            .then(pull)
            .finally(() => inFlight--);
          return pulls.catch((error: unknown) => {
            console.warn(`Couldn't refresh ${options.id}`, error);
          });
        };

        // A poll skips while a pull is running rather than queue up.
        const poll = () => {
          if (inFlight === 0 && document.visibilityState === "visible") {
            void refresh();
          }
        };
        const timer = setInterval(
          poll,
          options.pollEveryMs ?? defaultPollEveryMs,
        );
        document.addEventListener("visibilitychange", poll);
        window.addEventListener("online", poll);
        return () => {
          stopped = true;
          clearInterval(timer);
          document.removeEventListener("visibilitychange", poll);
          window.removeEventListener("online", poll);
          refresh = () => Promise.resolve();
        };
      },
    },
  });

  return {
    collection,
    /** Pulls what changed, e.g. after a write. */
    refresh: () => refresh(),
  };
};
