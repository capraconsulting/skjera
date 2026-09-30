import type { DocumentId } from "@skjera/documents/api";
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
import { formatLongDate } from "../../time.ts";
import { Attend } from "./Attend.tsx";
import styles from "./EventPage.module.css";
import type { siteLoader } from "./SiteLayout.tsx";

export const eventLoader = ({ params }: LoaderFunctionArgs) =>
  runPublic((client) => {
    const id = params.id as DocumentId;
    return Effect.all({
      event: client.events.get({ params: { id } }),
      attendance: client.events.attendance({ params: { id } }),
    }).pipe(
      Effect.catchTag("EventNotFound", () =>
        Effect.sync(() => {
          throw data("Event not found", { status: 404 });
        }),
      ),
    );
  });

type AttendResult =
  | { readonly guestToken: string | null }
  | { readonly error: string }
  | { readonly ok: true };

const message = (error: { readonly _tag: string }) =>
  "message" in error && typeof error.message === "string"
    ? error.message
    : "Something went wrong";

/** Signing up and cancelling, as a member or as a guest. */
export const eventAction = async ({
  request,
  params,
}: ActionFunctionArgs): Promise<AttendResult> => {
  const id = params.id as DocumentId;
  const form = await request.formData();
  switch (form.get("intent")) {
    case "attend":
      return runPublic((client) =>
        client.events.attend({ params: { id }, payload: {} }).pipe(
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
      const dietary = form.get("dietary");
      const guest = {
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        ...(dietary === null ? {} : { dietary: String(dietary) }),
      };
      return runPublic((client) =>
        client.events.attend({ params: { id }, payload: { guest } }).pipe(
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
  const { event, attendance } = useLoaderData<typeof eventLoader>();
  const me = useRouteLoaderData<typeof siteLoader>("site");
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
        ? "This event doesn't exist, or isn't published."
        : "Something went wrong."}
    </p>
  );
}
