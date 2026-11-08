import { expect, type Locator, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";
import { dropPng, pixel } from "../images.ts";
import { TextField } from "../TextField.ts";
import { ImagePicker } from "./ImagePicker.ts";

/** The event's cover image, and its description. */
export class Cover {
  private readonly page: Page;
  readonly description: TextField;

  constructor(page: Page) {
    this.page = page;
    this.description = new TextField(
      page.getByRole("textbox", { name: m.editor_cover_description() }),
    );
  }

  private readonly preview = () =>
    this.page.getByRole("img", { name: m.editor_cover_alt() });

  async chooseFile(image: Buffer = pixel): Promise<void> {
    await this.page.getByLabel(m.editor_cover_file()).setInputFiles({
      name: "picture.png",
      mimeType: "image/png",
      buffer: image,
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

  private readonly pickExisting = () =>
    this.page.getByRole("button", {
      name: m.editor_existing_pick(),
      exact: true,
    });

  async expectCanPickExisting(): Promise<void> {
    await expect(this.pickExisting()).toBeVisible();
  }

  /** Opens the list of images already in Skjera. */
  async openPicker(): Promise<ImagePicker> {
    await this.pickExisting().click();
    const picker = new ImagePicker(this.page);
    await picker.expectOpen();
    return picker;
  }

  private readonly reset = () =>
    this.page.getByRole("button", { name: m.editor_cover_reset() });

  /**
   * Crops to the part between two points of the picture, each as a share of
   * its width and height, and applies it.
   */
  async crop(
    from: { readonly x: number; readonly y: number },
    to: { readonly x: number; readonly y: number },
  ): Promise<void> {
    await this.page
      .getByRole("button", { name: m.editor_cover_crop(), exact: true })
      .click();
    await this.drag(this.page.getByTestId("crop-picture"), from, to);
    await this.page
      .getByRole("button", { name: m.editor_cover_apply() })
      .click();
  }

  /** Sets the focal point to a point of the picture shown, and applies it. */
  async setFocalPoint(at: { readonly x: number; readonly y: number }) {
    await this.page
      .getByRole("button", { name: m.editor_cover_focus(), exact: true })
      .click();
    const picture = this.page.getByTestId("focus-picture");
    const box = await picture.boundingBox();
    expect(box, "the picture is shown").not.toBeNull();
    await picture.click({
      position: { x: (box?.width ?? 0) * at.x, y: (box?.height ?? 0) * at.y },
    });
    await this.page
      .getByRole("button", { name: m.editor_cover_apply() })
      .click();
  }

  private async drag(
    picture: Locator,
    from: { readonly x: number; readonly y: number },
    to: { readonly x: number; readonly y: number },
  ): Promise<void> {
    const box = await picture.boundingBox();
    expect(box, "the picture is shown").not.toBeNull();
    const { x, y, width, height } = box ?? { x: 0, y: 0, width: 0, height: 0 };
    await this.page.mouse.move(x + width * from.x, y + height * from.y);
    await this.page.mouse.down();
    await this.page.mouse.move(x + width * to.x, y + height * to.y, {
      steps: 5,
    });
    await this.page.mouse.up();
  }

  async resetCropAndFocus(): Promise<void> {
    await this.reset().click();
  }

  async expectCanReset(): Promise<void> {
    await expect(this.reset()).toBeVisible();
  }

  async expectCannotReset(): Promise<void> {
    await expect(this.reset()).toHaveCount(0);
  }

  /** The picture in the field is about as wide as it is high. */
  async expectAboutSquare(): Promise<void> {
    await expect
      .poll(async () =>
        this.preview().evaluate((image: HTMLImageElement) =>
          image.naturalHeight === 0
            ? 0
            : image.naturalWidth / image.naturalHeight,
        ),
      )
      .toBeCloseTo(1, 0);
  }

  async remove(): Promise<void> {
    await this.page
      .getByRole("button", { name: m.editor_cover_remove() })
      .click();
  }

  /** No cover, and no description for one. */
  async expectNone(): Promise<void> {
    await expect(this.preview()).toHaveCount(0);
    await this.description.expectAbsent();
  }
}
