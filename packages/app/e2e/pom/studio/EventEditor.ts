import { expect, type Locator, type Page } from "@playwright/test";
import { Mailbox } from "../Mailbox.ts";
import { EventPage } from "../site/EventPage.ts";
import { pixel } from "../support.ts";
import { TextField } from "../TextField.ts";
import { Attendees } from "./Attendees.ts";
import { EventsColumn } from "./EventsColumn.ts";

/** Where events are, unless a test says otherwise. */
const defaultPlace = "Kantina";

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
  readonly coverDescription: TextField;
  readonly signedUpSubject: TextField;
  readonly signedUpText: TextField;
  readonly tags: TagInput;
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
    this.coverDescription = textbox("Cover description");
    this.signedUpSubject = textbox("Subject of the signed-up email");
    this.signedUpText = textbox("Text of the signed-up email");
    this.tags = new TagInput(page);
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
  private readonly startDate = () =>
    this.page.getByRole("button", { name: "Start date" });

  /**
   * Creates an event in the open team, fills it in and publishes it. Its
   * title is unique, for finding its emails.
   */
  async createPublished(settings: EventSettings): Promise<PublishedEvent> {
    const id = await new EventsColumn(this.page).newEvent();
    const title = `Meetup ${id.slice(-12)}`;
    await this.title.type(title);
    await this.pickTimes();
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

  /**
   * Sets the event to start at 18:00 on the 15th of next month, so sign-up
   * is open; it ends two hours later. Returns the day as the site shows it
   * ("Sunday, November 15, 2026").
   */
  async pickTimes(): Promise<string> {
    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth() + 1, 15);
    const month = day.toLocaleDateString("en-US", { month: "long" });
    await this.startDate().click();
    await this.page.getByRole("button", { name: /next month/i }).click();
    await this.page
      .getByRole("button", {
        name: new RegExp(`${month} 15th, ${day.getFullYear()}`),
      })
      .click();
    await this.fillStartTime("18:00");
    const shown = day.toLocaleDateString("en-US", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    await this.expectStartDate(shown);
    await this.expectStartTime("18:00");
    await this.expectEndTime("20:00");
    return shown;
  }

  /** Sets the event to start on the 15th of last month. */
  async pickPastStart(): Promise<void> {
    await this.startDate().click();
    await this.page.getByRole("button", { name: /previous month/i }).click();
    await this.page.getByRole("button", { name: /15th, \d{4}/ }).click();
  }

  /** Opens the start date's calendar, in the page's language. */
  async openStartDate(label = "Start date"): Promise<void> {
    await this.page.getByRole("button", { name: label }).click();
  }

  async expectCalendarButton(name: RegExp): Promise<void> {
    await expect(this.page.getByRole("button", { name })).toBeVisible();
  }

  async pressEscape(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }

  async expectStartDate(shown: string): Promise<void> {
    await expect(this.startDate()).toHaveText(shown);
  }

  async fillStartTime(time: string): Promise<void> {
    await this.page.getByLabel("Start time").fill(time);
  }

  async expectStartTime(time: string): Promise<void> {
    await expect(this.page.getByLabel("Start time")).toHaveValue(time);
  }

  async fillEndTime(time: string): Promise<void> {
    await this.page.getByLabel("End time").fill(time);
  }

  async expectEndTime(time: string): Promise<void> {
    await expect(this.page.getByLabel("End time")).toHaveValue(time);
  }

  /** Sets a sign-up deadline at midnight on the 1st, which has passed. */
  async setPassedDeadline(): Promise<void> {
    await this.page.getByRole("button", { name: "Deadline date" }).click();
    await this.page
      .getByRole("button", { name: /1st, \d{4}/ })
      .first()
      .click();
    await this.page.getByLabel("Deadline time").fill("00:00");
  }

  async selectTimeZone(zone: string): Promise<void> {
    await this.page
      .getByRole("combobox", { name: "Time zone" })
      .selectOption(zone);
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

  async checkStreamed(): Promise<void> {
    await this.checkbox(/The event is streamed/).check();
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

  private readonly repeats = () => this.checkbox(/The event repeats/);
  private readonly repeatEvery = () =>
    this.page.getByRole("combobox", { name: "Repeat every" });
  private readonly repeatUnit = () =>
    this.page.getByRole("combobox", { name: "Repeat unit" });

  async checkRepeats(): Promise<void> {
    await this.repeats().check();
  }

  async uncheckRepeats(): Promise<void> {
    await this.repeats().uncheck();
  }

  async selectRepeatEvery(every: string): Promise<void> {
    await this.repeatEvery().selectOption(every);
  }

  async selectRepeatUnit(
    unit: "day" | "week" | "month" | "year",
  ): Promise<void> {
    await this.repeatUnit().selectOption(unit);
  }

  async expectRepeatChoices(
    every: ReadonlyArray<string>,
    units: ReadonlyArray<string>,
  ): Promise<void> {
    await expect(this.repeatEvery().locator("option")).toHaveText([...every]);
    await expect(this.repeatUnit().locator("option")).toHaveText([...units]);
  }

  /** Repeats every `every` `unit`s, or doesn't repeat (`null`). */
  async expectRepeat(
    repeat: { readonly every: string; readonly unit: string } | null,
  ): Promise<void> {
    if (repeat === null) {
      await expect(this.repeatEvery()).toHaveCount(0);
      await expect(this.repeatUnit()).toHaveCount(0);
      return;
    }
    await expect(this.repeats()).toBeChecked();
    await expect(this.repeatEvery()).toHaveValue(repeat.every);
    await expect(this.repeatUnit()).toHaveValue(repeat.unit);
  }

  private readonly addQuestionButton = () =>
    this.page.getByRole("button", { name: "Add question" });
  private readonly question = (n: number) =>
    this.page.getByRole("textbox", { name: `Question ${n}`, exact: true });
  private readonly questionItem = (n: number) =>
    this.page.getByRole("listitem").filter({
      has: this.page.getByRole("combobox", { name: `Question ${n} type` }),
    });

  /** Adds a question, of a type unless it's a written answer. */
  async addQuestion(
    n: number,
    text: string,
    type?: "Checkbox" | "One of several",
  ): Promise<void> {
    await this.addQuestionButton().click();
    if (type !== undefined) {
      await this.page
        .getByRole("combobox", { name: `Question ${n} type` })
        .selectOption(type);
    }
    await this.question(n).fill(text);
  }

  async fillQuestionOption(
    n: number,
    option: number,
    text: string,
  ): Promise<void> {
    await this.page
      .getByRole("textbox", { name: `Question ${n} option ${option}` })
      .fill(text);
  }

  /** Ticks a question's "Must be ticked" or "Required". */
  async checkQuestionRule(
    n: number,
    rule: "Must be ticked" | "Required",
  ): Promise<void> {
    await this.questionItem(n).getByRole("checkbox", { name: rule }).check();
  }

  async moveQuestionUp(n: number): Promise<void> {
    await this.page
      .getByRole("button", { name: `Move question ${n} up` })
      .click();
  }

  async expectQuestion(n: number, text: string): Promise<void> {
    await expect(this.question(n)).toHaveValue(text);
  }

  /** Opens an email's own subject and text, by the button's name. */
  async openEmail(name: "Signed-up email"): Promise<void> {
    await this.page.getByRole("button", { name }).click();
  }

  private readonly toolbarButton = (name: string) =>
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

  /** Opens the body's "Add image" dialog. */
  async openImageDialog(): Promise<ImageDialog> {
    await this.toolbarButton("Image").click();
    return new ImageDialog(this.page, "Add image", "Add image");
  }

  /** Opens the dialog describing the selected image in the body. */
  async openDescribeImageDialog(): Promise<ImageDialog> {
    await this.toolbarButton("Describe image").click();
    return new ImageDialog(this.page, "Describe image", "Save");
  }

  private readonly bodyImages = () =>
    this.page
      .getByRole("textbox", { name: "Body" })
      .locator('img[src^="/api/images/"]');
  private readonly bodyImage = (name: string) =>
    this.page.getByRole("textbox", { name: "Body" }).getByRole("img", { name });

  /** Pastes the PNG where the caret is in the body. */
  async pasteImageIntoBody(): Promise<void> {
    await pastePng(this.page.getByRole("textbox", { name: "Body" }));
  }

  /** Drops the PNG onto the middle of the body. */
  async dropImageOntoBody(): Promise<void> {
    await dropPng(this.page.getByRole("textbox", { name: "Body" }));
  }

  /** Undescribed images have no img role: these count them by address. */
  async expectBodyImageCount(count: number): Promise<void> {
    await expect(this.bodyImages()).toHaveCount(count);
  }

  async expectBodyImageAddresses(pattern: RegExp): Promise<void> {
    await expect(this.bodyImages()).toHaveAttribute("src", pattern);
  }

  async expectBodyImage(name: string): Promise<void> {
    await expect(this.bodyImage(name)).toBeVisible();
  }

  async bodyImageSrc(name: string): Promise<string> {
    return (await this.bodyImage(name).getAttribute("src")) ?? "";
  }

  private readonly coverPreview = () =>
    this.page.getByRole("img", { name: "Cover" });

  async chooseCoverFile(): Promise<void> {
    await this.page.getByLabel("Cover image file").setInputFiles({
      name: "pixel.png",
      mimeType: "image/png",
      buffer: pixel,
    });
  }

  async dropCoverImage(): Promise<void> {
    await dropPng(this.page.getByTestId("cover-drop"));
  }

  async coverSrc(): Promise<string> {
    return (await this.coverPreview().getAttribute("src")) ?? "";
  }

  async expectCover(src: string | RegExp): Promise<void> {
    await expect(this.coverPreview()).toHaveAttribute("src", src);
  }

  async expectCoverNot(src: string): Promise<void> {
    await expect(this.coverPreview()).not.toHaveAttribute("src", src);
  }

  async removeCover(): Promise<void> {
    await this.page.getByRole("button", { name: "Remove cover image" }).click();
  }

  async expectNoCover(): Promise<void> {
    await expect(this.coverPreview()).toHaveCount(0);
    await this.coverDescription.expectAbsent();
  }

  private readonly avatars = () =>
    this.page.getByRole("region", { name: "Editor" }).getByTestId("avatar");

  /** Who else has the event open, by their avatar's name. */
  async expectOthersHere(name: string): Promise<void> {
    await expect(this.avatars()).toHaveAccessibleName(name);
  }

  async expectNobodyElseHere(): Promise<void> {
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

/** The editor's tags field, with its suggestions and the tags added. */
export class TagInput {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly input = () =>
    this.page.getByRole("combobox", { name: "Tags" });
  private readonly pills = () =>
    this.page.getByRole("list", { name: "Tags on this event" });

  async fill(text: string): Promise<void> {
    await this.input().fill(text);
  }

  async add(tag: string): Promise<void> {
    await this.fill(tag);
    await this.input().press("Enter");
  }

  /** Done tagging: the suggestions close. */
  async close(): Promise<void> {
    await this.input().press("Escape");
  }

  async expectSuggestion(name: string): Promise<void> {
    await expect(this.page.getByRole("option", { name })).toBeVisible();
  }

  async pickSuggestion(name: string): Promise<void> {
    await this.page.getByRole("option", { name }).click();
  }

  async remove(tag: string): Promise<void> {
    await this.page.getByRole("button", { name: `Remove tag ${tag}` }).click();
  }

  async expectTag(tag: string): Promise<void> {
    await expect(this.pills()).toContainText(tag);
  }

  async expectTags(tags: ReadonlyArray<RegExp>): Promise<void> {
    await expect(this.pills().getByRole("listitem")).toHaveText([...tags]);
  }

  async expectNone(): Promise<void> {
    await expect(this.pills()).toHaveCount(0);
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

const pixelBase64 = pixel.toString("base64");

/** A DataTransfer holding the PNG, as pasting or dropping a file gives. */
const pngTransfer = (page: Page, name = "pixel.png") =>
  page.evaluateHandle(
    ({ base64, name }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type: "image/png" }));
      return transfer;
    },
    { base64: pixelBase64, name },
  );

/** Pastes the PNG into what has focus in `target`. */
const pastePng = async (target: Locator) => {
  const transfer = await pngTransfer(target.page());
  await target.evaluate((element, clipboardData) => {
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, transfer);
};

/** Drops the PNG onto the middle of `target`. */
const dropPng = async (target: Locator) => {
  const box = await target.boundingBox();
  expect(box, "the drop target is visible").not.toBeNull();
  const at = {
    clientX: (box?.x ?? 0) + (box?.width ?? 0) / 2,
    clientY: (box?.y ?? 0) + (box?.height ?? 0) / 2,
  };
  const dataTransfer = await pngTransfer(target.page());
  await target.dispatchEvent("dragover", { dataTransfer, ...at });
  await target.dispatchEvent("drop", { dataTransfer, ...at });
};
