import { afterEach, describe, expect, it, vi } from "vitest";
import { syncedTable } from "../src/client.ts";
import type { Pulled } from "../src/schema.ts";

// The TanStack DB collection against a scripted server: which tokens it
// pulls with, and what the collection holds between and after pages.

interface Item {
  readonly id: string;
  readonly name: string;
}

const items = (...ids: ReadonlyArray<number>) =>
  ids.map((n) => ({ id: `item-${n}`, name: `Item ${n}` }));

const page = (
  page: Partial<Pulled<Item>> & { readonly token: string },
): Pulled<Item> => ({
  rows: [],
  deleted: [],
  complete: false,
  more: false,
  ...page,
});

interface Step {
  /** The token the pull is expected to come with. */
  readonly since: string | undefined;
  readonly reply: Pulled<Item> | Error;
  /** Held until this resolves. */
  readonly gate?: Promise<void>;
}

/** A server answering pulls in order, recording the tokens they came with. */
const scripted = (steps: ReadonlyArray<Step>) => {
  const tokens: Array<string | undefined> = [];
  let next = 0;
  return {
    tokens,
    pull: async (since: string | undefined) => {
      const step = steps[next++];
      tokens.push(since);
      if (step === undefined) throw new Error("No more pulls expected");
      await step.gate;
      if (step.reply instanceof Error) throw step.reply;
      return step.reply;
    },
  };
};

const gate = () => {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

let tables = 0;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const table = (server: ReturnType<typeof scripted>) => {
  const synced = syncedTable({
    id: `items-${++tables}`,
    getKey: (item: Item) => item.id,
    pull: server.pull,
    // Pulls only when told to.
    pollEveryMs: 1e9,
  });
  cleanups.push(() => synced.collection.cleanup());
  return synced;
};

const names = (synced: ReturnType<typeof table>) =>
  Object.fromEntries(
    [...synced.collection.values()].map((item) => [item.id, item.name]),
  );

describe("syncedTable", () => {
  it("loads every page before showing the table", async () => {
    const held = gate();
    const server = scripted([
      {
        since: undefined,
        reply: page({
          rows: items(1, 2),
          complete: true,
          more: true,
          token: "t1",
        }),
      },
      {
        since: "t1",
        gate: held.promise,
        reply: page({ rows: items(3, 4), more: true, token: "t2" }),
      },
      { since: "t2", reply: page({ rows: items(5), token: "t3" }) },
    ]);
    const synced = table(server);
    const ready = synced.collection.preload();
    await vi.waitFor(() => expect(server.tokens).toHaveLength(2));
    // Mid-way: nothing yet, not half of it.
    expect(synced.collection.size).toBe(0);
    held.open();
    await ready;
    expect(synced.collection.size).toBe(5);
    expect(server.tokens).toEqual([undefined, "t1", "t2"]);
  });

  it("applies pages of changes as they come, and resumes after a failure", async () => {
    const server = scripted([
      {
        since: undefined,
        reply: page({ rows: items(1, 2, 3), complete: true, token: "t1" }),
      },
      {
        since: "t1",
        reply: page({
          rows: [{ id: "item-1", name: "Renamed" }],
          more: true,
          token: "t2",
        }),
      },
      { since: "t2", reply: new Error("Offline") },
      { since: "t2", reply: page({ deleted: ["item-2"], token: "t3" }) },
    ]);
    const synced = table(server);
    await synced.collection.preload();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await synced.refresh();
    warn.mockRestore();
    // The page before the failure stays applied.
    expect(names(synced)).toEqual({
      "item-1": "Renamed",
      "item-2": "Item 2",
      "item-3": "Item 3",
    });
    await synced.refresh();
    expect(names(synced)).toEqual({ "item-1": "Renamed", "item-3": "Item 3" });
    expect(server.tokens).toEqual([undefined, "t1", "t2", "t2"]);
  });

  it("replaces the copy at once when the server starts over", async () => {
    const held = gate();
    const server = scripted([
      {
        since: undefined,
        reply: page({ rows: items(1, 2, 3), complete: true, token: "t1" }),
      },
      // Starting over, then failing mid-way: the copy stays as it was, and
      // the next pull starts from the token it had.
      {
        since: "t1",
        reply: page({
          rows: items(1),
          complete: true,
          more: true,
          token: "u1",
        }),
      },
      { since: "u1", reply: new Error("Offline") },
      {
        since: "t1",
        reply: page({
          rows: items(1, 4),
          complete: true,
          more: true,
          token: "v1",
        }),
      },
      {
        since: "v1",
        gate: held.promise,
        reply: page({ rows: items(5), token: "v2" }),
      },
    ]);
    const synced = table(server);
    await synced.collection.preload();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await synced.refresh();
    warn.mockRestore();
    expect(Object.keys(names(synced))).toEqual(["item-1", "item-2", "item-3"]);

    const refreshed = synced.refresh();
    await vi.waitFor(() => expect(server.tokens).toHaveLength(5));
    // Mid-way: still the old copy, whole.
    expect(synced.collection.size).toBe(3);
    held.open();
    await refreshed;
    expect(Object.keys(names(synced)).sort()).toEqual([
      "item-1",
      "item-4",
      "item-5",
    ]);
    expect(server.tokens).toEqual([undefined, "t1", "u1", "t1", "v1"]);
    // The start-over cut off left no transaction open behind it.
    expect(synced.collection._state.pendingSyncedTransactions).toHaveLength(0);
  });
});
