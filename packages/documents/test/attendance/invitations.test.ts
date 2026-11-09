import { assert, layer } from "@effect/vitest";
import { Effect, Ref } from "effect";
import { Invitations } from "../../src/attendance/Invitations.ts";
import { Documents } from "../../src/events/documents/index.ts";
import type { DocumentId } from "../../src/Model.ts";
import { NoticesKept } from "../../src/notices/Notifications.ts";
import {
  alice,
  newTeam,
  problemOf,
  publishedEvent,
  TestLayer,
} from "../helpers.ts";

/** An event only a draft of, as the studio shows it before publishing. */
const draftEvent = Effect.gen(function* () {
  return yield* (yield* Documents).create("event", yield* newTeam, alice);
});

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Invitations", (it) => {
  it.effect(
    "notes who was invited, trimmed, with no name when none is given (AC-2)",
    () =>
      Effect.gen(function* () {
        const invitations = yield* Invitations;
        const id = yield* publishedEvent({ public: true, guests: true });

        const gina = yield* invitations.invite(id, {
          name: " Gina Guest ",
          email: " gina@example.org ",
        });
        assert.strictEqual(gina.name, "Gina Guest");
        assert.strictEqual(gina.email, "gina@example.org");
        yield* invitations.invite(id, { email: "hana@example.org" });
        yield* invitations.invite(id, {
          name: "   ",
          email: "ivar@example.org",
        });

        const listed = yield* invitations.invitations(id);
        assert.deepStrictEqual(
          listed.map(({ name, email }) => ({ name, email })),
          [
            { name: "Gina Guest", email: "gina@example.org" },
            { name: null, email: "hana@example.org" },
            { name: null, email: "ivar@example.org" },
          ],
        );
      }),
  );

  it.effect("notes invitations for an event not published yet too (AC-1)", () =>
    Effect.gen(function* () {
      const invitations = yield* Invitations;
      const id = yield* draftEvent;

      yield* invitations.invite(id, { email: "gina@example.org" });

      assert.deepStrictEqual(
        (yield* invitations.invitations(id)).map((row) => row.email),
        ["gina@example.org"],
      );
    }),
  );

  it.effect(
    "refuses an address that is not valid, and keeps nothing (AC-3)",
    () =>
      Effect.gen(function* () {
        const invitations = yield* Invitations;
        const id = yield* publishedEvent({ public: true, guests: true });

        for (const email of ["", "   ", "gina@example"]) {
          const refused = yield* Effect.flip(invitations.invite(id, { email }));
          assert.strictEqual(refused._tag, "InvitationRejected");
          assert.deepStrictEqual(problemOf(refused), {
            _tag: "InvitedEmailInvalid",
          });
        }
        assert.lengthOf(yield* invitations.invitations(id), 0);
      }),
  );

  it.effect(
    "refuses the same address again, whatever its case, once per event (AC-4)",
    () =>
      Effect.gen(function* () {
        const invitations = yield* Invitations;
        const id = yield* publishedEvent({ public: true, guests: true });
        const other = yield* publishedEvent({ public: true, guests: true });
        yield* invitations.invite(id, { email: "gina@example.org" });

        const again = yield* Effect.flip(
          invitations.invite(id, { name: "Gina", email: " Gina@Example.org " }),
        );
        assert.strictEqual(again._tag, "InvitationRejected");
        assert.deepStrictEqual(problemOf(again), {
          _tag: "AlreadyInvited",
          email: "Gina@Example.org",
        });
        assert.lengthOf(yield* invitations.invitations(id), 1);

        yield* invitations.invite(other, { email: "gina@example.org" });
        assert.lengthOf(yield* invitations.invitations(other), 1);
      }),
  );

  it.effect("lists invitations in the order they were added (AC-5)", () =>
    Effect.gen(function* () {
      const invitations = yield* Invitations;
      const id = yield* publishedEvent({ public: true, guests: true });
      const emails = ["zed@example.org", "amy@example.org", "mia@example.org"];
      for (const email of emails) yield* invitations.invite(id, { email });

      assert.deepStrictEqual(
        (yield* invitations.invitations(id)).map((row) => row.email),
        emails,
      );
    }),
  );

  it.effect("sends nobody anything when someone is added (AC-6)", () =>
    Effect.gen(function* () {
      const invitations = yield* Invitations;
      const kept = yield* NoticesKept;
      const id = yield* publishedEvent({ public: true, guests: true });
      const about = (event: DocumentId) =>
        Effect.map(Ref.get(kept), (all) =>
          all.filter((notice) => notice.event === event),
        );
      const before = yield* about(id);

      yield* invitations.invite(id, {
        name: "Gina Guest",
        email: "gina@example.org",
      });

      assert.deepStrictEqual(yield* about(id), before);
    }),
  );

  it.effect(
    "notes nothing for an event that is deleted or does not exist",
    () =>
      Effect.gen(function* () {
        const invitations = yield* Invitations;
        const gone = yield* publishedEvent({ public: true, guests: true });
        yield* (yield* Documents).delete(gone, alice);

        const deleted = yield* Effect.flip(
          invitations.invite(gone, { email: "gina@example.org" }),
        );
        assert.strictEqual(deleted._tag, "DocumentNotFound");
        const unknown = yield* Effect.flip(
          invitations.invite(crypto.randomUUID() as DocumentId, {
            email: "gina@example.org",
          }),
        );
        assert.strictEqual(unknown._tag, "DocumentNotFound");
      }),
  );
});
