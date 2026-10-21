import { expect, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";
import type { Locale } from "@skjera/i18n/runtime";

/** The editor's tags field, with its suggestions and the tags added. */
export class TagInput {
  private readonly page: Page;
  /** The language the field is read in. */
  private readonly locale: Locale;

  constructor(page: Page, locale: Locale = "en") {
    this.page = page;
    this.locale = locale;
  }

  private readonly input = () =>
    this.page.getByRole("combobox", {
      name: m.site_tags({}, { locale: this.locale }),
    });
  private readonly pills = () =>
    this.page.getByRole("list", {
      name: m.editor_tags_on_event({}, { locale: this.locale }),
    });

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
    await this.page
      .getByRole("button", {
        name: m.editor_remove_tag({ tag }, { locale: this.locale }),
      })
      .click();
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
