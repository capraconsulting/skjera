import { expect, type Page, test } from "@playwright/test";

const editor = (page: Page, replica: 1 | 2, field: "title" | "body") =>
  page.getByRole("textbox", { name: `Replica ${replica} ${field}` });

const json = async (page: Page, replica: 1 | 2) =>
  JSON.parse(
    (await page.getByTestId(`Replica ${replica} json`).textContent()) ?? "",
  ) as { title: string; body: string };

test.beforeEach(async ({ page }) => {
  await page.goto("/playground");
});

test("edits appear in the other replica without re-creating its editor", async ({
  page,
}) => {
  const other = editor(page, 2, "title");
  await other.evaluate((element) => {
    (element as HTMLElement & { marker?: boolean }).marker = true;
  });

  await editor(page, 1, "title").pressSequentially("Hello there");
  await expect(other).toHaveText("Hello there");

  expect(
    await other.evaluate(
      (element) => (element as HTMLElement & { marker?: boolean }).marker,
    ),
  ).toBe(true);
});

test("merges concurrent edits made while disconnected", async ({ page }) => {
  await editor(page, 1, "body").pressSequentially("Hello");
  await expect(editor(page, 2, "body")).toHaveText("Hello");

  await page.getByLabel("Replicas connected").uncheck();
  await editor(page, 1, "body").press("End");
  await editor(page, 1, "body").pressSequentially(" left");
  await editor(page, 2, "body").press("Home");
  await editor(page, 2, "body").pressSequentially("right ");
  await page.getByLabel("Replicas connected").check();

  await expect(editor(page, 1, "body")).toHaveText("right Hello left");
  await expect(editor(page, 2, "body")).toHaveText("right Hello left");
  expect(await json(page, 1)).toEqual(await json(page, 2));
});

test("stores plain strings without block markers", async ({ page }) => {
  await editor(page, 1, "title").pressSequentially("One");
  await editor(page, 1, "title").press("Enter");
  await editor(page, 1, "title").pressSequentially(" line");

  await editor(page, 1, "body").pressSequentially("First");
  await editor(page, 1, "body").press("Enter");
  await editor(page, 1, "body").pressSequentially("Second");

  await expect
    .poll(() => json(page, 2))
    .toEqual({ title: "One line", body: "First\nSecond" });
});
