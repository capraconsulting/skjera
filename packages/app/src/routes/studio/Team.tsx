import type { DocumentId, TeamId } from "@skjera/documents/api";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Effect } from "effect";
import { useEffect, useRef } from "react";
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
  useRevalidator,
  useRouteError,
} from "react-router";
import { Avatars } from "../../components/Avatars.tsx";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { Pane, PanePlaceholder } from "../../components/Pane.tsx";
import { call } from "../../documents/client.ts";
import { usePresence } from "../../presence/presence.ts";
import { documents, events, teams } from "../../sync/tables.ts";
import { formatDate, fromIsoDate } from "../../time.ts";
import styles from "./Team.module.css";

export const teamLoader = async ({ params }: LoaderFunctionArgs) => {
  const teamId = params.teamId as TeamId;
  await teams.collection.preload();
  // It may be new: made by someone else since the last pull.
  if (!teams.collection.has(teamId)) await teams.refresh();
  if (!teams.collection.has(teamId)) {
    throw data("Team not found", { status: 404 });
  }
  const events = await call((client) =>
    client.ListDocuments({ type: "event", teamId }),
  );
  return { teamId, events };
};

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
      await documents.refresh();
      return redirect(`/studio/teams/${teamId}`);
    }
    default: {
      const event = await call((client) =>
        client.CreateDocument({ type: "event", teamId }),
      );
      await documents.refresh();
      return redirect(`/studio/teams/${teamId}/events/${event}`);
    }
  }
};

/**
 * The events' titles and dates live in their drafts, which aren't synced as
 * rows, so the list is loaded. This reloads it whenever the team's synced
 * rows change: an event added, deleted, edited or published.
 */
function useReloadOnChanges(teamId: TeamId) {
  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ document: documents.collection })
        .leftJoin({ event: events.collection }, ({ document, event }) =>
          eq(document.id, event.id),
        )
        .where(({ document }) => eq(document.teamId, teamId))
        .select(({ document, event }) => ({
          id: document.id,
          updatedAt: document.updatedAt,
          publishedAt: event?.publishedAt,
        })),
    [teamId],
  );
  const version = data
    .map(
      (row) =>
        `${row.id}@${row.updatedAt.getTime()}/${row.publishedAt?.getTime()}`,
    )
    .sort()
    .join(",");

  const revalidator = useRevalidator();
  const revalidate = useRef(revalidator.revalidate);
  revalidate.current = revalidator.revalidate;
  // The loader has just run for a newly opened team.
  const seen = useRef({ teamId, version });
  useEffect(() => {
    const changed =
      seen.current.teamId === teamId && seen.current.version !== version;
    seen.current = { teamId, version };
    if (changed) void revalidate.current();
  }, [teamId, version]);
}

/** The second column: the selected team's events. */
export function Team() {
  const { teamId, events } = useLoaderData<typeof teamLoader>();
  const others = usePresence();
  useReloadOnChanges(teamId);
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
                  to={`/studio/teams/${teamId}/events/${event.id}`}
                  className={({ isActive }) =>
                    isActive ? `${styles.item} ${styles.active}` : styles.item
                  }
                >
                  <span className={styles.heading}>
                    {event.title.trim() === "" ? (
                      <span className={`${styles.title} ${styles.untitled}`}>
                        Untitled
                      </span>
                    ) : (
                      <span className={styles.title}>{event.title}</span>
                    )}
                    <Avatars
                      small
                      entries={others.filter(
                        (entry) => entry.location?.documentId === event.id,
                      )}
                    />
                  </span>
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
