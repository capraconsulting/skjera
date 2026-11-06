import type { EventContent } from "@skjera/documents/api";

/** The draft's keys for the emails' own subjects and texts. */
export type EmailField =
  | "signedUpSubject"
  | "signedUpText"
  | "signupCancelledSubject"
  | "signupCancelledText"
  | "eventChangedSubject"
  | "eventChangedText"
  | "eventCancelledSubject"
  | "eventCancelledText";

/** The keys one email keeps its subject and text under. */
export interface EmailKeys {
  readonly subject: EmailField;
  readonly text: EmailField;
}

/** Something is written in the draft: not only spaces and block markers. */
export const isWritten = (value: string | undefined) =>
  value !== undefined && value.replace(/[\s￼]+/g, "") !== "";

/**
 * Open from the start: the sign-up email always, since everyone signing up
 * gets it; another only when something is written for it.
 */
export const opensFromStart = (
  content: Partial<Pick<EventContent, EmailField>>,
  email: EmailKeys,
) =>
  email.subject === "signedUpSubject" ||
  isWritten(content[email.subject]) ||
  isWritten(content[email.text]);
