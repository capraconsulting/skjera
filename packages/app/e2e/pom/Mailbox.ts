import { expect } from "@playwright/test";
import { m } from "@skjera/i18n/messages";
import { locales } from "@skjera/i18n/runtime";

/** Mailpit's API (compose.yml): where the server's emails go in development. */
const mailpit = async (path: string, init?: RequestInit) => {
  const response = await fetch(`http://localhost:8025/api/v1${path}`, init);
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
