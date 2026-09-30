import { Link, useLoaderData } from "react-router";
import { runPublic } from "../../site/client.ts";
import { formatLongDate } from "../../time.ts";
import styles from "./Home.module.css";

export const homeLoader = () => runPublic((client) => client.events.list());

const excerpt = (body: string) =>
  body.length > 200 ? `${body.slice(0, 200).trimEnd()}…` : body;

export function Home() {
  const events = useLoaderData<typeof homeLoader>();
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
              <p className={styles.excerpt}>{excerpt(event.body)}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
