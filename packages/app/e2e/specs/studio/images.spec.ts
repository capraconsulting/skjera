import { imagePathPattern, imagesPath } from "@skjera/documents/api";
import { dexUsers } from "@skjera/test";
import { cleanUp } from "../../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../../fixtures/support.ts";
import { expect, test } from "../../fixtures/test.ts";
import {
  firstPageOfImages,
  pixel,
  uploadPng,
  watchUploads,
  wide,
} from "../../pom/images.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

test("an image upload waits for a server that is starting (OPS-06 AC-4)", async ({
  browser,
}) => {
  const page = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(page).create(uniqueTeamName("Starting"));
  const editor = new EventEditor(page);
  const event = await editor.createPublished({ public: true });
  let attempts = 0;
  await page.route(imagesPath, (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts += 1;
    return attempts === 1 ? route.fulfill({ status: 503 }) : route.continue();
  });

  await editor.cover.chooseFile();
  await editor.cover.expect(imagePathPattern);
  expect(attempts).toBe(2);

  await cleanUp(page, team, event.id);
});

test("images are uploaded into the body and shown on the site (STU-08 AC-1, STU-08 AC-7)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
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
  await dialog.fillCaption("A caption");
  await dialog.choosePlacement("Float left");
  await dialog.chooseSize("Small");
  await dialog.clickConfirm();
  await dialog.expectClosed();
  await editor.bodyImages.expect("A pixel");
  const src = await editor.bodyImages.src("A pixel");
  expect(src).toMatch(imagePathPattern);

  await editor.publish();

  // Anyone with the link can see it, as the image it is, with its caption.
  const reader = await visitor(browser);
  const page = new EventPage(reader);
  await page.goto(event.id);
  await page.expectBodyImage("A pixel", new RegExp(`${src}$`));
  await page.expectBodyFigure("A pixel", "A caption");
  const headers = await page.imageHeaders(src);
  expect(headers["content-type"]).toBe("image/png");
  expect(headers["x-content-type-options"]).toBe("nosniff");

  // The choices are kept in the event: they are there when the image is
  // opened again after a reload.
  await editor.reload();
  await editor.bodyImages.select("A pixel");
  const described = await editor.toolbar.openDescribeImageDialog();
  await described.expectChoices({
    placement: "left",
    size: "small",
    caption: "A caption",
  });
  await described.cancel();

  await cleanUp(alice, team, event.id);
});

test("images pasted or dropped into the body are uploaded (STU-08 AC-2, STU-08 AC-8)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Paste"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });
  await editor.body.type("Look:");

  await editor.bodyImages.paste();
  await editor.bodyImages.expectCount(1);
  await editor.bodyImages.expectAddresses(imagePathPattern);

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
  // The dropped image was never described: it is named for those who can't
  // see it, and is shown with the choices a new image gets.
  await page.expectBodyImage("Illustration in the event description");
  await page.expectBodyFigure("Illustration in the event description");

  await cleanUp(alice, team, event.id);
});

test("the email texts' editor has no choices for an image (MAIL-06 AC-1)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Emails"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });

  await editor.emailText("signed up").click();
  const dialog = await editor.emailToolbar("signed up").openImageDialog();
  await dialog.expectNoChoices();
  await dialog.cancel();

  await cleanUp(alice, team, event.id);
});

test("an event's cover image is shown on the site", async ({ browser }) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Cover"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });

  await editor.cover.chooseFile();
  await editor.cover.expect(imagePathPattern);
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

test("the organiser crops the cover, and the site shows the cropped part (STU-25 AC-1, STU-25 AC-2)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Crop"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });

  await editor.cover.chooseFile(wide);
  await editor.cover.expect(imagePathPattern);
  const picture = await editor.cover.src();
  await editor.cover.expectCannotReset();

  // The left half of a 200 × 100 picture is about square.
  await editor.cover.crop({ x: 0.02, y: 0.02 }, { x: 0.5, y: 1 });
  await editor.cover.expectNot(picture);
  await editor.cover.expect(imagePathPattern);
  await editor.cover.expectAboutSquare();
  await editor.cover.expectCanReset();
  const part = await editor.cover.src();
  await editor.cover.description.type("The left half");

  await editor.publish();
  const reader = await visitor(browser);
  const page = new EventPage(reader);
  await page.goto(event.id);
  await page.expectCover("The left half", part);

  await cleanUp(alice, team, event.id);
});

test("the organiser sets the cover's focal point, and resets it (STU-25 AC-1, STU-25 AC-8)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Focus"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });

  await editor.cover.chooseFile(wide);
  await editor.cover.expect(imagePathPattern);
  const picture = await editor.cover.src();
  await editor.cover.setFocalPoint({ x: 0.8, y: 0.3 });
  await editor.cover.expectCanReset();
  // The picture itself is still the one shown.
  await editor.cover.expect(picture);

  await editor.cover.crop({ x: 0.02, y: 0.02 }, { x: 0.5, y: 1 });
  await editor.cover.expectNot(picture);
  await editor.cover.resetCropAndFocus();
  await editor.cover.expect(picture);
  await editor.cover.expectCannotReset();

  await cleanUp(alice, team, event.id);
});

test("the cover offers to pick an image already in Skjera (STU-22 AC-1)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Pick cover"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });

  await editor.cover.expectCanPickExisting();
  await editor.cover.chooseFile();
  await editor.cover.expect(imagePathPattern);
  await editor.cover.expectCanPickExisting();

  await cleanUp(alice, team, event.id);
});

test("the Image dialog of the body and of an email text offers to pick an image already in Skjera (STU-22 AC-1)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Pick text"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });

  await editor.body.click();
  const body = await editor.toolbar.openImageDialog();
  await body.expectCanPickExisting();
  await body.cancel();

  await editor.emailText("signed up").click();
  const email = await editor.emailToolbar("signed up").openImageDialog();
  await email.expectCanPickExisting();
  await email.cancel();

  await cleanUp(alice, team, event.id);
});

test("an image picked for the cover is used without uploading it again (STU-22 AC-4)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Pick cover"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });
  const image = await uploadPng(alice);
  const uploads = watchUploads(alice);

  const picker = await editor.cover.openPicker();
  await picker.pick(image);
  await picker.expectClosed();
  await editor.cover.expect(image);
  expect(uploads.count()).toBe(0);

  await cleanUp(alice, team, event.id);
});

test("an image picked in the Image dialog is added without uploading it again, also after a file was chosen (STU-22 AC-4)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Pick body"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });
  await editor.body.click();
  const image = await uploadPng(alice);
  const uploads = watchUploads(alice);

  // The picker opens beside the dialog: picking leaves the dialog open.
  const dialog = await editor.toolbar.openImageDialog();
  const picker = await dialog.openPicker();
  await picker.pick(image);
  await picker.expectClosed();
  await dialog.expectPicked(image);
  await dialog.fillDescription("Picked");
  await dialog.clickConfirm();
  await dialog.expectClosed();
  await editor.bodyImages.expect("Picked");
  expect(await editor.bodyImages.src("Picked")).toBe(image);

  // A file chosen first does not get in when an image is picked after it.
  const second = await editor.toolbar.openImageDialog();
  await second.chooseFile({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: pixel,
  });
  const again = await second.openPicker();
  await again.pick(image);
  await second.fillDescription("Picked again");
  await second.clickConfirm();
  await second.expectClosed();
  await editor.bodyImages.expect("Picked again");
  expect(await editor.bodyImages.src("Picked again")).toBe(image);
  expect(uploads.count()).toBe(0);

  await cleanUp(alice, team, event.id);
});

test("the list of images loads more as it is scrolled (STU-22 AC-3)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Pick more"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });

  // A page holds 30: upload only as many as it takes to make a second.
  const first = await firstPageOfImages(alice);
  if (!first.more) {
    for (let have = first.count; have <= 30; have++) await uploadPng(alice);
  }
  const page = await firstPageOfImages(alice);
  expect(page.more).toBe(true);

  const picker = await editor.cover.openPicker();
  expect(await picker.count()).toBeLessThanOrEqual(page.count);
  await picker.expectMoreThan(page.count);

  await cleanUp(alice, team, event.id);
});
