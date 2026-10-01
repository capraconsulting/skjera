import type { DocumentId } from "@skjera/documents/api";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Badge } from "../../components/Badge.tsx";
import { attendees as attendeesTable } from "../../sync/tables.ts";
import styles from "./Attendees.module.css";

/** Who has signed up to attend, for the event's organizers. */
export function Attendees(props: { readonly id: DocumentId }) {
  const { id } = props;
  const { data, isReady } = useLiveQuery(
    (q) =>
      q
        .from({ attendee: attendeesTable.collection })
        .where(({ attendee }) => eq(attendee.eventId, id))
        .orderBy(({ attendee }) => attendee.signedUpAt),
    [id],
  );
  const attendees = isReady ? data : null;

  return (
    <section className={styles.attendees} aria-label="Attendees">
      <h3 className={styles.heading}>
        Attendees{attendees === null ? "" : ` (${attendees.length})`}
      </h3>
      {attendees === null ? null : attendees.length === 0 ? (
        <p className={styles.empty}>Nobody has signed up yet.</p>
      ) : (
        <ul className={styles.list}>
          {attendees.map(({ id, details: who }) =>
            // Signed-in users always see who signed up.
            who === null ? null : (
              <li key={id} className={styles.item}>
                {who.name}
                {who.email === null ? null : (
                  <span className={styles.email}>{who.email}</span>
                )}
                {who.guest ? <Badge tone="neutral">Guest</Badge> : null}
                {who.dietary === null ? null : (
                  <span className={styles.dietary}>Diet: {who.dietary}</span>
                )}
                {who.answers.length === 0 ? null : (
                  <dl className={styles.answers}>
                    {who.answers.map(({ question, answer }) => (
                      <div key={question}>
                        <dt>{question}</dt>
                        <dd>{answer}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
