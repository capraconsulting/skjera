import { describe, expect, it } from "vitest";
import { placesForVisitor, placesLeft } from "../src/site/signupCount.ts";

const event = {
  maxAttendees: 3,
  isStreamed: false,
  hidePlacesLeft: false,
  isPublic: true,
};

const signups = (count: number, online = false) =>
  Array.from({ length: count }, () => ({ online }));

describe("placesForVisitor", () => {
  it("gives the places left, with a limit (AC-10)", () => {
    expect(placesForVisitor(event, signups(1))).toEqual({ left: 2 });
    expect(placesForVisitor(event, signups(0))).toEqual({ left: 3 });
  });

  it("says none are left when the limit is reached, or passed (AC-10)", () => {
    expect(placesForVisitor(event, signups(3))).toBe("none");
    expect(placesForVisitor(event, signups(4))).toBe("none");
  });

  it("says nothing while places remain when the organiser hides how many, and none left when full (AC-10)", () => {
    const hidden = { ...event, hidePlacesLeft: true };
    expect(placesForVisitor(hidden, signups(1))).toBeNull();
    expect(placesForVisitor(hidden, signups(3))).toBe("none");
  });

  it("counts only those in person for a streamed event (AC-10)", () => {
    const streamed = { ...event, isStreamed: true };
    const mixed = [...signups(2, true), ...signups(1)];
    expect(placesForVisitor(streamed, mixed)).toEqual({ left: 2 });
    expect(placesForVisitor(streamed, signups(3, true))).toEqual({ left: 3 });
    expect(placesForVisitor(streamed, signups(3))).toBe("none");
  });

  it("says nothing without a limit, or for an event shown only to members (AC-10)", () => {
    expect(
      placesForVisitor({ ...event, maxAttendees: null }, signups(1)),
    ).toBeNull();
    expect(
      placesForVisitor({ ...event, isPublic: false }, signups(1)),
    ).toBeNull();
    expect(
      placesForVisitor({ ...event, isPublic: false }, signups(3)),
    ).toBeNull();
  });
});

describe("placesLeft", () => {
  it("is null without a limit, and never below 0 (AC-10)", () => {
    expect(
      placesLeft({ maxAttendees: null, isStreamed: false }, signups(5)),
    ).toBeNull();
    expect(placesLeft({ maxAttendees: 3, isStreamed: false }, signups(5))).toBe(
      0,
    );
  });
});
