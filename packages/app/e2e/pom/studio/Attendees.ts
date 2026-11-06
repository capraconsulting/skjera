import { expect, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";
import readExcelFile from "read-excel-file/node";

/** The Excel file of the attendees, as downloaded and read. */
export interface AttendeesExcel {
  readonly filename: string;
  /** Its sheets, each with its name and its rows: the headings, then a row per attendee. */
  readonly sheets: ReadonlyArray<{
    readonly sheet: string;
    readonly data: ReadonlyArray<ReadonlyArray<unknown>>;
  }>;
}

/**
 * The studio's list of who signed up for the open event, and what they
 * can't eat.
 */
export class Attendees {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly region = () =>
    this.page.getByRole("region", { name: "Attendees" });
  private readonly row = (name: string) =>
    this.region().getByRole("listitem").filter({ hasText: name });
  private readonly dietary = () =>
    this.page.getByRole("region", { name: "Dietary preferences" });

  /** How many are signed up, as the heading says. */
  async count(): Promise<number> {
    const heading = this.region().getByRole("heading", {
      name: /^Attendees \(\d+\)$/,
    });
    return Number(/\d+/.exec((await heading.textContent()) ?? "")?.[0]);
  }

  async expectText(text: string): Promise<void> {
    await expect(this.region()).toContainText(text);
  }

  async expectNoText(text: string): Promise<void> {
    await expect(this.region()).not.toContainText(text);
  }

  async expectEmpty(): Promise<void> {
    await this.expectText("Nobody has signed up yet.");
  }

  private readonly searchField = () =>
    this.region().getByRole("searchbox", { name: m.studio_attendees_search() });

  /** The list can be searched: the field is there, with its message as placeholder. */
  async expectSearch(): Promise<void> {
    await expect(this.searchField()).toBeVisible();
    await expect(this.searchField()).toHaveAttribute(
      "placeholder",
      m.studio_attendees_search(),
    );
  }

  async expectNoSearch(): Promise<void> {
    await expect(this.searchField()).toHaveCount(0);
  }

  /** Types `text` in the search field. */
  async search(text: string): Promise<void> {
    await this.searchField().fill(text);
  }

  /** The row of the attendee called `name` says `text`. */
  async expectRow(name: string, text: string): Promise<void> {
    await expect(this.row(name)).toContainText(text);
  }

  /** The answer to `question`, of the attendee called `name` if given. */
  async expectAnswer(
    question: string,
    answer: string,
    name?: string,
  ): Promise<void> {
    const within = name === undefined ? this.region() : this.row(name);
    await expect(
      within.getByRole("term").filter({ hasText: question }).locator("+ dd"),
    ).toHaveText(answer);
  }

  async downloadExcel(): Promise<AttendeesExcel> {
    const downloading = this.page.waitForEvent("download");
    await this.region().getByRole("button", { name: "Download Excel" }).click();
    const file = await downloading;
    return {
      filename: file.suggestedFilename(),
      sheets: await readExcelFile((await file.path()) ?? ""),
    };
  }

  private readonly emailButton = () =>
    this.region().getByRole("button", { name: m.studio_email_attendees() });
  private readonly emailForm = () =>
    this.page.getByRole("dialog", { name: m.studio_email_attendees() });
  private readonly sentEmails = () =>
    this.page.getByRole("region", { name: m.studio_emails_sent() });

  /** The button that writes to those signed up is there, or is not. */
  async expectEmailButton(shown: boolean): Promise<void> {
    await expect(this.emailButton()).toHaveCount(shown ? 1 : 0);
  }

  /** Opens the form, which says how many the email goes to. */
  async openEmailForm(goesTo: number): Promise<void> {
    await this.emailButton().click();
    await expect(this.emailForm()).toBeVisible();
    await expect(this.emailForm()).toContainText(
      m.studio_email_goes_to({ count: goesTo }),
    );
    await expect(
      this.emailForm().getByLabel(m.studio_email_subject()),
    ).toBeVisible();
    await expect(
      this.emailForm().getByLabel(m.studio_email_text()),
    ).toBeVisible();
  }

  async fillEmail(subject: string, text: string): Promise<void> {
    await this.emailForm().getByLabel(m.studio_email_subject()).fill(subject);
    await this.emailForm().getByLabel(m.studio_email_text()).fill(text);
  }

  /** Presses Send, answering the question that follows; returns what it asked. */
  async sendEmailAnswering(answer: "accept" | "dismiss"): Promise<string> {
    const asked = new Promise<string>((resolve) =>
      this.page.once("dialog", (dialog) => {
        resolve(dialog.message());
        return answer === "accept" ? dialog.accept() : dialog.dismiss();
      }),
    );
    await this.emailForm()
      .getByRole("button", { name: m.studio_email_send() })
      .click();
    return asked;
  }

  /** The studio says the email is being sent to `count`, and the form is closed. */
  async expectSending(count: number): Promise<void> {
    await expect(
      this.region()
        .getByRole("status")
        .filter({
          hasText: m.studio_email_sending({ count }),
        }),
    ).toBeVisible();
    await expect(this.emailForm()).toHaveCount(0);
  }

  /** The form is still open: nothing was sent. */
  async expectEmailFormOpen(): Promise<void> {
    await expect(this.emailForm()).toBeVisible();
  }

  /** The list of emails sent has one with `subject`, sent to `count`. */
  async expectSentEmail(subject: string, count: number): Promise<void> {
    const row = this.sentEmails().getByRole("listitem").filter({
      hasText: subject,
    });
    await expect(row).toContainText(m.studio_emails_sent_recipients({ count }));
  }

  async expectSentEmailCount(count: number): Promise<void> {
    await expect(this.sentEmails().getByRole("listitem")).toHaveCount(count);
  }

  /** Takes the attendee called `name` off, saying yes when asked. */
  async remove(name: string): Promise<void> {
    this.page.once("dialog", (dialog) => dialog.accept());
    await this.region()
      .getByRole("button", { name: `Remove ${name}` })
      .click();
  }

  /** What people can't eat: how many said, and what, without names. */
  async expectDietaryPreferences(items: ReadonlyArray<string>): Promise<void> {
    await expect(
      this.dietary().getByRole("heading", {
        name: `Dietary preferences (${items.length})`,
      }),
    ).toBeVisible();
    await expect(this.dietary().getByRole("listitem")).toHaveText([...items]);
  }

  async expectDietaryPreferencesWithout(text: string): Promise<void> {
    await expect(this.dietary()).not.toContainText(text);
  }
}
