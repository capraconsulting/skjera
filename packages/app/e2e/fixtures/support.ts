import type {
  Browser,
  BrowserContextOptions,
  Page,
  WebSocketRoute,
} from "@playwright/test";
import { Header } from "../pom/Header.ts";
import { LoginPage } from "../pom/LoginPage.ts";

/** A browser of its own, with no session. */
export const visitor = async (
  browser: Browser,
  options?: BrowserContextOptions,
): Promise<Page> => (await browser.newContext(options)).newPage();

/** A browser of its own for a Dex test user, logged in to the studio. */
export const signedIn = async (
  browser: Browser,
  email: string,
): Promise<Page> => {
  const page = await visitor(browser);
  await page.goto("/studio/teams");
  await new LoginPage(page).signIn(email);
  await new Header(page).expectSignedInAs(email);
  return page;
};

/** A team name no other test run uses. */
export const uniqueTeamName = (label: string): string =>
  `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Controls a page's live connections to the server: its WebSockets.
 * Set it up before the page opens the socket, e.g. before navigating.
 */
export const connection = async (page: Page) => {
  let online = true;
  const open = new Set<WebSocketRoute>();
  await page.routeWebSocket(/\/automerge$/, (ws) => {
    if (!online) {
      ws.close();
      return;
    }
    ws.connectToServer();
    open.add(ws);
  });
  return {
    offline: async () => {
      online = false;
      for (const ws of open) await ws.close();
      open.clear();
    },
    online: () => {
      online = true;
    },
  };
};
