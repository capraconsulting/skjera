import type { DocumentId, TeamId } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
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
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import inputStyles from "../../components/Input.module.css";
import { Input } from "../../components/Input.tsx";
import { Pane, PanePlaceholder } from "../../components/Pane.tsx";
import { documents, events, teams } from "../../sync/tables.ts";
import { formatDateIn } from "../../time.ts";
import {
  readOrder,
  searchEvents,
  sortEvents,
  useEventOrder,
} from "./eventList.ts";
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

/** The team's events, with how published and what the lists search and order by. */
const useTeamEvents = (teamId: TeamId) =>
  useLiveQuery({
    query: (q) =>
      q
        .from({ document: documents.collection })
        .leftJoin({ event: events.collection }, ({ document, event }) =>
          eq(document.id, event.id),
        )
        .where(({ document }) => eq(document.teamId, teamId))
        .select(({ document, event }) => ({
          id: document.id,
          title: document.title,
          // The draft's tags, not the published version's: `event.tags`.
          tags: document.tags,
          startsAt: document.startsAt,
          timeZone: document.timeZone,
          draftHeads: document.draftHeads,
          publishedHeads: event?.publishedHeads,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
        })),
  }).data;

/** What a row of a list of events shows of an event. */
export type ListedEvent = {
  readonly id: string;
  readonly title: string;
  readonly startsAt: Date | null;
  readonly timeZone: string | null;
  readonly draftHeads: ReadonlyArray<string>;
  readonly publishedHeads: ReadonlyArray<string> | undefined;
};

/** The second column: the selected team's events. */
export function Team() {
  const { teamId } = useLoaderData<typeof teamLoader>();
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
        startsAt: null,
        timeZone: null,
        draftHeads: [],
        tags: [],
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
  const { order, choose } = useEventOrder();
  // The search belongs to the team's list: opening one of its events keeps it,
  // and another team, or coming back to this one, starts with an empty field.
  const [search, setSearch] = useState({ teamId, text: "" });
  if (search.teamId !== teamId) setSearch({ teamId, text: "" });
  const text = search.teamId === teamId ? search.text : "";
  const shown = sortEvents(searchEvents(rows, text), order);
  return (
    <>
      <Pane
        title={m.site_events()}
        label={m.site_events()}
        actions={
          <Button variant="primary" disabled={creating} onClick={newEvent}>
            {m.studio_new_event()}
          </Button>
        }
      >
        <div className={styles.tools}>
          <Input
            type="search"
            aria-label={m.studio_events_search()}
            placeholder={m.studio_events_search()}
            value={text}
            onChange={(event) =>
              setSearch({ teamId, text: event.currentTarget.value })
            }
          />
          <select
            aria-label={m.studio_events_order()}
            className={inputStyles.input}
            value={order}
            onChange={(event) => choose(readOrder(event.currentTarget.value))}
          >
            <option value="updated">{m.studio_order_updated()}</option>
            <option value="created">{m.studio_order_created()}</option>
            <option value="starts">{m.studio_order_starts()}</option>
          </select>
        </div>
        {rows.length === 0 ? (
          <p className={styles.empty}>{m.studio_no_events()}</p>
        ) : shown.length === 0 ? (
          <p className={styles.empty}>{m.studio_no_matches()}</p>
        ) : (
          <ul className={styles.list}>
            {shown.map((event) => (
              <li key={event.id}>
                <EventItem teamId={teamId} event={event} />
              </li>
            ))}
          </ul>
        )}
      </Pane>
      <Outlet />
    </>
  );
}

/** One event in a list; `team` is its team's name, where the list spans teams. */
export function EventItem(props: {
  readonly teamId: TeamId;
  readonly event: ListedEvent;
  readonly team?: string;
}) {
  const { teamId, event, team } = props;
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
          <span className={`${styles.title} ${styles.untitled}`}>
            {m.studio_untitled()}
          </span>
        ) : (
          <span className={styles.title}>{title}</span>
        )}
      </span>
      {team === undefined ? null : <span className={styles.team}>{team}</span>}
      <span className={styles.meta}>
        {event.startsAt == null || event.timeZone == null
          ? m.studio_no_date()
          : formatDateIn(event.startsAt, event.timeZone)}
        {event.publishedHeads === undefined ? (
          <Badge tone="neutral">{m.studio_draft()}</Badge>
        ) : event.publishedHeads.join() !== event.draftHeads.join() ? (
          <Badge tone="warning">{m.studio_changed()}</Badge>
        ) : (
          <Badge tone="success">{m.studio_published()}</Badge>
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
        ? m.studio_team_gone()
        : m.common_something_wrong()}
    </PanePlaceholder>
  );
}

export function NoEventSelected() {
  return <PanePlaceholder>{m.studio_pick_event()}</PanePlaceholder>;
}
