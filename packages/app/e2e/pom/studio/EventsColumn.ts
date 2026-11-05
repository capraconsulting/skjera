import { expect, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";

/** The orders the studio's lists can be in, by the name the page gives them. */
type Order = "updated" | "created" | "starts";
const orderLabels: Record<Order, () => string> = {
  updated: () => m.studio_order_updated(),
  created: () => m.studio_order_created(),
  starts: () => m.studio_order_starts(),
};

/** The studio's events column: the open team's events. */
export class EventsColumn {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly region = () =>
    this.page.getByRole("region", { name: "Events" });
  private readonly link = (title: string | RegExp) =>
    this.region().getByRole("link", { name: title });

  /** Creates an event in the open team and returns its id. */
  async newEvent(): Promise<string> {
    const before = this.page.url();
    await this.page.getByRole("button", { name: "New event" }).click();
    // Wait for the new event, also when another one was open.
    await expect(this.page).not.toHaveURL(before);
    await expect(this.page).toHaveURL(
      /\/studio\/teams\/[0-9a-f-]+\/events\/[0-9a-f-]+$/,
    );
    return new URL(this.page.url()).pathname.split("/").pop() ?? "";
  }

  /** The event is listed, saying `status` if given ("Draft", "Published"). */
  async expectEvent(title: string | RegExp, status?: string): Promise<void> {
    if (status === undefined) await expect(this.link(title)).toBeVisible();
    else await expect(this.link(title)).toContainText(status);
  }

  async expectNoEvent(title: string | RegExp): Promise<void> {
    await expect(this.link(title)).toHaveCount(0);
  }

  async expectEmpty(): Promise<void> {
    await expect(this.region().getByText("No events yet.")).toBeVisible();
  }

  private readonly row = (path: string) =>
    this.page
      .getByRole("listitem")
      .filter({ has: this.page.locator(`a[href="${path}"]`) });

  /** The event's row, by its studio address, says `text`. */
  async expectRow(path: string, text: string | RegExp): Promise<void> {
    await expect(this.row(path)).toContainText(text);
  }

  /** The event's row, by its studio address, does not say `text`. */
  async expectRowWithout(path: string, text: string): Promise<void> {
    await expect(this.row(path)).not.toContainText(text);
  }

  private readonly searchField = () =>
    this.region().getByRole("searchbox", { name: m.studio_events_search() });
  private readonly orderField = () =>
    this.region().getByRole("combobox", { name: m.studio_events_order() });

  /** Types `text` in the team's search field, replacing what was there. */
  async search(text: string): Promise<void> {
    await this.searchField().fill(text);
  }

  async expectSearchText(text: string): Promise<void> {
    await expect(this.searchField()).toHaveValue(text);
  }

  /** Picks an order for the lists. */
  async chooseOrder(order: Order): Promise<void> {
    await this.orderField().selectOption({ label: orderLabels[order]() });
  }

  /** The order choice says `order`. */
  async expectOrder(order: Order): Promise<void> {
    await expect(this.orderField().locator("option:checked")).toHaveText(
      orderLabels[order](),
    );
  }

  /** The team's events are exactly these, in this order. */
  async expectTitles(titles: ReadonlyArray<string | RegExp>): Promise<void> {
    await expect(
      this.region().getByRole("listitem").getByRole("link"),
    ).toContainText([...titles]);
  }

  async expectNothingFound(): Promise<void> {
    await expect(this.region().getByText(m.studio_no_matches())).toBeVisible();
  }

  /** Opens the event with this title in the list. */
  async open(title: string | RegExp): Promise<void> {
    await this.link(title).click();
  }
}
