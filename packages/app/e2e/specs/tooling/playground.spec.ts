import { expect, test } from "../../fixtures/test.ts";
import { Playground } from "../../pom/Playground.ts";

test.beforeEach(async ({ page }) => {
  await new Playground(page).goto();
});

test("edits appear in the other replica without re-creating its editor", async ({
  page,
}) => {
  const playground = new Playground(page);
  await playground.markField(2, "title");

  await playground.field(1, "title").type("Hello there");
  await playground.field(2, "title").expectText("Hello there");

  await playground.expectFieldMarked(2, "title");
});

test("merges concurrent edits made while disconnected", async ({ page }) => {
  const playground = new Playground(page);
  await playground.field(1, "body").type("Hello");
  await playground.field(2, "body").expectText("Hello");

  await playground.disconnect();
  await playground.field(1, "body").typeAt("end", " left");
  await playground.field(2, "body").typeAt("start", "right ");
  await playground.connect();

  await playground.field(1, "body").expectText("right Hello left");
  await playground.field(2, "body").expectText("right Hello left");
  expect(await playground.json(1)).toEqual(await playground.json(2));
});

test("stores plain strings without block markers", async ({ page }) => {
  const playground = new Playground(page);
  const title = playground.field(1, "title");
  await title.type("One");
  await title.press("Enter");
  await title.type(" line");

  const body = playground.field(1, "body");
  await body.type("First");
  await body.press("Enter");
  await body.type("Second");

  await playground.expectJson(2, { title: "One line", body: "First\nSecond" });
});
