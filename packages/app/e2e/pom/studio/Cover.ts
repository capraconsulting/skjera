import { expect, type Page } from "@playwright/test";
import { dropPng } from "../images.ts";
import { pixel } from "../support.ts";
import { TextField } from "../TextField.ts";

/** The event's cover image, and its description. */
export class Cover {
  private readonly page: Page;
  readonly description: TextField;

  constructor(page: Page) {
    this.page = page;
    this.description = new TextField(
      page.getByRole("textbox", { name: "Cover description" }),
    );
  }

  private readonly preview = () =>
    this.page.getByRole("img", { name: "Cover" });

  async chooseFile(): Promise<void> {
    await this.page.getByLabel("Cover image file").setInputFiles({
      name: "pixel.png",
      mimeType: "image/png",
      buffer: pixel,
    });
  }

  /** Drops the PNG onto the cover's place. */
  async drop(): Promise<void> {
    await dropPng(this.page.getByTestId("cover-drop"));
  }

  async src(): Promise<string> {
    return (await this.preview().getAttribute("src")) ?? "";
  }

  async expect(src: string | RegExp): Promise<void> {
    await expect(this.preview()).toHaveAttribute("src", src);
  }

  async expectNot(src: string): Promise<void> {
    await expect(this.preview()).not.toHaveAttribute("src", src);
  }

  async remove(): Promise<void> {
    await this.page.getByRole("button", { name: "Remove cover image" }).click();
  }

  /** No cover, and no description for one. */
  async expectNone(): Promise<void> {
    await expect(this.preview()).toHaveCount(0);
    await this.description.expectAbsent();
  }
}
