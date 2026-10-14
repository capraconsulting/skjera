import { expect, type Page } from "@playwright/test";

/** The editor's tags field, with its suggestions and the tags added. */
export class TagInput {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly input = () =>
    this.page.getByRole("combobox", { name: "Tags" });
  private readonly pills = () =>
    this.page.getByRole("list", { name: "Tags on this event" });

  async fill(text: string): Promise<void> {
    await this.input().fill(text);
  }

  async add(tag: string): Promise<void> {
    await this.fill(tag);
    await this.input().press("Enter");
  }

  /** Done tagging: the suggestions close. */
  async close(): Promise<void> {
    await this.input().press("Escape");
  }

  async expectSuggestion(name: string): Promise<void> {
    await expect(this.page.getByRole("option", { name })).toBeVisible();
  }

  async pickSuggestion(name: string): Promise<void> {
    await this.page.getByRole("option", { name }).click();
  }

  async remove(tag: string): Promise<void> {
    await this.page.getByRole("button", { name: `Remove tag ${tag}` }).click();
  }

  async expectTag(tag: string): Promise<void> {
    await expect(this.pills()).toContainText(tag);
  }

  async expectTags(tags: ReadonlyArray<RegExp>): Promise<void> {
    await expect(this.pills().getByRole("listitem")).toHaveText([...tags]);
  }

  async expectNone(): Promise<void> {
    await expect(this.pills()).toHaveCount(0);
  }
}
