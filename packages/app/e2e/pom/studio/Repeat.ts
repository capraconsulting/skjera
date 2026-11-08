import { expect, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";

/** Whether the event repeats, and how often. */
export class Repeat {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly repeats = () =>
    this.page.getByRole("checkbox", { name: /The event repeats/ });
  private readonly every = () =>
    this.page.getByRole("combobox", { name: m.studio_repeat_every() });
  private readonly unit = () =>
    this.page.getByRole("combobox", { name: m.studio_repeat_unit() });

  async check(): Promise<void> {
    await this.repeats().check();
  }

  async uncheck(): Promise<void> {
    await this.repeats().uncheck();
  }

  async selectEvery(every: string): Promise<void> {
    await this.every().selectOption(every);
  }

  async selectUnit(unit: "day" | "week" | "month" | "year"): Promise<void> {
    await this.unit().selectOption(unit);
  }

  async expectChoices(
    every: ReadonlyArray<string>,
    units: ReadonlyArray<string>,
  ): Promise<void> {
    await expect(this.every().locator("option")).toHaveText([...every]);
    await expect(this.unit().locator("option")).toHaveText([...units]);
  }

  /** Repeats every `every` `unit`s, or doesn't repeat (`null`). */
  async expect(
    repeat: { readonly every: string; readonly unit: string } | null,
  ): Promise<void> {
    if (repeat === null) {
      await expect(this.every()).toHaveCount(0);
      await expect(this.unit()).toHaveCount(0);
      return;
    }
    await expect(this.repeats()).toBeChecked();
    await expect(this.every()).toHaveValue(repeat.every);
    await expect(this.unit()).toHaveValue(repeat.unit);
  }
}
