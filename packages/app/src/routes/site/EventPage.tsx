import type { DocumentId } from "@skjera/documents/api";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Effect } from "effect";
import {
  type ActionFunctionArgs,
  data,
  isRouteErrorResponse,
  type LoaderFunctionArgs,
  useLoaderData,
  useRouteError,
  useRouteLoaderData,
} from "react-router";
import { Badge } from "../../components/Badge.tsx";
import { runPublic } from "../../site/client.ts";
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

/** How many are coming, and whether the signed-in user is. */
const useAttendance = (id: DocumentId) => {
  const signups = useLiveQuery(
    (q) =>
      q
        .from({ attendee: attendees.collection })
        .where(({ attendee }) => eq(attendee.eventId, id)),
    [id],
  ).data;
  return {
    count: signups.length,
    attending: signups.some((signup) => signup.mine),
  };
};

const missing = "This event doesn't exist, or isn't published.";

type AttendResult =
  | { readonly guestToken: string | null }
  | { readonly error: string }
  | { readonly ok: true };

const message = (error: { readonly _tag: string }) =>
  "message" in error && typeof error.message === "string"
    ? error.message
    : "Something went wrong";

/** Signing up and cancelling, as a member or as a guest. */
export const eventAction = async (
  args: ActionFunctionArgs,
): Promise<AttendResult> => {
  const result = await signUpOrCancel(args);
  await attendees.refresh();
  return result;
};

const signUpOrCancel = async ({
  request,
  params,
}: ActionFunctionArgs): Promise<AttendResult> => {
  const id = params.id as DocumentId;
  const form = await request.formData();
  const dietaryValue = form.get("dietary");
  const dietary =
    dietaryValue === null ? {} : { dietary: String(dietaryValue) };
  switch (form.get("intent")) {
    case "attend":
      return runPublic((client) =>
        client.events.attend({ params: { id }, payload: dietary }).pipe(
          Effect.as({ ok: true } as const),
          Effect.catch((error) => Effect.succeed({ error: message(error) })),
        ),
      );
    case "leave":
      return runPublic((client) =>
        client.events.leave({ params: { id } }).pipe(
          Effect.as({ ok: true } as const),
          Effect.catch((error) => Effect.succeed({ error: message(error) })),
        ),
      );
    case "guest-leave": {
      const token = String(form.get("token") ?? "");
      // Gone either way: cancelled now, or already before.
      return runPublic((client) =>
        client.events
          .leaveAsGuest({ params: { id, token } })
          .pipe(Effect.ignore, Effect.as({ guestToken: null })),
      );
    }
    default: {
      const guest = {
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
      };
      return runPublic((client) =>
        client.events
          .attend({ params: { id }, payload: { guest, ...dietary } })
          .pipe(
            Effect.map((signup) => ({
              guestToken: signup?.cancelToken ?? null,
            })),
            Effect.catch((error) => Effect.succeed({ error: message(error) })),
          ),
      );
    }
  }
};

export function EventPage() {
  const { id } = useLoaderData<typeof eventLoader>();
  const attendance = useAttendance(id);
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
        attendance={attendance}
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
