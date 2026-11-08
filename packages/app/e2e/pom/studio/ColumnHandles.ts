import { expect, type Locator, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";

type Column = "teams" | "events";

/** The lines between the studio's columns, that change their widths. */
export class ColumnHandles {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly handle = (column: Column): Locator =>
    this.page.getByRole("separator", {
      name:
        column === "teams" ? m.studio_resize_teams() : m.studio_resize_events(),
    });
  private readonly region = (column: Column): Locator =>
    this.page.getByRole("region", {
      name: column === "teams" ? m.studio_teams() : m.site_events(),
    });

  /** The column's width on screen, in pixels. */
  async width(column: Column): Promise<number> {
    const box = await this.region(column).boundingBox();
    if (box === null) throw new Error(`The ${column} column is not shown`);
    return box.width;
  }

  async expectWidth(column: Column, pixels: number): Promise<void> {
    await expect.poll(() => this.width(column)).toBeCloseTo(pixels, 0);
  }

  async expectHandle(column: Column): Promise<void> {
    await expect(this.handle(column)).toBeVisible();
  }

  async expectNoHandle(column: Column): Promise<void> {
    await expect(this.handle(column)).toHaveCount(0);
  }

  /** Drags the line on the column's right by `pixels`, right if positive. */
  async drag(column: Column, pixels: number): Promise<void> {
    const box = await this.handle(column).boundingBox();
    if (box === null) throw new Error(`No line for the ${column} column`);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.mouse.move(x + pixels / 2, y);
    await this.page.mouse.move(x + pixels, y);
    await this.page.mouse.up();
  }

  async press(column: Column, key: string): Promise<void> {
    await this.handle(column).focus();
    await this.page.keyboard.press(key);
  }

  async doubleClick(column: Column): Promise<void> {
    await this.handle(column).dblclick();
  }
}
