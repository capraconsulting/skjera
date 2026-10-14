import { expect, type Locator, type Page } from "@playwright/test";

/** The body's formatting toolbar, and the dialogs it opens. */
export class BodyToolbar {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly button = (name: string) =>
    this.page
      .getByRole("toolbar", { name: "Body formatting" })
      .getByRole("button", { name, exact: true });

  async clickBold(): Promise<void> {
    await this.page.getByRole("button", { name: "Bold" }).click();
  }

  /** Links the selected text in the body to `address`. */
  async linkSelection(address: string): Promise<void> {
    await this.page.getByRole("button", { name: "Link", exact: true }).click();
    await this.page
      .getByRole("textbox", { name: "Link address" })
      .fill(address);
    await this.page.getByRole("button", { name: "Add link" }).click();
  }

  /** Opens the "Add image" dialog. */
  async openImageDialog(): Promise<ImageDialog> {
    await this.button("Image").click();
    return new ImageDialog(this.page, "Add image", "Add image");
  }

  /** Opens the dialog describing the selected image in the body. */
  async openDescribeImageDialog(): Promise<ImageDialog> {
    await this.button("Describe image").click();
    return new ImageDialog(this.page, "Describe image", "Save");
  }
}

/** A dialog about an image in the body: adding one, or describing it. */
export class ImageDialog {
  private readonly dialog: Locator;
  private readonly confirm: string;

  constructor(page: Page, name: string, confirm: string) {
    this.dialog = page.getByRole("dialog", { name });
    this.confirm = confirm;
  }

  async chooseFile(file: {
    readonly name: string;
    readonly mimeType: string;
    readonly buffer: Buffer;
  }): Promise<void> {
    await this.dialog.getByLabel("Image file").setInputFiles(file);
  }

  async fillDescription(text: string): Promise<void> {
    await this.dialog.getByRole("textbox", { name: "Description" }).fill(text);
  }

  async clickConfirm(): Promise<void> {
    await this.dialog.getByRole("button", { name: this.confirm }).click();
  }

  async expectError(text: string): Promise<void> {
    await expect(this.dialog.getByRole("alert")).toHaveText(text);
  }

  async expectClosed(): Promise<void> {
    await expect(this.dialog).toBeHidden();
  }
}
