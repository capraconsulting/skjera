import { expect, type Page } from "@playwright/test";
import { documentPath } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { Mailbox } from "../Mailbox.ts";
import { EventPage } from "../site/EventPage.ts";
import { TextField } from "../TextField.ts";
import { Attendees } from "./Attendees.ts";
import { Confirmation } from "./Confirmation.ts";
import { EventsColumn } from "./EventsColumn.ts";
import { BodyImages } from "./event-editor/BodyImages.ts";
import { BodyToolbar } from "./event-editor/BodyToolbar.ts";
import { Cover } from "./event-editor/Cover.ts";
import {
  type EventEmail,
  EventEmailFields,
} from "./event-editor/EventEmails.ts";
import { EventHistory } from "./event-editor/EventHistory.ts";
import type {
  EventSettings,
  PublishedEvent,
} from "./event-editor/EventLifecycle.ts";
import { EventSettingsControls } from "./event-editor/EventSettings.ts";
import { EventTimes } from "./event-editor/EventTimes.ts";
import { Questions } from "./event-editor/Questions.ts";
import { Repeat } from "./event-editor/Repeat.ts";
import { Presence } from "./Presence.ts";
import { TagInput } from "./TagInput.ts";

export type { EventEmail } from "./event-editor/EventEmails.ts";
export type {
  EventSettings,
  PublishedEvent,
} from "./event-editor/EventLifecycle.ts";

/** Where events are, unless a test says otherwise. */
const defaultPlace = "Kantina";

/** The studio's editor for the open event. */
export class EventEditor {
  private readonly page: Page;
  readonly title: TextField;
  readonly summary: TextField;
  readonly body: TextField;
  readonly place: TextField;
  readonly streamLink: TextField;
  readonly whatsServed: TextField;
  readonly times: EventTimes;
  readonly tags: TagInput;
  readonly repeat: Repeat;
  readonly questions: Questions;
  readonly toolbar: BodyToolbar;
  readonly bodyImages: BodyImages;
  readonly cover: Cover;
  readonly presence: Presence;
  readonly attendees: Attendees;
  private readonly settings: EventSettingsControls;
  private readonly history: EventHistory;
  private readonly emails: EventEmailFields;

  constructor(page: Page) {
    this.page = page;
    const textbox = (name: string, exact = false) =>
      new TextField(page.getByRole("textbox", { name, exact }));
    this.title = textbox(m.studio_title());
    this.summary = textbox(m.studio_summary());
    this.body = textbox(m.studio_body());
    this.place = textbox(m.site_place(), true);
    this.streamLink = textbox(m.studio_stream_link());
    this.whatsServed = textbox(m.studio_whats_served());
    this.times = new EventTimes(page);
    this.tags = new TagInput(page);
    this.repeat = new Repeat(page);
    this.questions = new Questions(page);
    this.toolbar = new BodyToolbar(page);
    this.bodyImages = new BodyImages(page);
    this.cover = new Cover(page);
    this.presence = new Presence(page);
    this.attendees = new Attendees(page);
    this.settings = new EventSettingsControls(page);
    this.history = new EventHistory(page);
    this.emails = new EventEmailFields(page);
  }

  /** A text field by its label, in the page's language. */
  field(name: string): TextField {
    return new TextField(this.page.getByRole("textbox", { name }));
  }

  /** A button by its name, in the page's language. */
  async expectButton(name: string): Promise<void> {
    await expect(
      this.page.getByRole("button", { name, exact: true }),
    ).toBeVisible();
  }

  async expectNoButton(name: string): Promise<void> {
    await expect(
      this.page.getByRole("button", { name, exact: true }),
    ).toHaveCount(0);
  }

  /** The studio address of an event. */
  static path(team: string, event: string): string {
    return `/studio/teams/${team}/events/${event}`;
  }

  async goto(team: string, event: string): Promise<void> {
    await this.page.goto(EventEditor.path(team, event));
  }

  async expectAt(team: string, event: string): Promise<void> {
    await expect(this.page).toHaveURL(
      new RegExp(`${EventEditor.path(team, event)}$`),
    );
  }

  async reload(): Promise<void> {
    await this.page.reload();
  }

  /** Makes a copy of the open event and returns the copy's id. */
  async copy(): Promise<string> {
    const before = this.page.url();
    await this.page
      .getByRole("button", { name: m.studio_copy(), exact: true })
      .click();
    // The copy opens in the same team, as another event.
    await expect(this.page).not.toHaveURL(before);
    await expect(this.page).toHaveURL(
      /\/studio\/teams\/[0-9a-f-]+\/events\/[0-9a-f-]+$/,
    );
    return new URL(this.page.url()).pathname.split("/").pop() ?? "";
  }

  private readonly status = () => this.page.getByTestId("status");
  private readonly publishButton = () =>
    this.page.getByRole("button", { name: m.studio_publish(), exact: true });

  /**
   * Creates an event in the open team, fills it in and publishes it. Its
   * title is unique, for finding its emails.
   */
  async createPublished(settings: EventSettings): Promise<PublishedEvent> {
    const id = await new EventsColumn(this.page).newEvent();
    const title = `Meetup ${id.slice(-12)}`;
    await this.title.type(title);
    if (settings.past) await this.times.pickPastStart();
    else await this.times.pick();
    await this.writePlace();
    if (settings.tags !== undefined && settings.tags.length > 0) {
      for (const tag of settings.tags) await this.tags.add(tag);
      await this.tags.close();
    }
    if (settings.public) await this.checkPublic();
    if (settings.guests) await this.checkGuests();
    if (settings.dietary) await this.checkFoodServed();
    if (settings.maxAttendees !== undefined) {
      await this.fillMaxAttendees(settings.maxAttendees);
    }
    if (settings.streamed !== undefined) {
      await this.checkStreamed();
      if (settings.streamed.link !== undefined) {
        await this.streamLink.type(settings.streamed.link);
        await this.streamLink.expectText(settings.streamed.link);
      }
    }
    await this.publish();
    return { id, title };
  }

  /** Publishes, once the changes are saved, and waits for it. */
  async publish(): Promise<void> {
    await this.expectSaved();
    await this.clickPublish();
    await this.expectPublished();
    await this.expectPublishedButtonDisabled();
  }

  async clickPublish(): Promise<void> {
    await this.publishButton().click();
  }

  /**
   * Clicks Publish, answering the question it asks by accepting or
   * dismissing it. Returns the question.
   */
  async clickPublishAnswering(answer: "accept" | "dismiss"): Promise<string> {
    return this.clickAnswering(answer, m.studio_publish(), () =>
      this.clickPublish(),
    ).question;
  }

  /** Clicks, then answers the question the studio asks: the button named `action`, or Cancel. */
  private clickAnswering(
    answer: "accept" | "dismiss",
    action: string,
    click: () => Promise<unknown>,
    waitForDone: () => Promise<unknown> = () => Promise.resolve(),
  ): { readonly question: Promise<string>; readonly done: Promise<unknown> } {
    const confirmation = new Confirmation(this.page);
    const done = waitForDone();
    const question = click().then(async () => {
      const asked = await confirmation.question();
      await (answer === "accept"
        ? confirmation.accept(action)
        : confirmation.dismiss());
      return asked;
    });
    return { question, done };
  }

  async expectPublishEnabled(): Promise<void> {
    await expect(this.publishButton()).toBeEnabled();
  }

  /** The Publish button reads "Published" and can't be clicked. */
  async expectPublishedButtonDisabled(): Promise<void> {
    await expect(
      this.page.getByRole("button", {
        name: m.studio_published(),
        exact: true,
      }),
    ).toBeDisabled();
  }

  async expectRefused(message: string): Promise<void> {
    await expect(this.page.getByRole("alert")).toHaveText(message);
  }

  async expectSaved(): Promise<void> {
    await expect(this.status()).toContainText(m.studio_saved());
  }

  async expectPublished(): Promise<void> {
    await expect(this.status()).toContainText(m.studio_published());
  }

  /** What the footer says: "Saving", "Not published", or in another language. */
  async expectStatus(text: string): Promise<void> {
    await expect(this.status()).toContainText(text);
  }

  async expectViewOnSite(): Promise<void> {
    await expect(
      this.page.getByRole("link", { name: m.studio_view_on_site() }),
    ).toBeVisible();
  }

  /** Clicks **Preview** and gives the tab it opens the event's preview in. */
  async openPreview(): Promise<Page> {
    const opening = this.page.context().waitForEvent("page");
    await this.page
      .getByRole("link", { name: m.studio_preview(), exact: true })
      .click();
    const preview = await opening;
    await preview.waitForLoadState();
    return preview;
  }

  async expectDeletedMessage(): Promise<void> {
    await expect(this.page.getByRole("alert")).toContainText(
      "This event was deleted",
    );
  }

  /**
   * Deletes the open event, and checks it's gone from the studio and the
   * site. Its attendees are emailed that it's cancelled: once they are, the
   * emails about it are cleared (they link to it). Tests end with this, so
   * they leave no events, or emails, behind.
   */
  async delete(id: string): Promise<void> {
    const title = await this.title.text();
    // Who's signed up now: freshly pulled, as someone may just have left.
    await this.page.reload();
    const signedUp = await this.attendees.count();
    const asked = this.clickDeleteAnswering("accept");
    await asked.question;
    await this.expectDeleted(id);
    await asked.done;

    await new EventPage(this.page).goto(id);
    await new EventPage(this.page).expectNotPublished();
    await new Mailbox().clearCancellations(id, title, signedUp);
  }

  /**
   * Clicks Delete, answering the question it asks. Its `question` is what
   * was asked; `done` the server's answer to the delete.
   */
  clickDeleteAnswering(answer: "accept" | "dismiss"): {
    readonly question: Promise<string>;
    readonly done: Promise<unknown>;
  } {
    return this.clickAnswering(
      answer,
      m.common_delete(),
      () =>
        this.page
          .getByRole("button", { name: m.common_delete(), exact: true })
          .click(),
      () =>
        this.page.waitForResponse(
          (response) =>
            response.request().method() === "DELETE" &&
            documentPath.itemPattern.test(new URL(response.url()).pathname),
        ),
    );
  }

  /**
   * Clicks Unpublish, answering the question it asks. Its `question` is what
   * was asked; `done` the server's answer to the unpublish, which only an
   * accepted question sends.
   */
  clickUnpublishAnswering(answer: "accept" | "dismiss"): {
    readonly question: Promise<string>;
    readonly done: Promise<unknown>;
  } {
    return this.clickAnswering(
      answer,
      m.studio_unpublish(),
      () =>
        this.page
          .getByRole("button", { name: m.studio_unpublish(), exact: true })
          .click(),
      () =>
        answer === "accept"
          ? this.page.waitForResponse(
              (response) =>
                response.request().method() === "DELETE" &&
                documentPath.publicationPattern.test(
                  new URL(response.url()).pathname,
                ),
            )
          : Promise.resolve(),
    );
  }

  /**
   * Clicks Discard changes, answering the question it asks. Its `question` is
   * what was asked; `done` the server's answer to the discard, which only an
   * accepted question sends.
   */
  clickDiscardAnswering(answer: "accept" | "dismiss"): {
    readonly question: Promise<string>;
    readonly done: Promise<unknown>;
  } {
    return this.clickAnswering(
      answer,
      m.studio_discard_changes(),
      () =>
        this.page
          .getByRole("button", {
            name: m.studio_discard_changes(),
            exact: true,
          })
          .click(),
      () =>
        answer === "accept"
          ? this.page.waitForResponse(
              (response) =>
                response.request().method() === "DELETE" &&
                documentPath.changesPattern.test(
                  new URL(response.url()).pathname,
                ),
            )
          : Promise.resolve(),
    );
  }

  openHistory = () => this.history.open();
  historyEntries = (kind: string) => this.history.entries(kind);
  viewVersion = (kind: string) => this.history.viewVersion(kind);

  /**
   * Clicks **Restore this version** on the newest entry of a kind, answering
   * the question it asks. Its `question` is what was asked; `done` the
   * server's answer to the restore, which only an accepted question sends.
   */
  clickRestoreAnswering(
    kind: string,
    answer: "accept" | "dismiss",
  ): {
    readonly question: Promise<string>;
    readonly done: Promise<unknown>;
  } {
    return this.clickAnswering(
      answer,
      m.studio_restore_version(),
      () =>
        this.historyEntries(kind)
          .first()
          .getByRole("button", {
            name: m.studio_restore_version(),
            exact: true,
          })
          .click(),
      () =>
        answer === "accept"
          ? this.page.waitForResponse(
              (response) =>
                response.request().method() === "POST" &&
                documentPath.restorationsPattern.test(
                  new URL(response.url()).pathname,
                ),
            )
          : Promise.resolve(),
    );
  }

  /** Back on the event's team, without the event. */
  async expectDeleted(id: string): Promise<void> {
    await expect(this.page).toHaveURL(/\/studio\/teams\/[0-9a-f-]+$/);
    await expect(this.page.locator(`a[href$="/events/${id}"]`)).toHaveCount(0);
  }

  /** Writes where the event is. */
  async writePlace(text = defaultPlace): Promise<void> {
    await this.place.type(text);
    await this.place.expectText(text);
  }

  openEmail = (email: Exclude<EventEmail, "signed up">) =>
    this.emails.open(email);
  emailSubject = (email: EventEmail) => this.emails.subject(email);
  emailText = (email: EventEmail) => this.emails.text(email);
  emailToolbar = (email: EventEmail) => this.emails.toolbar(email);

  checkPublic = () => this.settings.checkPublic();
  uncheckPublic = () => this.settings.uncheckPublic();
  expectPublic = (checked: boolean) => this.settings.expectPublic(checked);
  focusPublic = () => this.settings.focusPublic();
  checkGuests = () => this.settings.checkGuests();
  uncheckGuests = () => this.settings.uncheckGuests();
  expectGuests = (ticked: boolean, changeable: boolean) =>
    this.settings.expectGuests(ticked, changeable);
  checkFoodServed = () => this.settings.checkFoodServed();
  uncheckFoodServed = () => this.settings.uncheckFoodServed();
  checkStreamed = () => this.settings.checkStreamed();
  uncheckStreamed = () => this.settings.uncheckStreamed();
  expectStreamed = () => this.settings.expectStreamed();
  checkHidePlacesLeft = () => this.settings.checkHidePlacesLeft();
  expectReminders = (choice: "default" | "on" | "off") =>
    this.settings.expectReminders(choice);
  chooseReminders = (choice: "default" | "on" | "off") =>
    this.settings.chooseReminders(choice);
  expectOrganizer = (team: string) => this.settings.expectOrganizer(team);
  expectOrganizerChoices = (names: ReadonlyArray<string>) =>
    this.settings.expectOrganizerChoices(names);
  chooseOrganizer = (name: string) => this.settings.chooseOrganizer(name);
  expectOrganizerLocked = () => this.settings.expectOrganizerLocked();
  fillMaxAttendees = (limit: number) => this.settings.fillMaxAttendees(limit);
}
