import type { DocumentId } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { eq, useLiveQuery } from "@tanstack/react-db";
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
  if (!events.collection.has(id)) {
    throw data("Event not found", { status: 404 });
  }
  return { id, linkGone };
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
  const { id, linkGone } = useLoaderData<typeof eventLoader>();
  const signups = useSignups(id);
  const me = useRouteLoaderData<typeof siteLoader>("site");
  const signedIn = me !== null && me !== undefined;
  const event = useLiveQuery({
    query: (q) =>
      q
        .from({ event: events.collection })
        .where(({ event }) => eq(event.id, id))
        .findOne(),
  }).data;
  // Unpublished, deleted or hidden since the page opened.
  if (event === undefined) {
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
            {event.isPublic ? <Globe {...icon} /> : <Lock {...icon} />}
            {event.isPublic ? m.site_open_to_all() : m.common_members_only()}
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
