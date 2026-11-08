import { assert, layer } from "@effect/vitest";
import { m } from "@skjera/i18n/messages";
import { Identity } from "@skjera/oauth/api";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { Attendance } from "../../src/attendance/Attendance.ts";
import { cancelLinkHours } from "../../src/Model.ts";
import { formatAt } from "../../src/notices/emails/format.ts";
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

  it.effect(
    "emails a guest a link that cancels for the configured time, each time they ask, without a calendar (AC-3, AC-1)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const event = yield* publishedEvent();
        const signup = crypto.randomUUID();
        const address = `gina-${signup}@example.org`;
        yield* attendance.attendAsGuest(
          event,
          { name: "Gina", email: address },
          { id: signup },
        );
        yield* emailsTo(address, 1);

        yield* attendance.requestCancel(event, address);
        yield* emailsTo(address, 2);
        // A second request is its own email, not a duplicate of the first.
        yield* attendance.requestCancel(event, address);
        const [, first, second] = yield* emailsTo(address, 3);

        for (const email of [first, second]) {
          assert.strictEqual(
            email?.message.subject,
            "Confirm cancelling: Launch",
          );
          assert.deepStrictEqual(email?.message.to, {
            name: "Gina",
            address,
          });
          assert.isUndefined(email?.message.calendar);
          assert.include(email?.message.text ?? "", String(cancelLinkHours));
          // The link names this event, and the server accepts its token.
          const link = new RegExp(
            `${process.env.SITE_URL}/events/${event}/cancel\\?token=([\\w.-]+)`,
          ).exec(email?.message.text ?? "");
          assert.isNotNull(link);
          assert.deepStrictEqual(
            yield* attendance.cancelLink(event, link?.[1] ?? ""),
            { title: "Launch" },
          );
        }
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
  it.effect(
    "tells a guest until the sign-up deadline, and a member until the start when there is none, that they can change or cancel (MAIL-01 AC-3)",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const attendance = yield* Attendance;
        const locale = { locale: "en" } as const;
        const withDeadline = yield* publishedEvent();
        const deadline = new Date("2036-10-14T12:00+02:00");
        yield* sql`
          UPDATE events SET signup_deadline = ${deadline}
          WHERE id = ${withDeadline}
        `;
        const address = `gina-${crypto.randomUUID()}@example.org`;
        yield* attendance.attendAsGuest(withDeadline, {
          name: "Gina",
          email: address,
        });
        const [guest] = yield* emailsTo(address, 1);
        assert.include(
          guest?.message.text ?? "",
          m.email_signed_up_change_guest(
            { until: formatAt("en", deadline, "Europe/Oslo") },
            locale,
          ),
        );

        const withoutDeadline = yield* publishedEvent();
        const member = new Identity({
          issuer: "https://idp.example",
          subject: `m-${crypto.randomUUID()}`,
          email: `member-${crypto.randomUUID()}@example.com`,
          name: "Morten",
        });
        yield* attendance.attend(withoutDeadline, member);
        const [signedUp] = yield* emailsTo(member.email ?? "", 1);
        assert.include(
          signedUp?.message.text ?? "",
          m.email_signed_up_change_member(
            {
              until: formatAt(
                "en",
                new Date("2036-10-15T18:00+02:00"),
                "Europe/Oslo",
              ),
            },
            locale,
          ),
        );
      }),
  );

  it.effect(
    "ends the confirmation by saying why it was sent (MAIL-01 AC-4)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const event = yield* publishedEvent();
        const address = `gina-${crypto.randomUUID()}@example.org`;
        yield* attendance.attendAsGuest(event, {
          name: "Gina",
          email: address,
        });
        const [signedUp] = yield* emailsTo(address, 1);
        const site = process.env.SITE_NAME ?? "Skjera";
        assert.isTrue(
          (signedUp?.message.text ?? "")
            .trimEnd()
            .endsWith(
              m.email_reason_signed_up(
                { title: "Launch", site },
                { locale: "en" },
              ),
            ),
        );
      }),
  );

  it.effect(
    "tells someone who cancelled how to sign up again, with the event's page (MAIL-02 AC-3)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const event = yield* publishedEvent();
        const address = `gina-${crypto.randomUUID()}@example.org`;
        const token = yield* attendance.attendAsGuest(event, {
          name: "Gina",
          email: address,
        });
        yield* attendance.leaveAsGuest(event, token);
        const [, cancelled] = yield* emailsTo(address, 2);
        const text = cancelled?.message.text ?? "";
        assert.include(text, m.email_left_again({}, { locale: "en" }));
        assert.include(text, `${process.env.SITE_URL}/events/${event}`);
        // The event's page, not the link that cancelled.
        assert.notInclude(text, "?guest=");
      }),
  );

  it.effect(
    "writes to a member in the language their signup came with (MAIL-07 AC-4)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const event = yield* publishedEvent();
        const member = new Identity({
          issuer: "https://idp.example",
          subject: `m-${crypto.randomUUID()}`,
          email: `member-${crypto.randomUUID()}@example.com`,
          name: "Morten",
        });
        yield* attendance.attend(event, member, { locale: "nn" });
        const [signedUp] = yield* emailsTo(member.email ?? "", 1);
        // The site's own language is English, so a dropped one shows.
        assert.strictEqual(
          signedUp?.message.subject,
          m.email_signed_up_subject({ title: "Launch" }, { locale: "nn" }),
        );
        assert.include(
          signedUp?.message.text ?? "",
          m.email_greeting({ name: "Morten" }, { locale: "nn" }),
        );
        assert.include(signedUp?.message.html ?? "", 'lang="nn"');
      }),
  );

  it.effect(
    "tells a guest an organizer took off the event, and takes it out of their calendar (AC-1, AC-2, AC-4)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const event = yield* publishedEvent();
        const site = process.env.SITE_NAME ?? "Skjera";
        const [left, removed] = [crypto.randomUUID(), crypto.randomUUID()];
        const leaver = `leaver-${left}@example.org`;
        const address = `gina-${removed}@example.org`;
        const token = yield* attendance.attendAsGuest(
          event,
          { name: "Lise", email: leaver },
          { id: left },
        );
        yield* attendance.attendAsGuest(
          event,
          { name: "Gina", email: address },
          { id: removed },
        );
        const [invitation] = yield* emailsTo(address, 1);

        yield* attendance.remove(removed);
        const [, told] = yield* emailsTo(address, 2);
        assert.strictEqual(
          told?.message.subject,
          m.email_left_subject({ title: "Launch" }, { locale: "en" }),
        );
        assert.strictEqual(told?.message.calendar?.method, "CANCEL");
        const uid = `UID:${event}@${new URL(process.env.SITE_URL ?? "").host}`;
        assert.include(told?.message.calendar?.content ?? "", "METHOD:CANCEL");
        assert.include(told?.message.calendar?.content ?? "", uid);
        assert.include(invitation?.message.calendar?.content ?? "", uid);
        // The organizers' doing, not hers; the way back stays.
        const text = told?.message.text ?? "";
        assert.include(
          text,
          m.email_reason_removed({ title: "Launch", site }, { locale: "en" }),
        );
        assert.notInclude(
          text,
          m.email_reason_left({ title: "Launch", site }, { locale: "en" }),
        );
        assert.include(text, m.email_left_again({}, { locale: "en" }));
        assert.include(text, `${process.env.SITE_URL}/events/${event}`);

        // Cancelling oneself still says so.
        yield* attendance.leaveAsGuest(event, token);
        const [, cancelled] = yield* emailsTo(leaver, 2);
        const cancelledText = cancelled?.message.text ?? "";
        assert.include(
          cancelledText,
          m.email_reason_left({ title: "Launch", site }, { locale: "en" }),
        );
        assert.notInclude(
          cancelledText,
          m.email_reason_removed({ title: "Launch", site }, { locale: "en" }),
        );
      }),
  );
});
