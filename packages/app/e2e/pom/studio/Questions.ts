import { expect, type Page } from "@playwright/test";

/** The questions the event asks those signing up, numbered from 1. */
export class Questions {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly question = (n: number) =>
    this.page.getByRole("textbox", { name: `Question ${n}`, exact: true });
  private readonly label = (n: number) =>
    this.page.getByRole("textbox", {
      name: `Question ${n} answer option`,
      exact: true,
    });
  private readonly type = (n: number) =>
    this.page.getByRole("combobox", { name: `Question ${n} type` });
  private readonly item = (n: number) =>
    this.page.getByRole("listitem").filter({ has: this.type(n) });

  /** Adds question `n`, of a type unless it's a written answer. */
  async add(
    n: number,
    text: string,
    type?: "Checkbox" | "One of several",
  ): Promise<void> {
    await this.page.getByRole("button", { name: "Add question" }).click();
    if (type !== undefined) await this.type(n).selectOption(type);
    await this.question(n).fill(text);
  }

  async fillOption(n: number, option: number, text: string): Promise<void> {
    await this.page
      .getByRole("textbox", { name: `Question ${n} option ${option}` })
      .fill(text);
  }

  /** Fills in a checkbox question's "Answer option". */
  async fillLabel(n: number, text: string): Promise<void> {
    await this.label(n).fill(text);
  }

  /** Ticks a question's "Must be ticked" or "Required". */
  async checkRule(
    n: number,
    rule: "Must be ticked" | "Required",
  ): Promise<void> {
    await this.item(n).getByRole("checkbox", { name: rule }).check();
  }

  async moveUp(n: number): Promise<void> {
    await this.page
      .getByRole("button", { name: `Move question ${n} up` })
      .click();
  }

  async expect(n: number, text: string): Promise<void> {
    await expect(this.question(n)).toHaveValue(text);
  }

  async expectLabel(n: number, text: string): Promise<void> {
    await expect(this.label(n)).toHaveValue(text);
  }

  /** Question `n` has no "Answer option": it is not a checkbox. */
  async expectNoLabel(n: number): Promise<void> {
    await expect(this.label(n)).toHaveCount(0);
  }
}
