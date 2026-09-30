import type { DocumentId } from "@skjera/documents/api";
import { Effect } from "effect";
import {
  data,
  isRouteErrorResponse,
  type LoaderFunctionArgs,
  useLoaderData,
  useRouteError,
} from "react-router";
import { runPublic } from "../../site/client.ts";
import { formatLongDate } from "../../time.ts";
import styles from "./EventPage.module.css";

export const eventLoader = ({ params }: LoaderFunctionArgs) =>
  runPublic((client) =>
    client.events.get({ params: { id: params.id as DocumentId } }).pipe(
      Effect.catchTag("EventNotFound", () =>
        Effect.sync(() => {
          throw data("Event not found", { status: 404 });
        }),
      ),
    ),
  );

export function EventPage() {
  const event = useLoaderData<typeof eventLoader>();
  return (
    <article className={styles.event}>
      <h1 className={styles.title}>{event.title}</h1>
      <p className={styles.date}>
        <time dateTime={event.date}>{formatLongDate(event.date)}</time>
      </p>
      <div className={styles.body} data-testid="event-body">
        {event.body}
      </div>
    </article>
  );
}

export function EventError() {
  const error = useRouteError();
  return (
    <p className={styles.missing}>
      {isRouteErrorResponse(error) && error.status === 404
        ? "This event doesn't exist, or isn't published."
        : "Something went wrong."}
    </p>
  );
}
