import * as A from "@automerge/automerge";
import { assert, layer } from "@effect/vitest";
import { m } from "@skjera/i18n/messages";
import { Effect } from "effect";
import { Attendance } from "../../src/attendance/Attendance.ts";
import { Documents } from "../../src/events/documents/index.ts";
import type { DocumentId } from "../../src/Model.ts";
import {
  alice,
  draftEvent,
  editDraft,
  emailsTo,
  journey,
  publishedEvent,
  spanBlock,
  TestLayer,
  writeField,
  writeParagraph,
  writtenEverywhere,
  writtenText,
} from "./helpers.ts";

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Mail: own texts", (it) => {
  it.effect(
    "sends the written subject of each email followed by the event's title, to guests in either language (AC-1)",
    () =>
      Effect.gen(function* () {
        for (const locale of ["en", "nb"] as const) {
          const event = yield* publishedEvent({
            emailTexts: writtenEverywhere,
          });
          const { sent } = yield* journey(event, locale);
          assert.deepStrictEqual(
            sent.map((message) => message.subject),
            [
              "Written for signedUp Launch",
              "Written for eventChanged Launch",
              "Written for eventChanged Launch",
              "Written for eventChanged Launch",
              "Written for signupCancelled Launch",
              "Written for eventCancelled Launch",
            ],
            locale,
          );
        }
      }),
  );

  it.effect(
    "shows the written text in place of the standard heading and opening",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const event = yield* publishedEvent({
          emailTexts: { signedUpText: writtenText },
        });
        const address = `text-${crypto.randomUUID()}@example.org`;
        yield* attendance.attendAsGuest(event, {
          name: "Gina",
          email: address,
        });
        const [signedUp] = yield* emailsTo(address, 1);
        const html = signedUp?.message.html ?? "";
        assert.match(html, /<h2[^>]*>Big news<\/h2>/);
        assert.match(html, /<strong[^>]*>live<\/strong>/);
        assert.match(html, /<a[^>]*href="https:\/\/example\.org\/docs"/);
        assert.match(html, /<li[^>]*>(<[^>]+>)*Bring a friend/);
        // Not the standard heading, greeting or opening sentence.
        assert.notMatch(html, /<h1/);
        assert.notInclude(
          html,
          m.email_greeting({ name: "Gina" }, { locale: "en" }),
        );
        // The inbox preview is the start of the text.
        assert.include(
          html,
          "Big news We are live and read the docs Bring a friend",
        );
        // The subject is the standard one: none was written.
        assert.strictEqual(
          signedUp?.message.subject,
          "You're signed up: Launch",
        );
      }),
  );

  it.effect(
    "keeps only web links and images in a written text, with images from the site",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const event = yield* publishedEvent({
          emailTexts: {
            signedUpText: [
              spanBlock("paragraph"),
              {
                type: "text",
                value: "bad link",
                marks: {
                  link: JSON.stringify({
                    href: "javascript:alert(1)",
                    title: "",
                  }),
                },
              },
              spanBlock(
                "image",
                { src: "/api/images/abc", alt: "A full room" },
                true,
              ),
              spanBlock(
                "image",
                { src: "javascript:alert(2)", alt: "Odd" },
                true,
              ),
            ],
          },
        });
        const address = `links-${crypto.randomUUID()}@example.org`;
        yield* attendance.attendAsGuest(event, {
          name: "Gina",
          email: address,
        });
        const [signedUp] = yield* emailsTo(address, 1);
        const html = signedUp?.message.html ?? "";
        assert.include(html, "bad link");
        assert.notInclude(html, "javascript:");
        assert.include(html, `src="${process.env.SITE_URL}/api/images/abc"`);
        assert.include(html, 'alt="A full room"');
      }),
  );

  it.effect(
    "uses the standard wording for what is not written, in the guest's language",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const onlySubject = yield* publishedEvent({
          emailTexts: { signedUpSubject: "Welcome aboard" },
        });
        const onlyText = yield* publishedEvent({
          emailTexts: { signedUpText: writtenText },
        });
        const emailFor = (event: DocumentId) =>
          Effect.gen(function* () {
            const address = `nora-${crypto.randomUUID()}@example.org`;
            yield* attendance.attendAsGuest(
              event,
              { name: "Nora", email: address },
              { locale: "nb" },
            );
            return (yield* emailsTo(address, 1))[0]?.message;
          });

        const first = yield* emailFor(onlySubject);
        assert.strictEqual(first?.subject, "Welcome aboard Launch");
        assert.include(
          first?.html ?? "",
          m.email_signed_up_heading({}, { locale: "nb" }),
        );
        assert.include(first?.text ?? "", "Hei Nora,");

        const second = yield* emailFor(onlyText);
        assert.strictEqual(second?.subject, "Du er påmeldt: Launch");
        assert.include(second?.html ?? "", "Big news");
      }),
  );

  it.effect(
    "keeps the details, the invitation and the links around a written text",
    () =>
      Effect.gen(function* () {
        const event = yield* publishedEvent({
          dietary: true,
          emailTexts: writtenEverywhere,
        });
        const { sent, token, signup } = yield* journey(event, "en");
        const [signedUp, moved, , both, left, cancelled] = sent;
        const site = process.env.SITE_URL;
        const guestLink = `${site}/events/${event}?guest=${signup}&token=${token}`;
        const eventLink = `${site}/events/${event}`;
        const invited = m.email_organizer_calendar_invited(
          {},
          { locale: "en" },
        );
        const removed = m.email_organizer_calendar_removed(
          {},
          { locale: "en" },
        );

        assert.deepStrictEqual(
          sent.map((message) => message.calendar?.method),
          ["REQUEST", "REQUEST", "REQUEST", "REQUEST", "CANCEL", "CANCEL"],
        );
        // The title, the time and the place follow the text.
        for (const message of [signedUp, left, cancelled]) {
          const text = message?.text ?? "";
          assert.include(text, "Launch");
          assert.match(
            text,
            /Wednesday, October 15, 2036, 6:00\s–\s9:00\sPM \(Central European Time\)/,
          );
          assert.include(text, "Kantina");
        }
        // A line about the attached calendar file.
        assert.include(signedUp?.text ?? "", invited);
        assert.include(left?.text ?? "", removed);
        assert.include(cancelled?.text ?? "", removed);
        assert.include(
          moved?.text ?? "",
          m.email_calendar_updated({}, { locale: "en" }),
        );
        // Signed up: the food line, the change line with its deadline and her own link.
        assert.include(signedUp?.text ?? "", "Food is served");
        assert.match(signedUp?.text ?? "", /until Wednesday, October 15, 2036/);
        assert.include(signedUp?.text ?? "", guestLink);
        // Moved: the old time and place, and her own link.
        assert.match(both?.text ?? "", /It was Tuesday, October 14, 2036/);
        assert.include(both?.text ?? "", "It was at Hall.");
        assert.include(both?.text ?? "", guestLink);
        // Signup cancelled: the button to the event. Cancelled: no link.
        assert.include(left?.text ?? "", eventLink);
        assert.notInclude(cancelled?.text ?? "", eventLink);
      }),
  );

  it.effect(
    "sends the subject and text the event was published with, not the draft's",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const attendance = yield* Attendance;
        const { id, heads } = yield* draftEvent;
        const withA = yield* editDraft(id, (event) => {
          writeField(event, "eventCancelledSubject", "Subject A");
          writeParagraph(event, "eventCancelledText", "Text A");
        });
        yield* documents.publish(id, withA, alice);
        const address = `cancel-${crypto.randomUUID()}@example.org`;
        yield* attendance.attendAsGuest(id, { name: "Gina", email: address });
        yield* emailsTo(address, 1);
        // Changed, but not published.
        yield* editDraft(id, (event) => {
          A.updateText(event, ["eventCancelledSubject"], "Subject B");
          A.updateText(event, ["eventCancelledText"], "Text B");
        });
        yield* documents.delete(id, alice);

        const [, cancelled] = yield* emailsTo(address, 2);
        assert.strictEqual(cancelled?.message.subject, "Subject A Launch");
        assert.include(cancelled?.message.html ?? "", "Text A");
        assert.notInclude(cancelled?.message.html ?? "", "Text B");
        assert.isDefined(heads);
      }),
  );

  it.effect(
    "sends the subject of the version published, while the draft holds a later one",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const attendance = yield* Attendance;
        const { id, heads } = yield* draftEvent;
        yield* documents.publish(id, heads, alice);
        const address = `moved-${crypto.randomUUID()}@example.org`;
        yield* attendance.attendAsGuest(id, { name: "Gina", email: address });
        yield* emailsTo(address, 1);

        // The first change moves the event and writes subject C ...
        const seen = yield* editDraft(id, (event) => {
          (event as Record<string, unknown>)["start"] = new A.ImmutableString(
            "2036-10-16T18:00+02:00[Europe/Oslo]",
          );
          (event as Record<string, unknown>)["end"] = new A.ImmutableString(
            "2036-10-16T21:00+02:00[Europe/Oslo]",
          );
          writeField(event, "eventChangedSubject", "Subject C");
        });
        // ... and a later one writes D, before the first is published.
        yield* editDraft(id, (event) =>
          A.updateText(event, ["eventChangedSubject"], "Subject D"),
        );
        yield* documents.publish(id, seen, alice);

        const [, moved] = yield* emailsTo(address, 2);
        assert.strictEqual(moved?.message.subject, "Subject C Launch");
      }),
  );
  it.effect(
    "sends the written subject and text to someone an organizer took off the event (AC-3)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const event = yield* publishedEvent({
          emailTexts: {
            signupCancelledSubject: "Written for signupCancelled",
            signupCancelledText: writtenText,
          },
        });
        const signup = crypto.randomUUID();
        const address = `removed-${signup}@example.org`;
        yield* attendance.attendAsGuest(
          event,
          { name: "Gina", email: address },
          { id: signup },
        );
        yield* emailsTo(address, 1);

        yield* attendance.remove(signup);
        const [, removed] = yield* emailsTo(address, 2);
        assert.strictEqual(
          removed?.message.subject,
          "Written for signupCancelled Launch",
        );
        const html = removed?.message.html ?? "";
        assert.match(html, /<h2[^>]*>Big news<\/h2>/);
        assert.notMatch(html, /<h1/);
        assert.notInclude(
          html,
          m.email_greeting({ name: "Gina" }, { locale: "en" }),
        );
      }),
  );
});
