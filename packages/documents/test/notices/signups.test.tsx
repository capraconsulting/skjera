import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { Effect } from "effect";
import { Attendance } from "../../src/attendance/Attendance.ts";
import {
  descriptionOf,
  emailsTo,
  outbox,
  publishedEvent,
  TestLayer,
} from "./helpers.ts";

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Mail: signups", (it) => {
  it.effect("tells a guest they're signed up, then that they're not", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const event = yield* publishedEvent({ dietary: true });
      const signup = crypto.randomUUID();
      const address = `gina-${signup}@example.org`;
      const token = yield* attendance.attendAsGuest(
        event,
        { name: "Gina", email: address },
        { id: signup, dietary: "None" },
      );

      const [signedUp] = yield* emailsTo(address, 1);
      const message = signedUp?.message;
      assert.strictEqual(message?.subject, "You're signed up: Launch");
      assert.deepStrictEqual(message?.to, { name: "Gina", address });
      assert.strictEqual(message?.from, process.env.EMAIL_FROM);
      // Their own link, to change or cancel from anywhere.
      assert.include(
        message?.text ?? "",
        `${process.env.SITE_URL}/events/${event}?guest=${signup}&token=${token}`,
      );
      // (Intl puts thin spaces around the dash.)
      assert.match(
        message?.text ?? "",
        /Wednesday, October 15, 2036, 6:00\s–\s9:00\sPM \(Central European Time\)/,
      );
      assert.include(message?.text ?? "", "Food is served");
      // The invitation, for their calendar.
      assert.strictEqual(message?.calendar?.method, "REQUEST");
      const invitation = message?.calendar?.content ?? "";
      assert.include(invitation, "METHOD:REQUEST");
      assert.include(
        invitation,
        `UID:${event}@${new URL(process.env.SITE_URL ?? "").host}`,
      );
      assert.include(invitation, "DTSTART:20361015T160000Z");
      assert.include(invitation, "DTEND:20361015T190000Z");
      assert.match(invitation, /ATTENDEE;[^\r\n]*CN="Gina"/);
      assert.include(invitation, "SUMMARY:Launch");
      assert.include(invitation, "LOCATION:Kantina");

      yield* attendance.leaveAsGuest(event, token);
      const [, cancelled] = yield* emailsTo(address, 2);
      assert.strictEqual(
        cancelled?.message.subject,
        "Signup cancelled: Launch",
      );
      assert.strictEqual(cancelled?.message.calendar?.method, "CANCEL");
      assert.include(
        cancelled?.message.calendar?.content ?? "",
        "METHOD:CANCEL",
      );
    }),
  );

  it.effect("carries the summary in a guest's invitations", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const event = yield* publishedEvent({ summary: "Coffee and a talk." });
      const signup = crypto.randomUUID();
      const address = `gina-${signup}@example.org`;
      const token = yield* attendance.attendAsGuest(
        event,
        { name: "Gina", email: address },
        { id: signup, dietary: "None" },
      );
      const [signedUp] = yield* emailsTo(address, 1);

      yield* attendance.leaveAsGuest(event, token);
      const [, cancelled] = yield* emailsTo(address, 2);
      const link = `${process.env.SITE_URL}/events/${event}`;
      for (const email of [signedUp, cancelled]) {
        assert.strictEqual(
          descriptionOf(email?.message.calendar?.content ?? ""),
          `Coffee and a talk.\n\n${link}`,
        );
      }
    }),
  );

  it.effect("writes in the language each signed up in", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const event = yield* publishedEvent();
      const address = `nora-${crypto.randomUUID()}@example.org`;
      const token = yield* attendance.attendAsGuest(
        event,
        { name: "Nora", email: address },
        { locale: "nb" },
      );
      const [signedUp] = yield* emailsTo(address, 1);
      assert.strictEqual(signedUp?.message.subject, "Du er påmeldt: Launch");
      assert.include(signedUp?.message.text ?? "", "Hei Nora,");
      // Dates as Norwegians write them, in the event's zone.
      assert.include(
        signedUp?.message.text ?? "",
        "onsdag 15. oktober 2036, 18:00–21:00 (sentraleuropeisk tid)",
      );
      assert.include(signedUp?.message.html ?? "", 'lang="nb"');

      // Nynorsk, for a guest who said so.
      const other = `nils-${crypto.randomUUID()}@example.org`;
      const nils = yield* attendance.attendAsGuest(
        event,
        { name: "Nils", email: other },
        { locale: "nn" },
      );
      yield* attendance.leaveAsGuest(event, nils);
      const [, left] = yield* emailsTo(other, 2);
      assert.strictEqual(left?.message.subject, "Avmeld: Launch");
      assert.include(left?.message.text ?? "", "Du er ikkje lenger påmeld");
      yield* attendance.leaveAsGuest(event, token);
    }),
  );

  it.effect("tells members once, however often they sign up", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const event = yield* publishedEvent();
      const member = new Identity({
        issuer: "https://idp.example",
        subject: `m-${crypto.randomUUID()}`,
        email: `member-${crypto.randomUUID()}@example.com`,
        name: "Morten",
      });
      yield* attendance.attend(event, member);
      yield* attendance.attend(event, member);
      const sent = yield* emailsTo(member.email ?? "", 1);
      yield* Effect.sleep("300 millis");
      assert.strictEqual(outbox.to(member.email ?? "").length, 1);
      // Members get the event's page, not a guest's link.
      assert.notInclude(sent[0]?.message.text ?? "", "?guest=");

      yield* attendance.leave(event, member);
      const [, cancelled] = yield* emailsTo(member.email ?? "", 2);
      assert.strictEqual(cancelled?.message.calendar?.method, "CANCEL");
    }),
  );
});
