import type { AttendeeRow, ShownEvent } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { useId } from "react";
import styles from "./Signups.module.css";

/** Who has signed up, by name, members and guests apart: for members. */
export function Signups(props: {
  readonly event: ShownEvent;
  readonly signups: ReadonlyArray<AttendeeRow>;
}) {
  // Oldest first. One's own new signup has no name until it's synced.
  const named = props.signups
    .toSorted((a, b) => a.signedUpAt.getTime() - b.signedUpAt.getTime())
    .flatMap(({ id, details }) =>
      details === null
        ? []
        : [{ id, name: details.name, guest: details.guest }],
    );
  const members = named.filter((who) => !who.guest);
  const guests = named.filter((who) => who.guest);
  return (
    <section className={styles.signups} aria-label={m.attend_who_is_coming()}>
      <h2 className={styles.heading}>{m.attend_who_is_coming()}</h2>
      <People
        heading={m.attend_members_count({ count: members.length })}
        nobody={m.attend_no_members()}
        people={members}
      />
      {props.event.allowGuests ? (
        <People
          heading={m.attend_guests_count({ count: guests.length })}
          nobody={m.attend_no_guests()}
          people={guests}
        />
      ) : null}
    </section>
  );
}

/** One kind: a region named by its heading, then the names or `nobody`. */
function People(props: {
  readonly heading: string;
  readonly nobody: string;
  readonly people: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
  }>;
}) {
  const heading = useId();
  return (
    <section aria-labelledby={heading}>
      <h3 id={heading} className={styles.kind}>
        {props.heading}
      </h3>
      {props.people.length === 0 ? (
        <p className={styles.empty}>{props.nobody}</p>
      ) : (
        <ul className={styles.list}>
          {props.people.map((who) => (
            <li key={who.id}>{who.name}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
