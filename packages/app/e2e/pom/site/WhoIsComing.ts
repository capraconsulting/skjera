import { expect, type Page } from "@playwright/test";

/** Another browser's change comes with a pull: a few pulls' time, when busy. */
const pulled = { timeout: 20_000 };

/** An event page's "Who's coming": members and guests apart. */
export class WhoIsComing {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly region = () =>
    this.page.getByRole("region", { name: "Who's coming" });
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
