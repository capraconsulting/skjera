import { expect } from "@playwright/test";
import { m } from "@skjera/i18n/messages";
import { locales } from "@skjera/i18n/runtime";
import { mailpitApiUrl } from "@skjera/test";

/** Mailpit's API (compose.yml): where the server's emails go in development. */
const mailpit = async (path: string, init?: RequestInit) => {
  const response = await fetch(`${mailpitApiUrl}${path}`, init);
  if (!response.ok) throw new Error(`Mailpit: ${response.status} ${path}`);
  return response.headers.get("content-type")?.includes("json")
    ? response.json()
    : response.text();
};

interface MailpitSummary {
  readonly ID: string;
  readonly Subject: string;
}

/** An email as it came: its text, and all of it as MIME. */
export interface Email {
  readonly text: string;
  readonly raw: string;
}

/** What an email's calendar invitation says, where it says it. */
export interface Invitation {
  readonly location: string | undefined;
  /** The whole ORGANIZER line, with the name and the address. */
  readonly organizer: string | undefined;
  readonly description: string | undefined;
}

/** The calendar invitation in an email, its lines unfolded. */
export const invitationOf = (email: Email): Invitation => {
  const begin = email.raw.indexOf("BEGIN:VCALENDAR");
  const end = email.raw.indexOf("END:VCALENDAR", begin);
  const ics = email.raw.slice(begin, end).replace(/\r?\n[ \t]/g, "");
  const line = (name: string) =>
    ics.match(new RegExp(`^${name}[;:][^\\r\\n]*`, "m"))?.[0];
  /** A line's value, its text unescaped. */
  const value = (name: string) =>
    line(name)
      ?.replace(/^[^:]*:/, "")
      .replace(/\\n/g, "\n")
      .replace(/\\([,;\\])/g, "$1");
  return {
    location: value("LOCATION"),
    organizer: line("ORGANIZER"),
    description: value("DESCRIPTION"),
  };
};

/** The emails the server sends, in Mailpit. */
export class Mailbox {
  /** The email to `address` with `subject`, once it has come. */
  async emailTo(address: string, subject: string): Promise<Email> {
    let found: MailpitSummary | undefined;
    await expect
      .poll(
        async () => {
          const { messages } = (await mailpit(
            `/search?query=${encodeURIComponent(`to:"${address}"`)}`,
          )) as { messages: ReadonlyArray<MailpitSummary> };
          found = messages.find((message) => message.Subject === subject);
          return found !== undefined;
        },
        { message: `an email to ${address}: ${subject}` },
      )
      .toBe(true);
    const { Text } = (await mailpit(`/message/${found?.ID}`)) as {
      readonly Text: string;
    };
    const raw = (await mailpit(`/message/${found?.ID}/raw`)) as string;
    return { text: Text, raw };
  }

  /** The subjects of the emails to `address`, as they are now. */
  async subjectsTo(address: string): Promise<ReadonlyArray<string>> {
    const { messages } = (await mailpit(
      `/search?query=${encodeURIComponent(`to:"${address}"`)}`,
    )) as { messages: ReadonlyArray<MailpitSummary> };
    return messages.map((message) => message.Subject);
  }

  /** Clears the emails to `address` out. */
  async deleteEmailsTo(address: string): Promise<void> {
    await mailpit(`/search?query=${encodeURIComponent(`to:"${address}"`)}`, {
      method: "DELETE",
    });
  }

  /**
   * Waits for the `count` emails saying the event titled `title` is
   * cancelled, in each one's language, and clears them out with the other
   * emails about the event `id` (they link to it).
   */
  async clearCancellations(
    id: string,
    title: string,
    count: number,
  ): Promise<void> {
    // (Titles are unique: see EventEditor.createPublished.)
    const subjects: ReadonlyArray<string> = locales.map((locale) =>
      m.email_cancelled_subject({ title }, { locale }),
    );
    const cancelled = async () => {
      // Mailpit matches subjects by what they contain: "Signup cancelled: …"
      // too.
      const { messages } = (await mailpit(
        `/search?query=${encodeURIComponent(`subject:"${title}"`)}`,
      )) as { messages: ReadonlyArray<MailpitSummary> };
      return messages.filter((message) => subjects.includes(message.Subject));
    };
    if (count > 0) {
      await expect.poll(async () => (await cancelled()).length).toBe(count);
      await mailpit("/messages", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          IDs: (await cancelled()).map((each) => each.ID),
        }),
      });
    }
    await mailpit(`/search?query=${encodeURIComponent(`"${id}"`)}`, {
      method: "DELETE",
    });
  }
}
