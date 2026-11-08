import { organizerEmails } from "@skjera/documents/api";
import { describe, expect, it } from "vitest";
import {
  emails,
  opensFromStart,
} from "../../src/routes/studio/email-texts/emailTexts.ts";

describe("opensFromStart", () => {
  it("projects every organiser email into the studio (AC-1)", () => {
    expect(
      emails.map(({ kind, subject, text }) => ({ kind, subject, text })),
    ).toEqual(
      organizerEmails.map(({ kind, subject, text }) => ({
        kind,
        subject,
        text,
      })),
    );
  });

  it("opens the sign-up email from its catalogue metadata (AC-2)", () => {
    const signedUp = emails.find(({ kind }) => kind === "signedUp");
    expect(signedUp?.openFromStart).toBe(true);
    expect(signedUp === undefined ? false : opensFromStart({}, signedUp)).toBe(
      true,
    );
  });
});
