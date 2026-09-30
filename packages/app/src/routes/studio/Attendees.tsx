import type { Attendee, DocumentId } from "@skjera/documents/api";
import { useEffect, useState } from "react";
import { Badge } from "../../components/Badge.tsx";
import { call } from "../../documents/client.ts";
import styles from "./Attendees.module.css";

const refreshEvery = 15_000;

/** Who has signed up to attend, for the event's organizers. */
export function Attendees(props: { readonly id: DocumentId }) {
  const [attendees, setAttendees] = useState<ReadonlyArray<Attendee> | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    const load = () =>
      call((client) => client.ListAttendees({ id: props.id })).then(
        (list) => active && setAttendees(list),
        () => {},
      );
    void load();
    const timer = setInterval(load, refreshEvery);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [props.id]);

  return (
    <section className={styles.attendees} aria-label="Attendees">
      <h3 className={styles.heading}>
        Attendees{attendees === null ? "" : ` (${attendees.length})`}
      </h3>
      {attendees === null ? null : attendees.length === 0 ? (
        <p className={styles.empty}>Nobody has signed up yet.</p>
      ) : (
        <ul className={styles.list}>
          {attendees.map((attendee) => (
            <li
              key={`${attendee.email}-${attendee.signedUpAt.getTime()}`}
              className={styles.item}
            >
              {attendee.name}
              {attendee.email === null ? null : (
                <span className={styles.email}>{attendee.email}</span>
              )}
              {attendee.guest ? <Badge tone="neutral">Guest</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
