import { cleanUp } from "../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName } from "../fixtures/support.ts";
import { test } from "../fixtures/test.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { EventsColumn } from "../pom/studio/EventsColumn.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

test("two users edit an event live, publish it and delete it", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const bob = await signedIn(browser, "bob@example.com");
  const editor = new EventEditor(alice);
  const bobsEditor = new EventEditor(bob);

  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Collaboration"),
  );
  const id = await new EventsColumn(alice).newEvent();
  await bobsEditor.goto(team, id);

  await editor.title.type("Hello from Alice");
  await bobsEditor.title.expectText("Hello from Alice");

  await bobsEditor.body.type("Bob writes");
  await editor.body.expectText("Bob writes");

  // Both type into the body at the same time.
  await Promise.all([
    editor.body.typeAt("end", " and Alice adds"),
    bobsEditor.body.typeAt("start", "First, "),
  ]);
  await editor.body.expectText("First, Bob writes and Alice adds");
  await bobsEditor.body.expectText("First, Bob writes and Alice adds");

  // Alice sets the times; Bob sees them too.
  const date = await editor.times.pick();
  await bobsEditor.times.expectStartDate(date);
  await bobsEditor.times.expectStartTime("18:00");
  await bobsEditor.times.expectEndTime("20:00");

  await editor.writePlace();
  await editor.publish();

  await new TeamsColumn(bob).goto(team);
  const events = new EventsColumn(bob);
  await events.expectRow(EventEditor.path(team, id), "Hello from Alice");
  await events.expectRow(EventEditor.path(team, id), "Published");

  // Bob has the event open when Alice deletes it.
  await bobsEditor.goto(team, id);
  await bobsEditor.title.expectText("Hello from Alice");
  await editor.delete(id);
  await bobsEditor.expectDeletedMessage();
  await new TeamsColumn(alice).delete(team);
});

test("publishing needs a title, times that make sense and a place", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Untitled"));
  const id = await new EventsColumn(alice).newEvent();
  const editor = new EventEditor(alice);
  await editor.body.type("No title here");
  await editor.clickPublish();
  await editor.expectRefused(
    "Add a title, a start time, an end time and a place before publishing",
  );

  await editor.title.type("Titled");
  await editor.clickPublish();
  await editor.expectRefused(
    "Add a start time, an end time and a place before publishing",
  );

  await editor.times.pick();
  await editor.clickPublish();
  await editor.expectRefused("Add a place before publishing");

  await editor.writePlace();
  await editor.times.fillEndTime("17:00");
  await editor.clickPublish();
  await editor.expectRefused("The event has to end after it starts");
  await editor.expectStatus("Not published");

  await cleanUp(alice, team, id);
});

test("an event can be set to repeat, and still repeats after a reload", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Repeating"));
  const id = await new EventsColumn(alice).newEvent();
  const editor = new EventEditor(alice);
  await editor.repeat.expect(null);

  await editor.repeat.check();
  await editor.repeat.selectEvery("2");
  await editor.repeat.expectChoices(
    ["1", "2", "3", "4", "5", "6", "7"],
    ["days", "weeks", "months", "years"],
  );
  await editor.repeat.selectUnit("week");
  await editor.expectSaved();

  await editor.reload();
  await editor.repeat.expect({ every: "2", unit: "week" });

  await editor.repeat.uncheck();
  await editor.repeat.expect(null);

  await cleanUp(alice, team, id);
});
