import type { Page } from "@playwright/test";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

/** Deletes a test's events, each from its editor, and then their team. */
export const cleanUp = async (
  page: Page,
  team: string,
  ...events: ReadonlyArray<string>
): Promise<void> => {
  const editor = new EventEditor(page);
  for (const event of events) {
    await editor.goto(team, event);
    await editor.delete(event);
  }
  await new TeamsColumn(page).delete(team);
};
