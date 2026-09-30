import type { DocumentId, TeamId } from "@skjera/documents/api";
import { Effect, Result } from "effect";
import {
  type ActionFunctionArgs,
  data,
  Form,
  type LoaderFunctionArgs,
  NavLink,
  Outlet,
  redirect,
  useActionData,
  useLoaderData,
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

/** Creating and deleting events, and deleting the team. */
export const teamAction = async ({ request, params }: ActionFunctionArgs) => {
  const teamId = params.teamId as TeamId;
  const form = await request.formData();
  switch (form.get("intent")) {
    case "delete-team": {
      const result = await call((client) =>
        Effect.result(client.DeleteTeam({ id: teamId })),
      );
      return Result.isSuccess(result)
        ? redirect("/studio/teams")
        : { error: "Delete the team's events first." };
    }
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
  const action = useActionData<typeof teamAction>();
  return (
    <>
      <Pane
        title={team.name}
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
          <div className={styles.empty}>
            <p>No events yet.</p>
            <Form method="post">
              <Button
                type="submit"
                name="intent"
                value="delete-team"
                variant="danger"
              >
                Delete team
              </Button>
            </Form>
          </div>
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
        {action?.error === undefined ? null : (
          <p role="alert" className={styles.error}>
            {action.error}
          </p>
        )}
      </Pane>
      <Outlet />
    </>
  );
}

export function NoEventSelected() {
  return <PanePlaceholder>Pick an event, or create a new one.</PanePlaceholder>;
}
