import { describe, expect, it } from "vitest";
import { placesForVisitor, placesLeft } from "../../src/site/signupCount.ts";

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
    expect(placesForVisitor(event, signups(1), false)).toEqual({ left: 2 });
    expect(placesForVisitor(event, signups(0), false)).toEqual({ left: 3 });
  });

  it("says none are left when the limit is reached, or passed (AC-10)", () => {
    expect(placesForVisitor(event, signups(3), false)).toBe("none");
    expect(placesForVisitor(event, signups(4), false)).toBe("none");
  });

  it("says nothing while places remain when the organiser hides how many, and none left when full (AC-10)", () => {
    const hidden = { ...event, hidePlacesLeft: true };
    expect(placesForVisitor(hidden, signups(1), false)).toBeNull();
    expect(placesForVisitor(hidden, signups(3), false)).toBe("none");
  });

  it("counts only those in person for a streamed event (AC-10)", () => {
    const streamed = { ...event, isStreamed: true };
    const mixed = [...signups(2, true), ...signups(1)];
    expect(placesForVisitor(streamed, mixed, false)).toEqual({ left: 2 });
    expect(placesForVisitor(streamed, signups(3, true), false)).toEqual({
      left: 3,
    });
    expect(placesForVisitor(streamed, signups(3), false)).toBe("none");
  });

  it("says nothing without a limit, or for an event shown only to members (AC-10)", () => {
    expect(
      placesForVisitor({ ...event, maxAttendees: null }, signups(1), false),
    ).toBeNull();
    expect(
      placesForVisitor({ ...event, isPublic: false }, signups(1), false),
    ).toBeNull();
    expect(
      placesForVisitor({ ...event, isPublic: false }, signups(3), false),
    ).toBeNull();
  });

  it("says nothing of the places left once the sign-up deadline has passed", () => {
    expect(placesForVisitor(event, signups(1), true)).toBeNull();
    expect(placesForVisitor(event, signups(0), true)).toBeNull();
    const streamed = { ...event, isStreamed: true };
    expect(placesForVisitor(streamed, signups(1), true)).toBeNull();
    const hidden = { ...event, hidePlacesLeft: true };
    expect(placesForVisitor(hidden, signups(1), true)).toBeNull();
  });

  it("says none are left, whether or not the sign-up deadline has passed", () => {
    const hidden = { ...event, hidePlacesLeft: true };
    expect(placesForVisitor(event, signups(3), true)).toBe("none");
    expect(placesForVisitor(event, signups(3), false)).toBe("none");
    expect(placesForVisitor(hidden, signups(3), true)).toBe("none");
    expect(placesForVisitor(hidden, signups(3), false)).toBe("none");
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
