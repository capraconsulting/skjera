import { expect, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";

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
    this.page.getByRole("button", { name: m.editor_start_date() });

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
    const now = new Date();
    await this.pickCalendarDay(
      new Date(now.getFullYear(), now.getMonth() - 1, 15),
      "previous",
    );
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
    await this.page.getByLabel(m.editor_start_time()).fill(time);
  }

  async expectStartTime(time: string): Promise<void> {
    await expect(this.page.getByLabel(m.editor_start_time())).toHaveValue(time);
  }

  async fillEndTime(time: string): Promise<void> {
    await this.page.getByLabel(m.editor_end_time()).fill(time);
  }

  async expectEndTime(time: string): Promise<void> {
    await expect(this.page.getByLabel(m.editor_end_time())).toHaveValue(time);
  }

  /** Sets a sign-up deadline at midnight on the 1st of last month. */
  async setPassedDeadline(): Promise<void> {
    // Exact: the food deadline's date and time have these words in theirs.
    const date = this.page.getByRole("button", {
      name: m.editor_deadline_date(),
      exact: true,
    });
    await date.click();
    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    await this.pickCalendarDay(day, "previous");
    await expect(date).toHaveText(
      day.toLocaleDateString("en-US", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    );
    await this.page
      .getByLabel(m.editor_deadline_time(), { exact: true })
      .fill("00:00");
  }

  private readonly foodDate = () =>
    this.page.getByRole("button", { name: m.editor_food_deadline_date() });

  /**
   * Picks `day` under the food deadline. The calendar keeps the month it last
   * showed, so it is moved `towards` the day's month until the day shows.
   */
  async pickFoodDeadline(
    day: Date,
    towards: "next" | "previous",
  ): Promise<void> {
    await this.foodDate().click();
    await this.pickCalendarDay(day, towards);
  }

  private async pickCalendarDay(
    day: Date,
    towards: "next" | "previous",
  ): Promise<void> {
    const month = day.toLocaleDateString("en-US", { month: "long" });
    const target = this.page.getByRole("button", {
      name: new RegExp(
        `${month} ${ordinal(day.getDate())}, ${day.getFullYear()}`,
      ),
    });
    const move = this.page.getByRole("button", {
      name: towards === "next" ? /next month/i : /previous month/i,
    });
    for (let step = 0; step < 3 && (await target.count()) === 0; step++) {
      await move.click();
    }
    await target.click();
  }

  /** Sets the food deadline to the same past day as setPassedDeadline. */
  async setPassedFoodDeadline(towards: "next" | "previous"): Promise<void> {
    const now = new Date();
    await this.pickFoodDeadline(
      new Date(now.getFullYear(), now.getMonth() - 1, 1),
      towards,
    );
    await this.page.getByLabel(m.editor_food_deadline_time()).fill("00:00");
  }

  async expectFoodDeadline(shown: string, time: string): Promise<void> {
    await expect(this.foodDate()).toHaveText(shown);
    await expect(
      this.page.getByLabel(m.editor_food_deadline_time()),
    ).toHaveValue(time);
  }

  async clearFoodDeadline(): Promise<void> {
    await this.page
      .getByRole("button", { name: m.editor_food_deadline_clear() })
      .click();
  }

  async expectNoFoodDeadline(): Promise<void> {
    await expect(this.foodDate()).toHaveText(m.editor_pick_date());
    await expect(
      this.page.getByLabel(m.editor_food_deadline_time()),
    ).toHaveValue("");
    await expect(
      this.page.getByRole("button", { name: m.editor_food_deadline_clear() }),
    ).toHaveCount(0);
  }

  async selectTimeZone(zone: string): Promise<void> {
    await this.page
      .getByRole("combobox", { name: m.editor_time_zone() })
      .selectOption(zone);
  }
}
