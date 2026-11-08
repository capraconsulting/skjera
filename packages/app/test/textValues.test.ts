import { defaultEventType, signupRetentionDays } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { describe, expect, it } from "vitest";
import {
  privacyInvited,
  privacyKeep,
  privacySignupBasis,
} from "../src/routes/privacy/Privacy.tsx";
import { salesEventTypeLabel } from "../src/routes/studio/EventEditor.tsx";

describe("texts backed by code values", () => {
  it("passes the retention value to every privacy message (AC-1)", () => {
    expect(privacyKeep()).toBe(m.privacy_keep({ days: signupRetentionDays }));
    expect(privacySignupBasis()).toBe(
      m.privacy_signup_basis({ days: signupRetentionDays }),
    );
    expect(privacyInvited()).toBe(
      m.privacy_invited({ days: signupRetentionDays }),
    );
  });

  it("passes the default event type to the editor message (AC-1)", () => {
    expect(salesEventTypeLabel()).toBe(
      m.studio_sales_event_type({ eventType: defaultEventType }),
    );
  });
});
