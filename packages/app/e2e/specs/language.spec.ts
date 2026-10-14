import { expect, test } from "@playwright/test";
import { Header } from "../pom/Header.ts";
import { Mailbox } from "../pom/Mailbox.ts";
import { Attendance } from "../pom/site/Attendance.ts";
import { EventPage } from "../pom/site/EventPage.ts";
import { cleanUp } from "../pom/studio/cleanUp.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";
import { signedIn, uniqueTeamName, visitor } from "../pom/support.ts";

test("visitors pick their language, and get emails in it", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Språk"));
  const event = await new EventEditor(alice).createPublished({
    public: true,
    guests: true,
  });
  const address = `nora-${crypto.randomUUID()}@example.org`;

  const nora = await visitor(browser);
  const header = new Header(nora);
  const page = new EventPage(nora);
  await page.goto(event.id);
  await header.expectPageLanguage("en");
  await header.selectLanguage("Bokmål");
  // The page comes back in it, dates too; the event as it was written.
  await header.expectPageLanguage("nb");
  const box = new Attendance(nora, "Påmelding");
  await box.expectText("Ingen har meldt seg på ennå.");
  await box.expectText(/Påmeldingen stenger \S+dag \d+\. \S+ \d{4}/);
  await page.expectHeading(event.title);

  await box.fillField("Navnet ditt", "Nora");
  await box.fillField("E-postadressen din", address);
  await box.clickSignUp("Meld meg på");
  await box.expectSignedUp("Du er påmeldt.");
  const email = await new Mailbox().emailTo(
    address,
    `Du er påmeldt: ${event.title}`,
  );
  expect(email.text).toContain("Hei Nora,");

  // The server's refusals come in it too.
  const other = await visitor(browser);
  await new EventPage(other).goto(event.id);
  await new Header(other).selectLanguage("Bokmål");
  const form = new Attendance(other, "Påmelding");
  await form.fillField("Navnet ditt", "Nora");
  await form.fillField("E-postadressen din", address);
  await form.clickSignUp("Meld meg på");
  await form.expectExactAlert(
    "Den e-postadressen er allerede påmeldt dette arrangementet",
  );

  // Remembered.
  await page.reload();
  await header.expectPageLanguage("nb");
  await header.expectLanguagePicked("nb", "Språk");

  await cleanUp(alice, team, event.id);
});

test("the studio speaks Nynorsk too", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Nynorsk"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });
  const header = new Header(alice);

  await header.selectLanguage("Nynorsk");
  await header.expectPageLanguage("nn");
  await editor.field("Tittel").expectText(event.title);
  await editor.expectStatus("Lagra");
  await editor.expectStatus("Publisert");
  await editor.expectButton("Slett");
  // The calendar, in it too.
  await editor.times.openStartDate("Startdato");
  await editor.times.expectCalendarButton(/neste månad/i);
  await editor.times.closeCalendar();

  await header.selectLanguage("English", "Språk");
  await header.expectPageLanguage("en");
  await editor.delete(event.id);
  await new TeamsColumn(alice).delete(team);
});
