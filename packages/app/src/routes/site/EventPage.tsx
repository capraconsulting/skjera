import type { DocumentId } from "@skjera/documents/api";
import { eq, useLiveQuery } from "@tanstack/react-db";
import {
  data,
  isRouteErrorResponse,
  type LoaderFunctionArgs,
  useLoaderData,
  useRouteError,
  useRouteLoaderData,
} from "react-router";
import { Badge } from "../../components/Badge.tsx";
import { attendees, events } from "../../sync/tables.ts";
import { formatLongDate } from "../../time.ts";
import { Attend } from "./Attend.tsx";
import styles from "./EventPage.module.css";
import type { siteLoader } from "./SiteLayout.tsx";

export const eventLoader = async ({ params }: LoaderFunctionArgs) => {
  const id = params.id as DocumentId;
  await Promise.all([
    events.collection.preload(),
    attendees.collection.preload(),
  ]);
  // It may be new: published since the last pull.
  if (!events.collection.has(id)) await events.refresh();
  if (!events.collection.has(id)) {
    throw data("Event not found", { status: 404 });
  }
  return { id };
};

/** Everyone signed up for the event. */
const useSignups = (id: DocumentId) =>
  useLiveQuery(
    (q) =>
      q
        .from({ attendee: attendees.collection })
        .where(({ attendee }) => eq(attendee.eventId, id)),
    [id],
  ).data;

const missing = "This event doesn't exist, or isn't published.";

export function EventPage() {
  const { id } = useLoaderData<typeof eventLoader>();
  const signups = useSignups(id);
  const me = useRouteLoaderData<typeof siteLoader>("site");
  const event = useLiveQuery(
    (q) =>
      q
        .from({ event: events.collection })
        .where(({ event }) => eq(event.id, id))
        .findOne(),
    [id],
  ).data;
  // Unpublished, deleted or hidden since the page opened.
  if (event === undefined) return <p className={styles.missing}>{missing}</p>;
  return (
    <article className={styles.event}>
      <h1 className={styles.title}>{event.title}</h1>
      <p className={styles.date}>
        <time dateTime={event.date}>{formatLongDate(event.date)}</time>
        {event.isPublic ? null : (
          <>
            {" "}
            <Badge tone="neutral">Members only</Badge>
          </>
        )}
      </p>
      <div className={styles.body} data-testid="event-body">
        {event.body}
      </div>
      <Attend
        event={event}
        signups={signups}
        signedIn={me !== null && me !== undefined}
      />
    </article>
  );
}

export function EventError() {
  const error = useRouteError();
  return (
    <p className={styles.missing}>
      {isRouteErrorResponse(error) && error.status === 404
        ? missing
        : "Something went wrong."}
    </p>
  );
}
