import * as A from "@automerge/automerge";
import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { Effect, Ref } from "effect";
import { SqlClient } from "effect/sql";
import { Attendance } from "../../src/attendance/Attendance.ts";
import type { EventContent } from "../../src/events/ContentTypes.ts";
import { Documents } from "../../src/events/Documents.ts";
import { type DocumentId, NoticeChanged } from "../../src/Model.ts";
import { NoticesKept } from "../../src/notices/Notifications.ts";
import {
  alice,
  bob,
  dietaryList,
  interruptedWhileLocked,
  openEditor,
  organizerView,
  publishedAs,
  publishedEvent,
  setPlace,
  setTimes,
  syncedDocument,
  TestLayer,
} from "../helpers.ts";

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Attendee notices", (it) => {
  it.effect(
    "answers with the same publishing and cancelling rules it acts on (AC-1)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        yield* attendance.attendAsGuest(id, {
          name: "Gina",
          email: "gina@example.org",
        });
        yield* attendance.attend(id, bob);
        const editor = yield* openEditor(id);
        const heads = yield* documents.applyChanges(
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

        assert.deepStrictEqual(
          { ...(yield* documents.publishingNotice(id, heads, alice)) },
          { moved: true, newPlace: false, told: 1 },
        );
        assert.deepStrictEqual(
          { ...(yield* documents.cancellingNotice(id)) },
          { told: 1 },
        );

        const stale = yield* documents.publishConfirmed(id, heads, alice, {
          moved: false,
          newPlace: false,
          told: 0,
        });
        if (!(stale instanceof NoticeChanged))
          assert.fail("expected changed notice");
        assert.strictEqual(stale._tag, "NoticeChanged");
        assert.deepStrictEqual(
          { ...stale.notice },
          {
            moved: true,
            newPlace: false,
            told: 1,
          },
        );
      }),
  );
  it.effect(
    "tells attendees when a republish gives the event another place",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const attendance = yield* Attendance;
        const kept = yield* NoticesKept;
        const id = yield* publishedEvent({ public: true, guests: true });
        const carol = new Identity({
          issuer: "https://idp.example",
          subject: "carol",
          email: "carol@example.com",
          name: "Carol",
        });
        yield* attendance.attend(id, carol);
        yield* attendance.attend(id, bob); // No email to tell.
        yield* attendance.attendAsGuest(id, {
          name: "Gina",
          email: "gina@example.org",
        });
        const changes = Ref.get(kept).pipe(
          Effect.map((all) =>
            all
              .filter((notice) => notice.kind === "eventChanged")
              .filter((notice) => notice.event === id),
          ),
        );
        const editor = yield* openEditor(id);
        const republish = (edit: (event: EventContent) => void) =>
          documents
            .applyChanges(id, [editor.edit(edit)], alice)
            .pipe(
              Effect.flatMap((heads) => documents.publish(id, heads, alice)),
            );

        // Anything but its place: nobody is told.
        yield* republish((event) => A.updateText(event, ["title"], "Meetup!"));
        assert.deepStrictEqual(yield* changes, []);

        // Another place, at the same times: everyone with an email is, once
        // each, with the place it was.
        const moved = yield* republish((event) => setPlace(event, "Aula"));
        const told = yield* changes;
        assert.deepStrictEqual(
          told.map((notice) => notice.attendee.name).sort(),
          ["Carol", "Gina"],
        );
        for (const notice of told) {
          assert.strictEqual(
            notice.version,
            String(moved.publishedAt.getTime()),
          );
          assert.strictEqual(notice.previousPlace, "Kantina");
          assert.isUndefined(notice.previously);
        }

        // Both at once: one notice each, with both.
        const both = yield* republish((event) => {
          setPlace(event, "Torget");
          setTimes(event, {
            start: "2036-10-16T18:00+02:00[Europe/Oslo]",
            end: "2036-10-16T21:00+02:00[Europe/Oslo]",
          });
        });
        const latest = (yield* changes).filter(
          (notice) => notice.version === String(both.publishedAt.getTime()),
        );
        assert.deepStrictEqual(
          latest.map((notice) => notice.attendee.name).sort(),
          ["Carol", "Gina"],
        );
        for (const notice of latest) {
          assert.strictEqual(notice.previousPlace, "Aula");
          assert.deepStrictEqual(notice.previously, {
            startsAt: "2036-10-15T16:00:00.000Z",
            endsAt: "2036-10-15T19:00:00.000Z",
          });
        }
      }),
  );

  it.effect(
    "tells attendees of an event published before when it gets a place",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const attendance = yield* Attendance;
        const sql = yield* SqlClient.SqlClient;
        const kept = yield* NoticesKept;
        const id = yield* publishedEvent({ public: true, guests: true });
        yield* attendance.attendAsGuest(id, {
          name: "Gina",
          email: "gina@example.org",
        });
        // As published before events had a place.
        yield* sql`UPDATE events SET place = NULL WHERE id = ${id}`;
        const editor = yield* openEditor(id);
        const heads = yield* documents.applyChanges(
          id,
          [editor.edit((event) => setPlace(event, "Aula"))],
          alice,
        );
        yield* documents.publish(id, heads, alice);
        const told = (yield* Ref.get(kept))
          .filter((notice) => notice.kind === "eventChanged")
          .filter((notice) => notice.event === id);
        assert.strictEqual(told.length, 1);
        assert.strictEqual(told[0]?.previousPlace, "");
        assert.isUndefined(told[0]?.previously);
      }),
  );

  it.effect("keeps a deleted event, telling attendees it's cancelled", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const attendance = yield* Attendance;
      const sql = yield* SqlClient.SqlClient;
      const kept = yield* NoticesKept;
      const cancellations = (event: DocumentId) =>
        Ref.get(kept).pipe(
          Effect.map((all) =>
            all.filter(
              (notice) =>
                notice.kind === "eventCancelled" && notice.event === event,
            ),
          ),
        );
      const id = yield* publishedEvent({ public: true, guests: true });
      const carol = new Identity({
        issuer: "https://idp.example",
        subject: "carol",
        email: "carol@example.com",
        name: "Carol",
      });
      yield* attendance.attend(id, carol);
      yield* attendance.attend(id, bob); // No email to tell.
      const token = yield* attendance.attendAsGuest(id, {
        name: "Gina",
        email: "gina@example.org",
      });

      yield* documents.delete(id, bob);
      assert.deepStrictEqual(
        (yield* cancellations(id)).map((notice) => notice.attendee.name).sort(),
        ["Carol", "Gina"],
      );
      // Kept, marked deleted, with who did it.
      const [row] = yield* sql<{
        deleted: boolean;
        deleted_by_subject: string;
        signups: number;
      }>`
        SELECT d.deleted_at IS NOT NULL AND e.deleted_at IS NOT NULL AS deleted,
          d.deleted_by_subject,
          (SELECT count(*)::int FROM attendees WHERE event_id = d.id) AS signups
        FROM documents d JOIN events e ON e.id = d.id WHERE d.id = ${id}
      `;
      assert.deepStrictEqual(row, {
        deleted: true,
        deleted_by_subject: "bob",
        signups: 3,
      });
      // Otherwise gone: from the studio, the site and signing up.
      assert.isUndefined(yield* syncedDocument(id));
      assert.isUndefined(yield* publishedAs(id, "members"));
      assert.deepStrictEqual(yield* organizerView(id), []);
      assert.strictEqual(
        (yield* Effect.flip(attendance.attend(id, alice)))._tag,
        "EventNotFound",
      );
      assert.strictEqual(
        (yield* Effect.flip(attendance.leaveAsGuest(id, token)))._tag,
        "SignupNotFound",
      );

      // An event that's over just goes.
      const past = yield* publishedEvent({
        public: true,
        guests: true,
        edit: (event) =>
          setTimes(event, {
            start: "2020-10-15T18:00+02:00[Europe/Oslo]",
            end: "2020-10-15T21:00+02:00[Europe/Oslo]",
          }),
      });
      yield* sql`
        INSERT INTO attendees (event_id, name, email, cancel_token_hash)
        VALUES (${past}, 'Gina', 'gina@example.org', ${crypto.randomUUID()})
      `;
      yield* documents.delete(past, alice);
      assert.deepStrictEqual(yield* cancellations(past), []);
    }),
  );

  it.effect(
    "cancels an unpublished event for those signed up, and removes their signups (AC-7)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const attendance = yield* Attendance;
        const sql = yield* SqlClient.SqlClient;
        const kept = yield* NoticesKept;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          dietary: true,
        });
        const carol = new Identity({
          issuer: "https://idp.example",
          subject: "carol",
          email: "carol@example.com",
          name: "Carol",
        });
        yield* attendance.attend(id, carol);
        yield* attendance.attend(id, bob); // No email to tell.
        yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "gina@example.org" },
          { dietary: "vegan" },
        );
        assert.lengthOf(yield* dietaryList(id), 1);

        yield* documents.unpublish(id);

        const cancellations = (yield* Ref.get(kept)).filter(
          (notice) => notice.kind === "eventCancelled" && notice.event === id,
        );
        assert.deepStrictEqual(
          cancellations.map((notice) => notice.attendee.name).sort(),
          ["Carol", "Gina"],
        );
        const [row] = yield* sql<{ signups: number; dietary: number }>`
          SELECT (SELECT count(*)::int FROM attendees WHERE event_id = ${id}) AS signups,
            (SELECT count(*)::int FROM dietary_preferences WHERE event_id = ${id}) AS dietary
        `;
        assert.deepStrictEqual(row, { signups: 0, dietary: 0 });
      }),
  );

  it.effect(
    "tells nobody and keeps the signups when an unpublished event is over (AC-8)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const sql = yield* SqlClient.SqlClient;
        const kept = yield* NoticesKept;
        const past = yield* publishedEvent({
          public: true,
          guests: true,
          edit: (event) =>
            setTimes(event, {
              start: "2020-10-15T18:00+02:00[Europe/Oslo]",
              end: "2020-10-15T21:00+02:00[Europe/Oslo]",
            }),
        });
        yield* sql`
          INSERT INTO attendees (event_id, name, email, cancel_token_hash)
          VALUES (${past}, 'Gina', 'gina@example.org', ${crypto.randomUUID()})
        `;

        yield* documents.unpublish(past);

        assert.deepStrictEqual(
          (yield* Ref.get(kept)).filter((notice) => notice.event === past),
          [],
        );
        const [row] = yield* sql<{ signups: number }>`
          SELECT count(*)::int AS signups FROM attendees WHERE event_id = ${past}
        `;
        assert.deepStrictEqual(row, { signups: 1 });
      }),
  );

  it.effect(
    "finishes unpublishing when the client goes away, and tells each person once (AC-15)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const attendance = yield* Attendance;
        const kept = yield* NoticesKept;
        const id = yield* publishedEvent({ public: true, guests: true });
        const carol = new Identity({
          issuer: "https://idp.example",
          subject: "carol",
          email: "carol@example.com",
          name: "Carol",
        });
        yield* attendance.attend(id, carol);
        yield* attendance.attendAsGuest(id, {
          name: "Gina",
          email: "gina@example.org",
        });
        const cancellations = Ref.get(kept).pipe(
          Effect.map((all) =>
            all.filter(
              (notice) =>
                notice.kind === "eventCancelled" && notice.event === id,
            ),
          ),
        );

        // The `UPDATE events` is what waits for this lock, not the first read.
        yield* interruptedWhileLocked("events", documents.unpublish(id));
        assert.isUndefined(yield* publishedAs(id, "members"));
        assert.lengthOf(yield* cancellations, 2);

        // Again: nothing left to tell.
        yield* documents.unpublish(id);
        assert.lengthOf(yield* cancellations, 2);
      }),
  );

  it.effect("tells attendees when a republish moves the event", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const attendance = yield* Attendance;
      const kept = yield* NoticesKept;
      const id = yield* publishedEvent({ public: true, guests: true });
      const carol = new Identity({
        issuer: "https://idp.example",
        subject: "carol",
        email: "carol@example.com",
        name: "Carol",
      });
      yield* attendance.attend(id, carol);
      yield* attendance.attend(id, bob); // No email to tell.
      yield* attendance.attendAsGuest(id, {
        name: "Gina",
        email: "gina@example.org",
      });
      const changes = Ref.get(kept).pipe(
        Effect.map((all) =>
          all
            .filter((notice) => notice.kind === "eventChanged")
            .filter((notice) => notice.event === id),
        ),
      );
      const editor = yield* openEditor(id);
      const republish = (edit: (event: EventContent) => void) =>
        documents
          .applyChanges(id, [editor.edit(edit)], alice)
          .pipe(Effect.flatMap((heads) => documents.publish(id, heads, alice)));

      // Anything but its time: nobody is told.
      yield* republish((event) => A.updateText(event, ["title"], "Meetup!"));
      assert.deepStrictEqual(yield* changes, []);

      // A day later: everyone with an email is, once each.
      const moved = yield* republish((event) =>
        setTimes(event, {
          start: "2036-10-16T18:00+02:00[Europe/Oslo]",
          end: "2036-10-16T21:00+02:00[Europe/Oslo]",
        }),
      );
      const told = yield* changes;
      assert.deepStrictEqual(
        told.map((notice) => notice.attendee.name).sort(),
        ["Carol", "Gina"],
      );
      for (const notice of told) {
        assert.strictEqual(notice.event, id);
        assert.strictEqual(notice.version, String(moved.publishedAt.getTime()));
        assert.deepStrictEqual(notice.previously, {
          startsAt: "2036-10-15T16:00:00.000Z",
          endsAt: "2036-10-15T19:00:00.000Z",
        });
      }
      assert.isTrue(
        told.some((notice) => notice.attendee.guest),
        "the guest's notice says so, for their link",
      );
    }),
  );
});
