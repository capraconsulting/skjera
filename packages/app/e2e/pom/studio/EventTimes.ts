import { expect, type Page } from "@playwright/test";

/** 1 as "1st", 14 as "14th": how the calendar names its days. */
const ordinal = (day: number): string => {
  const suffixes = ["th", "st", "nd", "rd"];
  const rest = day % 100;
  return `${day}${suffixes[(rest - 20) % 10] ?? suffixes[rest] ?? suffixes[0]}`;
};

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
    // Exact: the food deadline's date and time have these words in theirs.
    await this.page
      .getByRole("button", { name: "Deadline date", exact: true })
      .click();
    await this.page
      .getByRole("button", { name: /1st, \d{4}/ })
      .first()
      .click();
    await this.page.getByLabel("Deadline time", { exact: true }).fill("00:00");
  }

  private readonly foodDate = () =>
    this.page.getByRole("button", { name: "Food deadline date" });

  /**
   * Picks `day` under the food deadline. The calendar keeps the month it last
   * showed, so it is moved `towards` the day's month until the day shows.
   */
  async pickFoodDeadline(
    day: Date,
    towards: "next" | "previous",
  ): Promise<void> {
    const month = day.toLocaleDateString("en-US", { month: "long" });
    const target = this.page.getByRole("button", {
      name: new RegExp(
        `${month} ${ordinal(day.getDate())}, ${day.getFullYear()}`,
      ),
    });
    await this.foodDate().click();
    const move = this.page.getByRole("button", {
      name: towards === "next" ? /next month/i : /previous month/i,
    });
    for (let step = 0; step < 3 && (await target.count()) === 0; step++) {
      await move.click();
    }
    await target.click();
  }

  /** Sets the food deadline to midnight on the 1st of this month, which has passed. */
  async setPassedFoodDeadline(towards: "next" | "previous"): Promise<void> {
    const now = new Date();
    await this.pickFoodDeadline(
      new Date(now.getFullYear(), now.getMonth(), 1),
      towards,
    );
    await this.page.getByLabel("Food deadline time").fill("00:00");
  }

  async expectFoodDeadline(shown: string, time: string): Promise<void> {
    await expect(this.foodDate()).toHaveText(shown);
    await expect(this.page.getByLabel("Food deadline time")).toHaveValue(time);
  }

  async clearFoodDeadline(): Promise<void> {
    await this.page
      .getByRole("button", { name: "Clear food deadline" })
      .click();
  }

  async expectNoFoodDeadline(): Promise<void> {
    await expect(this.foodDate()).toHaveText("Pick a date");
    await expect(this.page.getByLabel("Food deadline time")).toHaveValue("");
    await expect(
      this.page.getByRole("button", { name: "Clear food deadline" }),
    ).toHaveCount(0);
  }

  async selectTimeZone(zone: string): Promise<void> {
    await this.page
      .getByRole("combobox", { name: "Time zone" })
      .selectOption(zone);
  }
}
