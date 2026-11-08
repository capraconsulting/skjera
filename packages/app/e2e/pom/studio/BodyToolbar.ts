import { expect, type Locator, type Page } from "@playwright/test";
import { imagesPath } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { ImagePicker } from "./ImagePicker.ts";

/**
 * The formatting toolbar of a rich text field, the body unless `field` names
 * another, and the dialogs it opens.
 */
export class BodyToolbar {
  private readonly page: Page;
  private readonly field: string;

  constructor(page: Page, field = "Body") {
    this.page = page;
    this.field = field;
  }

  private readonly button = (name: string) =>
    this.page
      .getByRole("toolbar", { name: `${this.field} formatting` })
      .getByRole("button", { name, exact: true });

  async clickBold(): Promise<void> {
    await this.page.getByRole("button", { name: m.editor_bold() }).click();
  }

  /** Links the selected text in the body to `address`. */
  async linkSelection(address: string): Promise<void> {
    await this.page
      .getByRole("button", { name: m.editor_link(), exact: true })
      .click();
    await this.page
      .getByRole("textbox", { name: m.editor_link_address() })
      .fill(address);
    await this.page.getByRole("button", { name: m.editor_add_link() }).click();
  }

  /**
   * Opens the link dialog for the selected text: "Add link" for text with no
   * link, "Edit link" for text with one.
   */
  async openLinkDialog(title: "Add link" | "Edit link"): Promise<LinkDialog> {
    await this.page
      .getByRole("button", { name: m.editor_link(), exact: true })
      .click();
    return new LinkDialog(this.page, title);
  }

  /** Opens the "Add image" dialog. */
  async openImageDialog(): Promise<ImageDialog> {
    await this.button("Image").click();
    return new ImageDialog(this.page, "Add image", "Add image");
  }

  /** Opens the dialog describing the selected image in the body. */
  async openDescribeImageDialog(): Promise<ImageDialog> {
    await this.button("Alt text: describe the image").click();
    return new ImageDialog(this.page, "Describe image", "Save");
  }
}

/** A dialog about an image in the body: adding one, or describing it. */
export class ImageDialog {
  private readonly page: Page;
  private readonly dialog: Locator;
  private readonly confirm: string;

  constructor(page: Page, name: string, confirm: string) {
    this.page = page;
    this.dialog = page.getByRole("dialog", { name });
    this.confirm = confirm;
  }

  private readonly pickExisting = () =>
    this.dialog.getByRole("button", {
      name: m.editor_existing_pick(),
      exact: true,
    });

  async expectCanPickExisting(): Promise<void> {
    await expect(this.pickExisting()).toBeVisible();
  }

  /** Opens the list of images already in Skjera, beside this dialog. */
  async openPicker(): Promise<ImagePicker> {
    await this.pickExisting().click();
    const picker = new ImagePicker(this.page);
    await picker.expectOpen();
    return picker;
  }

  /** The image picked from the list is the one this dialog will add. */
  async expectPicked(src: string): Promise<void> {
    await expect(
      this.dialog.locator(`img[src^="${imagesPath}/"]`),
    ).toHaveAttribute("src", src);
  }

  async chooseFile(file: {
    readonly name: string;
    readonly mimeType: string;
    readonly buffer: Buffer;
  }): Promise<void> {
    await this.dialog.getByLabel(m.editor_image_file()).setInputFiles(file);
  }

  async fillDescription(text: string): Promise<void> {
    await this.dialog
      .getByRole("textbox", { name: m.editor_description() })
      .fill(text);
  }

  async fillCaption(text: string): Promise<void> {
    await this.dialog
      .getByRole("textbox", { name: m.editor_caption() })
      .fill(text);
  }

  /** Picks a placement by its name, e.g. "Float left". */
  async choosePlacement(name: string): Promise<void> {
    await this.dialog
      .getByRole("combobox", { name: m.editor_placement() })
      .selectOption({ label: name });
  }

  /** Picks a size by its name, e.g. "Small". */
  async chooseSize(name: string): Promise<void> {
    await this.dialog
      .getByRole("combobox", { name: m.editor_size() })
      .selectOption({ label: name });
  }

  /** The dialog shows these choices, by the values of its fields (e.g. "left"). */
  async expectChoices(choices: {
    readonly placement: string;
    readonly size: string;
    readonly caption: string;
  }): Promise<void> {
    await expect(
      this.dialog.getByRole("combobox", { name: m.editor_placement() }),
    ).toHaveValue(choices.placement);
    await expect(
      this.dialog.getByRole("combobox", { name: m.editor_size() }),
    ).toHaveValue(choices.size);
    await expect(
      this.dialog.getByRole("textbox", { name: m.editor_caption() }),
    ).toHaveValue(choices.caption);
  }

  async cancel(): Promise<void> {
    await this.dialog.getByRole("button", { name: m.common_cancel() }).click();
  }

  async expectNoChoices(): Promise<void> {
    await expect(
      this.dialog.getByRole("textbox", { name: m.editor_caption() }),
    ).toHaveCount(0);
    await expect(
      this.dialog.getByRole("combobox", { name: m.editor_placement() }),
    ).toHaveCount(0);
    await expect(
      this.dialog.getByRole("combobox", { name: m.editor_size() }),
    ).toHaveCount(0);
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

/** The dialog that asks where a link goes: adding one, or editing it. */
export class LinkDialog {
  private readonly dialog: Locator;
  private readonly confirm: string;

  constructor(page: Page, title: "Add link" | "Edit link") {
    this.dialog = page.getByRole("dialog", { name: title });
    this.confirm = title === "Add link" ? "Add link" : "Save link";
  }

  private readonly address = () =>
    this.dialog.getByRole("textbox", { name: m.editor_link_address() });

  async fillAddress(address: string): Promise<void> {
    await this.address().fill(address);
  }

  async expectAddress(address: string): Promise<void> {
    await expect(this.address()).toHaveValue(address);
  }

  /** Clicks «Add link», or «Save link» when editing. */
  async clickConfirm(): Promise<void> {
    await this.dialog.getByRole("button", { name: this.confirm }).click();
  }

  async clickRemove(): Promise<void> {
    await this.dialog
      .getByRole("button", { name: m.editor_remove_link() })
      .click();
  }

  async expectError(text: string): Promise<void> {
    await expect(this.dialog.getByRole("alert")).toHaveText(text);
  }

  async expectClosed(): Promise<void> {
    await expect(this.dialog).toBeHidden();
  }
}
