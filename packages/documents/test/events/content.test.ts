import * as A from "@automerge/automerge";
import { assert, describe, it, layer } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import {
  type BooleanEventField,
  choiceQuestionMinimum,
  type EventContent,
  reminderChoice,
  repeatDefaults,
  repeatEveryChoices,
  repeatUnitChoices,
  salesEventFields,
  signupTakesPlace,
} from "../../src/events/ContentTypes.ts";
import { Documents } from "../../src/events/Documents.ts";
import type { DocumentId } from "../../src/Model.ts";
import { Sync } from "../../src/server/Sync.ts";
import {
  addTags,
  alice,
  newTeam,
  openEditor,
  publishedAs,
  publishedEvent,
  setPlace,
  setSalesEvent,
  setStreamed,
  setSummary,
  setTimes,
  TestLayer,
} from "../helpers.ts";

/** Sets the draft's `reminders` as the studio (or an older studio) did. */
const setReminders = (value: unknown) => (event: EventContent) => {
  const draft = event as Record<string, unknown>;
  if (value === undefined) delete draft.reminders;
  else draft.reminders = value;
};

describe("shared event rules", () => {
  it("publishes the event rule catalogues and defaults (AC-1)", () => {
    assert.deepStrictEqual(salesEventFields, [
      "public",
      "guests",
      "salesEvent",
    ]);
    assert.deepStrictEqual(repeatEveryChoices, [1, 2, 3, 4, 5, 6, 7]);
    assert.deepStrictEqual(repeatUnitChoices, ["day", "week", "month", "year"]);
    assert.deepStrictEqual(repeatDefaults, { every: 1, unit: "week" });
    assert.strictEqual(choiceQuestionMinimum, 2);
  });

  it("counts online signups only when the event is not streamed (AC-1)", () => {
    assert.isTrue(signupTakesPlace(false, true));
    assert.isFalse(signupTakesPlace(true, true));
    assert.isTrue(signupTakesPlace(true, false));
  });

  it("derives every boolean event field from EventContent (AC-2)", () => {
    const fields: ReadonlyArray<BooleanEventField> = [
      "public",
      "guests",
      "dietary",
      "hidePlacesLeft",
      "streamed",
      "salesEvent",
      "recurring",
    ];
    assert.strictEqual(fields.length, 7);
  });
});

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Event content", (it) => {
  it.effect(
    "publishes reminders by the choice: Standard follows the guests, On and Off do not",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const reminds = (id: DocumentId) =>
          sql<{ send_reminders: boolean }>`
            SELECT send_reminders FROM events WHERE id = ${id}
          `.pipe(Effect.map(([row]) => row?.send_reminders));
        for (const [choice, isPublic, guests, expected] of [
          ["default", true, true, true],
          ["default", true, false, false],
          ["default", false, true, false],
          ["default", false, false, false],
          ["on", true, false, true],
          ["on", true, true, true],
          ["on", false, false, true],
          ["off", true, true, false],
          ["off", true, false, false],
        ] as const) {
          const id = yield* publishedEvent({
            public: isPublic,
            guests,
            edit: setReminders(new A.ImmutableString(choice)),
          });
          assert.strictEqual(
            yield* reminds(id),
            expected,
            `${choice}, public ${isPublic}, guests ${guests}`,
          );
        }
        // A new draft has no choice, which is Standard.
        const fresh = yield* publishedEvent({ public: true, guests: true });
        assert.strictEqual(yield* reminds(fresh), true);
        const freshMembers = yield* publishedEvent({
          public: false,
          guests: false,
        });
        assert.strictEqual(yield* reminds(freshMembers), false);
      }),
  );

  it.effect(
    "publishes drafts from before the choice: ticked is Standard, unticked is Off",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const reminds = (id: DocumentId) =>
          sql<{ send_reminders: boolean }>`
            SELECT send_reminders FROM events WHERE id = ${id}
          `.pipe(Effect.map(([row]) => row?.send_reminders));
        for (const [ticked, isPublic, guests, expected] of [
          [true, true, true, true],
          [true, true, false, false],
          [false, true, true, false],
          [undefined, true, true, true],
        ] as const) {
          const id = yield* publishedEvent({
            public: isPublic,
            guests,
            edit: setReminders(ticked),
          });
          assert.strictEqual(
            yield* reminds(id),
            expected,
            `reminders ${ticked}, public ${isPublic}, guests ${guests}`,
          );
        }
      }),
  );

  it.effect("takes the three reminder choices and refuses any other", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      for (const choice of ["default", "on", "off"] as const) {
        const editor = yield* openEditor(id);
        yield* documents.applyChanges(
          id,
          [editor.edit(setReminders(new A.ImmutableString(choice)))],
          alice,
        );
        const snapshot = yield* documents.get(id);
        assert.strictEqual(
          reminderChoice(
            (A.load(snapshot.draft) as { reminders?: unknown }).reminders,
          ),
          choice,
        );
      }
      for (const choice of ["sometimes", "ON", ""]) {
        const editor = yield* openEditor(id);
        const error = yield* Effect.flip(
          documents.applyChanges(
            id,
            [editor.edit(setReminders(new A.ImmutableString(choice)))],
            alice,
          ),
        );
        assert.strictEqual(error._tag, "InvalidContent", choice);
      }
    }),
  );

  it.effect("reads a draft's reminder choice, older ticks included", () =>
    Effect.sync(() => {
      assert.strictEqual(reminderChoice(undefined), "default");
      assert.strictEqual(reminderChoice(true), "default");
      assert.strictEqual(reminderChoice(false), "off");
      for (const choice of ["default", "on", "off"] as const) {
        assert.strictEqual(
          reminderChoice(new A.ImmutableString(choice)),
          choice,
        );
      }
    }),
  );

  it.effect(
    "takes a repeat of 1 to 7 days, weeks, months or years, and refuses the rest",
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

  it.effect("publishes whether the event is streamed and its link", () =>
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
    "publishes a sales event only when it is public, open to guests and set (AC-1)",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const published = (settings: {
          readonly public: boolean;
          readonly guests: boolean;
          readonly set?: boolean;
          readonly type?: string;
        }) =>
          Effect.gen(function* () {
            const id = yield* publishedEvent({
              public: settings.public,
              guests: settings.guests,
              edit: (event) => {
                if (settings.set !== undefined) {
                  setSalesEvent(event, settings.set, settings.type);
                }
              },
            });
            const row = yield* publishedAs(id, "members");
            const [stored] = yield* sql<{ sales_event_type: string | null }>`
              SELECT sales_event_type FROM events WHERE id = ${id}
            `;
            return { row, type: stored?.sales_event_type };
          });
        const sales = yield* published({
          public: true,
          guests: true,
          set: true,
          type: "  Workshop ",
        });
        assert.isTrue(sales.row?.isSalesEvent);
        assert.strictEqual(sales.type, "Workshop");
        for (const settings of [
          { public: true, guests: true, set: false },
          { public: true, guests: true },
          { public: true, guests: false, set: true },
          { public: false, guests: true, set: true },
        ]) {
          const { row } = yield* published(settings);
          assert.isFalse(row?.isSalesEvent, JSON.stringify(settings));
        }
        const blank = yield* published({
          public: true,
          guests: true,
          set: true,
          type: "   ",
        });
        assert.isNull(blank.type);
      }),
  );

  it.effect(
    "refuses a link that is not a web address, and takes none or a blank one",
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

  it.effect("publishes the summary trimmed", () =>
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
    "publishes a blank summary, or none from an older draft, as none",
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

  it.effect("syncs an event without a summary with summary null", () =>
    Effect.gen(function* () {
      const id = yield* publishedEvent({ public: false, guests: false });
      const row = yield* publishedAs(id, "members");
      assert.isNull(row?.summary);
    }),
  );

  it.effect("publishes no link for an event that is not streamed", () =>
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

  it.effect("takes a place in a draft from before events had one", () =>
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

  it.effect(
    "does not suggest a tag only added to drafts, never published (STU-15 AC-5)",
    () =>
      Effect.gen(function* () {
        const sync = yield* Sync;
        const documents = yield* Documents;
        const unique = crypto.randomUUID().slice(0, 8);
        const kept = `Draft only ${unique}`;
        const removed = `Taken off ${unique}`;
        const unpublished = `After publishing ${unique}`;

        // Added to a new draft and kept.
        const draft = yield* documents.create("event", yield* newTeam, alice);
        const editor = yield* openEditor(draft);
        yield* documents.applyChanges(
          draft,
          [editor.edit((event) => addTags(event, kept, removed))],
          alice,
        );
        // Added and taken off again.
        yield* documents.applyChanges(
          draft,
          [
            editor.edit((event) => {
              (event as unknown as { tags: Array<string> }).tags.splice(1, 1);
            }),
          ],
          alice,
        );
        // Added to the draft of a published event, without publishing again.
        const published = yield* publishedEvent({
          public: true,
          guests: false,
        });
        const republished = yield* openEditor(published);
        yield* documents.applyChanges(
          published,
          [republished.edit((event) => addTags(event, unpublished))],
          alice,
        );

        const suggested = (yield* sync.tags(undefined)).rows
          .map((row) => row.name.toLowerCase())
          .filter((name) => name.endsWith(unique.toLowerCase()));
        assert.deepStrictEqual(suggested, []);
      }),
  );
});
