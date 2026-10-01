import type { DocumentId } from "@skjera/documents/api";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import {
  attendees as attendeesTable,
  events,
  type Removal,
} from "../../sync/tables.ts";
import styles from "./Attendees.module.css";
import { attendeesCsv, download } from "./attendeesCsv.ts";

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
  const event = useLiveQuery(
    (q) =>
      q
        .from({ event: events.collection })
        .where(({ event }) => eq(event.id, id))
        .findOne(),
    [id],
  ).data;
  const [error, setError] = useState<string | null>(null);

  const remove = (attendee: string, name: string) => {
    if (!window.confirm(`Take ${name} off this event?`)) return;
    setError(null);
    const removal: Removal = { asOrganizer: true };
    attendeesTable.collection
      .delete(attendee, { metadata: removal })
      .isPersisted.promise.catch((failure: Error) => setError(failure.message));
  };

  const exportCsv = () =>
    download(
      attendeesCsv(event, attendees ?? []),
      `${event?.title.trim() || "Event"} attendees.csv`,
      "text/csv;charset=utf-8",
    );

  return (
    <section className={styles.attendees} aria-label="Attendees">
      <div className={styles.header}>
        <h3 className={styles.heading}>
          Attendees{attendees === null ? "" : ` (${attendees.length})`}
        </h3>
        {attendees === null || attendees.length === 0 ? null : (
          <Button variant="ghost" onClick={exportCsv}>
            Download CSV
          </Button>
        )}
      </div>
      {error === null ? null : (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
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
                <Button
                  variant="ghost"
                  className={styles.remove}
                  aria-label={`Remove ${who.name}`}
                  onClick={() => remove(id, who.name)}
                >
                  Remove
                </Button>
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
