import * as A from "@automerge/automerge";
import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { Effect, Ref } from "effect";
import { SqlClient } from "effect/sql";
import { Attendance } from "../../src/attendance/Attendance.ts";
import type { EventContent } from "../../src/events/ContentTypes.ts";
import { Documents } from "../../src/events/Documents.ts";
import { AnnouncementsKept } from "../../src/notices/Announcements.ts";
import { NoticesKept } from "../../src/notices/Notifications.ts";
import {
  alice,
  bob,
  end,
  newTeam,
  openEditor,
  publishedAs,
  publishedEvent,
  setCover,
  setPlace,
  setQuestions,
  setTimes,
  start,
  syncedDocument,
  TestLayer,
} from "../helpers.ts";

const carol = new Identity({
  issuer: "https://idp.example",
  subject: "carol",
  email: "carol@example.com",
  name: "Carol",
});

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Publishing", (it) => {
  it.effect("tells Announcements once when an event is first published", () =>
    Effect.gen(function* () {
      const kept = yield* AnnouncementsKept;
      const id = yield* publishedEvent({ public: true, guests: true });
      const told = (yield* Ref.get(kept)).filter((event) => event === id);
      assert.deepStrictEqual(told, [id]);
    }),
  );

  it.effect(
    "tells Announcements nothing when a published event is published again",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const kept = yield* AnnouncementsKept;
        const id = yield* publishedEvent({ public: true, guests: true });
        const editor = yield* openEditor(id);
        // A new title, then moved a day.
        const retitled = yield* documents.applyChanges(
          id,
          [editor.edit((event) => A.updateText(event, ["title"], "Meetup 2"))],
          alice,
        );
        yield* documents.publish(id, retitled, alice);
        const moved = yield* documents.applyChanges(
          id,
          [
            editor.edit((event) =>
              setTimes(event, {
                start: "2036-10-16T18:00+02:00[Europe/Oslo]",
                end: "2036-10-16T21:00+02:00[Europe/Oslo]",
              }),
            ),
          ],
          alice,
        );
        yield* documents.publish(id, moved, alice);
        const told = (yield* Ref.get(kept)).filter((event) => event === id);
        assert.deepStrictEqual(told, [id]);
      }),
  );

  it.effect("publishes the cover image, which has to be an uploaded one", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const sql = yield* SqlClient.SqlClient;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const src = "/api/images/AAAAAAAAAAAAAAAAAAAAAA";

      const elsewhere = yield* openEditor(id);
      const error = yield* Effect.flip(
        documents.applyChanges(
          id,
          [
            elsewhere.edit((event) => {
              setCover(event, "https://example.com/x.png");
            }),
          ],
          alice,
        ),
      );
      assert.strictEqual(error._tag, "InvalidContent");

      const editor = yield* openEditor(id);
      const withCover = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Launch");
            setTimes(event);
            setPlace(event);
            setCover(event, src);
          }),
          editor.edit((event) =>
            A.updateText(event, ["cover", "alt"], "A full room"),
          ),
        ],
        alice,
      );
      yield* documents.publish(id, withCover, alice);
      const cover = sql<{ cover: unknown }>`
        SELECT cover FROM events WHERE id = ${id}
      `;
      assert.deepStrictEqual(yield* cover, [
        { cover: { src, alt: "A full room" } },
      ]);

      // Taken off again.
      const without = yield* documents.applyChanges(
        id,
        [editor.edit((event) => setCover(event, null))],
        alice,
      );
      yield* documents.publish(id, without, alice);
      assert.deepStrictEqual(yield* cover, [{ cover: null }]);
    }),
  );

  it.effect("publishes the version the user saw", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const sql = yield* SqlClient.SqlClient;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);

      const seen = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Launch");
            // A heading, and a paragraph with a bold word.
            A.splitBlock(event, ["body"], 0, {
              type: new A.ImmutableString("heading"),
              parents: [],
              attrs: { level: 2 },
            });
            A.splice(event, ["body"], 1, 0, "News");
            A.splitBlock(event, ["body"], 5, {
              type: new A.ImmutableString("paragraph"),
              parents: [],
              attrs: {},
            });
            A.splice(event, ["body"], 6, 0, "We're live");
            A.mark(
              event,
              ["body"],
              { start: 12, end: 16, expand: "none" },
              "strong",
              true,
            );
            setTimes(event);
            setPlace(event);
          }),
        ],
        alice,
      );
      // Someone keeps typing while Alice clicks publish.
      yield* documents.applyChanges(
        id,
        [editor.edit((event) => A.updateText(event, ["title"], "Launch day!"))],
        alice,
      );

      const first = yield* documents.publish(id, seen, alice);
      assert.deepStrictEqual(first.heads, seen);
      const [row] = yield* sql<{
        title: string;
        body: unknown;
        starts_at: Date;
        ends_at: Date;
        signup_deadline: Date | null;
        time_zone: string;
      }>`
        SELECT title, body, starts_at, ends_at, signup_deadline, time_zone
        FROM events WHERE id = ${id}
      `;
      // The body keeps its structure.
      assert.deepStrictEqual(row, {
        title: "Launch",
        body: [
          {
            type: "block",
            value: { type: "heading", attrs: { level: 2 }, parents: [] },
          },
          { type: "text", value: "News" },
          {
            type: "block",
            value: { type: "paragraph", attrs: {}, parents: [] },
          },
          { type: "text", value: "We're " },
          { type: "text", value: "live", marks: { strong: true } },
        ],
        starts_at: new Date("2036-10-15T16:00:00Z"),
        ends_at: new Date("2036-10-15T19:00:00Z"),
        signup_deadline: null,
        time_zone: "Europe/Oslo",
      });

      const latest = (yield* documents.get(id)).heads;
      const second = yield* documents.publish(id, latest, alice);
      assert.deepStrictEqual(second.firstPublishedAt, first.firstPublishedAt);
      assert.isTrue(second.publishedAt >= first.publishedAt);
      const [updated] = yield* sql<{ title: string }>`
        SELECT title FROM events WHERE id = ${id}
      `;
      assert.strictEqual(updated?.title, "Launch day!");
    }),
  );

  it.effect(
    "refuses to publish without a title, times or a place, or an unknown version",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const id = yield* documents.create("event", yield* newTeam, alice);
        const editor = yield* openEditor(id);
        const blank = (yield* documents.get(id)).heads;
        const dated = yield* documents.applyChanges(
          id,
          [
            editor.edit((event) => {
              setTimes(event);
              setPlace(event);
            }),
          ],
          alice,
        );
        const empty = yield* Effect.flip(documents.publish(id, blank, alice));
        assert.strictEqual(
          empty.message,
          "Add a title, a start time, an end time and a place before publishing",
        );
        const untitled = yield* Effect.flip(
          documents.publish(id, dated, alice),
        );
        assert.strictEqual(untitled.message, "Add a title before publishing");

        // A place of nothing but spaces is no place.
        for (const place of ["", "  "]) {
          const placeless = yield* documents.applyChanges(
            id,
            [
              editor.edit((event) => {
                A.updateText(event, ["title"], "Endless");
                setPlace(event, place);
              }),
            ],
            alice,
          );
          const unplaced = yield* Effect.flip(
            documents.publish(id, placeless, alice),
          );
          assert.strictEqual(unplaced.message, "Add a place before publishing");
        }

        const titled = yield* documents.applyChanges(
          id,
          [
            editor.edit((event) => {
              setPlace(event);
              setTimes(event, { end: null });
            }),
          ],
          alice,
        );
        const undated = yield* Effect.flip(
          documents.publish(id, titled, alice),
        );
        assert.strictEqual(
          undated.message,
          "Add an end time before publishing",
        );

        // The times have to make sense together.
        for (const [times, message] of [
          [{ end: start }, "The event has to end after it starts"],
          [
            { end, deadline: "2036-10-15T18:01+02:00[Europe/Oslo]" },
            "The sign-up deadline can't be after the event starts",
          ],
          [
            { end: "2036-10-15T20:00+01:00[Europe/London]", deadline: null },
            "The times have to be in the same time zone",
          ],
        ] as const) {
          const heads = yield* documents.applyChanges(
            id,
            [editor.edit((event) => setTimes(event, times))],
            alice,
          );
          const refused = yield* Effect.flip(
            documents.publish(id, heads, alice),
          );
          assert.strictEqual(refused.message, message);
        }

        const unknown = yield* Effect.flip(
          documents.publish(id, ["00".repeat(32)], alice),
        );
        assert.strictEqual(unknown._tag, "PublishRejected");
      }),
  );

  it.effect("shows the public only what was published", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);
      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Public");
            setTimes(event);
            setPlace(event);
          }),
        ],
        alice,
      );

      // A draft is invisible until it is published.
      assert.isUndefined(yield* publishedAs(id, "members"));

      yield* documents.publish(id, heads, alice);
      yield* documents.applyChanges(
        id,
        [
          editor.edit((event) =>
            A.updateText(event, ["title"], "Secret draft"),
          ),
        ],
        alice,
      );

      // Edits after publishing stay private until republished.
      assert.strictEqual((yield* publishedAs(id, "members"))?.title, "Public");
    }),
  );

  it.effect(
    "refuses to publish half-made questions or a late food deadline",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const id = yield* documents.create("event", yield* newTeam, alice);
        const editor = yield* openEditor(id);
        const refusal = (edit: (event: EventContent) => void) =>
          Effect.gen(function* () {
            const heads = yield* documents.applyChanges(
              id,
              [editor.edit(edit)],
              alice,
            );
            const error = yield* Effect.flip(
              documents.publish(id, heads, alice),
            );
            return error.message;
          });
        yield* documents.applyChanges(
          id,
          [
            editor.edit((event) => {
              A.updateText(event, ["title"], "Questions");
              setTimes(event);
              setPlace(event);
            }),
          ],
          alice,
        );
        const option = () => ({ id: crypto.randomUUID(), text: "Yes" });
        const question = {
          id: crypto.randomUUID(),
          type: "choice",
          text: "Coming by bike?",
        } as const;

        assert.strictEqual(
          yield* refusal((event) =>
            setQuestions(event, [{ ...question, type: "text", text: " " }]),
          ),
          "Every question needs its text",
        );
        assert.strictEqual(
          yield* refusal((event) =>
            setQuestions(event, [{ ...question, options: [option()] }]),
          ),
          "Choice questions need at least two options, all filled in",
        );
        assert.strictEqual(
          yield* refusal((event) =>
            setQuestions(event, [
              { ...question, options: [option(), { ...option(), text: "" }] },
            ]),
          ),
          "Choice questions need at least two options, all filled in",
        );
        assert.strictEqual(
          yield* refusal((event) => {
            setQuestions(event, []);
            setTimes(event, {
              deadline: "2036-10-14T12:00+02:00[Europe/Oslo]",
              foodDeadline: "2036-10-14T12:01+02:00[Europe/Oslo]",
            });
          }),
          "The food deadline can't be after sign-up closes",
        );
      }),
  );

  it.effect(
    "takes an unpublished event off the site and keeps its draft (AC-4, AC-6)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const sql = yield* SqlClient.SqlClient;
        const id = yield* publishedEvent({ public: true, guests: true });
        assert.isDefined(yield* publishedAs(id, "anyone"));

        yield* documents.unpublish(id);

        // Off the site, but the published row is kept with the mark set.
        assert.isUndefined(yield* publishedAs(id, "anyone"));
        assert.isUndefined(yield* publishedAs(id, "members"));
        const [row] = yield* sql<{ off: boolean }>`
          SELECT deleted_at IS NOT NULL AS off FROM events WHERE id = ${id}
        `;
        assert.deepStrictEqual(row, { off: true });
        // The draft stays, with its content.
        assert.isDefined(yield* syncedDocument(id));
        const draft = A.load<EventContent>((yield* documents.get(id)).draft);
        assert.strictEqual(draft.title, "Meetup");

        // Unpublishing again, or a draft never published, is as good as done.
        yield* documents.unpublish(id);
        const unpublished = yield* documents.create(
          "event",
          yield* newTeam,
          alice,
        );
        yield* documents.unpublish(unpublished);

        // A deleted event is gone, not unpublished.
        const deleted = yield* publishedEvent({ public: true, guests: true });
        yield* documents.delete(deleted, alice);
        assert.strictEqual(
          (yield* Effect.flip(documents.unpublish(deleted)))._tag,
          "DocumentNotFound",
        );
      }),
  );

  it.effect("refuses sign-ups to an unpublished event (AC-5)", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      yield* documents.unpublish(id);

      assert.strictEqual(
        (yield* Effect.flip(attendance.attend(id, bob)))._tag,
        "EventNotFound",
      );
      assert.strictEqual(
        (yield* Effect.flip(
          attendance.attendAsGuest(id, {
            name: "Gina",
            email: "gina@example.org",
          }),
        ))._tag,
        "EventNotFound",
      );
    }),
  );

  it.effect(
    "puts an unpublished event back on the site, empty and not announced again (AC-11)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const attendance = yield* Attendance;
        const sql = yield* SqlClient.SqlClient;
        const announced = yield* AnnouncementsKept;
        const notices = yield* NoticesKept;
        const id = yield* publishedEvent({ public: true, guests: true });
        yield* attendance.attend(id, carol);
        yield* attendance.attendAsGuest(id, {
          name: "Gina",
          email: "gina@example.org",
        });
        yield* documents.unpublish(id);
        assert.isUndefined(yield* publishedAs(id, "anyone"));

        yield* documents.publish(id, (yield* documents.get(id)).heads, alice);

        assert.isDefined(yield* publishedAs(id, "anyone"));
        assert.isDefined(yield* publishedAs(id, "members"));
        const [row] = yield* sql<{ off: boolean; signups: number }>`
          SELECT deleted_at IS NOT NULL AS off,
            (SELECT count(*)::int FROM attendees WHERE event_id = events.id) AS signups
          FROM events WHERE id = ${id}
        `;
        assert.deepStrictEqual(row, { off: false, signups: 0 });
        // Slack was told once, the first time.
        const told = (yield* Ref.get(announced)).filter((each) => each === id);
        assert.deepStrictEqual(told, [id]);
        const changes = (yield* Ref.get(notices))
          .filter((notice) => notice.kind === "eventChanged")
          .filter((notice) => notice.event === id);
        assert.deepStrictEqual(changes, []);
      }),
  );
});
