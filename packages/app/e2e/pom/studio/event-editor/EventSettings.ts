import { expect, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";

export class EventSettingsControls {
  private readonly page: Page;
  private readonly checkbox = (name: RegExp) =>
    this.page.getByRole("checkbox", { name });

  constructor(page: Page) {
    this.page = page;
  }

  async checkPublic(): Promise<void> {
    await this.checkbox(/Public event/).check();
  }

  async uncheckPublic(): Promise<void> {
    await this.checkbox(/Public event/).uncheck();
  }

  async expectPublic(checked: boolean): Promise<void> {
    await expect(this.checkbox(/Public event/)).toBeChecked({ checked });
  }

  async focusPublic(): Promise<void> {
    await this.checkbox(/Public event/).focus();
  }

  async checkGuests(): Promise<void> {
    await this.checkbox(/Guests can sign up/).check();
  }

  async uncheckGuests(): Promise<void> {
    await this.checkbox(/Guests can sign up/).uncheck();
  }

  /** Guests can sign up shows ticked or not, and can be changed or not. */
  async expectGuests(ticked: boolean, changeable: boolean): Promise<void> {
    const guests = this.checkbox(/Guests can sign up/);
    await expect(guests).toBeChecked({ checked: ticked });
    await expect(guests).toBeEnabled({ enabled: changeable });
  }

  async checkFoodServed(): Promise<void> {
    await this.checkbox(/Food is served/).check();
  }

  async uncheckFoodServed(): Promise<void> {
    await this.checkbox(/Food is served/).uncheck();
  }

  async checkStreamed(): Promise<void> {
    await this.checkbox(/The event is streamed/).check();
  }

  async uncheckStreamed(): Promise<void> {
    await this.checkbox(/The event is streamed/).uncheck();
  }

  async expectStreamed(): Promise<void> {
    await expect(this.checkbox(/The event is streamed/)).toBeChecked();
  }

  async checkHidePlacesLeft(): Promise<void> {
    await this.checkbox(/Hide how many places are left/).check();
  }

  private reminders() {
    return this.page.getByRole("combobox", { name: m.studio_remind() });
  }

  async expectReminders(choice: "default" | "on" | "off"): Promise<void> {
    await expect(this.reminders()).toHaveValue(choice);
  }

  async chooseReminders(choice: "default" | "on" | "off"): Promise<void> {
    await this.reminders().selectOption(choice);
  }

  private organizer() {
    return this.page.getByRole("combobox", { name: m.site_organizer() });
  }

  /** «Organizer» has the team with this id chosen. */
  async expectOrganizer(team: string): Promise<void> {
    await expect(this.organizer()).toHaveValue(team);
  }

  /** «Organizer» lists these teams, by name, and no others of the test's. */
  async expectOrganizerChoices(names: ReadonlyArray<string>): Promise<void> {
    for (const name of names) {
      await expect(
        this.organizer().getByRole("option", { name, exact: true }),
      ).toHaveCount(1);
    }
  }

  async chooseOrganizer(name: string): Promise<void> {
    await this.organizer().selectOption({ label: name });
  }

  /** «Organizer» can't be changed, and says why. */
  async expectOrganizerLocked(): Promise<void> {
    await expect(this.organizer()).toBeDisabled();
    await expect(
      this.page.getByText(m.studio_organizer_locked()),
    ).toBeVisible();
  }

  async fillMaxAttendees(limit: number): Promise<void> {
    await this.page
      .getByRole("spinbutton", { name: m.studio_max_attendees() })
      .fill(String(limit));
  }
}
