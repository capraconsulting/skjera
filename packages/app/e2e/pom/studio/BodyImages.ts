import { expect, type Page } from "@playwright/test";
import { imagesPath } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { dropPng, pastePng } from "../images.ts";

/** The images in the event's body. */
export class BodyImages {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly body = () =>
    this.page.getByRole("textbox", { name: m.studio_body() });
  /** Undescribed images have no img role: these are found by address. */
  private readonly all = () =>
    this.body().locator(`img[src^="${imagesPath}/"]`);
  private readonly image = (name: string) =>
    this.body().getByRole("img", { name });

  /** Pastes the PNG where the caret is. */
  async paste(): Promise<void> {
    await pastePng(this.body());
  }

  /** Drops the PNG onto the middle of the body. */
  async drop(): Promise<void> {
    await dropPng(this.body());
  }

  async expectCount(count: number): Promise<void> {
    await expect(this.all()).toHaveCount(count);
  }

  async expectAddresses(pattern: RegExp): Promise<void> {
    await expect(this.all()).toHaveAttribute("src", pattern);
  }

  /** A described image, by its description. */
  async expect(name: string): Promise<void> {
    await expect(this.image(name)).toBeVisible();
  }

  /** Selects a described image, as clicking it does. */
  async select(name: string): Promise<void> {
    await this.image(name).click();
  }

  async src(name: string): Promise<string> {
    return (await this.image(name).getAttribute("src")) ?? "";
  }
}
