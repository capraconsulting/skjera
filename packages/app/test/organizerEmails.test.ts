import { organizerEmailMissingField } from "@skjera/documents/api";
import { describe, expect, it } from "vitest";
import { recipientCount } from "../src/routes/studio/organizerEmails.ts";

describe("recipientCount", () => {
  it("counts the signups that have an email and leaves the others out (AC-1)", () => {
    expect(
      recipientCount([
        { details: { email: "bob@example.org" } },
        { details: { email: null } },
        { details: { email: "gina@example.org" } },
        { details: null },
      ]),
    ).toBe(2);
    expect(recipientCount([])).toBe(0);
  });
});

describe("organizerEmailMissingField", () => {
  it("names the field that is empty or only spaces, the subject first (AC-3)", () => {
    expect(
      organizerEmailMissingField({ subject: "", text: "Vi er i rom 3." }),
    ).toBe("subject");
    expect(
      organizerEmailMissingField({ subject: "Nytt rom", text: " \n " }),
    ).toBe("text");
    expect(organizerEmailMissingField({ subject: "  ", text: "" })).toBe(
      "subject",
    );
  });

  it("returns null when both are filled in (AC-3)", () => {
    expect(
      organizerEmailMissingField({
        subject: "Nytt rom",
        text: "Vi er i rom 3.",
      }),
    ).toBe(null);
  });
});
