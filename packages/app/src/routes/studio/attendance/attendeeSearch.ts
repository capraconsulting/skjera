import type { AttendeeDetails } from "@skjera/documents/api";

type Searchable = Pick<AttendeeDetails, "name" | "email" | "phone" | "company">;

/**
 * The attendees whose name, email, phone or company contains `text`,
 * ignoring case; all of them while `text` is blank.
 */
export const searchAttendees = <
  T extends { readonly details: Searchable | null },
>(
  attendees: ReadonlyArray<T>,
  text: string,
): ReadonlyArray<T> => {
  const needle = text.trim().toLowerCase();
  if (needle === "") return attendees;
  return attendees.filter(
    ({ details }) =>
      details !== null &&
      [details.name, details.email, details.phone, details.company].some(
        (field) => field?.toLowerCase().includes(needle) === true,
      ),
  );
};
