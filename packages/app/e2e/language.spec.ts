import { expect, test } from "@playwright/test";
import {
  deleteEvent,
  deleteTeam,
  emailTo,
  newTeam,
  publishedEvent,
  signedIn,
  uniqueTeamName,
  visitor,
} from "./helpers.ts";

test("visitors pick their language, and get emails in it", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Språk"));
  const event = await publishedEvent(alice, { public: true, guests: true });
  const address = `nora-${crypto.randomUUID()}@example.org`;

  const nora = await visitor(browser);
  await nora.goto(`/events/${event.id}`);
  await expect(nora.locator("html")).toHaveAttribute("lang", "en");
  await nora.getByRole("combobox", { name: "Language" }).selectOption("Bokmål");
  // The page comes back in it, dates too; the event as it was written.
  await expect(nora.locator("html")).toHaveAttribute("lang", "nb");
  const box = nora.getByRole("region", { name: "Påmelding" });
  await expect(box).toContainText("Ingen har meldt seg på ennå.");
  await expect(box).toContainText(/Påmeldingen stenger \S+dag \d+\. \S+ \d{4}/);
  await expect(nora.getByRole("heading", { name: event.title })).toBeVisible();

  await box.getByRole("textbox", { name: "Navnet ditt" }).fill("Nora");
  await box.getByRole("textbox", { name: "E-postadressen din" }).fill(address);
  await box.getByRole("button", { name: "Meld meg på" }).click();
  await expect(box).toContainText("Du er påmeldt.");
  const email = await emailTo(address, `Du er påmeldt: ${event.title}`);
  expect(email.text).toContain("Hei Nora,");

  // The server's refusals come in it too.
  const other = await visitor(browser);
  await other.goto(`/events/${event.id}`);
  await other
    .getByRole("combobox", { name: "Language" })
    .selectOption("Bokmål");
  const form = other.getByRole("region", { name: "Påmelding" });
  await form.getByRole("textbox", { name: "Navnet ditt" }).fill("Nora");
  await form.getByRole("textbox", { name: "E-postadressen din" }).fill(address);
  await form.getByRole("button", { name: "Meld meg på" }).click();
  await expect(form.getByRole("alert")).toHaveText(
    "Den e-postadressen er allerede påmeldt dette arrangementet",
  );

  // Remembered.
  await nora.reload();
  await expect(nora.locator("html")).toHaveAttribute("lang", "nb");
  await expect(nora.getByRole("combobox", { name: "Språk" })).toHaveValue("nb");

  await alice.goto(`/studio/teams/${team}/events/${event.id}`);
  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("the studio speaks Nynorsk too", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Nynorsk"));
  const event = await publishedEvent(alice, { public: true });

  await alice
    .getByRole("combobox", { name: "Language" })
    .selectOption("Nynorsk");
  await expect(alice.locator("html")).toHaveAttribute("lang", "nn");
  await expect(alice.getByRole("textbox", { name: "Tittel" })).toHaveText(
    event.title,
  );
  await expect(alice.getByTestId("status")).toContainText("Lagra");
  await expect(alice.getByTestId("status")).toContainText("Publisert");
  await expect(alice.getByRole("button", { name: "Slett" })).toBeVisible();
  // The calendar, in it too.
  await alice.getByRole("button", { name: "Startdato" }).click();
  await expect(
    alice.getByRole("button", { name: /neste månad/i }),
  ).toBeVisible();
  await alice.keyboard.press("Escape");

  await alice.getByRole("combobox", { name: "Språk" }).selectOption("English");
  await expect(alice.locator("html")).toHaveAttribute("lang", "en");
  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});
