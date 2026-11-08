import type { TeamId } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { lower, useLiveQuery } from "@tanstack/react-db";
import { Select } from "../../components/Input.tsx";
import { checkboxFieldStyles } from "../../editor/CheckboxField.tsx";
import { teams } from "../../sync/tables.ts";

/**
 * The team that organizes the event, among every team. It can be changed
 * until the event is first published, and after that only shows the team.
 */
export function OrganizerField(props: {
  readonly teamId: TeamId;
  readonly locked: boolean;
  readonly moving: boolean;
  readonly onChoose: (team: TeamId) => void;
}) {
  const choices = useLiveQuery((q) =>
    q
      .from({ team: teams.collection })
      .orderBy(({ team }) => lower(team.name))
      .select(({ team }) => ({ id: team.id, name: team.name })),
  ).data;
  return (
    <div>
      <div className={checkboxFieldStyles.label}>{m.site_organizer()}</div>
      <Select
        aria-label={m.site_organizer()}
        value={props.teamId}
        disabled={props.locked || props.moving}
        onChange={(event) => {
          const team = event.currentTarget.value as TeamId;
          if (team !== props.teamId) props.onChoose(team);
        }}
      >
        {choices.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </Select>
      {props.locked ? (
        <span className={checkboxFieldStyles.hint}>
          {m.studio_organizer_locked()}
        </span>
      ) : null}
    </div>
  );
}
