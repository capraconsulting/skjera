import { readFile } from "node:fs/promises";
import { assert, it } from "@effect/vitest";
import { escapeHtml } from "../../src/site/Html.ts";

it("escapes text without importing images or file-system services (AC-7)", async () => {
  assert.strictEqual(
    escapeHtml(`<a href="'">&`),
    "&lt;a href=&quot;&#39;&quot;&gt;&amp;",
  );
  const source = await readFile(
    new URL("../../src/site/Html.ts", import.meta.url),
    "utf8",
  );
  assert.notMatch(source, /Images|FileSystem|node:fs/);
});
