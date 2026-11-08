/** How many of the signups an email to those signed up goes to: those with an email address. */
export const recipientCount = (
  attendees: ReadonlyArray<{
    readonly details: { readonly email: string | null } | null;
  }>,
) => attendees.filter((attendee) => attendee.details?.email != null).length;
