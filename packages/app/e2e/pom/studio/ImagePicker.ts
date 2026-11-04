import { expect, type Locator, type Page } from "@playwright/test";

/** The list of images already in Skjera, as a dialog. */
export class ImagePicker {
  private readonly dialog: Locator;

  constructor(page: Page) {
    this.dialog = page.getByRole("dialog", { name: "Images in Skjera" });
  }

  private readonly pictures = () =>
    this.dialog.getByRole("button", { name: /^Image uploaded/ });

  async expectOpen(): Promise<void> {
    await expect(this.dialog).toBeVisible();
    await expect(this.pictures().first()).toBeVisible();
  }

  async expectClosed(): Promise<void> {
    await expect(this.dialog).toBeHidden();
  }

  /** Picks the image served at `src`. */
  async pick(src: string): Promise<void> {
    await this.dialog.locator(`button:has(img[src="${src}"])`).click();
  }

  async count(): Promise<number> {
    return await this.pictures().count();
  }

  /** Scrolls to the last picture shown, which asks for the next page. */
  async scrollToEnd(): Promise<void> {
    await this.pictures().last().scrollIntoViewIfNeeded();
  }

  /** Scrolls on until more pictures are shown than `count`. */
  async expectMoreThan(count: number): Promise<void> {
    await expect
      .poll(async () => {
        await this.scrollToEnd();
        return await this.count();
      })
      .toBeGreaterThan(count);
  }
}
