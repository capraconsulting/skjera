import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";

/** A spreadsheet of the attendees, as downloaded. */
export interface AttendeesCsv {
  readonly filename: string;
  /** Its lines: the header, then a line per attendee. */
  readonly lines: ReadonlyArray<string>;
}

/**
 * The studio's list of who signed up for the open event, and what they
 * can't eat.
 */
export class Attendees {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly region = () =>
    this.page.getByRole("region", { name: "Attendees" });
  private readonly row = (name: string) =>
    this.region().getByRole("listitem").filter({ hasText: name });
  private readonly dietary = () =>
    this.page.getByRole("region", { name: "Dietary preferences" });

  /** How many are signed up, as the heading says. */
  async count(): Promise<number> {
    const heading = this.region().getByRole("heading", {
      name: /^Attendees \(\d+\)$/,
    });
    return Number(/\d+/.exec((await heading.textContent()) ?? "")?.[0]);
  }

  async expectText(text: string): Promise<void> {
    await expect(this.region()).toContainText(text);
  }

  async expectNoText(text: string): Promise<void> {
    await expect(this.region()).not.toContainText(text);
  }

  async expectEmpty(): Promise<void> {
    await this.expectText("Nobody has signed up yet.");
  }

  /** The row of the attendee called `name` says `text`. */
  async expectRow(name: string, text: string): Promise<void> {
    await expect(this.row(name)).toContainText(text);
  }

  /** The answer to `question`, of the attendee called `name` if given. */
  async expectAnswer(
    question: string,
    answer: string,
    name?: string,
  ): Promise<void> {
    const within = name === undefined ? this.region() : this.row(name);
    await expect(
      within.getByRole("term").filter({ hasText: question }).locator("+ dd"),
    ).toHaveText(answer);
  }

  async downloadCsv(): Promise<AttendeesCsv> {
    const downloading = this.page.waitForEvent("download");
    await this.region().getByRole("button", { name: "Download CSV" }).click();
    const file = await downloading;
    const lines = (await readFile((await file.path()) ?? "", "utf8"))
      .trim()
      .split(/\r?\n/);
    return { filename: file.suggestedFilename(), lines };
  }

  /** Takes the attendee called `name` off, saying yes when asked. */
  async remove(name: string): Promise<void> {
    this.page.once("dialog", (dialog) => dialog.accept());
    await this.region()
      .getByRole("button", { name: `Remove ${name}` })
      .click();
  }

  /** What people can't eat: how many said, and what, without names. */
  async expectDietaryPreferences(items: ReadonlyArray<string>): Promise<void> {
    await expect(
      this.dietary().getByRole("heading", {
        name: `Dietary preferences (${items.length})`,
      }),
    ).toBeVisible();
    await expect(this.dietary().getByRole("listitem")).toHaveText([...items]);
  }

  async expectDietaryPreferencesWithout(text: string): Promise<void> {
    await expect(this.dietary()).not.toContainText(text);
  }
}
