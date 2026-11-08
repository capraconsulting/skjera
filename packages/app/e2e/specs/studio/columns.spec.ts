import { dexUsers } from "@skjera/test";
import {
  defaultWidths,
  maxWidth,
} from "../../../src/routes/studio/lists/columnWidths.ts";
import { signedIn, uniqueTeamName } from "../../fixtures/support.ts";
import { test } from "../../fixtures/test.ts";
import { ColumnHandles } from "../../pom/studio/ColumnHandles.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

// The studio's root font size is 16px: 16rem is 256px.
const rem = 16;

test("the studio's columns are dragged wider, and stay so after a reload", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const teams = new TeamsColumn(alice);
  const columns = new ColumnHandles(alice);
  await teams.goto();

  // Without a team picked, there are no events to widen.
  await columns.expectHandle("teams");
  await columns.expectNoHandle("events");
  await columns.expectWidth("teams", defaultWidths.teams * rem);

  await columns.drag("teams", 4 * rem);
  await columns.expectWidth("teams", (defaultWidths.teams + 4) * rem);
  await alice.reload();
  await columns.expectWidth("teams", (defaultWidths.teams + 4) * rem);

  // Arrow keys move it a rem at a time, and a double click puts it back.
  await columns.press("teams", "ArrowLeft");
  await columns.expectWidth("teams", (defaultWidths.teams + 3) * rem);
  await columns.doubleClick("teams");
  await columns.expectWidth("teams", defaultWidths.teams * rem);

  // The events column has its own line once a team is picked.
  const team = await teams.create(uniqueTeamName("Wide"));
  await columns.expectHandle("events");
  await columns.drag("events", -4 * rem);
  await columns.expectWidth("events", (defaultWidths.events - 4) * rem);
  await columns.expectWidth("teams", defaultWidths.teams * rem);

  // No wider than 32rem, however far it is dragged.
  await columns.drag("teams", 40 * rem);
  await columns.expectWidth("teams", maxWidth * rem);

  await teams.delete(team);
});
