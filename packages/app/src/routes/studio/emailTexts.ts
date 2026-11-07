import {
  type EmailField,
  type EventContent,
  organizerEmails,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";

export const emails = organizerEmails.map((email) => ({
  ...email,
  name: m[email.name],
  subjectLabel: m[email.subjectLabel],
  textLabel: m[email.textLabel],
}));

type EmailOpening = Pick<
  (typeof organizerEmails)[number],
  "subject" | "text" | "openFromStart"
>;

/** Something is written in the draft: not only spaces and block markers. */
export const isWritten = (value: string | undefined) =>
  value !== undefined && value.replace(/[\s￼]+/g, "") !== "";

/**
 * Open from the start: the sign-up email always, since everyone signing up
 * gets it; another only when something is written for it.
 */
export const opensFromStart = (
  content: Partial<Pick<EventContent, EmailField>>,
  email: EmailOpening,
) =>
  email.openFromStart ||
  isWritten(content[email.subject]) ||
  isWritten(content[email.text]);
