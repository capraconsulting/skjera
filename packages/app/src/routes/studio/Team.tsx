import type {
  DocumentId,
  DocumentSummary,
  TeamId,
} from "@skjera/documents/api";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useEffect, useRef, useState } from "react";
import {
  data,
  isRouteErrorResponse,
  type LoaderFunctionArgs,
  NavLink,
  Outlet,
  useLoaderData,
  useNavigate,
  useRevalidator,
  useRouteError,
} from "react-router";
import { Avatars } from "../../components/Avatars.tsx";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { Pane, PanePlaceholder } from "../../components/Pane.tsx";
import { call } from "../../documents/client.ts";
import { type PresenceEntry, usePresence } from "../../presence/presence.ts";
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

/**
 * The team's events, most recently edited first. Which events there are
 * comes from the synced rows; their titles and dates live in their drafts,
 * which aren't synced as rows, so those are loaded, and reloaded whenever
 * the rows change: an event added, deleted, edited or published.
 */
function useTeamEvents(teamId: TeamId) {
  const { data } = useLiveQuery(
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

  return data;
}

/** The second column: the selected team's events. */
export function Team() {
  const { teamId, events } = useLoaderData<typeof teamLoader>();
  const others = usePresence();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  // Opens the new event once the server has it.
  const newEvent = () => {
    const id = crypto.randomUUID() as DocumentId;
    const now = new Date();
    setCreating(true);
    documents.collection
      .insert({ id, type: "event", teamId, createdAt: now, updatedAt: now })
      .isPersisted.promise.then(
        () => navigate(`/studio/teams/${teamId}/events/${id}`),
        () => {},
      )
      .finally(() => setCreating(false));
  };
  const rows = useTeamEvents(teamId);
  const summaries = new Map(events.map((event) => [event.id, event]));
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
            {rows.map(({ id }) => (
              <li key={id}>
                <EventItem
                  teamId={teamId}
                  id={id}
                  // Not loaded yet: it's new, so untitled and a draft.
                  summary={summaries.get(id) ?? null}
                  here={others.filter(
                    (entry) => entry.location?.documentId === id,
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
  readonly id: DocumentId;
  readonly summary: DocumentSummary | null;
  readonly here: ReadonlyArray<PresenceEntry>;
}) {
  const { teamId, id, summary } = props;
  const title = summary?.title.trim() ?? "";
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
        {summary === null || summary.date === null
          ? "No date"
          : formatDate(fromIsoDate(summary.date))}
        {summary === null || summary.publishedAt === null ? (
          <Badge tone="neutral">Draft</Badge>
        ) : summary.hasUnpublishedChanges ? (
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
