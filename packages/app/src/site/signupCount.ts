import {
  type AttendeeRow,
  type EventRow,
  signupTakesPlace,
} from "@skjera/documents/api";

/**
 * Places left with a limit, null without one. Only those in person take a
 * place when the event is streamed; a limit set below those signed up leaves
 * none, never a negative number.
 */
export const placesLeft = (
  event: Pick<EventRow, "maxAttendees" | "isStreamed">,
  signups: ReadonlyArray<Pick<AttendeeRow, "online">>,
): number | null => {
  if (event.maxAttendees === null) return null;
  const taken = signups.filter((signup) =>
    signupTakesPlace(event.isStreamed, signup.online),
  );
  return Math.max(0, event.maxAttendees - taken.length);
};

/**
 * What a visitor not logged in is told of the signups: the places left, or
 * that none are left; nothing otherwise. None left is said whatever the
 * organiser hides, as the sign-up box does. Once the sign-up deadline has
 * passed the number of places left is not said, as nobody can take one. Nothing
 * for an event shown only to members: visitors are sent no signups of it to
 * count.
 */
export const placesForVisitor = (
  event: Pick<
    EventRow,
    "maxAttendees" | "isStreamed" | "hidePlacesLeft" | "isPublic"
  >,
  signups: ReadonlyArray<Pick<AttendeeRow, "online">>,
  deadlinePassed: boolean,
): { readonly left: number } | "none" | null => {
  if (!event.isPublic) return null;
  const left = placesLeft(event, signups);
  if (left === null) return null;
  if (left === 0) return "none";
  return event.hidePlacesLeft || deadlinePassed ? null : { left };
};
