import * as A from "@automerge/automerge";
import { assert, layer } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import type { EventContent } from "../../src/ContentTypes.ts";
import { Documents } from "../../src/Documents.ts";
import type { DocumentId } from "../../src/Model.ts";
import { Sync } from "../../src/Sync.ts";
import {
  addTags,
  alice,
  newTeam,
  openEditor,
  publishedAs,
  publishedEvent,
  setPlace,
  setStreamed,
  setSummary,
  setTimes,
  TestLayer,
} from "../helpers.ts";

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Event content", (it) => {
  it.effect("publishes whether attendees are reminded: yes, unless not", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const reminds = (id: DocumentId) =>
        sql<{ send_reminders: boolean }>`
          SELECT send_reminders FROM events WHERE id = ${id}
        `.pipe(Effect.map(([row]) => row?.send_reminders));
      const fresh = yield* publishedEvent({ public: false, guests: false });
      assert.strictEqual(yield* reminds(fresh), true);
      const off = yield* publishedEvent({
        public: false,
        guests: false,
        edit: (event) => {
          (event as { reminders: boolean }).reminders = false;
        },
      });
      assert.strictEqual(yield* reminds(off), false);
      // Drafts from before there was a choice.
      const older = yield* publishedEvent({
        public: false,
        guests: false,
        edit: (event) => {
          delete (event as { reminders?: boolean }).reminders;
        },
      });
      assert.strictEqual(yield* reminds(older), true);
    }),
  );

  it.effect(
    "takes a repeat of 1 to 7 days, weeks, months or years, and refuses the rest (AC-1)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const id = yield* documents.create("event", yield* newTeam, alice);
        const setRepeat =
          (every: number, unit: string) => (event: EventContent) => {
            const draft = event as Record<string, unknown>;
            draft.recurring = true;
            draft.repeatEvery = every;
            draft.repeatUnit = new A.ImmutableString(unit);
          };
        for (const [every, unit] of [
          [1, "day"],
          [7, "week"],
          [3, "month"],
          [2, "year"],
        ] as const) {
          const editor = yield* openEditor(id);
          yield* documents.applyChanges(
            id,
            [editor.edit(setRepeat(every, unit))],
            alice,
          );
        }
        for (const [every, unit] of [
          [0, "week"],
          [8, "week"],
          [1.5, "week"],
          [1, "fortnight"],
        ] as const) {
          const editor = yield* openEditor(id);
          const error = yield* Effect.flip(
            documents.applyChanges(
              id,
              [editor.edit(setRepeat(every, unit))],
              alice,
            ),
          );
          assert.strictEqual(error._tag, "InvalidContent", `${every} ${unit}`);
        }
      }),
  );

  it.effect("publishes whether the event is streamed and its link (AC-1)", () =>
    Effect.gen(function* () {
      const streamed = yield* publishedEvent({
        public: true,
        guests: false,
        edit: (event) =>
          setStreamed(event, true, "https://stream.example/meetup"),
      });
      const row = yield* publishedAs(streamed, "anyone");
      assert.isTrue(row?.isStreamed);
      assert.strictEqual(row?.streamLink, "https://stream.example/meetup");

      // A draft from before streaming has neither.
      const older = yield* publishedEvent({ public: true, guests: false });
      const bare = yield* publishedAs(older, "anyone");
      assert.isFalse(bare?.isStreamed);
      assert.isNull(bare?.streamLink);
    }),
  );

  it.effect(
    "refuses a link that is not a web address, and takes none or a blank one (AC-1)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        for (const link of ["stream.example/meetup", "javascript:alert(1)"]) {
          const id = yield* documents.create("event", yield* newTeam, alice);
          const editor = yield* openEditor(id);
          const heads = yield* documents.applyChanges(
            id,
            [
              editor.edit((event) => {
                A.updateText(event, ["title"], "Meetup");
                setTimes(event);
                setPlace(event);
                setStreamed(event, true, link);
              }),
            ],
            alice,
          );
          const error = yield* Effect.flip(documents.publish(id, heads, alice));
          assert.deepStrictEqual(
            [error._tag, "problem" in error && error.problem],
            ["PublishRejected", { _tag: "StreamLinkNotWeb" }],
            link,
          );
        }

        for (const link of [undefined, "", " \t "]) {
          const id = yield* publishedEvent({
            public: true,
            guests: false,
            edit: (event) => setStreamed(event, true, link),
          });
          const row = yield* publishedAs(id, "anyone");
          assert.isTrue(row?.isStreamed, String(link));
          assert.isNull(row?.streamLink, String(link));
        }
      }),
  );

  it.effect("publishes the summary trimmed (AC-1)", () =>
    Effect.gen(function* () {
      const id = yield* publishedEvent({
        public: true,
        guests: false,
        edit: (event) =>
          setSummary(event, "  Coffee and a talk about Effect. \n"),
      });
      const row = yield* publishedAs(id, "anyone");
      assert.strictEqual(row?.summary, "Coffee and a talk about Effect.");
    }),
  );

  it.effect(
    "publishes a blank summary, or none from an older draft, as none (AC-1)",
    () =>
      Effect.gen(function* () {
        for (const text of ["", " \t \n"]) {
          const id = yield* publishedEvent({
            public: true,
            guests: false,
            edit: (event) => setSummary(event, text),
          });
          const row = yield* publishedAs(id, "anyone");
          assert.isNull(row?.summary, JSON.stringify(text));
        }
        // A draft from before events had a summary has no key for it.
        const older = yield* publishedEvent({
          public: true,
          guests: false,
          edit: (event) => {
            delete (event as { summary?: string }).summary;
          },
        });
        assert.isNull((yield* publishedAs(older, "anyone"))?.summary);
      }),
  );

  it.effect("syncs an event without a summary with summary null (AC-2)", () =>
    Effect.gen(function* () {
      const id = yield* publishedEvent({ public: false, guests: false });
      const row = yield* publishedAs(id, "members");
      assert.isNull(row?.summary);
    }),
  );

  it.effect("publishes no link for an event that is not streamed (AC-1)", () =>
    Effect.gen(function* () {
      const id = yield* publishedEvent({
        public: true,
        guests: false,
        edit: (event) =>
          setStreamed(event, false, "https://stream.example/meetup"),
      });
      const row = yield* publishedAs(id, "anyone");
      assert.isFalse(row?.isStreamed);
      assert.isNull(row?.streamLink);
    }),
  );

  it.effect("takes a place in a draft from before events had one (AC-1)", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);
      yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            delete (event as { place?: string }).place;
          }),
        ],
        alice,
      );
      // Without a place, the draft takes other changes, and then a place.
      yield* documents.applyChanges(
        id,
        [editor.edit((event) => A.updateText(event, ["title"], "Older"))],
        alice,
      );
      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            (event as { place?: string }).place = "";
          }),
          editor.edit((event) => setPlace(event, "Kantina, 2. etasje")),
        ],
        alice,
      );
      const draft = A.load<EventContent>((yield* documents.get(id)).draft);
      assert.strictEqual(draft.place, "Kantina, 2. etasje");
      assert.deepStrictEqual(
        [...A.getHeads(editor.doc())].sort(),
        [...heads].sort(),
      );
    }),
  );

  it.effect("publishes tags once each, and collects them to suggest", () =>
    Effect.gen(function* () {
      const sync = yield* Sync;
      const name = `Tag ${crypto.randomUUID().slice(0, 8)}`;
      const id = yield* publishedEvent({
        public: true,
        guests: false,
        edit: (event) => {
          // As two people adding the same tag at once leave it.
          addTags(event, name, "Workshop", name.toUpperCase(), name);
        },
      });
      assert.deepStrictEqual((yield* publishedAs(id, "anyone"))?.tags, [
        name,
        "Workshop",
      ]);

      // Published again, or by another event in other letters: still once.
      yield* publishedEvent({
        public: false,
        guests: false,
        edit: (event) => addTags(event, name.toLowerCase()),
      });
      const suggested = (yield* sync.tags(undefined)).rows
        .map((row) => row.name)
        .filter((tag) => tag.toLowerCase() === name.toLowerCase());
      assert.deepStrictEqual(suggested, [name]);

      // Tags are trimmed, and short.
      const documents = yield* Documents;
      const draft = yield* documents.create("event", yield* newTeam, alice);
      for (const tag of [" Padded", "", "x".repeat(41)]) {
        const editor = yield* openEditor(draft);
        const error = yield* Effect.flip(
          documents.applyChanges(
            draft,
            [editor.edit((event) => addTags(event, tag))],
            alice,
          ),
        );
        assert.strictEqual(error._tag, "InvalidContent", tag);
      }
    }),
  );
});
