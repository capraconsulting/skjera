import { assert, it } from "@effect/vitest";
import { Effect, Ref } from "effect";
import { DocumentId } from "../../src/Model.ts";
import { NoticesKept, Notifications } from "../../src/notices/Notifications.ts";

it.effect("records organizer emails and reminders (AC-2, AC-5)", () =>
  Effect.gen(function* () {
    const notifications = yield* Notifications;
    const kept = yield* NoticesKept;
    const attendee = {
      id: "signup",
      name: "Gina",
      email: "gina@example.org",
      guest: true,
    };
    const event = DocumentId.make("00000000-0000-4000-8000-000000000001");
    yield* notifications.organizerEmail({
      event,
      attendee,
      organizerEmail: "message",
    });
    yield* notifications.reminder({
      event,
      attendee,
      version: "123",
    });

    assert.deepStrictEqual(yield* Ref.get(kept), [
      {
        kind: "organizerEmail",
        event,
        attendee,
        organizerEmail: "message",
      },
      {
        kind: "reminder",
        event,
        attendee,
        version: "123",
      },
    ]);
  }).pipe(Effect.provide(Notifications.layerTest)),
);

import { readFile } from "node:fs/promises";

it("routes organizer emails and reminders through Notifications (AC-2, AC-5)", async () => {
  const organizer = await readFile(
    new URL("../../src/notices/OrganizerEmails.ts", import.meta.url),
    "utf8",
  );
  const mail = await readFile(
    new URL("../../src/notices/Mail.tsx", import.meta.url),
    "utf8",
  );
  assert.match(organizer, /notifications\.organizerEmail\(/);
  assert.match(mail, /notifications\.reminder\(/);
});
