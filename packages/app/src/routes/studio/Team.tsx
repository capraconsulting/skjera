import type { TeamId } from "@skjera/documents/api";
import { Effect, Result } from "effect";
import {
  type ActionFunctionArgs,
  data,
  Form,
  Link,
  type LoaderFunctionArgs,
  redirect,
  useActionData,
  useLoaderData,
} from "react-router";
import { Toolbar } from "../../components/Toolbar.tsx";
import { call } from "../../documents/client.ts";
import styles from "./Team.module.css";

export const teamLoader = ({ params }: LoaderFunctionArgs) =>
  call((client) =>
    Effect.all({
      team: client.GetTeam({ id: params.teamId as TeamId }),
      posts: client.ListDocuments({
        type: "post",
        teamId: params.teamId as TeamId,
      }),
    }).pipe(
      Effect.catchTag("TeamNotFound", () =>
        Effect.sync(() => {
          throw data("Team not found", { status: 404 });
        }),
      ),
    ),
  );

export const teamAction = async ({ request, params }: ActionFunctionArgs) => {
  const id = params.teamId as TeamId;
  const intent = (await request.formData()).get("intent");
  if (intent === "delete-team") {
    const result = await call((client) =>
      Effect.result(client.DeleteTeam({ id })),
    );
    return Result.isSuccess(result)
      ? redirect("/studio/teams")
      : { error: "Delete or move the team's posts first." };
  }
  const post = await call((client) =>
    client.CreateDocument({ type: "post", teamId: id }),
  );
  return redirect(`/studio/posts/${post}`);
};

/** A team's posts. New posts are created here. */
export function Team() {
  const { team, posts } = useLoaderData<typeof teamLoader>();
  const action = useActionData<typeof teamAction>();
  return (
    <>
      <p>
        <Link to="/studio/teams">Teams</Link>
      </p>
      <Toolbar>
        <h1>{team.name}</h1>
        <Form method="post">
          <button type="submit" name="intent" value="create-post">
            New post
          </button>
        </Form>
      </Toolbar>
      {posts.length === 0 ? (
        <>
          <p>No posts yet.</p>
          <Form method="post">
            <button type="submit" name="intent" value="delete-team">
              Delete team
            </button>
          </Form>
        </>
      ) : (
        <ul className={styles.list}>
          {posts.map((post) => (
            <li key={post.id}>
              <Link to={`/studio/posts/${post.id}`}>
                {post.title.trim() === "" ? "Untitled" : post.title}
              </Link>{" "}
              <span className={styles.badge}>
                {post.publishedAt === null
                  ? "Draft"
                  : post.hasUnpublishedChanges
                    ? "Changed since published"
                    : "Published"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {action?.error === undefined ? null : <p role="alert">{action.error}</p>}
    </>
  );
}
