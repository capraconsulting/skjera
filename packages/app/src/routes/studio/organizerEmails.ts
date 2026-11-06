/** How many of the signups an email to those signed up goes to: those with an email address. */
export const recipientCount = (
  attendees: ReadonlyArray<{
    readonly details: { readonly email: string | null } | null;
  }>,
) => attendees.filter((attendee) => attendee.details?.email != null).length;

/** The field that is empty or only spaces, as the server trims it: the subject first, else the text. */
export const missingField = (email: {
  readonly subject: string;
  readonly text: string;
}): "subject" | "text" | null =>
  email.subject.trim() === ""
    ? "subject"
    : email.text.trim() === ""
      ? "text"
      : null;
