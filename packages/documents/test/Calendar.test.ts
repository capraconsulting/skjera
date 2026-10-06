import { assert, describe, it } from "@effect/vitest";
import { invitation, parseAddress } from "../src/Calendar.ts";

const invite = (
  method: "REQUEST" | "CANCEL",
  sequence = 0,
  cancelled = false,
) =>
  invitation({
    method,
    event: {
      id: "launch",
      title: "Launch",
      startsAt: new Date("2036-10-15T18:00+02:00"),
      endsAt: new Date("2036-10-15T21:00+02:00"),
      url: "https://skjera.test/events/launch",
      sequence,
      cancelled,
    },
    attendee: { name: "Gina", email: "gina@example.org" },
    organizer: { name: "Skjera", email: "events@skjera.test" },
    site: { name: "Skjera", host: "skjera.test" },
  });

describe("Calendar", () => {
  it("invites: one event, the same id each time, in UTC", () => {
    const ics = invite("REQUEST", 3);
    assert.include(ics, "METHOD:REQUEST");
    assert.include(ics, "UID:launch@skjera.test");
    assert.include(ics, "SEQUENCE:3");
    assert.include(ics, "DTSTART:20361015T160000Z");
    assert.include(ics, "DTEND:20361015T190000Z");
    assert.include(ics, "URL;VALUE=URI:https://skjera.test/events/launch");
    assert.match(ics, /ORGANIZER;CN="Skjera":mailto:events@skjera.test/);
    // Long lines are folded: unfolded, the attendee is one.
    const attendee =
      /^ATTENDEE;.*$/m.exec(ics.replace(/\r\n /g, ""))?.[0] ?? "";
    assert.include(attendee, "PARTSTAT=ACCEPTED");
    assert.include(attendee, "RSVP=FALSE");
    assert.include(attendee, 'CN="Gina":MAILTO:gina@example.org');
    assert.strictEqual(ics.match(/BEGIN:VEVENT/g)?.length, 1);
  });

  it("cancels the same event", () => {
    const ics = invite("CANCEL", 4);
    assert.include(ics, "METHOD:CANCEL");
    assert.include(ics, "UID:launch@skjera.test");
    assert.include(ics, "SEQUENCE:4");
    // For the attendee only: the event goes on.
    assert.notInclude(ics, "STATUS:CANCELLED");
  });

  it("cancels the event for everyone", () => {
    const ics = invite("CANCEL", 5, true);
    assert.include(ics, "METHOD:CANCEL");
    assert.include(ics, "STATUS:CANCELLED");
  });

  it("reads who emails come from", () => {
    assert.deepStrictEqual(parseAddress("Skjera <events@skjera.test>"), {
      name: "Skjera",
      email: "events@skjera.test",
    });
    assert.deepStrictEqual(parseAddress("<events@skjera.test>"), {
      name: "events@skjera.test",
      email: "events@skjera.test",
    });
    assert.deepStrictEqual(parseAddress("events@skjera.test"), {
      name: "events@skjera.test",
      email: "events@skjera.test",
    });
  });
});
