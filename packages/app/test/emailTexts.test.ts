import { describe, expect, it } from "vitest";
import {
  type EmailKeys,
  opensFromStart,
} from "../src/routes/studio/emailTexts.ts";

const signedUp: EmailKeys = {
  subject: "signedUpSubject",
  text: "signedUpText",
};
const others: ReadonlyArray<EmailKeys> = [
  { subject: "signupCancelledSubject", text: "signupCancelledText" },
  { subject: "eventChangedSubject", text: "eventChangedText" },
  { subject: "eventCancelledSubject", text: "eventCancelledText" },
];

describe("opensFromStart", () => {
  it("opens the sign-up email when nothing is written for it (AC-1)", () => {
    expect(opensFromStart({}, signedUp)).toBe(true);
    expect(
      opensFromStart({ signedUpSubject: "", signedUpText: "" }, signedUp),
    ).toBe(true);
  });

  it("keeps the other emails closed while nothing is written for them (AC-2)", () => {
    for (const email of others) {
      expect(opensFromStart({}, email)).toBe(false);
      expect(
        opensFromStart(
          {
            signupCancelledSubject: "",
            signupCancelledText: "  ",
            eventChangedSubject: "\n",
            eventChangedText: "￼ ￼",
            eventCancelledSubject: " ",
            eventCancelledText: "",
          },
          email,
        ),
      ).toBe(false);
    }
  });

  it("opens another email when its subject or its text is written (AC-2)", () => {
    expect(
      opensFromStart({ eventChangedSubject: "Moved" }, others[1] as EmailKeys),
    ).toBe(true);
    expect(
      opensFromStart({ eventCancelledText: "Off" }, others[2] as EmailKeys),
    ).toBe(true);
    expect(
      opensFromStart({ signupCancelledSubject: "Bye" }, others[0] as EmailKeys),
    ).toBe(true);
  });
});
