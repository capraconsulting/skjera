import { expect, type Page } from "@playwright/test";

/** Who else has the event open: their avatars over the editor. */
export class Presence {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly avatars = () =>
    this.page.getByRole("region", { name: "Editor" }).getByTestId("avatar");

  /** Someone else here, by their avatar's name. */
  async expectOthersHere(name: string): Promise<void> {
    await expect(this.avatars()).toHaveAccessibleName(name);
  }

  /** This many avatars are shown: one for each person here. */
  async expectAvatarCount(count: number): Promise<void> {
    await expect(this.avatars()).toHaveCount(count);
  }

  async expectNobodyElse(): Promise<void> {
    await expect(this.avatars()).toHaveCount(0);
  }

  /** Hovering an avatar shows the name, hidden before. */
  async hoverAvatarShowing(name: string): Promise<void> {
    const shown = this.avatars().getByText(name);
    await expect(shown).toBeHidden();
    await this.avatars().hover();
    await expect(shown).toBeVisible();
  }
}
