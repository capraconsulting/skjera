import { Effect, Result } from "effect";
import {
  type ActionFunctionArgs,
  Form,
  NavLink,
  Outlet,
  redirect,
  useActionData,
  useLoaderData,
  useParams,
} from "react-router";
import { Button } from "../../components/Button.tsx";
import { Input } from "../../components/Input.tsx";
import { Pane, PanePlaceholder } from "../../components/Pane.tsx";
import { call } from "../../documents/client.ts";
import styles from "./Teams.module.css";

export const teamsLoader = () => call((client) => client.ListTeams());

/** The team list only changes through its own form. */
export const teamsShouldRevalidate = ({
  formMethod,
}: {
  readonly formMethod?: string | undefined;
}) => formMethod !== undefined;

export const createTeamAction = async ({ request }: ActionFunctionArgs) => {
  const name = String((await request.formData()).get("name") ?? "");
  const result = await call((client) =>
    Effect.result(client.CreateTeam({ name })),
  );
  return Result.isSuccess(result)
    ? redirect(`/studio/teams/${result.success.id}`)
    : { error: result.failure.message };
};

/**
 * The studio: teams, the selected team's events, and the selected event, side
 * by side. This is the first column; the others come through the outlet.
 */
export function Teams() {
  const teams = useLoaderData<typeof teamsLoader>();
  const action = useActionData<typeof createTeamAction>();
  const { teamId } = useParams();
  return (
    <div className={styles.columns}>
      <Pane
        title="Teams"
        label="Teams"
        footer={
          // Creating a team opens it, which gives the form a new key and so
          // clears it; after a failed attempt the name stays for fixing.
          <Form key={teamId} method="post" className={styles.create}>
            <Input
              name="name"
              aria-label="Team name"
              placeholder="New team name"
              required
              maxLength={100}
            />
            <Button type="submit" variant="primary">
              Create team
            </Button>
            {action?.error === undefined ? null : (
              <p role="alert" className={styles.error}>
                {action.error}
              </p>
            )}
          </Form>
        }
      >
        {teams.length === 0 ? (
          <p className={styles.empty}>No teams yet. Create the first one.</p>
        ) : (
          <ul className={styles.list}>
            {teams.map((team) => (
              <li key={team.id}>
                <NavLink
                  to={`/studio/teams/${team.id}`}
                  className={({ isActive }) =>
                    isActive ? `${styles.item} ${styles.active}` : styles.item
                  }
                >
                  {team.name}
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </Pane>
      <Outlet />
    </div>
  );
}

export function NoTeamSelected() {
  return (
    <PanePlaceholder span={2}>
      Pick a team to see its events, or create one.
    </PanePlaceholder>
  );
}
