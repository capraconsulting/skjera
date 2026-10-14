import { expect, type Page } from "@playwright/test";

/** The calendar of coming events, as a calendar app subscribes to it. */
export class CalendarFeed {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Fetches the calendar, as the page's browser, and checks it is one. */
  async fetch(): Promise<SubscribedCalendar> {
    const response = await this.page.request.get("/api/subscribe");
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toMatch(/^text\/calendar/);
    const text = (await response.text()).replace(/\r?\n[ \t]/g, "");
    expect(text).toMatch(/^BEGIN:VCALENDAR/);
    return new SubscribedCalendar(text);
  }
}

/** A calendar as fetched: which events it holds, by their titles. */
export class SubscribedCalendar {
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  private readonly titles = () =>
    [...this.text.matchAll(/^SUMMARY:([^\r\n]*)/gm)].map((match) =>
      (match[1] ?? "").replace(/\\([,;\\])/g, "$1"),
    );

  expectEvent(title: string): void {
    expect(this.titles()).toContain(title);
  }

  expectNoEvent(title: string): void {
    expect(this.titles()).not.toContain(title);
  }
}
