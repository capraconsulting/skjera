import { dexUsers } from "@skjera/test";
import { cleanUp } from "../../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../../fixtures/support.ts";
import { expect, test } from "../../fixtures/test.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { EventsColumn } from "../../pom/studio/EventsColumn.ts";
import { Invitations } from "../../pom/studio/Invitations.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

test("organisers note who was invited, by name and email, and nothing is sent (SIGN-15 AC-1, SIGN-15 AC-2, SIGN-15 AC-3, SIGN-15 AC-4, SIGN-15 AC-5)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Invited"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  const invitations = new Invitations(alice);

  await invitations.expectHint();
  await invitations.expectNoInvitations();

  // Added with a name, and with the email alone.
  await invitations.add("gina@example.org", "Gina Guest");
  await invitations.expectAdded("gina@example.org");
  await invitations.add("hana@example.org");
  await invitations.expectAdded("hana@example.org");
  await invitations.expectInvited([
    "Gina Guest - gina@example.org",
    "hana@example.org",
  ]);

  // A missing or invalid address is refused by the field, and nothing is added.
  await invitations.add("");
  await invitations.expectRefused({ _tag: "InvitedEmailInvalid" });
  await invitations.add("gina@example");
  await invitations.expectRefused({ _tag: "InvitedEmailInvalid" });

  // The same address again, in another case, is refused by the server.
  await invitations.add("Gina@Example.org");
  await invitations.expectRefused({
    _tag: "AlreadyInvited",
    email: "Gina@Example.org",
  });
  await invitations.expectInvited([
    "Gina Guest - gina@example.org",
    "hana@example.org",
  ]);

  // The list is kept: it is there when the event is opened again.
  await editor.reload();
  await invitations.expectInvited([
    "Gina Guest - gina@example.org",
    "hana@example.org",
  ]);

  // Only signed-in users can read the list.
  const stranger = await visitor(browser);
  expect(await new EventPage(stranger).invitationsStatus(event.id)).toBe(401);

  await cleanUp(alice, team, event.id);
});

test("an event not published yet has the section too (SIGN-15 AC-1)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Draft"));
  const id = await new EventsColumn(alice).newEvent();
  const invitations = new Invitations(alice);

  await invitations.expectHint();
  await invitations.add("gina@example.org");
  await invitations.expectAdded("gina@example.org");

  await cleanUp(alice, team, id);
});
