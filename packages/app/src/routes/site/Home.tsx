import type { EventRow } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { getLocale } from "@skjera/i18n/runtime";
import { useLiveQuery } from "@tanstack/react-db";
import { ArrowDown, ArrowRight } from "lucide-react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { Organizer } from "../../components/Organizer.tsx";
import { rowMarks, upcomingAndPast } from "../../site/frontPage.ts";
import { guestSignup } from "../../site/guestSignups.ts";
import { attendees, events as eventsTable } from "../../sync/tables.ts";
import { sameTag, uniqueTags } from "../../tags.ts";
import styles from "./Home.module.css";

/** Waits for the copies of the published events and signups. */
export const homeLoader = async () => {
  await Promise.all([
    eventsTable.collection.preload(),
    attendees.collection.preload(),
  ]);
  return null;
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

/** The events signed up for here: as a member, or as a guest. */
const useSignedUp = () => {
  const signups = useLiveQuery((q) =>
    q.from({ attendee: attendees.collection }),
  ).data;
  return new Set(
    signups
      .filter(
        (signup) =>
          signup.mine || guestSignup(signup.eventId)?.id === signup.id,
      )
      .map((signup) => signup.eventId),
  );
};

/** Past events, a page at a time. */
const pastPage = 6;

/** Events open to guests, or not: ?guests=yes or ?guests=no. */
const guestChoices = ["yes", "no"] as const;
type GuestChoice = (typeof guestChoices)[number];

export function Home() {
  const events = useLiveQuery((q) =>
    q.from({ event: eventsTable.collection }),
  ).data;
  const now = useNow();
  const signedUp = useSignedUp();
  const [pastShown, setPastShown] = useState(pastPage);
  // The tag picked, in the URL as ?tag=, to share or come back to.
  const [picked, setPicked] = useQueryState("tag");
  // Open to guests or not, in the URL as ?guests=yes or ?guests=no.
  const [guests, setGuests] = useQueryState(
    "guests",
    parseAsStringLiteral(guestChoices),
  );

  const active = events.filter((event) => event.endsAt > now);
  // Filters only for what's coming up or going on.
  const tags = uniqueTags(active.flatMap((event) => event.tags)).toSorted(
    (a, b) => a.localeCompare(b, getLocale()),
  );
  const tag =
    picked === null
      ? null
      : (tags.find((each) => sameTag(each, picked)) ?? picked);
  const shown = events.filter(
    (event) =>
      (tag === null || event.tags.some((each) => sameTag(each, tag))) &&
      (guests === null || event.allowGuests === (guests === "yes")),
  );
  const pick = (next: string | null) => void setPicked(next);
  // Choosing the chosen one again removes it.
  const pickGuests = (next: GuestChoice) =>
    void setGuests(guests === next ? null : next);

  const { upcoming, past } = upcomingAndPast(shown, now);

  const upcomingId = useId();
  const pastId = useId();

  const filters =
    tags.length === 0 && tag === null ? null : (
      <nav className={styles.filters} aria-label={m.site_filter_by_tag()}>
        <button
          type="button"
          className={styles.filter}
          aria-pressed={tag === null}
          onClick={() => pick(null)}
        >
          {m.site_filter_all()}
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
            #{each}
          </button>
        ))}
      </nav>
    );

  return (
    <div className={styles.home}>
      <section className={styles.section} aria-labelledby={upcomingId}>
        <div className={styles.headingRow}>
          <h1 id={upcomingId} className={styles.heading}>
            {m.site_upcoming()}
          </h1>
          <div className={styles.filterGroups}>
            <nav
              className={styles.filters}
              aria-label={m.site_filter_by_guests()}
            >
              <button
                type="button"
                className={styles.filter}
                aria-pressed={guests === "yes"}
                onClick={() => pickGuests("yes")}
              >
                {m.site_filter_open_to_guests()}
              </button>
              <button
                type="button"
                className={styles.filter}
                aria-pressed={guests === "no"}
                onClick={() => pickGuests("no")}
              >
                {m.site_filter_not_open_to_guests()}
              </button>
            </nav>
            {filters}
          </div>
        </div>
        {events.length === 0 ? (
          <p className={styles.empty}>{m.site_nothing_published()}</p>
        ) : upcoming.length === 0 ? (
          <p className={styles.empty}>
            {tag === null
              ? m.site_nothing_upcoming()
              : m.site_nothing_upcoming_tagged({ tag })}
          </p>
        ) : (
          <ul className={styles.rows}>
            {upcoming.map((event) => (
              <li key={event.id}>
                <Row
                  event={event}
                  now={now}
                  signedUp={signedUp.has(event.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      {past.length === 0 ? null : (
        <section className={styles.section} aria-labelledby={pastId}>
          <h2 id={pastId} className={styles.heading}>
            {m.site_past()}
          </h2>
          <ul className={styles.cards}>
            {past.slice(0, pastShown).map((event) => (
              <li key={event.id}>
                <Card event={event} />
              </li>
            ))}
          </ul>
          {past.length > pastShown ? (
            <Button
              className={styles.more}
              onClick={() => setPastShown((count) => count + pastPage)}
            >
              {m.site_show_more()}
              <ArrowDown size={18} strokeWidth={1.5} aria-hidden="true" />
            </Button>
          ) : null}
        </section>
      )}
    </div>
  );
}

/** An event coming up, or going on: a row with what to know at a glance. */
function Row(props: {
  readonly event: EventRow;
  readonly now: Date;
  readonly signedUp: boolean;
}) {
  const { event, now } = props;
  const marks = rowMarks(event, now);
  return (
    <Link to={`/events/${event.id}`} className={styles.row}>
      <span className={styles.rowTitle}>{event.title}</span>
      <span className={styles.organizer}>
        <Organizer organizer={event.organizer} />
      </span>
      <span className={styles.rowBadges}>
        {marks.happeningNow ? (
          <Badge tone="success">{m.site_happening_now()}</Badge>
        ) : null}
        <Badge tone="neutral">{marks.audience}</Badge>
        {marks.tags.map((tag) => (
          <Badge key={tag.toLowerCase()} tone="neutral">
            {tag}
          </Badge>
        ))}
        <Badge tone="neutral">
          <time dateTime={event.startsAt.toISOString()}>{marks.when}</time>
        </Badge>
        {props.signedUp ? (
          <Badge tone="highlight">{m.site_signed_up()}</Badge>
        ) : null}
      </span>
      <ArrowRight
        className={styles.rowArrow}
        size={20}
        strokeWidth={1.5}
        aria-hidden="true"
      />
    </Link>
  );
}

/** An event that's over: its picture and its title. */
function Card(props: { readonly event: EventRow }) {
  const { event } = props;
  return (
    <Link to={`/events/${event.id}`} className={styles.card}>
      <span className={styles.cardImage}>
        {event.cover === null ? null : (
          // Decorative here: the title under it says what it is.
          <img src={event.cover.src} alt="" loading="lazy" />
        )}
      </span>
      <span className={styles.cardTitle}>{event.title}</span>
      <span className={styles.cardOrganizer}>
        <Organizer organizer={event.organizer} />
      </span>
    </Link>
  );
}
