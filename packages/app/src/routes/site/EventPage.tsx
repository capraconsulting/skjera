import { DocumentId, type EventRow } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
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
import { Organizer } from "../../components/Organizer.tsx";
import { RichText } from "../../components/RichText.tsx";
import { usePageTitle } from "../../pageTitle.ts";
import { audience } from "../../site/audience.ts";
import { runPublic } from "../../site/client.ts";
import {
  rememberGuestSignup,
  storedGuestSignup,
} from "../../site/guestSignups.ts";
import { attendees, events } from "../../sync/tables.ts";
import { formatDaysIn, formatHoursIn } from "../../time.ts";
import { Attend } from "./Attend.tsx";
import styles from "./EventPage.module.css";
import { Signups } from "./Signups.tsx";
import type { siteLoader } from "./SiteLayout.tsx";

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
  const guest = url.searchParams.get("guest");
  const token = url.searchParams.get("token");
  if (guest !== null && token !== null) {
    const stored = await storedGuestSignup(id, token);
    if (stored === null) goneLink = id;
    else rememberGuestSignup(id, { id: stored.id, cancelToken: token });
    throw redirect(url.pathname);
  }
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
const useSignups = (id: DocumentId) =>
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
    <article className={styles.event}>
      <Link to="/" className={styles.back}>
        <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" />
        {m.site_all_events()}
      </Link>
      {event.tags.length === 0 ? null : (
        <ul className={styles.tags} aria-label={m.site_tags()}>
          {event.tags.map((tag) => (
            <li key={tag.toLowerCase()}>
              <Link to={`/?tag=${encodeURIComponent(tag)}`}>{tag}</Link>
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
                    <a href={event.streamLink} rel="noopener noreferrer">
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
          {signups.length === 0 ? null : (
            <li>
              <Users {...icon} />
              {m.attend_count({ count: signups.length })}
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
            src={event.cover.src}
            alt={event.cover.alt}
          />
        )}
      </div>
      <div className={styles.body} data-testid="event-body">
        <RichText spans={event.body} />
      </div>
      <Attend
        event={event}
        signups={signups}
        signedIn={signedIn}
        linkGone={linkGone}
      />
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
