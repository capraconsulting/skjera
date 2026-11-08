import { m } from "@skjera/i18n/messages";
import { describe, expect, it } from "vitest";
import {
  invitationsHeading,
  invitedAs,
} from "../../src/routes/studio/attendance/invitations.ts";

describe("invitedAs", () => {
  it("says the name and the email, or the email alone (AC-5)", () => {
    expect(invitedAs({ name: "Gina Guest", email: "gina@example.org" })).toBe(
      "Gina Guest - gina@example.org",
    );
    expect(invitedAs({ name: null, email: "gina@example.org" })).toBe(
      "gina@example.org",
    );
  });
});

describe("invitationsHeading", () => {
  it("counts those invited, says none when nobody is, and has a name while loading (AC-5)", () => {
    expect(invitationsHeading(2)).toBe(
      m.studio_invitations_count({ count: 2 }),
    );
    expect(invitationsHeading(0)).toBe(m.studio_invitations_none());
    expect(invitationsHeading(null)).toBe(m.studio_invitations());
  });
});
