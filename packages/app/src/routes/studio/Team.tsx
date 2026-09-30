import type { DocumentId, TeamId } from "@skjera/documents/api";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import {
  data,
  isRouteErrorResponse,
  type LoaderFunctionArgs,
  NavLink,
  Outlet,
  useLoaderData,
  useNavigate,
  useRouteError,
} from "react-router";
import { Avatars } from "../../components/Avatars.tsx";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { Pane, PanePlaceholder } from "../../components/Pane.tsx";
import { type PresenceEntry, usePresence } from "../../presence/presence.ts";
import { documents, events, teams } from "../../sync/tables.ts";
import { formatDate, fromIsoDate } from "../../time.ts";
import styles from "./Team.module.css";

export const teamLoader = async ({ params }: LoaderFunctionArgs) => {
  const teamId = params.teamId as TeamId;
  await Promise.all([
    teams.collection.preload(),
    documents.collection.preload(),
    events.collection.preload(),
  ]);
  // It may be new: made by someone else since the last pull.
  if (!teams.collection.has(teamId)) await teams.refresh();
  if (!teams.collection.has(teamId)) {
    throw data("Team not found", { status: 404 });
  }
  return { teamId };
};

/** The team's events, most recently edited first, with how published. */
const useTeamEvents = (teamId: TeamId) =>
  useLiveQuery(
    (q) =>
      q
        .from({ document: documents.collection })
        .leftJoin({ event: events.collection }, ({ document, event }) =>
          eq(document.id, event.id),
        )
        .where(({ document }) => eq(document.teamId, teamId))
        .orderBy(({ document }) => document.updatedAt, "desc")
        .select(({ document, event }) => ({
          id: document.id,
          title: document.title,
          date: document.date,
          draftHeads: document.draftHeads,
          publishedHeads: event?.publishedHeads,
        })),
    [teamId],
  ).data;

type TeamEvent = ReturnType<typeof useTeamEvents>[number];

/** The second column: the selected team's events. */
export function Team() {
  const { teamId } = useLoaderData<typeof teamLoader>();
  const others = usePresence();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  // Opens the new event once the server has it.
  const newEvent = () => {
    const id = crypto.randomUUID() as DocumentId;
    const now = new Date();
    setCreating(true);
    documents.collection
      .insert({
        id,
        type: "event",
        teamId,
        title: "",
        date: null,
        draftHeads: [],
        createdAt: now,
        updatedAt: now,
      })
      .isPersisted.promise.then(
        () => navigate(`/studio/teams/${teamId}/events/${id}`),
        () => {},
      )
      .finally(() => setCreating(false));
  };
  const rows = useTeamEvents(teamId);
  return (
    <>
      <Pane
        title="Events"
        label="Events"
        actions={
          <Button variant="primary" disabled={creating} onClick={newEvent}>
            New event
          </Button>
        }
      >
        {rows.length === 0 ? (
          <p className={styles.empty}>No events yet.</p>
        ) : (
          <ul className={styles.list}>
            {rows.map((event) => (
              <li key={event.id}>
                <EventItem
                  teamId={teamId}
                  event={event}
                  here={others.filter(
                    (entry) => entry.location?.documentId === event.id,
                  )}
                />
              </li>
            ))}
          </ul>
        )}
      </Pane>
      <Outlet />
    </>
  );
}

function EventItem(props: {
  readonly teamId: TeamId;
  readonly event: TeamEvent;
  readonly here: ReadonlyArray<PresenceEntry>;
}) {
  const { teamId, event } = props;
  const { id } = event;
  const title = event.title.trim();
  return (
    <NavLink
      to={`/studio/teams/${teamId}/events/${id}`}
      className={({ isActive }) =>
        isActive ? `${styles.item} ${styles.active}` : styles.item
      }
    >
      <span className={styles.heading}>
        {title === "" ? (
          <span className={`${styles.title} ${styles.untitled}`}>Untitled</span>
        ) : (
          <span className={styles.title}>{title}</span>
        )}
        <Avatars small entries={props.here} />
      </span>
      <span className={styles.meta}>
        {event.date === null ? "No date" : formatDate(fromIsoDate(event.date))}
        {event.publishedHeads === undefined ? (
          <Badge tone="neutral">Draft</Badge>
        ) : event.publishedHeads.join() !== event.draftHeads.join() ? (
          <Badge tone="warning">Changed</Badge>
        ) : (
          <Badge tone="success">Published</Badge>
        )}
      </span>
    </NavLink>
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
