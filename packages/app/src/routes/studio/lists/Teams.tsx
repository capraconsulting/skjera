import { type TeamId, teamNameLength } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { appPaths } from "@skjera/paths";
import { count, eq, lower, useLiveQuery } from "@tanstack/react-db";
import { type FormEvent, useState } from "react";
import { NavLink, Outlet, useNavigate, useParams } from "react-router";
import { Button } from "../../../components/controls/Button.tsx";
import { Dialog, dialogStyles } from "../../../components/controls/Dialog.tsx";
import {
  Dropdown,
  DropdownItem,
} from "../../../components/controls/Dropdown.tsx";
import { Input } from "../../../components/controls/Input.tsx";
import { Pane, PanePlaceholder } from "../../../components/Pane.tsx";
import { documents, events, teams } from "../../../sync/tables.ts";
import { TeamLogosDialog } from "../TeamLogos.tsx";
import { ColumnHandle } from "./ColumnHandle.tsx";
import { defaultWidths, useColumnWidths } from "./columnWidths.ts";
import { searchEvents, sortEvents, useEventOrder } from "./eventList.ts";
import { EventItem, useListedEvents } from "./Team.tsx";
import styles from "./Teams.module.css";

/** Waits for the copies of the tables the studio lists. */
export const teamsLoader = async () => {
  await Promise.all([
    teams.collection.preload(),
    documents.collection.preload(),
    events.collection.preload(),
  ]);
  return null;
};

/** Every team, alphabetically, with how many documents it has. */
const useTeams = () =>
  useLiveQuery((q) =>
    q
      .from({ team: teams.collection })
      .leftJoin({ document: documents.collection }, ({ team, document }) =>
        eq(team.id, document.teamId),
      )
      .groupBy(({ team }) => [team.id, team.name])
      .select(({ team, document }) => ({
        id: team.id,
        name: team.name,
        documentCount: count(document.id),
      }))
      .orderBy(({ $selected }) => lower($selected.name)),
  ).data;

type Team = ReturnType<typeof useTeams>[number];

/** The events of every team that `text` finds, in the order chosen. */
function FoundEvents(props: { readonly text: string }) {
  const found = useListedEvents();
  const { order } = useEventOrder();
  const shown = sortEvents(searchEvents(found, props.text), order);
  return shown.length === 0 ? (
    <p className={styles.empty}>{m.studio_no_matches()}</p>
  ) : (
    <ul className={styles.list}>
      {shown.map((event) => (
        <li key={event.id}>
          <EventItem
            teamId={event.teamId}
            event={event}
            team={event.teamName}
          />
        </li>
      ))}
    </ul>
  );
}

type DialogState =
  | { readonly kind: "create" }
  | { readonly kind: "rename"; readonly team: Team }
  | { readonly kind: "logos"; readonly team: Team }
  | null;

/**
 * The studio: teams, the selected team's events, and the selected event, side
 * by side. This is the first column; the others come through the outlet.
 */
export function Teams() {
  const all = useTeams();
  const { teamId } = useParams();
  const { widths, resize } = useColumnWidths();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Kept while the organiser moves between teams and events: this column
  // stays mounted.
  const [search, setSearch] = useState("");
  const searching = search.trim() !== "";
  return (
    <div
      className={styles.columns}
      style={{
        gridTemplateColumns: `${widths.teams}rem ${widths.events}rem minmax(0, 1fr)`,
      }}
    >
      <ColumnHandle
        label={m.studio_resize_teams()}
        width={widths.teams}
        defaultWidth={defaultWidths.teams}
        left={`${widths.teams}rem`}
        onResize={(rem) => resize("teams", rem)}
      />
      {/* The events column's own line, while it shows a team's events. */}
      {teamId === undefined ? null : (
        <ColumnHandle
          label={m.studio_resize_events()}
          width={widths.events}
          defaultWidth={defaultWidths.events}
          left={`${widths.teams + widths.events}rem`}
          onResize={(rem) => resize("events", rem)}
        />
      )}
      <Pane
        title={m.studio_teams()}
        label={m.studio_teams()}
        actions={
          <Dropdown label={m.studio_team_list_options()}>
            {(close) => (
              <DropdownItem
                onClick={() => {
                  close();
                  setDialog({ kind: "create" });
                }}
              >
                {m.studio_new_team()}
              </DropdownItem>
            )}
          </Dropdown>
        }
      >
        <div className={styles.search}>
          <Input
            type="search"
            aria-label={m.studio_search_all()}
            placeholder={m.studio_search_all()}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </div>
        {failure === null ? null : (
          <p role="alert" className={styles.failure}>
            {failure}
          </p>
        )}
        {searching ? (
          <FoundEvents text={search} />
        ) : all.length === 0 ? (
          <p className={styles.empty}>{m.studio_no_teams()}</p>
        ) : (
          <ul className={styles.list}>
            {all.map((team) => (
              <TeamRow
                key={team.id}
                team={team}
                onRename={() => setDialog({ kind: "rename", team })}
                onLogos={() => setDialog({ kind: "logos", team })}
                onFailure={setFailure}
              />
            ))}
          </ul>
        )}
      </Pane>
      <TeamDialog state={dialog} onClose={() => setDialog(null)} />
      <TeamLogosDialog
        teamId={dialog?.kind === "logos" ? dialog.team.id : null}
        onClose={() => setDialog(null)}
      />
      <Outlet />
    </div>
  );
}

function TeamRow(props: {
  readonly team: Team;
  readonly onRename: () => void;
  readonly onLogos: () => void;
  /** Deleting was refused, and the team is back. */
  readonly onFailure: (message: string) => void;
}) {
  const { team, onFailure } = props;
  const { teamId } = useParams();
  const navigate = useNavigate();

  const deleteTeam = () => {
    const deleted = teams.collection.delete(team.id);
    if (teamId === team.id) navigate(appPaths.studioTeams);
    deleted.isPersisted.promise.catch((error: Error) =>
      onFailure(error.message),
    );
  };

  return (
    <li className={styles.row}>
      <NavLink
        to={appPaths.studioTeam(team.id)}
        className={({ isActive }) =>
          isActive ? `${styles.item} ${styles.active}` : styles.item
        }
      >
        <span className={styles.name}>{team.name}</span>
      </NavLink>
      <span className={styles.menu}>
        <Dropdown label={m.studio_team_options({ name: team.name })}>
          {(close) => (
            <>
              <DropdownItem
                onClick={() => {
                  close();
                  props.onRename();
                }}
              >
                {m.studio_rename_team_menu()}
              </DropdownItem>
              <DropdownItem
                onClick={() => {
                  close();
                  props.onLogos();
                }}
              >
                {m.studio_team_logo_menu()}
              </DropdownItem>
              <DropdownItem
                danger
                onClick={() => {
                  close();
                  deleteTeam();
                }}
              >
                {m.studio_delete_team()}
              </DropdownItem>
            </>
          )}
        </Dropdown>
      </span>
    </li>
  );
}

/** Naming a new team, or renaming one. */
function TeamDialog(props: {
  readonly state: DialogState;
  readonly onClose: () => void;
}) {
  const navigate = useNavigate();
  const { state, onClose } = props;
  const renaming = state?.kind === "rename" ? state.team : null;
  const open = state?.kind === "create" || state?.kind === "rename";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };

  // The team shows right away; the dialog closes once the server has it,
  // or says why not once the change is undone.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(
      new FormData(event.currentTarget).get("name") ?? "",
    ).trim();
    const id = renaming?.id ?? (crypto.randomUUID() as TeamId);
    const change =
      renaming === null
        ? teams.collection.insert({
            id,
            name,
            logo: null,
            logoDark: null,
            createdAt: new Date(),
          })
        : teams.collection.update(id, (team) => {
            team.name = name;
          });
    setSaving(true);
    setError(null);
    change.isPersisted.promise.then(
      () => {
        setSaving(false);
        close();
        if (renaming === null) navigate(appPaths.studioTeam(id));
      },
      (failure: Error) => {
        setSaving(false);
        setError(failure.message);
      },
    );
  };

  return (
    <Dialog
      open={open}
      title={renaming === null ? m.studio_new_team() : m.studio_rename_team()}
      onClose={close}
    >
      <form onSubmit={submit}>
        <Input
          name="name"
          aria-label={m.studio_team_name()}
          placeholder={m.studio_team_name()}
          className={dialogStyles.input}
          defaultValue={renaming?.name ?? ""}
          required
          maxLength={teamNameLength}
          autoFocus
        />
        {error === null ? null : (
          <p role="alert" className={dialogStyles.error}>
            {error}
          </p>
        )}
        <div className={dialogStyles.actions}>
          <Button onClick={close}>{m.common_cancel()}</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {renaming === null
              ? m.studio_create_team()
              : m.studio_rename_team()}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function NoTeamSelected() {
  return <PanePlaceholder span={2}>{m.studio_pick_team()}</PanePlaceholder>;
}
