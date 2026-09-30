import { Effect, Result } from "effect";
import {
  type ActionFunctionArgs,
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
} from "react-router";
import { Button } from "../../components/Button.tsx";
import { Input } from "../../components/Input.tsx";
import { Toolbar } from "../../components/Toolbar.tsx";
import { call } from "../../documents/client.ts";
import { formatDate } from "../../time.ts";
import styles from "./Teams.module.css";

export const teamsLoader = () => call((client) => client.ListTeams());

export const createTeamAction = async ({ request }: ActionFunctionArgs) => {
  const name = String((await request.formData()).get("name") ?? "");
  const result = await call((client) =>
    Effect.result(client.CreateTeam({ name })),
  );
  return Result.isSuccess(result)
    ? redirect(`/studio/teams/${result.success.id}`)
    : { error: result.failure.message };
};

/** Every team; posts are created from a team's page. */
export function Teams() {
  const teams = useLoaderData<typeof teamsLoader>();
  const action = useActionData<typeof createTeamAction>();
  return (
    <>
      <Toolbar>
        <h1>Teams</h1>
      </Toolbar>
      {teams.length === 0 ? (
        <p className={styles.empty}>
          No teams yet. Create the first one below.
        </p>
      ) : (
        <ul className={styles.grid}>
          {teams.map((team) => (
            <li key={team.id}>
              <Link to={`/studio/teams/${team.id}`} className={styles.card}>
                {team.name}
                <span className={styles.meta}>
                  Created {formatDate(team.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Form method="post" className={styles.create}>
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
      </Form>
      {action?.error === undefined ? null : (
        <p role="alert" className={styles.error}>
          {action.error}
        </p>
      )}
    </>
  );
}
