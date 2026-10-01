import type { RichText } from "@skjera/documents/api";
import { useLiveQuery } from "@tanstack/react-db";
import { Link } from "react-router";
import { Badge } from "../../components/Badge.tsx";
import { plainText } from "../../components/RichText.tsx";
import { events as eventsTable } from "../../sync/tables.ts";
import { formatEventTimes } from "../../time.ts";
import styles from "./Home.module.css";

/** Waits for the copy of the published events. */
export const homeLoader = async () => {
  await eventsTable.collection.preload();
  return null;
};

const excerpt = (body: RichText) => {
  const text = plainText(body);
  return text.length > 200 ? `${text.slice(0, 200).trimEnd()}…` : text;
};

export function Home() {
  // Soonest first.
  const events = useLiveQuery((q) =>
    q
      .from({ event: eventsTable.collection })
      .orderBy(({ event }) => event.startsAt)
      .orderBy(({ event }) => event.firstPublishedAt),
  ).data;
  return (
    <div className={styles.home}>
      <h1 className={styles.heading}>Events</h1>
      {events.length === 0 ? (
        <p className={styles.empty}>Nothing has been published yet.</p>
      ) : (
        <div className={styles.list}>
          {events.map((event) => (
            <article key={event.id} className={styles.teaser}>
              {event.cover === null ? null : (
                // Decorative here: the title next to it says what it is.
                <img
                  className={styles.cover}
                  src={event.cover.src}
                  alt=""
                  loading="lazy"
                />
              )}
              <time
                className={styles.date}
                dateTime={event.startsAt.toISOString()}
              >
                {formatEventTimes(event.startsAt, event.endsAt, event.timeZone)}
              </time>
              <h2>
                <Link to={`/events/${event.id}`}>{event.title}</Link>
              </h2>
              {event.isPublic ? null : (
                <Badge tone="neutral">Members only</Badge>
              )}
              <p className={styles.excerpt}>{excerpt(event.body)}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
