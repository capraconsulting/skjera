import { expect, test } from "@playwright/test";
import { EventPage } from "../pom/site/EventPage.ts";
import { cleanUp } from "../pom/studio/cleanUp.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";
import { pixel, signedIn, uniqueTeamName, visitor } from "../pom/support.ts";

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
  const dialog = await editor.openImageDialog();
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
  await editor.expectBodyImage("A pixel");
  const src = await editor.bodyImageSrc("A pixel");
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

  await editor.pasteImageIntoBody();
  await editor.expectBodyImageCount(1);
  await editor.expectBodyImageAddresses(imagePath);

  // Selected after it lands, so it can be described right away.
  const dialog = await editor.openDescribeImageDialog();
  await dialog.fillDescription("A pixel");
  await dialog.clickConfirm();
  await editor.expectBodyImage("A pixel");

  await editor.dropImageOntoBody();
  await editor.expectBodyImageCount(2);

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

  await editor.chooseCoverFile();
  await editor.expectCover(imagePath);
  const first = await editor.coverSrc();
  await editor.coverDescription.type("A full room");

  // Dropping another image replaces it, and keeps the description.
  await editor.dropCoverImage();
  await editor.expectCoverNot(first);
  const cover = await editor.coverSrc();
  await editor.coverDescription.expectText("A full room");

  await editor.publish();

  const reader = await visitor(browser);
  const page = new EventPage(reader);
  await page.goto(event.id);
  await page.expectCover("A full room", cover);
  // Taken off again.
  await editor.removeCover();
  await editor.expectNoCover();
  await editor.publish();
  await page.goto(event.id);
  await page.expectHeading(event.title);
  await page.expectNoImages();

  await cleanUp(alice, team, event.id);
});
