import { m } from "@skjera/i18n/messages";

/** "Gina Guest - gina@example.org", or the email alone. */
export const invitedAs = (invitation: {
  readonly name: string | null;
  readonly email: string;
}) =>
  invitation.name === null
    ? invitation.email
    : `${invitation.name} - ${invitation.email}`;

/** «Invitasjoner (N)», «Ingen invitasjoner» when there are none, «Invitasjoner» while loading. */
export const invitationsHeading = (count: number | null) =>
  count === null
    ? m.studio_invitations()
    : count === 0
      ? m.studio_invitations_none()
      : m.studio_invitations_count({ count });
