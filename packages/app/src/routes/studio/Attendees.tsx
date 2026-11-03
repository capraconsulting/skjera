import type { DocumentId } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useEffect, useState } from "react";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { Input } from "../../components/Input.tsx";
import {
  attendees as attendeesTable,
  dietaryPreferences,
  events,
  type Removal,
} from "../../sync/tables.ts";
import styles from "./Attendees.module.css";
import { searchAttendees } from "./attendeeSearch.ts";
import { answerText, attendeesCsv, download } from "./attendeesCsv.ts";

/** Who has signed up to attend, for the event's organizers. */
export function Attendees(props: { readonly id: DocumentId }) {
  const { id } = props;
  const { data, isReady } = useLiveQuery({
    query: (q) =>
      q
        .from({ attendee: attendeesTable.collection })
        .where(({ attendee }) => eq(attendee.eventId, id))
        .orderBy(({ attendee }) => attendee.signedUpAt),
  });
  const attendees = isReady ? data : null;
  const event = useLiveQuery({
    query: (q) =>
      q
        .from({ event: events.collection })
        .where(({ event }) => eq(event.id, id))
        .findOne(),
  }).data;
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const remove = (attendee: string, name: string) => {
    if (!window.confirm(m.studio_take_off({ name }))) return;
    setError(null);
    const removal: Removal = { asOrganizer: true };
    attendeesTable.collection
      .delete(attendee, { metadata: removal })
      .isPersisted.promise.catch((failure: Error) => setError(failure.message));
  };

  const exportCsv = () =>
    download(
      attendeesCsv(event, attendees ?? []),
      m.studio_attendees_file({
        title: event?.title.trim() || m.studio_event(),
      }),
      "text/csv;charset=utf-8",
    );

  return (
    <>
      <section className={styles.attendees} aria-label={m.studio_attendees()}>
        <div className={styles.header}>
          <h3 className={styles.heading}>
            {attendees === null
              ? m.studio_attendees()
              : m.studio_attendees_count({ count: attendees.length })}
          </h3>
          {attendees === null || attendees.length === 0 ? null : (
            <Button variant="ghost" onClick={exportCsv}>
              {m.studio_download_csv()}
            </Button>
          )}
        </div>
        {error === null ? null : (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {attendees === null ? null : attendees.length === 0 ? (
          <p className={styles.empty}>{m.attend_nobody()}</p>
        ) : (
          <>
            <div className={styles.form}>
              <Input
                type="search"
                aria-label={m.studio_attendees_search()}
                placeholder={m.studio_attendees_search()}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <ul className={styles.list}>
              {searchAttendees(attendees, search).map(
                ({ id, details: who, online }) =>
                  // Signed-in users always see who signed up.
                  who === null ? null : (
                    <li key={id} className={styles.item}>
                      {who.name}
                      {who.email === null ? null : (
                        <span className={styles.email}>{who.email}</span>
                      )}
                      {who.phone === null ? null : (
                        <span className={styles.email}>{who.phone}</span>
                      )}
                      {who.company === null ? null : (
                        <span className={styles.email}>{who.company}</span>
                      )}
                      {who.guest ? (
                        <Badge tone="neutral">{m.studio_guest()}</Badge>
                      ) : null}
                      {event?.isStreamed ? (
                        <Badge tone="neutral">
                          {online ? m.attend_online() : m.attend_in_person()}
                        </Badge>
                      ) : null}
                      <Button
                        variant="ghost"
                        className={styles.remove}
                        aria-label={m.studio_remove_name({ name: who.name })}
                        onClick={() => remove(id, who.name)}
                      >
                        {m.common_remove()}
                      </Button>
                      {who.answers.length === 0 ? null : (
                        <dl className={styles.answers}>
                          {who.answers.map((answer) => (
                            <div key={answer.question}>
                              <dt>{answer.question}</dt>
                              <dd>{answerText(answer)}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </li>
                  ),
              )}
            </ul>
          </>
        )}
      </section>
      <DietaryPreferences id={id} asks={event?.askDietary === true} />
    </>
  );
}

/**
 * What people can't eat, as a list without names. Read once, when the event
 * is opened, and not as signups change: a list that updated live would show
 * each new text beside the new name.
 */
function DietaryPreferences(props: {
  readonly id: DocumentId;
  readonly asks: boolean;
}) {
  const { id, asks } = props;
  const [given, setGiven] = useState<ReadonlyArray<string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setGiven(null);
    setError(null);
    dietaryPreferences(id).then(
      (texts) => {
        if (current) setGiven(texts);
      },
      (failure: Error) => {
        if (current) setError(failure.message);
      },
    );
    return () => {
      current = false;
    };
  }, [id]);

  if (!asks && (given === null || given.length === 0)) return null;
  return (
    <section
      className={styles.dietaryPreferences}
      aria-label={m.attend_dietary()}
    >
      <div className={styles.header}>
        <h3 className={styles.heading}>
          {given === null
            ? m.attend_dietary()
            : m.studio_dietary_count({ count: given.length })}
        </h3>
      </div>
      {error === null ? null : (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {given === null ? null : given.length === 0 ? (
        <p className={styles.empty}>{m.studio_dietary_none()}</p>
      ) : (
        <ul className={styles.list}>
          {given.map((text, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the same text can be given twice, and nothing else tells them apart
            <li key={index} className={styles.item}>
              {text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
