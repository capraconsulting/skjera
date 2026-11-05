import { expect, type Page } from "@playwright/test";

type List = "upcoming" | "past" | "any";

/** Visitors' pages pull every 5 seconds: a few pulls' time, when busy. */
const pulled = { timeout: 20_000 };

/** One try inside a retry: short, so one try never uses the whole budget. */
const attempt = { timeout: 1_000 };

/** The site's front page: the events, upcoming and past, and filters. */
export class HomePage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly list = (list: List) =>
    list === "any"
      ? this.page.locator("body")
      : this.page.getByRole("region", {
          name: list === "upcoming" ? "Upcoming events" : "Past events",
        });
  private readonly link = (title: string, list: List = "any") =>
    this.list(list).getByRole("link", { name: title });
  private readonly showMore = (list: "upcoming" | "past") =>
    this.list(list).getByRole("button", { name: "Show more events" });
  private readonly tagFilters = () =>
    this.page.getByRole("navigation", { name: "Filter by tag" });
  private readonly guestFilter = (which: "open" | "not open") =>
    this.page
      .getByRole("navigation", { name: "Filter by who can sign up" })
      .getByRole("button", {
        name: which === "open" ? "Open to all" : "Internal only",
        exact: true,
      });

  /** The front page, with the query given ("?tag=Social"). */
  async goto(query = ""): Promise<void> {
    await this.page.goto(`/${query}`);
  }

  async reload(): Promise<void> {
    await this.page.reload();
  }

  async expectAt(): Promise<void> {
    await expect(this.page).toHaveURL(/\/$/);
  }

  /** The browser tab's title. */
  async expectTabTitle(title: string): Promise<void> {
    await expect(this.page).toHaveTitle(title);
  }

  /** The meta description of the page's head, as search results show it. */
  async expectDescription(content: string): Promise<void> {
    await expect(
      this.page.locator('head meta[name="description"]'),
    ).toHaveAttribute("content", content);
  }

  async expectUpcomingHeading(): Promise<void> {
    await expect(
      this.page.getByRole("heading", { name: "Upcoming events" }),
    ).toBeVisible();
  }

  /**
   * Presses «Show more events» until the list shows every event: both lists
   * for "any". An event behind the button is neither missed nor counted gone.
   */
  private async showAll(list: List): Promise<void> {
    for (const each of list === "any"
      ? (["upcoming", "past"] as const)
      : [list]) {
      const more = this.showMore(each);
      while (await more.isVisible()) await more.click(attempt);
    }
  }

  /**
   * Shows every event, then runs `check`, again on each retry while it waits
   * for the page's next pull.
   */
  private async withAll(list: List, check: () => Promise<void>): Promise<void> {
    await expect(async () => {
      await this.showAll(list);
      await check();
    }).toPass(pulled);
  }

  async clickEvent(title: string): Promise<void> {
    await this.withAll("any", () => this.link(title).click(attempt));
  }

  /** The event is listed, in time for the page's next pull. */
  async expectEvent(title: string, list: List = "any"): Promise<void> {
    await this.withAll(list, () =>
      expect(this.link(title, list)).toBeVisible(attempt),
    );
  }

  async expectNoEvent(title: string, list: List = "any"): Promise<void> {
    await this.withAll(list, () =>
      expect(this.link(title, list)).toHaveCount(0, attempt),
    );
  }

  /** The events listed, and those not, in a list. */
  async expectEvents(
    list: List,
    shown: ReadonlyArray<{ readonly title: string }>,
    hidden: ReadonlyArray<{ readonly title: string }> = [],
  ): Promise<void> {
    for (const event of shown) await this.expectEvent(event.title, list);
    for (const event of hidden) {
      await this.withAll(list, () =>
        expect(this.link(event.title, list)).toHaveCount(0, attempt),
      );
    }
  }

  /** The event's entry says `text`, in time for the page's next pull. */
  async expectEventSays(title: string, text: string): Promise<void> {
    await this.withAll("any", () =>
      expect(this.link(title)).toContainText(text, attempt),
    );
  }

  /** The event is listed, and its entry does not say `text`. */
  async expectEventDoesNotSay(title: string, text: string): Promise<void> {
    await this.withAll("any", async () => {
      await expect(this.link(title)).toBeVisible(attempt);
      await expect(this.link(title)).not.toContainText(text, attempt);
    });
  }

  /** How many events a list shows now, behind «Show more events» not counted. */
  async expectRows(list: "upcoming" | "past", count: number): Promise<void> {
    await expect(this.list(list).getByRole("listitem")).toHaveCount(
      count,
      pulled,
    );
  }

  /** «Show more events» is under the list, or has gone. */
  async expectShowMore(
    list: "upcoming" | "past",
    state: "there" | "gone",
  ): Promise<void> {
    await expect(this.showMore(list)).toHaveCount(
      state === "there" ? 1 : 0,
      pulled,
    );
  }

  async clickShowMore(list: "upcoming" | "past"): Promise<void> {
    await this.showMore(list).click();
  }

  /** The list says `text` instead of events. */
  async expectEmpty(list: "upcoming" | "past", text: string): Promise<void> {
    await expect(this.list(list).getByText(text)).toBeVisible(pulled);
  }

  /** The organizer's logo, named by the team, in the event's entry. */
  async expectOrganizerLogo(
    title: string,
    list: List,
    team: string,
    src: string,
  ): Promise<void> {
    await this.withAll(list, () =>
      expect(
        this.link(title, list).getByRole("img", { name: team }),
      ).toHaveAttribute("src", src, attempt),
    );
  }

  async expectNoOrganizerLogo(title: string, list: List): Promise<void> {
    await this.withAll(list, () =>
      expect(this.link(title, list).getByRole("img")).toHaveCount(0, attempt),
    );
  }

  /** Clicks a tag filter, or "All". */
  async clickTagFilter(name: string): Promise<void> {
    await this.tagFilters().getByRole("button", { name }).click();
  }

  async expectTagFilter(
    name: string,
    state: "shown" | "absent" | "chosen",
  ): Promise<void> {
    const filter = this.tagFilters().getByRole("button", { name });
    if (state === "shown") await expect(filter).toBeVisible();
    else if (state === "absent") await expect(filter).toHaveCount(0);
    else await expect(filter).toHaveAttribute("aria-pressed", "true");
  }

  async clickGuestFilter(which: "open" | "not open"): Promise<void> {
    await this.guestFilter(which).click();
  }

  /** Which guest filter is chosen, if any. */
  async expectGuestFilter(chosen: "open" | "not open" | null): Promise<void> {
    for (const which of ["open", "not open"] as const) {
      await expect(this.guestFilter(which)).toHaveAttribute(
        "aria-pressed",
        String(which === chosen),
      );
    }
  }

  /** The guest filters, as named in the page's language. */
  async expectGuestFilterNames(
    navigation: string,
    open: string,
    notOpen: string,
  ): Promise<void> {
    const filters = this.page.getByRole("navigation", { name: navigation });
    for (const name of [open, notOpen]) {
      await expect(
        filters.getByRole("button", { name, exact: true }),
      ).toBeVisible();
    }
  }

  /** The address's choices: the guest filter's and the tag's. */
  async expectQuery(guests: string | null, tag: string | null): Promise<void> {
    await expect(this.page).toHaveURL(
      (url) =>
        url.searchParams.get("guests") === guests &&
        url.searchParams.get("tag") === tag,
    );
  }

  async expectUrl(pattern: RegExp): Promise<void> {
    await expect(this.page).toHaveURL(pattern);
  }
}
