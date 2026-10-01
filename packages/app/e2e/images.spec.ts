import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  body,
  deleteEvent,
  deleteTeam,
  newTeam,
  publishedEvent,
  signedIn,
  uniqueTeamName,
  visitor,
} from "./helpers.ts";

// The smallest valid PNG: one transparent pixel.
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const pixelBase64 = pixel.toString("base64");

/** A DataTransfer holding the PNG, as pasting or dropping a file gives. */
const pngTransfer = (page: Page, name = "pixel.png") =>
  page.evaluateHandle(
    ({ base64, name }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type: "image/png" }));
      return transfer;
    },
    { base64: pixelBase64, name },
  );

/** Pastes the PNG into what has focus in `target`. */
const pastePng = async (target: Locator) => {
  const transfer = await pngTransfer(target.page());
  await target.evaluate((element, clipboardData) => {
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, transfer);
};

/** Drops the PNG onto the middle of `target`. */
const dropPng = async (target: Locator) => {
  const box = await target.boundingBox();
  if (box === null) throw new Error("Not visible");
  const at = {
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
  };
  const dataTransfer = await pngTransfer(target.page());
  await target.dispatchEvent("dragover", { dataTransfer, ...at });
  await target.dispatchEvent("drop", { dataTransfer, ...at });
};

const imagePath = /^\/api\/images\/[A-Za-z0-9_-]{22}$/;
test("images are uploaded into the body and shown on the site", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Images"));
  const event = await publishedEvent(alice, { public: true });
  await body(alice).click();

  // Only images get in.
  await alice
    .getByRole("toolbar", { name: "Body formatting" })
    .getByRole("button", { name: "Image" })
    .click();
  const dialog = alice.getByRole("dialog", { name: "Add image" });
  await dialog.getByLabel("Image file").setInputFiles({
    name: "page.html",
    mimeType: "text/html",
    buffer: Buffer.from("<script>alert(1)</script>"),
  });
  await dialog.getByRole("button", { name: "Add image" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Pick a PNG, JPEG, GIF, WebP or AVIF image",
  );

  await dialog.getByLabel("Image file").setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: pixel,
  });
  await dialog.getByRole("textbox", { name: "Description" }).fill("A pixel");
  await dialog.getByRole("button", { name: "Add image" }).click();
  await expect(dialog).toBeHidden();
  const image = body(alice).getByRole("img", { name: "A pixel" });
  await expect(image).toBeVisible();
  const src = await image.getAttribute("src");
  expect(src).toMatch(/^\/api\/images\/[A-Za-z0-9_-]{22}$/);

  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");

  // Anyone with the link can see it, as the image it is.
  const reader = await visitor(browser);
  await reader.goto(`/events/${event.id}`);
  const shown = reader.getByTestId("event-body").getByRole("img", {
    name: "A pixel",
  });
  await expect(shown).toHaveAttribute("src", new RegExp(`${src}$`));
  await expect
    .poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1);
  const response = await reader.request.get(src ?? "");
  expect(response.headers()["content-type"]).toBe("image/png");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("images pasted or dropped into the body are uploaded", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Paste"));
  const event = await publishedEvent(alice, { public: true });
  const editor = body(alice);
  await editor.pressSequentially("Look:");

  await pastePng(editor);
  // Undescribed images have no img role, so find them by their address.
  const images = editor.locator('img[src^="/api/images/"]');
  await expect(images).toHaveCount(1);
  await expect(images).toHaveAttribute("src", imagePath);

  // Selected after it lands, so it can be described right away.
  await alice
    .getByRole("toolbar", { name: "Body formatting" })
    .getByRole("button", { name: "Describe image" })
    .click();
  const dialog = alice.getByRole("dialog", { name: "Describe image" });
  await dialog.getByRole("textbox", { name: "Description" }).fill("A pixel");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(editor.getByRole("img", { name: "A pixel" })).toBeVisible();

  await dropPng(editor);
  await expect(images).toHaveCount(2);

  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");
  const reader = await visitor(browser);
  await reader.goto(`/events/${event.id}`);
  await expect(
    reader.getByTestId("event-body").locator('img[src*="/api/images/"]'),
  ).toHaveCount(2);
  await expect(
    reader.getByTestId("event-body").getByRole("img", { name: "A pixel" }),
  ).toBeVisible();

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("an event's cover image is shown on the site", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Cover"));
  const event = await publishedEvent(alice, { public: true });

  await alice.getByLabel("Cover image file").setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: pixel,
  });
  const preview = alice.getByRole("img", { name: "Cover" });
  await expect(preview).toHaveAttribute("src", imagePath);
  const first = await preview.getAttribute("src");
  await alice
    .getByRole("textbox", { name: "Cover description" })
    .pressSequentially("A full room");

  // Dropping another image replaces it, and keeps the description.
  await dropPng(alice.getByTestId("cover-drop"));
  await expect(preview).not.toHaveAttribute("src", first ?? "");
  const cover = await preview.getAttribute("src");
  await expect(
    alice.getByRole("textbox", { name: "Cover description" }),
  ).toHaveText("A full room");

  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");

  const reader = await visitor(browser);
  await reader.goto(`/events/${event.id}`);
  await expect(
    reader.getByRole("img", { name: "A full room" }),
  ).toHaveAttribute("src", cover ?? "");
  // The front page shows it too, next to the title.
  await reader.goto("/");
  await expect(
    reader
      .getByRole("article")
      .filter({ hasText: event.title })
      .locator(`img[src="${cover}"]`),
  ).toBeVisible();

  // Taken off again.
  await alice.getByRole("button", { name: "Remove cover image" }).click();
  await expect(preview).toHaveCount(0);
  await expect(
    alice.getByRole("textbox", { name: "Cover description" }),
  ).toHaveCount(0);
  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");
  await reader.goto(`/events/${event.id}`);
  await expect(
    reader.getByRole("heading", { name: event.title }),
  ).toBeVisible();
  await expect(reader.locator("img")).toHaveCount(0);

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});
