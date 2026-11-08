import { readFile } from "node:fs/promises";
import { assert, it } from "@effect/vitest";

it("constructs the mailer from token functions without Attendance (AC-4)", async () => {
  const source = await readFile(
    new URL("../../src/notices/EventEmails.tsx", import.meta.url),
    "utf8",
  );
  assert.notMatch(source, /from "\.\.\/attendance\/Attendance\.ts"/);
  assert.match(source, /guestToken/);
  assert.match(source, /cancelLinkToken/);
});
