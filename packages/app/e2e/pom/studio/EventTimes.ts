import { expect, type Page } from "@playwright/test";

/** The editor's times: start and end, deadlines, and the time zone. */
export class EventTimes {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly startDate = () =>
    this.page.getByRole("button", { name: "Start date" });

  /**
   * Sets the event to start at 18:00 on the 15th of next month, so sign-up
   * is open; it ends two hours later. Returns the day as the site shows it
   * ("Sunday, November 15, 2026").
   */
  async pick(): Promise<string> {
    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth() + 1, 15);
    const month = day.toLocaleDateString("en-US", { month: "long" });
    await this.startDate().click();
    await this.page.getByRole("button", { name: /next month/i }).click();
    await this.page
      .getByRole("button", {
        name: new RegExp(`${month} 15th, ${day.getFullYear()}`),
      })
      .click();
    await this.fillStartTime("18:00");
    const shown = day.toLocaleDateString("en-US", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    await this.expectStartDate(shown);
    await this.expectStartTime("18:00");
    await this.expectEndTime("20:00");
    return shown;
  }

  /** Sets the event to start on the 15th of last month. */
  async pickPastStart(): Promise<void> {
    await this.startDate().click();
    await this.page.getByRole("button", { name: /previous month/i }).click();
    await this.page.getByRole("button", { name: /15th, \d{4}/ }).click();
  }

  /** Opens the start date's calendar, by its label in the page's language. */
  async openStartDate(label = "Start date"): Promise<void> {
    await this.page.getByRole("button", { name: label }).click();
  }

  async expectCalendarButton(name: RegExp): Promise<void> {
    await expect(this.page.getByRole("button", { name })).toBeVisible();
  }

  async closeCalendar(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }

  async expectStartDate(shown: string): Promise<void> {
    await expect(this.startDate()).toHaveText(shown);
  }

  async fillStartTime(time: string): Promise<void> {
    await this.page.getByLabel("Start time").fill(time);
  }

  async expectStartTime(time: string): Promise<void> {
    await expect(this.page.getByLabel("Start time")).toHaveValue(time);
  }

  async fillEndTime(time: string): Promise<void> {
    await this.page.getByLabel("End time").fill(time);
  }

  async expectEndTime(time: string): Promise<void> {
    await expect(this.page.getByLabel("End time")).toHaveValue(time);
  }

  /** Sets a sign-up deadline at midnight on the 1st, which has passed. */
  async setPassedDeadline(): Promise<void> {
    await this.page.getByRole("button", { name: "Deadline date" }).click();
    await this.page
      .getByRole("button", { name: /1st, \d{4}/ })
      .first()
      .click();
    await this.page.getByLabel("Deadline time").fill("00:00");
  }

  async selectTimeZone(zone: string): Promise<void> {
    await this.page
      .getByRole("combobox", { name: "Time zone" })
      .selectOption(zone);
  }
}
