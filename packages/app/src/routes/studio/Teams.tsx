import { Effect, Result } from "effect";
import {
  type ActionFunctionArgs,
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
} from "react-router";
import { call } from "../../documents/client.ts";
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
      <h1>Teams</h1>
      {teams.length === 0 ? (
        <p>No teams yet. Create the first one below.</p>
      ) : (
        <ul className={styles.list}>
          {teams.map((team) => (
            <li key={team.id}>
              <Link to={`/studio/teams/${team.id}`}>{team.name}</Link>
            </li>
          ))}
        </ul>
      )}
      <Form method="post" className={styles.create}>
        <input
          name="name"
          aria-label="Team name"
          placeholder="Team name"
          required
          maxLength={100}
        />
        <button type="submit">Create team</button>
      </Form>
      {action?.error === undefined ? null : (
        <p role="alert" className={styles.error}>
          {action.error}
        </p>
      )}
    </>
  );
}
