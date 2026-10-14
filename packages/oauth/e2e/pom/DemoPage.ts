import { expect, type Page, type Response } from "@playwright/test";

/** The cookies the demo's session is kept in. */
export interface SessionCookies {
  readonly session?: { readonly httpOnly: boolean; readonly sameSite: string };
  readonly login: boolean;
}

/**
 * The demo server's page (dev/server.ts): who is logged in, with links to
 * log in and out, and the login routes it serves.
 */
export class DemoPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly status = () => this.page.locator("#status");

  async goto(): Promise<void> {
    await this.page.goto("/");
  }

  /** Starts logging in, returning to `returnTo` if given. */
  async gotoLogin(returnTo?: string): Promise<void> {
    await this.page.goto(
      returnTo === undefined
        ? "/auth/login"
        : `/auth/login?returnTo=${returnTo}`,
    );
  }

  async clickLogIn(): Promise<void> {
    await this.page.locator("#login").click();
  }

  async clickLogOut(): Promise<void> {
    await this.page.locator("#logout").click();
  }

  async expectLoggedOut(): Promise<void> {
    await expect(this.status()).toHaveText("Not logged in");
  }

  async expectLoggedInAs(email: string): Promise<void> {
    await expect(this.status()).toHaveText(`Logged in as ${email}`);
  }

  async expectAt(path: string): Promise<void> {
    await expect(this.page).toHaveURL(path);
  }

  /** What the page shows: the text of its body, e.g. JSON or a refusal. */
  async bodyText(): Promise<string> {
    return (await this.page.locator("body").textContent()) ?? "";
  }

  async expectBodyText(text: string): Promise<void> {
    await expect(this.page.locator("body")).toHaveText(text);
  }

  async cookies(): Promise<SessionCookies> {
    const cookies = await this.page.context().cookies();
    const session = cookies.find((cookie) => cookie.name === "skjera_session");
    return {
      ...(session === undefined
        ? {}
        : {
            session: { httpOnly: session.httpOnly, sameSite: session.sameSite },
          }),
      login: cookies.some((cookie) => cookie.name === "skjera_login"),
    };
  }

  /** Records the provider's callback, as the browser follows it. */
  watchCallback(): { readonly url: () => string | undefined } {
    let url: string | undefined;
    this.page.on("request", (request) => {
      if (request.url().includes("/auth/callback")) url = request.url();
    });
    return { url: () => url };
  }

  /** The response to the provider's callback, once it comes. */
  callbackResponse(): Promise<Response> {
    return this.page.waitForResponse((response) =>
      response.url().includes("/auth/callback"),
    );
  }

  /** Opens `url` again, e.g. a callback; returns its status. */
  async revisit(url: string): Promise<number | undefined> {
    return (await this.page.goto(url))?.status();
  }
}
