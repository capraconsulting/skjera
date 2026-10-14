import { expect, test } from "@playwright/test";
import { cleanUp } from "../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../fixtures/support.ts";
import { pixel } from "../pom/images.ts";
import { EventPage } from "../pom/site/EventPage.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

const imagePath = /^\/api\/images\/[A-Za-z0-9_-]{22}$/;

test("images are uploaded into the body and shown on the site", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Images"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });
  await editor.body.click();

  // Only images get in.
  const dialog = await editor.toolbar.openImageDialog();
  await dialog.chooseFile({
    name: "page.html",
    mimeType: "text/html",
    buffer: Buffer.from("<script>alert(1)</script>"),
  });
  await dialog.clickConfirm();
  await dialog.expectError("Pick a PNG, JPEG, GIF, WebP or AVIF image");

  await dialog.chooseFile({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: pixel,
  });
  await dialog.fillDescription("A pixel");
  await dialog.clickConfirm();
  await dialog.expectClosed();
  await editor.bodyImages.expect("A pixel");
  const src = await editor.bodyImages.src("A pixel");
  expect(src).toMatch(imagePath);

  await editor.publish();

  // Anyone with the link can see it, as the image it is.
  const reader = await visitor(browser);
  const page = new EventPage(reader);
  await page.goto(event.id);
  await page.expectBodyImage("A pixel", new RegExp(`${src}$`));
  const headers = await page.imageHeaders(src);
  expect(headers["content-type"]).toBe("image/png");
  expect(headers["x-content-type-options"]).toBe("nosniff");

  await cleanUp(alice, team, event.id);
});

test("images pasted or dropped into the body are uploaded", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Paste"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });
  await editor.body.type("Look:");

  await editor.bodyImages.paste();
  await editor.bodyImages.expectCount(1);
  await editor.bodyImages.expectAddresses(imagePath);

  // Selected after it lands, so it can be described right away.
  const dialog = await editor.toolbar.openDescribeImageDialog();
  await dialog.fillDescription("A pixel");
  await dialog.clickConfirm();
  await editor.bodyImages.expect("A pixel");

  await editor.bodyImages.drop();
  await editor.bodyImages.expectCount(2);

  await editor.publish();
  const reader = await visitor(browser);
  const page = new EventPage(reader);
  await page.goto(event.id);
  await page.expectBodyImageCount(2);
  await page.expectBodyImage("A pixel");

  await cleanUp(alice, team, event.id);
});

test("an event's cover image is shown on the site", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Cover"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });

  await editor.cover.chooseFile();
  await editor.cover.expect(imagePath);
  const first = await editor.cover.src();
  await editor.cover.description.type("A full room");

  // Dropping another image replaces it, and keeps the description.
  await editor.cover.drop();
  await editor.cover.expectNot(first);
  const cover = await editor.cover.src();
  await editor.cover.description.expectText("A full room");

  await editor.publish();

  const reader = await visitor(browser);
  const page = new EventPage(reader);
  await page.goto(event.id);
  await page.expectCover("A full room", cover);
  // Taken off again.
  await editor.cover.remove();
  await editor.cover.expectNone();
  await editor.publish();
  await page.goto(event.id);
  await page.expectHeading(event.title);
  await page.expectNoImages();

  await cleanUp(alice, team, event.id);
});
