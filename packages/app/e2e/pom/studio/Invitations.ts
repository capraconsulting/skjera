import { expect, type Page } from "@playwright/test";
import { describe, type Problem } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";

/** The studio's list of who was noted as invited to the open event. */
export class Invitations {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly region = () =>
    this.page.getByRole("region", { name: m.studio_invitations() });
  private readonly nameInput = () =>
    this.region().getByRole("textbox", { name: m.studio_invitation_name() });
  private readonly emailInput = () =>
    this.region().getByRole("textbox", {
      name: m.studio_invitation_email(),
      exact: true,
    });

  /** The section says it only records who was invited. */
  async expectHint(): Promise<void> {
    await expect(this.region()).toContainText(m.studio_invitations_hint());
  }

  /** Adds someone: the name is optional. */
  async add(email: string, name?: string): Promise<void> {
    if (name !== undefined) await this.nameInput().fill(name);
    await this.emailInput().fill(email);
    await this.region()
      .getByRole("button", { name: m.studio_invitation_add() })
      .click();
  }

  /** The confirmation of an addition, and both inputs emptied. */
  async expectAdded(email: string): Promise<void> {
    await expect(this.region().getByRole("status")).toHaveText(
      m.studio_invitation_added({ email }),
    );
    await expect(this.nameInput()).toHaveValue("");
    await expect(this.emailInput()).toHaveValue("");
  }

  /** The email input is refused with what `problem` says, as its description. */
  async expectRefused(problem: Problem): Promise<void> {
    await expect(this.emailInput()).toHaveAccessibleDescription(
      describe(problem),
    );
  }

  /** Those invited, as rows, under a heading that counts them. */
  async expectInvited(rows: ReadonlyArray<string>): Promise<void> {
    await expect(
      this.region().getByRole("heading", {
        name: m.studio_invitations_count({ count: rows.length }),
      }),
    ).toBeVisible();
    await expect(this.region().getByRole("listitem")).toHaveText([...rows]);
  }

  /** Nobody has been noted as invited. */
  async expectNoInvitations(): Promise<void> {
    await expect(this.region()).toContainText(m.studio_invitations_none());
    await expect(this.region().getByRole("listitem")).toHaveCount(0);
  }
}
