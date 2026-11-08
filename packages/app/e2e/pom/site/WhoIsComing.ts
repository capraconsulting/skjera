import { expect, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";
import { defaultPollEveryMs } from "@skjera/snapsync/client";

/** Another browser's change comes with a pull: a few pulls' time, when busy. */
const pulled = { timeout: 4 * defaultPollEveryMs };

/** An event page's "Who's coming": members and guests apart. */
export class WhoIsComing {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly region = () =>
    this.page.getByRole("region", { name: m.attend_who_is_coming() });
  private readonly part = (part: "members" | "guests") =>
    this.region().getByRole("region", {
      name: part === "members" ? /^Members/ : /^Guests/,
    });

  /** The part says `text`, waiting for other browsers' changes to come. */
  async expectSays(part: "members" | "guests", text: string): Promise<void> {
    await expect(this.part(part)).toContainText(text, pulled);
  }

  async expectNotSaying(
    part: "members" | "guests",
    text: string,
  ): Promise<void> {
    await expect(this.part(part)).not.toContainText(text);
  }

  async expectPart(part: "members" | "guests", shown: boolean): Promise<void> {
    if (shown) await expect(this.part(part)).toBeVisible();
    else await expect(this.part(part)).toHaveCount(0);
  }

  /** Not shown at all, as to visitors. */
  async expectHidden(): Promise<void> {
    await expect(this.region()).toHaveCount(0);
  }
}
