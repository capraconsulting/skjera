import type { DocumentId, TeamId } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { appPaths } from "@skjera/paths";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import {
  data,
  isRouteErrorResponse,
  type LoaderFunctionArgs,
  NavLink,
  Outlet,
  redirect,
  useLoaderData,
  useNavigate,
  useRouteError,
} from "react-router";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { Input, Select } from "../../components/Input.tsx";
import { Pane, PanePlaceholder } from "../../components/Pane.tsx";
import { documents, events, teams } from "../../sync/tables.ts";
import { formatDateIn } from "../../time.ts";
import {
  orderOptions,
  readOrder,
  searchEvents,
  sortEvents,
  useEventOrder,
} from "./eventList.ts";
import { rowState } from "./publishState.ts";
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
    // An old address of an event that was moved out of a team that is gone
    // since: it opens in the event's own team.
    const event = params.id as DocumentId | undefined;
    if (event !== undefined) {
      await documents.refresh();
      const moved = documents.collection.get(event);
      if (moved !== undefined && teams.collection.has(moved.teamId)) {
        throw redirect(appPaths.studioEvent(moved.teamId, event));
      }
    }
    throw data("Team not found", { status: 404 });
  }
  return { teamId };
};

/** The team's events, with how published and what the lists search and order by. */
export const useListedEvents = (teamId?: TeamId) =>
  useLiveQuery({
    query: (q) => {
      const listed = q
        .from({ document: documents.collection })
        .innerJoin({ team: teams.collection }, ({ document, team }) =>
          eq(document.teamId, team.id),
        )
        .leftJoin({ event: events.collection }, ({ document, event }) =>
          eq(document.id, event.id),
        )
        .select(({ document, event, team }) => ({
          id: document.id,
          teamId: document.teamId,
          teamName: team.name,
          title: document.title,
          // The draft's tags, not the published version's: `event.tags`.
          tags: document.tags,
          startsAt: document.startsAt,
          timeZone: document.timeZone,
          draftHeads: document.draftHeads,
          publishedHeads: event?.publishedHeads,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
        }));
      return teamId === undefined
        ? listed
        : listed.where(({ document }) => eq(document.teamId, teamId));
    },
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
  const [createError, setCreateError] = useState<string | null>(null);

  // Opens the new event once the server has it.
  const newEvent = () => {
    const id = crypto.randomUUID() as DocumentId;
    const now = new Date();
    setCreating(true);
    setCreateError(null);
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
        firstPublishedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .isPersisted.promise.then(
        () => navigate(appPaths.studioEvent(teamId, id)),
        () => setCreateError(m.studio_create_failed()),
      )
      .finally(() => setCreating(false));
  };
  const rows = useListedEvents(teamId);
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
        {createError === null ? null : <p role="alert">{createError}</p>}
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
          <Select
            aria-label={m.studio_events_order()}
            value={order}
            onChange={(event) => choose(readOrder(event.currentTarget.value))}
          >
            {orderOptions().map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
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
      to={appPaths.studioEvent(teamId, id)}
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
        {rowState(event) === "draft" ? (
          <Badge tone="neutral">{m.studio_draft()}</Badge>
        ) : rowState(event) === "changed" ? (
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
