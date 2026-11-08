import { readFile } from "node:fs/promises";
import { assert, it } from "@effect/vitest";

it("does not keep an unread sales-event record (AC-6)", async () => {
  const source = await readFile(
    new URL("../../src/notices/SalesEvents.ts", import.meta.url),
    "utf8",
  );
  assert.notInclude(source, "SalesEventsKept");
  assert.notInclude(source, "SalesEventsTold");
});
