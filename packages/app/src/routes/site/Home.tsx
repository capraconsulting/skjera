import { useLiveQuery } from "@tanstack/react-db";
import { Link } from "react-router";
import { Badge } from "../../components/Badge.tsx";
import { events as eventsTable } from "../../sync/tables.ts";
import { formatLongDate } from "../../time.ts";
import styles from "./Home.module.css";

/** Waits for the copy of the published events. */
export const homeLoader = async () => {
  await eventsTable.collection.preload();
  return null;
};

const excerpt = (body: string) =>
  body.length > 200 ? `${body.slice(0, 200).trimEnd()}…` : body;

export function Home() {
  // By date, earliest first.
  const events = useLiveQuery((q) =>
    q
      .from({ event: eventsTable.collection })
      .orderBy(({ event }) => event.date)
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
              <time className={styles.date} dateTime={event.date}>
                {formatLongDate(event.date)}
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
