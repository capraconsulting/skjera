import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("shared form rules", () => {
  it("uses server-owned limits in every covered form (AC-1)", () => {
    expect(source("routes/site/AttendInputs.tsx")).not.toMatch(
      /maxLength=\{(?:50|100|500|1000)\}/,
    );
    expect(source("routes/studio/OrganizerEmails.tsx")).not.toMatch(
      /maxLength=\{(?:200|10000)\}/,
    );
    expect(source("routes/studio/Invitations.tsx")).not.toContain(
      "maxLength={100}",
    );
    expect(source("routes/studio/Teams.tsx")).not.toContain("maxLength={100}");
    expect(source("editor/TagsField.tsx")).not.toContain("maxLength={40}");
  });

  it("uses the field catalogue in every covered producer and reader (AC-2)", () => {
    for (const path of [
      "routes/site/AttendInputs.tsx",
      "routes/site/Attend.tsx",
      "routes/site/CancelByEmail.tsx",
      "site/signupForm.ts",
    ]) {
      expect(source(path)).not.toMatch(
        /(?:name=|form\.get\(|textOf\(form, )['"](?:firstname|email|telephone|company|jobtitle|subject|dietary|attendance)['"]|name="(?:firstname|email|telephone|company|jobtitle|subject|dietary|attendance)"/,
      );
    }
  });
});
