import * as A from "@automerge/automerge";
import { Effect } from "effect";
import type { SqlClient } from "effect/sql";
import type { DocumentId } from "../Model.ts";
import { HistoryEntry } from "../Model.ts";
import { discardedMessage, restoredMessage } from "./DiscardChanges.ts";

// An event's history, built from the changes its draft keeps (who made each,
// and when) and the log of its publishings. Pure: the service reads the
// inputs from the database and the draft.

/** Changes by one person this close together, in seconds, are one entry. */
const closeTogether = 10 * 60;

/** What Automerge keeps about a change. `time` is in seconds, set by the editor. */
export interface ChangeInfo {
  readonly hash: string;
  readonly actor: string;
  readonly time: number;
  readonly deps: ReadonlyArray<string>;
  readonly message: string | null;
}

export interface Person {
  readonly issuer: string;
  readonly subject: string;
  /** The name, else the email; null when Skjera has neither. */
  readonly name: string | null;
}

export interface Publishing {
  readonly heads: ReadonlyArray<string>;
  readonly at: Date;
  /** Null: Skjera published it on its own. */
  readonly by: Person | null;
}

export interface HistoryInput {
  readonly changes: ReadonlyArray<ChangeInfo>;
  /** The person behind each actor id an editor has used. */
  readonly owners: ReadonlyArray<{
    readonly actor: string;
    readonly person: Person;
  }>;
  /** Who made the document; its first changes are theirs. */
  readonly creator: Person;
  readonly publications: ReadonlyArray<Publishing>;
}

interface Placed {
  readonly change: ChangeInfo;
  /** Seconds, never earlier than the changes it follows. */
  readonly time: number;
  /** How many changes lie between this one and the first. */
  readonly depth: number;
}

/** The changes in the order they happened, each after the changes it follows. */
const inOrder = (changes: ReadonlyArray<ChangeInfo>): ReadonlyArray<Placed> => {
  const byHash = new Map(changes.map((change) => [change.hash, change]));
  const placed = new Map<string, Placed>();
  for (const root of changes) {
    const stack = [root];
    for (let change = stack.at(-1); change; change = stack.at(-1)) {
      if (placed.has(change.hash)) {
        stack.pop();
        continue;
      }
      const waiting = change.deps
        .map((hash) => byHash.get(hash))
        .filter(
          (dep): dep is ChangeInfo =>
            dep !== undefined && !placed.has(dep.hash),
        );
      if (waiting.length > 0) {
        stack.push(...waiting);
        continue;
      }
      const before = change.deps.flatMap((hash) => placed.get(hash) ?? []);
      const after = Math.max(0, ...before.map((dep) => dep.time));
      placed.set(change.hash, {
        change,
        // An editor's clock may be behind, or a change may carry no time.
        time: Math.max(change.time > 0 ? change.time : after, after),
        depth: 1 + Math.max(0, ...before.map((dep) => dep.depth)),
      });
      stack.pop();
    }
  }
  return [...placed.values()].sort(
    (a, b) =>
      a.time - b.time ||
      a.depth - b.depth ||
      (a.change.hash < b.change.hash
        ? -1
        : a.change.hash > b.change.hash
          ? 1
          : 0),
  );
};

/** Every change `heads` include: the heads and everything they follow. */
const included = (
  heads: ReadonlyArray<string>,
  byHash: ReadonlyMap<string, ChangeInfo>,
): ReadonlySet<string> => {
  const seen = new Set<string>();
  const stack = [...heads];
  for (let hash = stack.pop(); hash !== undefined; hash = stack.pop()) {
    if (seen.has(hash)) continue;
    seen.add(hash);
    stack.push(...(byHash.get(hash)?.deps ?? []));
  }
  return seen;
};

const skjera = "skjera";
const keyOf = (person: Person | null) =>
  person === null ? skjera : `${person.issuer}\n${person.subject}`;

interface Draft {
  kind: HistoryEntry["kind"];
  at: number;
  heads: ReadonlyArray<string>;
  by: Person | null;
  /** Whether the entry was made by an explicit act: it takes no more changes. */
  closed: boolean;
}

/**
 * The history, newest first: a change joins the entry before it when the same
 * person made both within ten minutes and nothing was published between; a
 * publishing is an entry of its own, placed after the last change it
 * includes or that was made in an earlier second.
 */
export const historyOf = (input: HistoryInput): ReadonlyArray<HistoryEntry> => {
  const { changes, owners, creator, publications } = input;
  const byHash = new Map(changes.map((change) => [change.hash, change]));
  const ordered = inOrder(changes);

  const ownerOf = new Map(owners.map(({ actor, person }) => [actor, person]));
  const creatorActors = new Set(
    changes.filter((change) => change.deps.length === 0).map((c) => c.actor),
  );
  const whoMade = ({ actor }: ChangeInfo): Person | null =>
    ownerOf.get(actor) ?? (creatorActors.has(actor) ? creator : null);

  // Where each publishing goes: after the change at this index.
  const placedAfter = new Map<number, Array<Publishing>>();
  for (const publishing of [...publications].sort(
    (a, b) => a.at.getTime() - b.at.getTime(),
  )) {
    const includes = included(publishing.heads, byHash);
    const second = Math.floor(publishing.at.getTime() / 1000);
    let index = -1;
    ordered.forEach(({ change, time }, at) => {
      if (includes.has(change.hash) || time < second) index = at;
    });
    placedAfter.set(index, [...(placedAfter.get(index) ?? []), publishing]);
  }

  const entries: Array<Draft> = [];
  const heads = new Set<string>();
  let open: (Draft & { key: string }) | undefined;
  const publish = (index: number) => {
    for (const publishing of placedAfter.get(index) ?? []) {
      open = undefined;
      entries.push({
        kind: "published",
        at: publishing.at.getTime(),
        heads: [...publishing.heads].sort(),
        by: publishing.by,
        closed: true,
      });
    }
  };

  publish(-1);
  ordered.forEach(({ change, time }, index) => {
    for (const dep of change.deps) heads.delete(dep);
    heads.add(change.hash);
    const by = whoMade(change);
    const key = keyOf(by);
    const version = [...heads].sort();
    if (
      open !== undefined &&
      !open.closed &&
      open.key === key &&
      change.message === null &&
      time - open.at / 1000 <= closeTogether
    ) {
      open.at = time * 1000;
      open.heads = version;
    } else {
      const own =
        change.message === restoredMessage
          ? "restored"
          : change.message === discardedMessage
            ? "discarded"
            : "edited";
      open = {
        kind: own,
        at: time * 1000,
        heads: version,
        by,
        key,
        closed: change.message !== null,
      };
      entries.push(open);
    }
    publish(index);
  });

  return entries.reverse().map(
    (entry) =>
      new HistoryEntry({
        kind: entry.kind,
        at: new Date(entry.at),
        heads: entry.heads,
        by: entry.by?.name ?? null,
        automatic: entry.by === null,
      }),
  );
};

export const readHistory = (sql: SqlClient.SqlClient, id: DocumentId) =>
  Effect.gen(function* () {
    const [document] = yield* sql<{
      draft: Uint8Array;
      issuer: string;
      subject: string;
      name: string | null;
    }>`
      SELECT d.draft::bytea AS draft, d.created_by_issuer AS issuer,
        d.created_by_subject AS subject, p.name
      FROM documents d
      LEFT JOIN people p
        ON p.issuer = d.created_by_issuer AND p.subject = d.created_by_subject
      WHERE d.id = ${id} AND d.deleted_at IS NULL
    `;
    if (document === undefined) return undefined;
    const owners = yield* sql<Person & { actor: string }>`
      SELECT a.actor, a.user_issuer AS issuer, a.user_subject AS subject, p.name
      FROM document_actors a
      LEFT JOIN people p
        ON p.issuer = a.user_issuer AND p.subject = a.user_subject
      WHERE a.document_id = ${id}
    `;
    const publications = yield* sql<{
      heads: ReadonlyArray<string>;
      published_at: Date;
      issuer: string | null;
      subject: string | null;
      name: string | null;
    }>`
      SELECT e.heads, e.published_at, e.published_by_issuer AS issuer,
        e.published_by_subject AS subject, p.name
      FROM event_publications e
      LEFT JOIN people p
        ON p.issuer = e.published_by_issuer AND p.subject = e.published_by_subject
      WHERE e.event_id = ${id}
      ORDER BY e.published_at, e.id
    `;
    return historyOf({
      changes: A.getChangesMetaSince(A.load(document.draft), []).map(
        ({ hash, actor, time, deps, message }) => ({
          hash,
          actor,
          time,
          deps,
          message,
        }),
      ),
      owners: owners.map(({ actor, ...person }) => ({ actor, person })),
      creator: {
        issuer: document.issuer,
        subject: document.subject,
        name: document.name,
      },
      publications: publications.map((row) => ({
        heads: row.heads,
        at: row.published_at,
        by:
          row.issuer === null || row.subject === null
            ? null
            : { issuer: row.issuer, subject: row.subject, name: row.name },
      })),
    });
  });
