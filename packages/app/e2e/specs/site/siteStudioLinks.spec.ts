import { dexUsers } from "@skjera/test";
import { cleanUp } from "../../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName } from "../../fixtures/support.ts";
import { test } from "../../fixtures/test.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

test("the editor refuses a link that is not a web or email address, and edits and removes links (STU-07 AC-4, STU-07 AC-5)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Links"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });

  // The word is the last of the line: select it from the end.
  const selectFriends = async () => {
    await editor.body.press("End");
    for (const _ of "friends") await editor.body.press("Shift+ArrowLeft");
  };
  await editor.body.type("Meet our friends");
  await selectFriends();

  // Only web and email addresses are linked (AC-4).
  const adding = await editor.toolbar.openLinkDialog("Add link");
  await adding.fillAddress("ftp://example.com");
  await adding.clickConfirm();
  await adding.expectError("Enter a web address, like https://example.com");
  await editor.body.expectNoLink("friends");
  await adding.fillAddress("mailto:bob@example.com");
  await adding.clickConfirm();
  await adding.expectClosed();
  await editor.body.expectLinkTo("friends", "mailto:bob@example.com");

  // The address can be changed (AC-5)...
  await selectFriends();
  const editing = await editor.toolbar.openLinkDialog("Edit link");
  await editing.expectAddress("mailto:bob@example.com");
  await editing.fillAddress("https://example.com/friends");
  await editing.clickConfirm();
  await editing.expectClosed();
  await editor.body.expectLinkTo("friends", "https://example.com/friends");

  // ...and the link removed, leaving its text.
  await selectFriends();
  const removing = await editor.toolbar.openLinkDialog("Edit link");
  await removing.expectAddress("https://example.com/friends");
  await removing.clickRemove();
  await removing.expectClosed();
  await editor.body.expectNoLink("friends");
  await editor.body.expectText("Meet our friends");

  await cleanUp(alice, team, event.id);
});
