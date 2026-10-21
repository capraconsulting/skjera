import { expect, type Page } from "@playwright/test";
import { Mailbox } from "../Mailbox.ts";
import { EventPage } from "../site/EventPage.ts";
import { TextField } from "../TextField.ts";
import { Attendees } from "./Attendees.ts";
import { BodyImages } from "./BodyImages.ts";
import { BodyToolbar } from "./BodyToolbar.ts";
import { Cover } from "./Cover.ts";
import { EventsColumn } from "./EventsColumn.ts";
import { EventTimes } from "./EventTimes.ts";
import { Presence } from "./Presence.ts";
import { Questions } from "./Questions.ts";
import { Repeat } from "./Repeat.ts";
import { TagInput } from "./TagInput.ts";

/** Where events are, unless a test says otherwise. */
const defaultPlace = "Kantina";

/** The emails an event sends, each with a subject and text of its own. */
export type EventEmail =
  | "signed up"
  | "sign-up cancelled"
  | "event changed"
  | "event cancelled";

/** How the studio names each email. */
const emailNames: Record<EventEmail, string> = {
  "signed up": "signed-up",
  "sign-up cancelled": "sign-up cancelled",
  "event changed": "event changed",
  "event cancelled": "event cancelled",
};

/** What `createPublished` sets before publishing. */
export interface EventSettings {
  readonly public: boolean;
  readonly guests?: boolean;
  readonly dietary?: boolean;
  /** The most who can sign up; none by default. */
  readonly maxAttendees?: number;
  /** Streamed, with a link to the stream if given; not streamed by default. */
  readonly streamed?: { readonly link?: string };
  /** Tags, added one by one; none by default. */
  readonly tags?: ReadonlyArray<string>;
}

/** A published event, as `createPublished` returns it. */
export interface PublishedEvent {
  readonly id: string;
  readonly title: string;
}

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

  constructor(page: Page) {
    this.page = page;
    const textbox = (name: string, exact = false) =>
      new TextField(page.getByRole("textbox", { name, exact }));
    this.title = textbox("Title");
    this.summary = textbox("Summary");
    this.body = textbox("Body");
    this.place = textbox("Place", true);
    this.streamLink = textbox("Link to the stream");
    this.whatsServed = textbox("What's served");
    this.times = new EventTimes(page);
    this.tags = new TagInput(page);
    this.repeat = new Repeat(page);
    this.questions = new Questions(page);
    this.toolbar = new BodyToolbar(page);
    this.bodyImages = new BodyImages(page);
    this.cover = new Cover(page);
    this.presence = new Presence(page);
    this.attendees = new Attendees(page);
  }

  /** A text field by its label, in the page's language. */
  field(name: string): TextField {
    return new TextField(this.page.getByRole("textbox", { name }));
  }

  /** A button by its name, in the page's language. */
  async expectButton(name: string): Promise<void> {
    await expect(this.page.getByRole("button", { name })).toBeVisible();
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

  private readonly status = () => this.page.getByTestId("status");
  private readonly publishButton = () =>
    this.page.getByRole("button", { name: "Publish" });
  private readonly checkbox = (name: RegExp) =>
    this.page.getByRole("checkbox", { name });

  /**
   * Creates an event in the open team, fills it in and publishes it. Its
   * title is unique, for finding its emails.
   */
  async createPublished(settings: EventSettings): Promise<PublishedEvent> {
    const id = await new EventsColumn(this.page).newEvent();
    const title = `Meetup ${id.slice(-12)}`;
    await this.title.type(title);
    await this.times.pick();
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
  }

  async clickPublish(): Promise<void> {
    await this.publishButton().click();
  }

  /**
   * Clicks Publish, answering the question it asks by accepting or
   * dismissing it. Returns the question.
   */
  async clickPublishAnswering(answer: "accept" | "dismiss"): Promise<string> {
    const asked = new Promise<string>((resolve) => {
      this.page.once("dialog", (dialog) => {
        resolve(dialog.message());
        return answer === "accept" ? dialog.accept() : dialog.dismiss();
      });
    });
    await this.clickPublish();
    return asked;
  }

  async expectPublishEnabled(): Promise<void> {
    await expect(this.publishButton()).toBeEnabled();
  }

  async expectRefused(message: string): Promise<void> {
    await expect(this.page.getByRole("alert")).toHaveText(message);
  }

  async expectSaved(): Promise<void> {
    await expect(this.status()).toContainText("Saved");
  }

  async expectPublished(): Promise<void> {
    await expect(this.status()).toContainText("Published");
  }

  /** What the footer says: "Saving", "Not published", or in another language. */
  async expectStatus(text: string): Promise<void> {
    await expect(this.status()).toContainText(text);
  }

  async expectViewOnSite(): Promise<void> {
    await expect(
      this.page.getByRole("link", { name: "View on site" }),
    ).toBeVisible();
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
    const question = new Promise<string>((resolve) => {
      this.page.once("dialog", (dialog) => {
        resolve(dialog.message());
        return answer === "accept" ? dialog.accept() : dialog.dismiss();
      });
    });
    // The studio shows the delete before the server has done it, and
    // leaving the page would cut the request off.
    const done = this.page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        /^\/api\/documents\/[0-9a-f-]+$/.test(new URL(response.url()).pathname),
    );
    const clicked = this.page
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    return { question: clicked.then(() => question), done };
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

  /** Opens one of the event's own emails, to write its subject and text. */
  async openEmail(email: EventEmail): Promise<void> {
    await this.page
      .getByRole("button", { name: `${emailNames[email]} email` })
      .click();
  }

  /** The subject an email is sent with, written for this event. */
  emailSubject(email: EventEmail): TextField {
    return this.field(`Subject of the ${emailNames[email]} email`);
  }

  /** The text an email is sent with, written for this event. */
  emailText(email: EventEmail): TextField {
    return this.field(`Text of the ${emailNames[email]} email`);
  }

  async checkPublic(): Promise<void> {
    await this.checkbox(/Public event/).check();
  }

  async uncheckPublic(): Promise<void> {
    await this.checkbox(/Public event/).uncheck();
  }

  async focusPublic(): Promise<void> {
    await this.checkbox(/Public event/).focus();
  }

  async checkGuests(): Promise<void> {
    await this.checkbox(/Guests can sign up/).check();
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

  async expectRemindersOn(): Promise<void> {
    await expect(this.checkbox(/Remind attendees/)).toBeChecked();
  }

  async fillMaxAttendees(limit: number): Promise<void> {
    await this.page
      .getByRole("spinbutton", { name: "Maximum attendees" })
      .fill(String(limit));
  }
}
