import { expect, type Locator, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";
import { pixel } from "../images.ts";

/** The studio's teams column, with each team's menu and dialogs. */
export class TeamsColumn {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly region = () =>
    this.page.getByRole("region", { name: "Teams" });
  /** A team's link, which is marked while the team is selected. */
  private readonly link = (name: string) =>
    this.region().getByRole("link", { name });
  private readonly linkTo = (id: string) =>
    this.page.locator(`a[href="/studio/teams/${id}"]`);

  async goto(id?: string): Promise<void> {
    await this.page.goto(
      id === undefined ? "/studio/teams" : `/studio/teams/${id}`,
    );
  }

  async expectShown(): Promise<void> {
    await expect(this.region()).toBeVisible();
  }

  async expectAt(id?: string): Promise<void> {
    await expect(this.page).toHaveURL(
      new RegExp(id === undefined ? "/studio/teams$" : `/studio/teams/${id}$`),
    );
  }

  /** The studio says the team opened does not exist. */
  async expectTeamGone(): Promise<void> {
    await expect(
      this.page.getByText("This team doesn't exist anymore."),
    ).toBeVisible();
  }

  /** Creates a team with the "New team" dialog, opens it and returns its id. */
  async create(name: string): Promise<string> {
    await this.goto();
    const dialog = await this.openNewTeamDialog();
    await dialog.fillName(name);
    await dialog.clickConfirm();
    await dialog.expectClosed();
    await this.expectSelected(name);
    return new URL(this.page.url()).pathname.split("/").pop() ?? "";
  }

  async openNewTeamDialog(): Promise<TeamDialog> {
    await this.page.getByRole("button", { name: "Team list options" }).click();
    await this.page.getByRole("button", { name: "New team" }).click();
    const dialog = new TeamDialog(this.page, "New team", "Create team");
    await dialog.expectOpen();
    return dialog;
  }

  async clickTeam(name: string): Promise<void> {
    await this.link(name).click();
  }

  async expectTeam(name: string): Promise<void> {
    await expect(this.link(name)).toBeVisible();
  }

  /** How many teams' links match `name`; link names ignore case. */
  async expectTeamCount(name: string, count: number): Promise<void> {
    await expect(this.link(name)).toHaveCount(count);
  }

  async expectSelected(name: string): Promise<void> {
    await expect(this.link(name)).toHaveAttribute("aria-current", "page");
  }

  /** Opens a team's own "⋯" menu. */
  async openMenu(id: string): Promise<void> {
    const row = this.region()
      .getByRole("listitem")
      .filter({ has: this.linkTo(id) });
    await row.hover();
    await row.getByRole("button", { name: /^Options for / }).click();
  }

  async closeMenu(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }

  async expectDeleteRefused(): Promise<void> {
    await expect(
      this.page.getByRole("button", { name: "Delete team" }),
    ).toBeDisabled();
    await expect(
      this.page
        .locator(":popover-open")
        .getByText("Only teams without events can be deleted."),
    ).toBeVisible();
  }

  /** Opens the rename dialog from the team's menu. */
  async openRenameDialog(id: string): Promise<TeamDialog> {
    await this.openMenu(id);
    await this.page.getByRole("button", { name: "Rename team…" }).click();
    return new TeamDialog(this.page, "Rename team", "Rename team");
  }

  async rename(id: string, name: string): Promise<void> {
    const dialog = await this.openRenameDialog(id);
    await dialog.fillName(name);
    await dialog.clickConfirm();
    await dialog.expectClosed();
  }

  async openLogoDialog(id: string): Promise<LogoDialog> {
    await this.openMenu(id);
    await this.page.getByRole("button", { name: "Logo…" }).click();
    return new LogoDialog(this.page);
  }

  /** Gives a team a logo for a theme, and returns the logo's address. */
  async setLogo(id: string, theme: "light" | "dark"): Promise<string> {
    await this.goto(id);
    const dialog = await this.openLogoDialog(id);
    await dialog.chooseFile(theme);
    await dialog.expectLogo(theme);
    const src = await dialog.logoSrc(theme);
    await dialog.close();
    return src;
  }

  private readonly searchAllField = () =>
    this.region().getByRole("searchbox", { name: m.studio_search_all() });
  private readonly result = (title: string) =>
    this.region().getByRole("link").filter({ hasText: title });

  /** Types `text` in the search across every team, replacing what was there. */
  async searchAll(text: string): Promise<void> {
    await this.searchAllField().fill(text);
  }

  /** The event is listed in the search across teams, with its team's name. */
  async expectResult(title: string, team: string): Promise<void> {
    await expect(this.result(title)).toContainText(team);
  }

  /** The events with these titles are listed in the search, in this order. */
  async expectResultsInOrder(titles: ReadonlyArray<string>): Promise<void> {
    await expect
      .poll(async () => {
        const texts = await this.region().getByRole("link").allTextContents();
        return texts.flatMap((text) => {
          const title = titles.find((each) => text.includes(each));
          return title === undefined ? [] : [title];
        });
      })
      .toEqual([...titles]);
  }

  async openResult(title: string): Promise<void> {
    await this.result(title).click();
  }

  async expectNothingFound(): Promise<void> {
    await expect(this.region().getByText(m.studio_no_matches())).toBeVisible();
  }

  /** Deletes a team that has no events left, and checks it's gone. */
  async delete(id: string): Promise<void> {
    await this.goto(id);
    await this.openMenu(id);
    // The studio shows the delete before the server has done it, and
    // leaving the page would cut the request off.
    const done = this.page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        new URL(response.url()).pathname === `/api/teams/${id}`,
    );
    await this.page.getByRole("button", { name: "Delete team" }).click();
    await this.expectAt();
    await expect(this.linkTo(id)).toHaveCount(0);
    await done;
  }
}

/** The dialog that names a team: a new one, or one renamed. */
export class TeamDialog {
  private readonly dialog: Locator;
  private readonly confirm: string;

  constructor(page: Page, name: string, confirm: string) {
    this.dialog = page.getByRole("dialog", { name });
    this.confirm = confirm;
  }

  private readonly nameField = () =>
    this.dialog.getByRole("textbox", { name: "Team name" });

  async expectOpen(): Promise<void> {
    await expect(this.dialog).toBeVisible();
  }

  async expectClosed(): Promise<void> {
    await expect(this.dialog).toBeHidden();
  }

  async fillName(name: string): Promise<void> {
    await this.nameField().fill(name);
  }

  async expectName(name: string): Promise<void> {
    await expect(this.nameField()).toHaveValue(name);
  }

  async clickConfirm(): Promise<void> {
    await this.dialog.getByRole("button", { name: this.confirm }).click();
  }

  async clickCancel(): Promise<void> {
    await this.dialog.getByRole("button", { name: "Cancel" }).click();
  }

  async closeWithEscape(): Promise<void> {
    await this.dialog.page().keyboard.press("Escape");
  }

  async expectError(text: string): Promise<void> {
    await expect(this.dialog.getByRole("alert")).toContainText(text);
  }
}

/** A team's logo dialog: a logo for each theme. */
export class LogoDialog {
  private readonly dialog: Locator;

  constructor(page: Page) {
    this.dialog = page.getByRole("dialog", { name: "Team logo" });
  }

  private readonly field = (theme: "light" | "dark") =>
    this.dialog.getByRole("group", {
      name: theme === "light" ? "Light theme" : "Dark theme",
    });
  private readonly logo = (theme: "light" | "dark") =>
    this.field(theme).getByRole("img", { name: `Logo for the ${theme} theme` });

  async chooseFile(theme: "light" | "dark"): Promise<void> {
    await this.field(theme)
      .getByLabel(`Logo file for the ${theme} theme`)
      .setInputFiles({
        name: "logo.png",
        mimeType: "image/png",
        buffer: pixel,
      });
  }

  async clickReplace(theme: "light" | "dark"): Promise<void> {
    await this.field(theme)
      .getByRole("button", { name: "Replace image" })
      .click();
  }

  async clickRemove(theme: "light" | "dark"): Promise<void> {
    await this.field(theme)
      .getByRole("button", { name: "Remove image" })
      .click();
  }

  async logoSrc(theme: "light" | "dark"): Promise<string> {
    return (await this.logo(theme).getAttribute("src")) ?? "";
  }

  async expectLogo(theme: "light" | "dark", src?: string): Promise<void> {
    if (src === undefined) await expect(this.logo(theme)).toBeVisible();
    else await expect(this.logo(theme)).toHaveAttribute("src", src);
  }

  async expectLogoNot(theme: "light" | "dark", src: string): Promise<void> {
    await expect(this.logo(theme)).not.toHaveAttribute("src", src);
  }

  async expectNoLogo(theme: "light" | "dark"): Promise<void> {
    await expect(this.logo(theme)).toHaveCount(0);
  }

  async close(): Promise<void> {
    await this.dialog.getByRole("button", { name: "Close" }).click();
    await expect(this.dialog).toBeHidden();
  }

  async closeWithEscape(): Promise<void> {
    await this.dialog.page().keyboard.press("Escape");
  }
}
