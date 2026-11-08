import type { Page } from "@playwright/test";
import { TextField } from "../../TextField.ts";
import { BodyToolbar } from "./BodyToolbar.ts";

/** The emails an event sends, each with a subject and text of its own. */
export type EventEmail =
  | "signed up"
  | "sign-up cancelled"
  | "event changed"
  | "event cancelled";

/** How the studio names each email. */
export const emailNames: Record<EventEmail, string> = {
  "signed up": "signed-up",
  "sign-up cancelled": "sign-up cancelled",
  "event changed": "event changed",
  "event cancelled": "event cancelled",
};

export class EventEmailFields {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async open(email: Exclude<EventEmail, "signed up">): Promise<void> {
    await this.page
      .getByRole("button", { name: `${emailNames[email]} email` })
      .click();
  }

  subject(email: EventEmail): TextField {
    return new TextField(
      this.page.getByRole("textbox", {
        name: `Subject of the ${emailNames[email]} email`,
      }),
    );
  }

  text(email: EventEmail): TextField {
    return new TextField(
      this.page.getByRole("textbox", {
        name: `Text of the ${emailNames[email]} email`,
      }),
    );
  }

  toolbar(email: EventEmail): BodyToolbar {
    return new BodyToolbar(this.page, `Text of the ${emailNames[email]} email`);
  }
}
