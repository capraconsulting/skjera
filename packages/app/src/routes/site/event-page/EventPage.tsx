import {
  type AttendeeRow,
  DocumentId,
  type EventRow,
  type ShownEvent,
  shownCover,
  signupClosesAt,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { appPaths, appSearch } from "@skjera/paths";
import { defaultPollEveryMs } from "@skjera/snapsync/client";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Effect, Schema } from "effect";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Clock,
  Globe,
  Lock,
  MapPin,
  Users,
  UtensilsCrossed,
  Video,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  data,
  isRouteErrorResponse,
  Link,
  type LoaderFunctionArgs,
  redirect,
  useLoaderData,
  useRouteError,
  useRouteLoaderData,
} from "react-router";
import { Organizer } from "../../../components/Organizer.tsx";
import { RichText } from "../../../components/RichText.tsx";
import { usePageTitle } from "../../../pageTitle.ts";
import { rememberAdSource } from "../../../site/adSource.ts";
import { audience } from "../../../site/audience.ts";
import { runPublic } from "../../../site/client.ts";
import {
  rememberGuestSignup,
  storedGuestSignup,
} from "../../../site/guestSignups.ts";
import { placesForVisitor } from "../../../site/signupCount.ts";
import { attendees, events } from "../../../sync/tables.ts";
import { formatDaysIn, formatHoursIn } from "../../../time.ts";
import { Attend } from "../attendance/Attend.tsx";
import styles from "./EventPage.module.css";

export const eventPageStyles = { missing: styles.missing };

import type { siteLoader } from "../SiteLayout.tsx";
import { Signups } from "./Signups.tsx";
import { useHasPassed } from "./useHasPassed.ts";

/** The event whose link, just opened, led to no signup: said once. */
let goneLink: DocumentId | null = null;

const isDocumentId = Schema.is(DocumentId);

/**
 * The published event at `id`, members-only too, as anyone with its address
 * may read it: null when it isn't published. Not a part of the synced copy,
 * so the front page never lists it. Other failures reject.
 */
const linkedEvent = (id: DocumentId) =>
  runPublic((client) =>
    client.events
      .event({ params: { id } })
      .pipe(Effect.catchTag("EventNotFound", () => Effect.succeed(null))),
  );

/**
 * The event read by its address while the synced copy lacks it: the loader's
 * row at first, then read again every few seconds while the page is visible,
 * as the synced copy follows what is published. Null: not published.
 */
const useLinkedEvent = (
  id: DocumentId,
  loaded: EventRow | null,
  needed: boolean,
) => {
  const [read, setRead] = useState<{
    readonly id: DocumentId;
    readonly event: EventRow | null;
  }>({ id, event: loaded });
  useEffect(() => {
    if (!needed) return;
    let stopped = false;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const event = await linkedEvent(id);
        if (!stopped) setRead({ id, event });
      } catch {
        // Keeps what is shown; the next read tries again.
      }
    };
    void poll();
    const timer = setInterval(poll, defaultPollEveryMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [id, needed]);
  return read.id === id ? read.event : loaded;
};

export const eventLoader = async ({ params, request }: LoaderFunctionArgs) => {
  const id = params.id as DocumentId;
  // A guest's link to their signup, from an email: checked with the server
  // and remembered here, so they can change or cancel it, then out of the
  // address. A link that leads to no signup is not remembered.
  const url = new URL(request.url);
  const { guest, token } = appSearch.guestEvent(url);
  if (guest !== null && token !== null) {
    const stored = await storedGuestSignup(id, token);
    if (stored === null) goneLink = id;
    else rememberGuestSignup(id, { id: stored.id, cancelToken: token });
    throw redirect(url.pathname);
  }
  // Which ad they came from, kept for the sign-up: the loader runs again when
  // the address changes and after a login.
  rememberAdSource(id, url.search);
  const linkGone = goneLink === id;
  goneLink = null;
  await Promise.all([
    events.collection.preload(),
    attendees.collection.preload(),
  ]);
  // It may be new: published since the last pull.
  if (!events.collection.has(id)) await events.refresh();
  if (events.collection.has(id)) return { id, linkGone, linked: null };
  // Not in the copy: members only, to someone not logged in, or not published.
  const linked = isDocumentId(id) ? await linkedEvent(id) : null;
  if (linked === null) throw data("Event not found", { status: 404 });
  return { id, linkGone, linked };
};

/** Everyone signed up for the event. */
export const useSignups = (id: DocumentId) =>
  useLiveQuery({
    query: (q) =>
      q
        .from({ attendee: attendees.collection })
        .where(({ attendee }) => eq(attendee.eventId, id)),
  }).data;

export function EventPage() {
  const { id, linkGone, linked: loaded } = useLoaderData<typeof eventLoader>();
  const signups = useSignups(id);
  const me = useRouteLoaderData<typeof siteLoader>("site");
  const signedIn = me !== null && me !== undefined;
  const live = useLiveQuery({
    query: (q) =>
      q
        .from({ event: events.collection })
        .where(({ event }) => eq(event.id, id))
        .findOne(),
  }).data;
  const linked = useLinkedEvent(id, loaded, live === undefined);
  const event = live ?? linked;
  usePageTitle({ page: "event", title: event?.title ?? "" });
  // Unpublished, deleted or hidden since the page opened.
  if (event === null) {
    return <p className={styles.missing}>{m.site_event_missing()}</p>;
  }
  return (
    <EventView
      event={event}
      signups={signups}
      signedIn={signedIn}
      email={me?.email}
      linkGone={linkGone}
    />
  );
}

/** The event's page, published or previewed. A preview offers no sign-up. */
export function EventView(props: {
  readonly event: ShownEvent;
  readonly signups: ReadonlyArray<AttendeeRow>;
  readonly signedIn: boolean;
  readonly email: string | undefined;
  readonly linkGone: boolean;
  readonly preview?: boolean;
}) {
  const { event, signups, signedIn, linkGone } = props;
  // Turns true when sign-up closes, at the deadline or else the event start.
  const deadlinePassed = useHasPassed(
    signupClosesAt(event.signupDeadline, event.startsAt),
  );
  // Visitors not logged in are told the places left, not how many are signed up.
  const places = signedIn
    ? null
    : placesForVisitor(event, signups, deadlinePassed);
  return (
    <article className={styles.event}>
      <Link to={appPaths.root} className={styles.back}>
        <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" />
        {m.site_all_events()}
      </Link>
      {event.tags.length === 0 ? null : (
        <ul className={styles.tags} aria-label={m.site_tags()}>
          {event.tags.map((tag) => (
            <li key={tag.toLowerCase()}>
              <Link to={appPaths.tagFilter(tag)}>{tag}</Link>
            </li>
          ))}
        </ul>
      )}
      <h1 className={styles.title}>{event.title}</h1>
      {event.summary === null ? null : (
        <p className={styles.summary}>{event.summary}</p>
      )}
      <div className={styles.overview}>
        <ul className={styles.info}>
          <li>
            <Building2 {...icon} />
            <span>
              <span className={styles.label}>{m.site_organizer()}:</span>{" "}
              <Organizer organizer={event.organizer} />
            </span>
          </li>
          <li>
            <CalendarDays {...icon} />
            <time dateTime={event.startsAt.toISOString()}>
              {formatDaysIn(event.startsAt, event.endsAt, event.timeZone)}
            </time>
          </li>
          <li>
            <Clock {...icon} />
            <time dateTime={event.startsAt.toISOString()}>
              {formatHoursIn(event.startsAt, event.endsAt, event.timeZone)}
            </time>
          </li>
          {event.place === null ? null : (
            <li>
              <MapPin {...icon} />
              <span>
                <span className={styles.label}>{m.site_place()}:</span>{" "}
                {event.place}
              </span>
            </li>
          )}
          {event.isStreamed ? (
            <li>
              <Video {...icon} />
              <span>
                <span className={styles.label}>{m.site_streamed()}</span>
                {event.streamLink === null ? null : (
                  <>
                    {": "}
                    <a
                      href={event.streamLink}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {event.streamLink}
                    </a>
                  </>
                )}
              </span>
            </li>
          ) : null}
          {event.askDietary && event.food.trim() !== "" ? (
            <li>
              <UtensilsCrossed {...icon} />
              <span>
                <span className={styles.label}>{m.site_food()}:</span>{" "}
                {event.food}
              </span>
            </li>
          ) : null}
          {signedIn && signups.length > 0 ? (
            <li>
              <Users {...icon} />
              {m.attend_count({ count: signups.length })}
            </li>
          ) : null}
          {places === null ? null : (
            <li>
              <Users {...icon} />
              {places === "none"
                ? m.attend_no_places_left()
                : m.attend_places_left({ count: places.left })}
            </li>
          )}
          <li>
            {event.allowGuests ? <Globe {...icon} /> : <Lock {...icon} />}
            {audience(event).page}
          </li>
        </ul>
        {event.cover === null ? null : (
          <img
            className={styles.cover}
            src={shownCover(event.cover).src}
            style={{ objectPosition: shownCover(event.cover).position }}
            alt={event.cover.alt}
          />
        )}
      </div>
      <div className={styles.body} data-testid="event-body">
        <RichText spans={event.body} />
      </div>
      <div inert={props.preview}>
        <Attend
          event={event}
          signups={signups}
          signedIn={signedIn}
          email={props.email}
          linkGone={linkGone}
        />
      </div>
      {signedIn ? <Signups event={event} signups={signups} /> : null}
    </article>
  );
}

/** The info box's icons. */
const icon = {
  size: 18,
  strokeWidth: 1.5,
  "aria-hidden": true,
  className: styles.icon,
} as const;

export function EventError() {
  const error = useRouteError();
  return (
    <p className={styles.missing}>
      {isRouteErrorResponse(error) && error.status === 404
        ? m.site_event_missing()
        : m.common_something_wrong()}
    </p>
  );
}
