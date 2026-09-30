import type { Team, TeamId } from "@skjera/documents/api";
import { Effect, Result } from "effect";
import { useEffect, useState } from "react";
import {
  type ActionFunctionArgs,
  NavLink,
  Outlet,
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate,
  useParams,
} from "react-router";
import { Button } from "../../components/Button.tsx";
import { Dialog, dialogStyles } from "../../components/Dialog.tsx";
import {
  Dropdown,
  DropdownItem,
  DropdownNote,
} from "../../components/Dropdown.tsx";
import { Input } from "../../components/Input.tsx";
import { Pane, PanePlaceholder } from "../../components/Pane.tsx";
import { call } from "../../documents/client.ts";
import styles from "./Teams.module.css";

export const teamsLoader = () => call((client) => client.ListTeams());

/**
 * The team list changes with form submissions (teams, and the events they
 * count), not while editing.
 */
export const teamsShouldRevalidate = ({
  formMethod,
}: {
  readonly formMethod?: string | undefined;
}) => formMethod !== undefined;

type TeamsActionResult =
  | { readonly ok: true; readonly teamId: TeamId }
  | { readonly ok: false; readonly error: string };

/** What to tell the user about a failed team action. */
const failureMessage = (failure: { readonly _tag: string }) =>
  failure._tag === "TeamNotEmpty"
    ? "Only teams without events can be deleted."
    : "message" in failure && typeof failure.message === "string"
      ? failure.message
      : "Something went wrong";

/** Creating, renaming and deleting teams. */
export const teamsAction = async ({
  request,
}: ActionFunctionArgs): Promise<TeamsActionResult | Response> => {
  const form = await request.formData();
  const id = String(form.get("id") ?? "") as TeamId;
  const name = String(form.get("name") ?? "");
  const result = await call(
    (client): Effect.Effect<Result.Result<TeamId, string>> => {
      switch (form.get("intent")) {
        case "rename":
          return client.RenameTeam({ id, name }).pipe(
            Effect.map((team) => team.id),
            Effect.mapError(failureMessage),
            Effect.result,
          );
        case "delete":
          return client
            .DeleteTeam({ id })
            .pipe(
              Effect.as(id),
              Effect.mapError(failureMessage),
              Effect.result,
            );
        default:
          return client.CreateTeam({ name }).pipe(
            Effect.map((team) => team.id),
            Effect.mapError(failureMessage),
            Effect.result,
          );
      }
    },
  );
  if (Result.isFailure(result)) return { ok: false, error: result.failure };
  // Deleting the team being viewed: leave its page before anything reloads
  // it, which would fail now that it's gone.
  if (form.get("intent") === "delete" && form.get("viewing") === id) {
    return redirect("/studio/teams");
  }
  return { ok: true, teamId: result.success };
};

type DialogState =
  | { readonly kind: "create" }
  | { readonly kind: "rename"; readonly team: Team }
  | null;

/**
 * The studio: teams, the selected team's events, and the selected event, side
 * by side. This is the first column; the others come through the outlet.
 */
export function Teams() {
  const teams = useLoaderData<typeof teamsLoader>();
  const [dialog, setDialog] = useState<DialogState>(null);
  return (
    <div className={styles.columns}>
      <Pane
        title="Teams"
        label="Teams"
        actions={
          <Dropdown label="Team list options">
            {(close) => (
              <DropdownItem
                onClick={() => {
                  close();
                  setDialog({ kind: "create" });
                }}
              >
                New team
              </DropdownItem>
            )}
          </Dropdown>
        }
      >
        {teams.length === 0 ? (
          <p className={styles.empty}>No teams yet. Create the first one.</p>
        ) : (
          <ul className={styles.list}>
            {teams.map((team) => (
              <TeamRow
                key={team.id}
                team={team}
                onRename={() => setDialog({ kind: "rename", team })}
              />
            ))}
          </ul>
        )}
      </Pane>
      <TeamDialog state={dialog} onClose={() => setDialog(null)} />
      <Outlet />
    </div>
  );
}

function TeamRow(props: {
  readonly team: Team;
  readonly onRename: () => void;
}) {
  const { team } = props;
  const { teamId } = useParams();
  const deleter = useFetcher<TeamsActionResult>();

  return (
    <li className={styles.row}>
      <NavLink
        to={`/studio/teams/${team.id}`}
        className={({ isActive }) =>
          isActive ? `${styles.item} ${styles.active}` : styles.item
        }
      >
        {team.name}
      </NavLink>
      <span className={styles.menu}>
        <Dropdown label={`Options for ${team.name}`}>
          {(close) => (
            <>
              <DropdownItem
                onClick={() => {
                  close();
                  props.onRename();
                }}
              >
                Rename team…
              </DropdownItem>
              <deleter.Form method="post" action="/studio/teams">
                <input type="hidden" name="id" value={team.id} />
                <input type="hidden" name="viewing" value={teamId ?? ""} />
                <DropdownItem
                  type="submit"
                  name="intent"
                  value="delete"
                  danger
                  disabled={team.documentCount > 0}
                >
                  Delete team
                </DropdownItem>
              </deleter.Form>
              {team.documentCount > 0 ? (
                <DropdownNote>
                  Only teams without events can be deleted.
                </DropdownNote>
              ) : null}
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
  const fetcher = useFetcher<TeamsActionResult>();
  const navigate = useNavigate();
  const { state, onClose } = props;
  const renaming = state?.kind === "rename" ? state.team : null;

  // On success: close, and open a newly created team.
  useEffect(() => {
    if (fetcher.state !== "idle" || fetcher.data?.ok !== true) return;
    const created = fetcher.data.teamId;
    fetcher.reset();
    onClose();
    if (renaming === null) navigate(`/studio/teams/${created}`);
  }, [fetcher, onClose, navigate, renaming]);

  return (
    <Dialog
      open={state !== null}
      title={renaming === null ? "New team" : "Rename team"}
      onClose={() => {
        fetcher.reset();
        onClose();
      }}
    >
      <fetcher.Form method="post" action="/studio/teams">
        <input
          type="hidden"
          name="intent"
          value={renaming === null ? "create" : "rename"}
        />
        {renaming === null ? null : (
          <input type="hidden" name="id" value={renaming.id} />
        )}
        <Input
          name="name"
          aria-label="Team name"
          placeholder="Team name"
          className={dialogStyles.input}
          defaultValue={renaming?.name ?? ""}
          required
          maxLength={100}
          autoFocus
        />
        {fetcher.data?.ok === false ? (
          <p role="alert" className={dialogStyles.error}>
            {fetcher.data.error}
          </p>
        ) : null}
        <div className={dialogStyles.actions}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={fetcher.state !== "idle"}
          >
            {renaming === null ? "Create team" : "Rename team"}
          </Button>
        </div>
      </fetcher.Form>
    </Dialog>
  );
}

export function NoTeamSelected() {
  return (
    <PanePlaceholder span={2}>
      Pick a team to see its events, or create one.
    </PanePlaceholder>
  );
}
