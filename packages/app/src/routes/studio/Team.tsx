import type { DocumentId, TeamId } from "@skjera/documents/api";
import { Effect } from "effect";
import {
  type ActionFunctionArgs,
  data,
  Form,
  isRouteErrorResponse,
  type LoaderFunctionArgs,
  NavLink,
  Outlet,
  redirect,
  useLoaderData,
  useRouteError,
} from "react-router";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { Pane, PanePlaceholder } from "../../components/Pane.tsx";
import { call } from "../../documents/client.ts";
import { formatDate, fromIsoDate } from "../../time.ts";
import styles from "./Team.module.css";

export const teamLoader = ({ params }: LoaderFunctionArgs) =>
  call((client) =>
    Effect.all({
      team: client.GetTeam({ id: params.teamId as TeamId }),
      events: client.ListDocuments({
        type: "event",
        teamId: params.teamId as TeamId,
      }),
    }).pipe(
      Effect.catchTag("TeamNotFound", () =>
        Effect.sync(() => {
          throw data("Team not found", { status: 404 });
        }),
      ),
    ),
  );

/** Creating and deleting events. */
export const teamAction = async ({ request, params }: ActionFunctionArgs) => {
  const teamId = params.teamId as TeamId;
  const form = await request.formData();
  switch (form.get("intent")) {
    case "delete-event": {
      const id = String(form.get("id")) as DocumentId;
      await call((client) =>
        client
          .DeleteDocument({ id })
          .pipe(Effect.catchTag("DocumentNotFound", () => Effect.void)),
      );
      return redirect(`/studio/teams/${teamId}`);
    }
    default: {
      const event = await call((client) =>
        client.CreateDocument({ type: "event", teamId }),
      );
      return redirect(`/studio/teams/${teamId}/events/${event}`);
    }
  }
};

/** The second column: the selected team's events. */
export function Team() {
  const { team, events } = useLoaderData<typeof teamLoader>();
  return (
    <>
      <Pane
        title="Events"
        label="Events"
        actions={
          <Form method="post">
            <Button
              type="submit"
              name="intent"
              value="create-event"
              variant="primary"
            >
              New event
            </Button>
          </Form>
        }
      >
        {events.length === 0 ? (
          <p className={styles.empty}>No events yet.</p>
        ) : (
          <ul className={styles.list}>
            {events.map((event) => (
              <li key={event.id}>
                <NavLink
                  to={`/studio/teams/${team.id}/events/${event.id}`}
                  className={({ isActive }) =>
                    isActive ? `${styles.item} ${styles.active}` : styles.item
                  }
                >
                  {event.title.trim() === "" ? (
                    <span className={`${styles.title} ${styles.untitled}`}>
                      Untitled
                    </span>
                  ) : (
                    <span className={styles.title}>{event.title}</span>
                  )}
                  <span className={styles.meta}>
                    {event.date === null
                      ? "No date"
                      : formatDate(fromIsoDate(event.date))}
                    {event.publishedAt === null ? (
                      <Badge tone="neutral">Draft</Badge>
                    ) : event.hasUnpublishedChanges ? (
                      <Badge tone="warning">Changed</Badge>
                    ) : (
                      <Badge tone="success">Published</Badge>
                    )}
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </Pane>
      <Outlet />
    </>
  );
}

/** The team is gone, e.g. someone else deleted it. */
export function TeamError() {
  const error = useRouteError();
  return (
    <PanePlaceholder span={2}>
      {isRouteErrorResponse(error) && error.status === 404
        ? "This team doesn't exist anymore."
        : "Something went wrong."}
    </PanePlaceholder>
  );
}

export function NoEventSelected() {
  return <PanePlaceholder>Pick an event, or create a new one.</PanePlaceholder>;
}
