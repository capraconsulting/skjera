import type { EventRow, RichText } from "@skjera/documents/api";
import { useLiveQuery } from "@tanstack/react-db";
import { useQueryState } from "nuqs";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { Badge } from "../../components/Badge.tsx";
import { plainText } from "../../components/RichText.tsx";
import { events as eventsTable } from "../../sync/tables.ts";
import { sameTag, uniqueTags } from "../../tags.ts";
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

/** The time now, a minute at a time: when events start and end. */
const useNow = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
};

export function Home() {
  const events = useLiveQuery((q) =>
    q.from({ event: eventsTable.collection }),
  ).data;
  const now = useNow();
  // The tag picked, in the URL as ?tag=, to share or come back to.
  const [picked, setPicked] = useQueryState("tag");

  const active = events.filter((event) => event.endsAt > now);
  // Filters only for what's coming up or going on.
  const tags = uniqueTags(active.flatMap((event) => event.tags)).toSorted(
    (a, b) => a.localeCompare(b),
  );
  const tag =
    picked === null
      ? null
      : (tags.find((each) => sameTag(each, picked)) ?? picked);
  const shown = events.filter(
    (event) => tag === null || event.tags.some((each) => sameTag(each, tag)),
  );
  const pick = (next: string | null) => void setPicked(next);

  const upcoming = shown
    .filter((event) => event.endsAt > now)
    .toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const past = shown
    .filter((event) => event.endsAt <= now)
    .toSorted((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

  if (events.length === 0) {
    return (
      <div className={styles.home}>
        <h1 className={styles.heading}>Events</h1>
        <p className={styles.empty}>Nothing has been published yet.</p>
      </div>
    );
  }

  return (
    <div className={styles.home}>
      <h1 className={styles.heading}>Events</h1>
      {tags.length === 0 && tag === null ? null : (
        <nav className={styles.filters} aria-label="Filter by tag">
          <button
            type="button"
            className={styles.filter}
            aria-pressed={tag === null}
            onClick={() => pick(null)}
          >
            All
          </button>
          {(tag === null || tags.some((each) => sameTag(each, tag))
            ? tags
            : [...tags, tag]
          ).map((each) => (
            <button
              key={each.toLowerCase()}
              type="button"
              className={styles.filter}
              aria-pressed={tag !== null && sameTag(each, tag)}
              onClick={() =>
                pick(tag !== null && sameTag(each, tag) ? null : each)
              }
            >
              {each}
            </button>
          ))}
        </nav>
      )}
      <Section
        title="Upcoming and ongoing"
        events={upcoming}
        now={now}
        empty={
          tag === null
            ? "Nothing coming up right now."
            : `Nothing tagged “${tag}” coming up.`
        }
      />
      {past.length === 0 ? null : (
        <Section title="Past" events={past} now={now} empty="" />
      )}
    </div>
  );
}

function Section(props: {
  readonly title: string;
  readonly events: ReadonlyArray<EventRow>;
  readonly now: Date;
  readonly empty: string;
}) {
  const headingId = useId();
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.sectionHeading}>
        {props.title}
      </h2>
      {props.events.length === 0 ? (
        <p className={styles.empty}>{props.empty}</p>
      ) : (
        <div className={styles.list}>
          {props.events.map((event) => (
            <Teaser key={event.id} event={event} now={props.now} />
          ))}
        </div>
      )}
    </section>
  );
}

function Teaser(props: { readonly event: EventRow; readonly now: Date }) {
  const { event, now } = props;
  const ongoing = event.startsAt <= now && now < event.endsAt;
  return (
    <article className={styles.teaser}>
      {event.cover === null ? null : (
        // Decorative here: the title next to it says what it is.
        <img
          className={styles.cover}
          src={event.cover.src}
          alt=""
          loading="lazy"
        />
      )}
      <time className={styles.date} dateTime={event.startsAt.toISOString()}>
        {formatEventTimes(event.startsAt, event.endsAt, event.timeZone)}
      </time>
      <h3>
        <Link to={`/events/${event.id}`}>{event.title}</Link>
      </h3>
      <div className={styles.badges}>
        {ongoing ? <Badge tone="success">Happening now</Badge> : null}
        {event.isPublic ? null : <Badge tone="neutral">Members only</Badge>}
        {event.tags.map((tag) => (
          <span key={tag.toLowerCase()} className={styles.tag}>
            {tag}
          </span>
        ))}
      </div>
      <p className={styles.excerpt}>{excerpt(event.body)}</p>
    </article>
  );
}
